import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCatalog,estimateUsage,usageAnalytics} from '../src/pricing.mjs';

const catalog=()=>normalizeCatalog({data:[
 {id:'openai/worker',pricing:{prompt:'0.000002',completion:'0.000008',input_cache_read:'0.000001'}},
 {id:'typesafe/jev',pricing:{prompt:'0.000001',completion:'0.000003'}}
]},'2026-10-04T00:00:00Z');

test('catalog converts per-token prices, keeps zero and rejects negative or absent prices',()=>{
 const c=normalizeCatalog({data:[{id:'a',pricing:{prompt:'0',completion:'-1'}},{id:'b',pricing:{prompt:'',completion:null}}]},'now');
 assert.equal(c.models[0].input_per_million,0);assert.equal(c.models[0].output_per_million,null);
 assert.equal(c.models[1].input_per_million,null);assert.equal(c.models[1].output_per_million,null);
 assert.equal(normalizeCatalog(null,'now').status,'unavailable');
});

test('estimates subtract cached input once and require its price only when used',()=>{
 const p=catalog().models[0];
 assert.equal(estimateUsage({input_tokens:1000,output_tokens:100,cached_input_tokens:400},p),0.0024);
 assert.equal(estimateUsage({input_tokens:1000,output_tokens:100,cached_input_tokens:400},{...p,cache_input_per_million:null}),null);
 assert.equal(estimateUsage({input_tokens:10,output_tokens:0}, {...p,output_per_million:null}),0.00002);
 assert.equal(estimateUsage({input_tokens:10,output_tokens:1}, {...p,output_per_million:null}),null);
 assert.equal(estimateUsage({input_tokens:10,output_tokens:1,cached_input_tokens:11},p),null);
 assert.equal(estimateUsage({input_tokens:-10,output_tokens:1},p),null);
 assert.equal(estimateUsage(null,p),null);
});

test('analytics aggregates actual turns across phases without counting measurement again or cached JEV',()=>{
 const events=[
  {provider:'typesafe',kind:'jev_decision',model:'typesafe/jev',usage:{input_tokens:100,output_tokens:2}},
  {provider:'typesafe',kind:'jev_decision',model:'typesafe/jev',cached:true,usage:{input_tokens:900,output_tokens:99}},
  {kind:'codex_usage',task_id:'t',model:'worker',usage:{input_tokens:1000,output_tokens:100}},
  {kind:'codex_usage',task_id:'t',model:'worker',usage:{input_tokens:2000,output_tokens:200}}
 ];
 const tasks=[{id:'t',title:'Task',measurement:{model:'worker',execution_ms:2000,usage:{input_tokens:99999,output_tokens:99999}},planning_run:{measurement:{execution_ms:1000,usage:{input_tokens:99999,output_tokens:99999}}}}];
 const a=usageAnalytics(events,tasks,catalog());
 assert.equal(a.jev.input_tokens,100);assert.equal(a.jev.output_tokens,2);assert.equal(a.jev.cached_calls,1);
 assert.equal(a.executor.input_tokens,3000);assert.equal(a.executor.output_tokens,300);assert.equal(a.tasks[0].seconds,3);
 assert.equal(a.tasks[0].estimated_usd,0.0084);assert.equal(a.executor.estimated_usd,0.0084);
 assert.equal(a.simulations[0].estimated_usd,0.000216);assert.equal(a.simulations[0].jev_estimated_usd,0.000106);
});

test('missing price or usage makes totals unknown rather than a misleading partial zero',()=>{
 const a=usageAnalytics([{provider:'typesafe',model:'absent',usage:{input_tokens:20,output_tokens:2}},{provider:'typesafe',model:'typesafe/jev'}],[],catalog());
 assert.equal(a.jev.estimated_usd,null);assert.equal(a.jev.input_tokens,null);assert.equal(a.jev.unpriced_calls,2);
 const empty=usageAnalytics([],[],catalog());assert.equal(empty.jev.estimated_usd,null);assert.equal(empty.executor.input_tokens,null);
 const partial=usageAnalytics([{kind:'codex_usage',task_id:'measured',model:'worker',usage:{input_tokens:20,output_tokens:2}}],
  [{id:'unmeasured',measurement:{model:'worker',usage:null}}],catalog());
 assert.equal(partial.executor.estimated_usd,null);assert.equal(partial.executor.input_tokens,null);assert.equal(partial.executor.unpriced_calls,1);
});

test('measurement fallback accounts for both phases and unknown context metadata never invents usage',()=>{
 const tasks=[{id:'t',title:'Two phases',measurement:{model:'worker',execution_ms:200,usage:{input_tokens:20,output_tokens:2}},planning_run:{measurement:{model:'worker',execution_ms:100,usage:{input_tokens:10,output_tokens:1}}}}];
 const a=usageAnalytics([],tasks,catalog());assert.equal(a.tasks[0].input_tokens,30);assert.equal(a.tasks[0].seconds,0.3);
 const uncertain=usageAnalytics([{kind:'context_threshold',task_id:'t',usage:{input_tokens:500,output_tokens:5}}],[],catalog());
 assert.equal(uncertain.executor.estimated_usd,null);assert.equal(uncertain.executor.input_tokens,null);
});

