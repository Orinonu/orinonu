import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuotaTracker} from '../src/quota-tracker.mjs';

test('quota depletion and reset are shared by both Codex transports',()=>{
 let time=1000;
 const tracker=createQuotaTracker({now:()=>time});
 tracker.markQuotaDepleted('codex-appserver',{cooldownMs:100});
 assert.equal(tracker.isQuotaDepleted('codex'),true);
 assert.equal(tracker.isQuotaDepleted('codex-appserver'),true);
 tracker.resetQuota('codex-appserver');
 assert.equal(tracker.isQuotaDepleted('codex'),false);
 tracker.markQuotaDepleted('codex',{cooldownMs:100});
 assert.equal(tracker.isQuotaDepleted('codex-appserver'),true);
 time=1100;
 assert.equal(tracker.isQuotaDepleted('codex-appserver'),false);
});

test('quota-tracker tracks Devin plan expiration and days remaining', () => {
  const fakeSettings = {
    metadata: () => ({
      providers: [
        { id: 'devin', name: 'Devin / Windsurf', enabled: true, expires_at: '2026-10-15' },
      ],
      fallback_chain: ['devin'],
      auto_fallback: true,
    }),
    credentials: (id) => ({ id, enabled: true, expires_at: '2026-10-15', key: 'test-tok' }),
  };

  // Fixed time: 2026-10-04T12:00:00Z
  const fixedNow = Date.parse('2026-10-04T12:00:00Z');
  const tracker = createQuotaTracker({
    providerSettings: fakeSettings,
    now: () => fixedNow,
    devinPath: process.execPath,
    devinProbe: () => ({ cli_authenticated: true }),
  });

  const summary = tracker.getSummary();
  const devin = summary.providers.find(p => p.id === 'devin');
  assert.equal(devin.status, 'unavailable');
  assert(devin.status_label.includes('dias restantes'));
  assert.equal(tracker.isEligible('devin'), false);

  // Time after expiration: 2026-10-16
  const expiredNow = Date.parse('2026-10-16T12:00:00Z');
  const expiredTracker = createQuotaTracker({
    providerSettings: fakeSettings,
    now: () => expiredNow,
    devinPath: process.execPath,
    devinProbe: () => ({ cli_authenticated: true }),
  });
  const expSummary = expiredTracker.getSummary();
  const expDevin = expSummary.providers.find(p => p.id === 'devin');
  assert.equal(expDevin.status, 'unavailable');
  assert.equal(expDevin.expires_at, '2026-10-15');
  assert.equal(expiredTracker.isEligible('devin'), false);
});

test('credentials and installation alone never admit unverified or missing executors',()=>{
 const settings={credentials:id=>({id,enabled:true,key:'SENTINEL_FAKE_KEY'})};
 const tracker=createQuotaTracker({providerSettings:settings,antigravityPath:process.execPath,devinPath:'C:/missing/devin.exe'});
 for(const id of ['antigravity','openrouter','anthropic','devin','unknown'])assert.equal(tracker.isEligible(id),false,id);
 const unverified=createQuotaTracker({providerSettings:settings,devinPath:process.execPath,devinProbe:()=>({cli_authenticated:false})});
 assert.equal(unverified.isEligible('devin'),false);
 const verified=createQuotaTracker({providerSettings:settings,devinPath:process.execPath,devinProbe:()=>({cli_authenticated:true})});
 assert.equal(verified.isEligible('devin'),false);
 verified.markQuotaDepleted('devin');assert.equal(verified.isEligible('devin'),false);
});

test('quota-tracker activates cooldown on quota depletion and restores after expiry', () => {
  let currentTime = 1000000;
  const fakeSettings = {
    metadata: () => ({
      providers: [{ id: 'codex', name: 'OpenAI Codex', enabled: true }],
      fallback_chain: ['codex'],
      auto_fallback: true,
    }),
    credentials: () => ({ enabled: true }),
  };

  const tracker = createQuotaTracker({
    providerSettings: fakeSettings,
    codexAuth: { state: () => ({ status: 'chatgpt' }) },
    now: () => currentTime,
  });

  assert.equal(tracker.isEligible('codex'), true);

  // Mark depleted with 10 min cooldown
  tracker.markQuotaDepleted('codex', { reason: 'Rate limit 429', cooldownMs: 600000 });
  assert.equal(tracker.isEligible('codex'), false);

  const summary = tracker.getSummary();
  const codex = summary.providers.find(p => p.id === 'codex');
  assert.equal(codex.status, 'quota_depleted');
  assert(codex.status_label.includes('cooldown'));

  // Advance time past cooldown
  currentTime += 700000;
  assert.equal(tracker.isEligible('codex'), true);
});

