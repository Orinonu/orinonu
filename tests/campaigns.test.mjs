import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCampaign,campaignPairs,summarizeCampaign } from '../src/campaigns.mjs';
import { validateComparisons } from '../src/comparisons.mjs';
import { createStore } from '../src/store.mjs';
import { createMissionServer } from '../src/server.mjs';

const spec={title:'Effort alto na implementação',hypothesis:'Effort high reduz retrabalho sem aumentar custo medido.',benchmark_id:'mission-set-impl-v1',baseline_config:'gpt-6.1-sol/medium/implementation',candidate_config:'gpt-6.1-sol/high/implementation',workspace:'/work/alpha'};
const arm=(config,over={})=>({config,accepted:true,seconds:30,cost_usd:0.3,evidence:'tests.log',tokens:100,interventions:0,...over});
const win=(i,over={})=>({id:'p'+i,benchmark_id:'mission-set-impl-v1',controlled:true,project:'/work/alpha',baseline:arm('gpt-6.1-sol/medium/implementation',{seconds:30,cost_usd:0.3}),candidate:arm('gpt-6.1-sol/high/implementation',{seconds:20,cost_usd:0.1}),...over});
const wins=Array.from({length:10},(_,i)=>win(i));

test('defineCampaign validates a bounded, forbidden-key-free experiment spec',()=>{
  const c=defineCampaign(spec);
  assert(c.id&&c.created_at);assert.equal(c.min_pairs,10);assert.equal(c.max_pairs,10);assert.equal(c.status,'collecting');
  assert.equal(c.budget_usd,null);
  for(const bad of [
    {},// empty
    {...spec,title:''},
    {...spec,hypothesis:'x'.repeat(2001)},
    {...spec,benchmark_id:''},
    {...spec,baseline_config:spec.candidate_config},// arms identical
    {...spec,candidate_config:'run `rm -rf` hook'},// forbidden word
    {...spec,candidate_config:'call this command'},
    {...spec,min_pairs:0},{...spec,max_pairs:21},{...spec,min_pairs:8,max_pairs:4},
    {...spec,budget_usd:-1},{...spec,budget_usd:Infinity},
    {...spec,workspace:''},{...spec,workspace:5},
  ])assert.throws(()=>defineCampaign(bad),/./,JSON.stringify(bad));
  assert.equal(defineCampaign({...spec,min_pairs:4,max_pairs:12,budget_usd:2}).max_pairs,12);
});

test('campaignPairs selects only measured pairs of this project, benchmark and arms',()=>{
  const c=defineCampaign(spec);
  const others=validateComparisons({pairs:[
    {...win('x'),project:'/work/beta'},// other project
    {...win('y'),benchmark_id:'other-benchmark'},
    {...win('z'),candidate:arm('gpt-6-astra/low/implementation',{seconds:20,cost_usd:0.1})},// other candidate
    {...win('w'),project:undefined},
    win('ok'),
  ]});
  const selected=campaignPairs(c,others);
  assert.deepEqual(selected.map(p=>p.id),['pok']);
  assert.equal(campaignPairs(c,validateComparisons({pairs:wins})).length,10);
});

test('verdicts: fewer controlled pairs or unknown savings stay insufficient; regression rejects',()=>{
  const c=defineCampaign(spec);
  const few=summarizeCampaign(c,validateComparisons({pairs:wins.slice(0,9)}));
  assert.equal(few.verdict,'insufficient_evidence');
  assert.equal(few.applied,false);assert.match(few.rollback,/nada é aplicado|restaurar/i);
  assert(few.reasons.some(r=>/pares controlados/.test(r)));
  // unmeasured candidate costs keep savings unknown
  const noCost=summarizeCampaign(c,validateComparisons({pairs:wins.map(p=>({...p,candidate:{...p.candidate,cost_usd:null}}))}));
  assert.equal(noCost.verdict,'insufficient_evidence');assert(noCost.unknowns.includes('cost_usd'));
  // uncontrolled pairs never satisfy evidence
  const loose=summarizeCampaign(c,validateComparisons({pairs:wins.map(p=>({...p,controlled:false}))}));
  assert.equal(loose.verdict,'insufficient_evidence');
  // candidate regression rejects
  const regressed=summarizeCampaign(c,validateComparisons({pairs:[...wins.slice(0,9),{...win('r'),candidate:arm('gpt-6.1-sol/high/implementation',{accepted:false})}]}));
  assert.equal(regressed.verdict,'reject');assert.equal(regressed.applied,false);
  // slower+pricier candidate rejects even accepted
  const loss=Array.from({length:10},(_,i)=>win('l'+i,{candidate:arm('gpt-6.1-sol/high/implementation',{seconds:40,cost_usd:0.5})}));
  assert.equal(summarizeCampaign(c,validateComparisons({pairs:loss})).verdict,'reject');
});