test('verified JEV alias accepts endpoint pricing and never aliases an unverified version',()=>{
 const c=normalizeCatalog({data:[{id:'typesafe/jev-1.13',endpoints:[{pricing:{prompt:'0.000000042',completion:'0'}}]}]},new Date().toISOString());
 const a=usageAnalytics([{provider:'typesafe',model:'jev-1.13.0',usage:{input_tokens:1000,output_tokens:20}}],[],c);
 assert.equal(a.jev.estimated_usd,0.000042);
 assert.equal(usageAnalytics([{provider:'typesafe',model:'jev-latest',usage:{input_tokens:1000,output_tokens:0}}],[],c).jev.estimated_usd,null);
 assert.equal(c.status,'available');assert.equal(normalizeCatalog({data:[{id:'a',pricing:{prompt:'0',completion:'0'}}]},'2000-01-01').status,'stale');
});

test('tiered context pricing uses base only below request threshold, leaving ambiguous turn totals unknown',()=>{
 const c=normalizeCatalog({data:[{id:'openai/tiered',pricing:{prompt:'0.000002',completion:'0.00001',overrides:[{min_prompt_tokens:272000,prompt:'0.000004',completion:'0.000015'}]}}]},new Date().toISOString());
 assert.equal(estimateUsage({input_tokens:1000,output_tokens:1},c.models[0]),0.00201);
 assert.equal(estimateUsage({input_tokens:272000,output_tokens:1},c.models[0]),null);
 assert.equal(estimateUsage({input_tokens:500000,output_tokens:1},c.models[0]),null);
});

test('task totals include JEV overhead and both executor phases without charging cached decisions twice',()=>{
 const events=[
  {provider:'typesafe',task_id:'t',model:'typesafe/jev',usage:{input_tokens:100,output_tokens:2}},
  {provider:'typesafe',task_id:'t',model:'typesafe/jev',cached:true,usage:{input_tokens:100,output_tokens:2}},
  {provider:'typesafe',task_id:'other',model:'typesafe/jev',usage:{input_tokens:9000,output_tokens:20}},
  {kind:'codex_usage',task_id:'t',model:'worker',usage:{input_tokens:1000,output_tokens:100}},
  {kind:'codex_usage',task_id:'t',model:'worker',usage:{input_tokens:2000,output_tokens:200}}
 ];
 const tasks=[{id:'t',measurement:{model:'worker',execution_ms:2000},planning_run:{measurement:{model:'worker',execution_ms:1000}}}];
 const row=usageAnalytics(events,tasks,catalog()).tasks[0];
 assert.equal(row.input_tokens,3100);assert.equal(row.output_tokens,302);assert.equal(row.estimated_usd,0.008506);
 assert.equal(row.executor_input_tokens,3000);assert.equal(row.jev_input_tokens,100);assert.equal(row.jev_estimated_usd,0.000106);
 assert.equal(row.executor_estimated_usd,0.0084);assert.equal(row.jev_cached_calls,1);assert.equal(row.seconds,3);
});

test('task estimates remain unknown when an associated JEV call is unpriced or missing usage',()=>{
 const task={id:'t',measurement:{model:'worker',usage:{input_tokens:1000,output_tokens:100},execution_ms:1000}};
 const row=usageAnalytics([{provider:'typesafe',task_id:'t',model:'missing',usage:{input_tokens:100,output_tokens:2}}],[task],catalog()).tasks[0];
 assert.equal(row.estimated_usd,null);assert.equal(row.unpriced_calls,1);assert.equal(row.executor_estimated_usd,0.0028);
 const absent=usageAnalytics([{provider:'typesafe',task_id:'t',model:'typesafe/jev'}],[task],catalog()).tasks[0];
 assert.equal(absent.estimated_usd,null);assert.equal(absent.input_tokens,null);assert.equal(absent.jev_input_tokens,null);
});

test('task time sums finished reruns, exposes active partial coverage and never adds snapshots again',()=>{
 const events=[{kind:'task_finished',task_id:'t',duration_ms:1000},{kind:'task_finished',task_id:'t',duration_ms:2000},{kind:'task_finished',task_id:'other',duration_ms:99000}];
 const task={id:'t',status:'running',measurement:{model:'worker',execution_ms:500,usage:{input_tokens:10,output_tokens:1}},planning_run:{measurement:{execution_ms:500}}};
 const row=usageAnalytics(events,[task],catalog()).tasks[0];
 assert.equal(row.seconds,3);assert.equal(row.active,true);assert.equal(row.seconds_scope,'finished_runs_only');
 assert.match(usageAnalytics(events,[task],catalog()).note,/tempo parcial/);
 const invalid=usageAnalytics([...events,{kind:'task_finished',task_id:'t'}],[task],catalog()).tasks[0];assert.equal(invalid.seconds,null);
});

test('fallback handles planning, implementation and review snapshots, deduplicating current run identity',()=>{
 const task={id:'t',started_at:'run2',measurement:{model:'worker',execution_ms:2000,usage:{input_tokens:20,output_tokens:2}},
  implementation_run:{started_at:'run2',measurement:{model:'worker',execution_ms:2000,usage:{input_tokens:20,output_tokens:2}}},
  planning_run:{started_at:'run1',measurement:{model:'worker',execution_ms:1000,usage:{input_tokens:10,output_tokens:1}}}};
 let row=usageAnalytics([],[task],catalog()).tasks[0];assert.equal(row.seconds,3);assert.equal(row.input_tokens,30);
 task.started_at='run3';task.measurement={model:'worker',execution_ms:500,usage:{input_tokens:5,output_tokens:1}};
 row=usageAnalytics([],[task],catalog()).tasks[0];assert.equal(row.seconds,3.5);assert.equal(row.input_tokens,35);
});