test('unobserved usage and currency remain unknown in provider balances',async()=>{
 const settings={metadata:()=>({providers:[{id:'openrouter',enabled:true}]}),credentials:()=>({enabled:true,key:'SENTINEL_FAKE_KEY'})};
 for(const usage of [undefined,3]){
  const tracker=createQuotaTracker({providerSettings:settings,fetcher:async()=>({ok:true,json:async()=>({data:{limit:10,...(usage===undefined?{}:{usage})}})})});
  await tracker.refreshRemoteQuota('openrouter');
  const detail=tracker.getSummary().providers[0].limit_detail;
  assert.equal(detail.remaining_usd,usage===undefined?null:7);
  assert.equal(detail.remaining_brl,null);
  assert.equal(detail.used_brl,null);
 }
});

test('disabling execution does not hide an observed account balance',async()=>{
 const settings={metadata:()=>({providers:[{id:'openrouter',enabled:false}]}),credentials:()=>({enabled:false,key:'SENTINEL_FAKE_KEY'})};
 const tracker=createQuotaTracker({providerSettings:settings,fetcher:async()=>({ok:true,json:async()=>({data:{limit:10,usage:3}})})});
 await tracker.refreshRemoteQuota('openrouter');
 const provider=tracker.getSummary().providers[0];
 assert.equal(provider.status,'disabled');
 assert.equal(provider.eligible_for_execution,false);
 assert.equal(provider.limit_detail.remaining_usd,7);
});

test('quota-tracker fetches OpenRouter key limits and calculates balance', async () => {
  const fakeSettings = {
    metadata: () => ({
      providers: [{ id: 'openrouter', name: 'OpenRouter', enabled: true }],
      fallback_chain: ['openrouter'],
      auto_fallback: true,
    }),
    credentials: () => ({ enabled: true, key: 'sk-or-valid-key' }),
  };

  const mockFetcher = async () => ({
    ok: true,
    json: async () => ({
      data: {
        label: 'test-key',
        usage: 3.5,
        limit: 10.0,
        is_free_tier: false,
        rate_limit: { requests: 50, interval: '10s' },
      },
    }),
  });

  const tracker = createQuotaTracker({
    providerSettings: fakeSettings,
    currencyService: { getRate: () => 5.0 },
    fetcher: mockFetcher,
  });

  await tracker.refreshRemoteQuota('openrouter');
  const summary = tracker.getSummary();
  const or = summary.providers.find(p => p.id === 'openrouter');
  assert.equal(or.status, 'unavailable');
  assert.equal(or.eligible_for_execution, false);
  assert.equal(or.limit_detail.used_usd, 3.5);
  assert.equal(or.limit_detail.remaining_usd, 6.5);
  assert.equal(or.limit_detail.remaining_brl, 32.5);
});