test('a winning campaign recommends without applying; unknowns stay explicit; budget is measured',()=>{
  const c=defineCampaign({...spec,budget_usd:8});
  const report=summarizeCampaign(c,validateComparisons({pairs:wins}));
  assert.equal(report.verdict,'recommend');assert.equal(report.applied,false);
  assert.equal(report.proven_saved_seconds,100);assert.equal(report.proven_saved_usd>1.99&&report.proven_saved_usd<2.01,true);
  assert.equal(report.budget.declared_usd,8);assert.equal(report.budget.measured_usd>3.9&&report.budget.measured_usd<4.1,true);assert.equal(report.budget.measured,true);
  assert.match(report.rollback,/restaurar|reverter/i);assert.match(report.rollback,/gpt-6\.1-sol\/medium\/implementation/);
  assert.deepEqual(report.unknowns,[]);
  // when a measured dimension is missing on an accepted controlled pair it stays an explicit unknown
  const noTokens=validateComparisons({pairs:wins.map(p=>({...p,baseline:{...p.baseline,tokens:null},candidate:{...p.candidate,tokens:null}}))});
  const partial=summarizeCampaign(c,noTokens);
  assert.equal(partial.proven_saved_tokens,null);assert(partial.unknowns.includes('tokens'));
});

test('campaign endpoints record and report real mission pairs; nothing is applied and profiles are untouched',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'nexo-campaigns-')),dataDir=join(dir,'state');mkdirSync(dataDir);
  const store=createStore(dataDir,{tasks:[],profiles:{implementation:{model:'gpt-6.1-sol',effort:'medium'}}}),db=store.load();
  db.comparisons=validateComparisons({pairs:wins.map(p=>({...p,project:dir}))});
  store.save(db);store.close();
  const app=createMissionServer({dataDir,codexPath:process.execPath});await app.listen(0);
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  // invalid specs are refused before anything is recorded
  assert.equal((await post('/api/campaigns',{title:'x'})).status,400);
  const created=await(await post('/api/campaigns',{...spec,workspace:dir})).json();
  assert.equal(created.status,'collecting');assert.equal(created.applied,false);assert.equal(created.measured_pairs,10);
  const report=await(await post(`/api/campaigns/${created.id}/report`,{})).json();
  assert.equal(report.verdict,'recommend');assert.equal(report.applied,false);
  assert.match(report.rollback,/reverter|restaurar/i);
  // reporting is idempotent and the campaign carries the last verdict durably
  const again=await(await post(`/api/campaigns/${created.id}/report`,{})).json();
  assert.equal(again.verdict,'recommend');
  const evolution=await(await fetch(app.url+'/api/evolution')).json();
  const stored=evolution.eval_campaigns.find(row=>row.id===created.id);
  assert.equal(stored.last_report.verdict,'recommend');assert.equal(stored.applied,false);
  // a recommendation changes no profile — only the existing reviewed PATCH can
  const state=await(await fetch(app.url+'/api/state')).json();
  assert.equal(state.profiles.implementation.effort,'medium');
  assert.equal((await post('/api/campaigns/'+randomId()+'/report',{})).status,404);
  function randomId(){return '00000000-0000-4000-8000-000000000000';}
});
