import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeRate,toBrl,withBrl,rateSource} from '../src/currency.mjs';
import {currencyCache} from '../src/currency-cache.mjs';
import {createMissionServer} from '../src/server.mjs';

const quote=()=>({USDBRL:{bid:'5.40',ask:'5.44',create_date:'2026-10-04 09:00:00'}});

test('rate keeps the mid-market reference, single sides and explicit values',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-04T12:00:00Z'));
 const rate=normalizeRate(quote(),'2026-10-04T12:00:00Z');
 assert.equal(rate.source,rateSource);assert.equal(rate.usd_brl,5.42);assert.equal(rate.bid,5.4);assert.equal(rate.ask,5.44);
 assert.equal(rate.observed_at,'2026-10-04 09:00:00');assert.equal(rate.status,'available');
 assert.equal(normalizeRate({USDBRL:{bid:'5.4'}},'2026-10-04T12:00:00Z').usd_brl,5.4);
 assert.equal(normalizeRate({rate:5.5},'2026-10-04T12:00:00Z').usd_brl,5.5);
 assert.equal(normalizeRate({USDBRL:{bid:'0',ask:'-1'}},'2026-10-04T12:00:00Z').usd_brl,null);
 assert.equal(normalizeRate(null,'2026-10-04T12:00:00Z').status,'unavailable');
 assert.equal(normalizeRate(quote(),'2000-01-01T00:00:00Z').status,'stale');
});

test('conversion returns unknown instead of zero when a side is missing',()=>{
 assert.equal(toBrl(2,5.42),10.84);assert.equal(toBrl(0,5.42),0);
 assert.equal(toBrl(2,null),null);assert.equal(toBrl(null,5.42),null);
 assert.equal(toBrl(2,0),null);assert.equal(toBrl(2,-3),null);assert.equal(toBrl(2,Number.NaN),null);
});

test('withBrl decorates every estimate and totals without mutating the source',()=>{
 const analytics={pricing:{},jev:{input_tokens:100,output_tokens:2,estimated_usd:0.000106,unpriced_calls:0,cached_calls:1},
  executor:{input_tokens:3000,output_tokens:300,estimated_usd:0.0084,unpriced_calls:0},
  simulations:[{model:'openai/worker',estimated_usd:0.002,jev_estimated_usd:0.000106,difference_usd:0.001894}],
  tasks:[{task_id:'t',title:'T',input_tokens:3100,output_tokens:302,estimated_usd:0.008506,seconds:3,active:false}]};
 const decorated=withBrl(analytics,5.42);
 assert.equal(decorated.jev.estimated_brl,0.00057452);assert.equal(decorated.executor.estimated_brl,0.045528);
 assert.equal(decorated.tasks[0].estimated_brl,0.04610252);assert.equal(decorated.simulations[0].difference_brl,0.01026548);
 assert.deepEqual(decorated.totals,{estimated_usd:0.008506,estimated_brl:0.04610252,input_tokens:3100,output_tokens:302,seconds:3,unpriced_calls:0});
 assert.equal(analytics.jev.estimated_brl,undefined);assert.equal(analytics.totals,undefined);
});

test('totals stay unknown when a part of the estimate is unknown',()=>{
 const decorated=withBrl({jev:{input_tokens:null,output_tokens:null,estimated_usd:null,unpriced_calls:2},executor:{input_tokens:10,output_tokens:1,estimated_usd:0.0001,unpriced_calls:0},tasks:[{seconds:null}]},5.42);
 assert.equal(decorated.totals.estimated_usd,null);assert.equal(decorated.totals.estimated_brl,null);
 assert.equal(decorated.totals.input_tokens,null);assert.equal(decorated.totals.seconds,null);assert.equal(decorated.totals.unpriced_calls,2);
 assert.equal(withBrl({jev:{estimated_usd:1,unpriced_calls:0},executor:{estimated_usd:1,unpriced_calls:0},tasks:[]},null).totals.estimated_brl,null);
});

test('currency cache persists the last reference and survives failures',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-currency-'));
 try{
  const fetcher=async()=>({ok:true,json:async()=>quote()});
  const cache=currencyCache(dir,{fetcher});assert.equal(cache.get(),null);
  const refreshed=await cache.refresh();assert.equal(refreshed.usd_brl,5.42);assert.equal(cache.status().error,null);
  const saved=JSON.parse(readFileSync(join(dir,'currency.json'),'utf8'));assert.equal(saved.payload.USDBRL.bid,'5.40');
  const reloaded=currencyCache(dir,{fetcher});assert.equal(reloaded.get().usd_brl,5.42);
  const failing=currencyCache(dir,{fetcher:async()=>{throw new Error('offline');}});
  await failing.refresh();assert.equal(failing.get().usd_brl,5.42);assert.match(failing.status().error,/última referência preservada/);
  const invalid=currencyCache(dir,{fetcher:async()=>({ok:true,json:async()=>({USDBRL:{bid:'0'}})})});
  await invalid.refresh();assert.equal(invalid.get().usd_brl,5.42);assert.ok(invalid.status().error);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('state exposes the public quote and converts analytics and measured savings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-currency-state-'));
 try{
  writeFileSync(join(dir,'events.ndjson'),[
   {provider:'typesafe',kind:'jev_decision',ok:true,model:'jev-1.13.0',cached:false,usage:{input_tokens:1000,output_tokens:20}},
   {kind:'codex_usage',task_id:'t',model:'worker',usage:{input_tokens:1000,output_tokens:100}}
  ].map(row=>JSON.stringify(row)).join('\n')+'\n');
  const fetcher=async url=>url.includes('economia.awesomeapi')
   ?{ok:true,json:async()=>quote()}
   :{ok:true,json:async()=>url.endsWith('/endpoints')?{data:{id:'typesafe/jev-1.13',endpoints:[{provider_name:'TypeSafe',pricing:{prompt:'0.000000042',completion:'0'}}]}}:{data:[{id:'openai/worker',pricing:{prompt:'0.000002',completion:'0.000008'}}]}};
  const app=createMissionServer({dataDir:dir,pricingFetcher:fetcher,currencyFetcher:fetcher});await app.listen(0);
  try{
   await fetch(app.url+'/api/pricing/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const refreshed=await(await fetch(app.url+'/api/currency/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
   assert.equal(refreshed.usd_brl,5.42);assert.equal(refreshed.status,'available');assert.equal(refreshed.refresh.refreshing,false);
   const state=await(await fetch(app.url+'/api/state')).json();
   assert.equal(state.analytics.currency.usd_brl,5.42);
   assert.equal(state.analytics.jev.estimated_brl,0.00022764);
   assert.equal(state.analytics.executor.estimated_brl,0.015176);
   assert.equal(state.analytics.totals.estimated_brl,0.01540364);
   assert.equal(state.metrics.saved_brl,null);assert.equal(state.metrics.saved_usd,null);
  }finally{await app.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