test('quota and currency provenance use observation times, never the summary read time',async()=>{
 let time=0,fetchCalls=0,fail=false;
 const settings={metadata:()=>({providers:[{id:'openrouter',enabled:false}]}),credentials:()=>({enabled:false,key:'SENTINEL_FAKE_KEY'})};
 const quote={usd_brl:5,source:'https://example.invalid/rates',fetched_at:'2026-10-04T12:00:00Z',observed_at:'2026-10-04T11:59:00Z',status:'stale'};
 const tracker=createQuotaTracker({providerSettings:settings,now:()=>time,currencyService:{get:()=>quote},fetcher:async(url,options)=>{
  fetchCalls++;
  assert.equal(url,'https://openrouter.ai/api/v1/auth/key');
  assert.equal(options.headers.Authorization,'Bearer SENTINEL_FAKE_KEY');
  if(fail)throw Error('fixture unavailable');
  return {ok:true,json:async()=>({data:{usage:3.5,limit:10}})};
 }});
 const initial=tracker.getSummary();
 assert.equal(fetchCalls,0);
 assert.equal(initial.providers[0].last_checked,null);
 assert.equal(initial.providers[0].limit_detail,null);
 assert.deepEqual(initial.currency,quote);
 await tracker.refreshRemoteQuota('openrouter');
 const observed=tracker.getSummary();
 assert.equal(observed.providers[0].last_checked,'1970-01-01T00:00:00.000Z');
 assert.equal(observed.providers[0].limit_detail.source,'https://openrouter.ai/api/v1/auth/key');
 assert.equal(observed.providers[0].limit_detail.observed_at,'1970-01-01T00:00:00.000Z');
 assert.equal(observed.providers[0].limit_detail.remaining_brl,32.5);
 time=100000;
 fail=true;
 await tracker.refreshRemoteQuota('openrouter');
 const retained=tracker.getSummary();
 assert.equal(retained.current_time,'1970-01-01T00:01:40.000Z');
 assert.equal(retained.providers[0].last_checked,observed.providers[0].last_checked);
 assert.deepEqual(retained.providers[0].limit_detail,observed.providers[0].limit_detail);
 assert.deepEqual(retained.currency,quote);
 assert.doesNotMatch(JSON.stringify(retained),/SENTINEL_FAKE_KEY/);
});

test('only finite nonnegative observed amounts become public balances and exact zeros survive',async()=>{
 const settings={metadata:()=>({providers:[{id:'openrouter',enabled:true}]}),credentials:()=>({enabled:true,key:'SENTINEL_FAKE_KEY'})};
 for(const amount of [undefined,null,'3',NaN,Infinity,-Infinity,-1,0,3.25]){
  const valid=Number.isFinite(amount)&&amount>=0;
  for(const field of ['usage','limit']){
   const data=field==='usage'?{usage:amount,limit:10}:{usage:0,limit:amount};
   const tracker=createQuotaTracker({providerSettings:settings,now:()=>1000,currencyService:{getRate:()=>5},fetcher:async()=>({ok:true,json:async()=>({data})})});
   await tracker.refreshRemoteQuota('openrouter');
   const detail=tracker.getSummary().providers[0].limit_detail;
   assert.equal(detail[field==='usage'?'used_usd':'limit_usd'],valid?amount:null,`${field}: ${String(amount)}`);
   assert.equal(detail.remaining_usd,valid?(field==='usage'?10-amount:amount):null);
   assert.equal(detail.remaining_brl,valid?(field==='usage'?(10-amount)*5:amount*5):null);
  }
 }
 const tracker=createQuotaTracker({providerSettings:settings,now:()=>1000,currencyService:{getRate:()=>5},fetcher:async()=>({ok:true,json:async()=>({data:{usage:0,limit:0}})})});
 await tracker.refreshRemoteQuota('openrouter');
 const detail=tracker.getSummary().providers[0].limit_detail;
 for(const key of ['used_usd','used_brl','limit_usd','limit_brl','remaining_usd','remaining_brl'])assert.equal(detail[key],0,key);
 assert.equal(tracker.isQuotaDepleted('openrouter'),true);
});

test('missing or invalid FX cannot manufacture BRL, source, or observation timestamps',async()=>{
 const settings={metadata:()=>({providers:[{id:'openrouter',enabled:false}]}),credentials:()=>({enabled:false,key:'SENTINEL_FAKE_KEY'})};
 for(const rate of [undefined,null,'5.5',NaN,Infinity,-Infinity,0,-5,5]){
  const valid=Number.isFinite(rate)&&rate>0;
  const tracker=createQuotaTracker({providerSettings:settings,currencyService:{getRate:()=>rate},fetcher:async()=>({ok:true,json:async()=>({data:{usage:0,limit:10}})})});
  await tracker.refreshRemoteQuota('openrouter');
  const summary=tracker.getSummary(),detail=summary.providers[0].limit_detail;
  assert.equal(detail.used_usd,0);
  assert.equal(detail.remaining_usd,10);
  assert.equal(detail.used_brl,valid?0:null);
  assert.equal(detail.remaining_brl,valid?50:null);
  assert.equal(summary.currency.usd_brl,valid?rate:null);
  assert.equal(summary.currency.source,valid?'currency_service':'unknown');
  assert.equal(summary.currency.observed_at,null);
  assert.equal(summary.currency.fetched_at,null);
 }
 const tracker=createQuotaTracker({providerSettings:settings,currencyService:{get:()=>({usd_brl:null,status:'unavailable'}),getRate:()=>5.5},fetcher:async()=>({ok:true,json:async()=>({data:{usage:0,limit:10}})})});
 await tracker.refreshRemoteQuota('openrouter');
 assert.equal(tracker.getSummary().providers[0].limit_detail.remaining_brl,null);
});

test('an invalid FX snapshot cannot claim availability or replace its missing rate with a fallback',()=>{
 for(const rate of [null,'5.5',NaN,Infinity,0,-5]){
  const tracker=createQuotaTracker({currencyService:{get:()=>({usd_brl:rate,source:'https://example.invalid/rates',fetched_at:'invalid',observed_at:'invalid',status:'available'}),getRate:()=>5.5}});
  const currency=tracker.getSummary().currency;
  assert.equal(currency.usd_brl,null);
  assert.equal(currency.status,'unavailable');
  assert.equal(currency.source,'https://example.invalid/rates');
  assert.equal(currency.fetched_at,null);
  assert.equal(currency.observed_at,null);
 }
});

test('unknown observations and overflowing conversions stay null without changing admission or cooldown',async()=>{
 let time=1000;
 const settings={metadata:()=>({providers:[{id:'openrouter',enabled:false}]}),credentials:()=>({enabled:false,key:'SENTINEL_FAKE_KEY'})};
 const tracker=createQuotaTracker({providerSettings:settings,now:()=>time,currencyService:{getRate:()=>Number.MAX_VALUE},fetcher:async()=>({ok:true,json:async()=>({data:{usage:0,limit:10}})})});
 await tracker.refreshRemoteQuota('openrouter');
 assert.equal(tracker.getSummary().providers[0].limit_detail.remaining_usd,10);
 assert.equal(tracker.getSummary().providers[0].limit_detail.remaining_brl,null);
 assert.equal(tracker.isEligible('openrouter'),false);
 assert.equal(tracker.isQuotaDepleted('openrouter'),false);
 tracker.markQuotaDepleted('codex-appserver',{cooldownMs:100});
 tracker.getSummary();
 assert.equal(tracker.isQuotaDepleted('codex'),true);
 time=1100;
 assert.equal(tracker.isQuotaDepleted('codex'),false);
 const unknown=createQuotaTracker({providerSettings:settings,now:()=>time,fetcher:async()=>({ok:false})});
 await unknown.refreshRemoteQuota('openrouter');
 assert.equal(unknown.getSummary().providers[0].last_checked,null);
 assert.equal(unknown.getSummary().providers[0].limit_detail,null);
});

test('local expiry provenance survives quota metadata without certifying a subscription or changing eligibility',()=>{
 const expiry='2999-01-01T00:00:00Z';
 const settings={metadata:()=>({providers:[{id:'devin',enabled:true,expires_at:expiry,expires_at_source:'local_declaration'}]}),credentials:()=>({enabled:true,expires_at:expiry,key:'SENTINEL_FAKE_KEY'})};
 const tracker=createQuotaTracker({providerSettings:settings,devinPath:process.execPath,devinProbe:()=>({cli_authenticated:true}),now:()=>Date.parse('2026-10-04T12:00:00Z')});
 const provider=tracker.getSummary().providers[0];
 assert.equal(provider.expires_at,expiry);
 assert.equal(provider.expires_at_source,'local_declaration');
 assert.match(provider.status_label,/política local/i);
 assert.doesNotMatch(provider.status_label,/Plano ativo|assinatura ativa/i);
 assert.equal(provider.last_checked,null);
 assert.equal(provider.eligible_for_execution,false);
 tracker.markQuotaDepleted('devin');
 assert.equal(tracker.isEligible('devin'),false);
});
