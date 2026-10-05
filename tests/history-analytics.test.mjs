import test from 'node:test';
import assert from 'node:assert/strict';
import {usageAnalytics as reference} from './reference/pricing.mjs';
import {createHistoryAnalytics} from '../src/history-analytics.mjs';

const catalog={models:[{id:'openai/worker',input_per_million:2,output_per_million:8,cache_input_per_million:1},{id:'typesafe/jev-1.13',input_per_million:0.042,output_per_million:0}]};
test('historical projection equals independent reference through append, task changes and repricing',()=>{
 const events=[{provider:'typesafe',ok:true,model:'jev-1.13.0',task_id:'t',usage:{input_tokens:100,output_tokens:2}},
  {kind:'codex_usage',task_id:'t',model:'worker',usage:{input_tokens:1000,output_tokens:10}},
  {provider:'typesafe',cached:true,task_id:'t'}, {kind:'task_finished',task_id:'t',duration_ms:1200},
  ...Array.from({length:1001},()=>({kind:'tool_observed'}))];
 const tasks=[{id:'t',title:'Measured',status:'running'},{id:'fallback',started_at:'run',measurement:{model:'worker',execution_ms:100,usage:{input_tokens:5,output_tokens:1}},implementation_run:{started_at:'run',measurement:{model:'worker',execution_ms:100,usage:{input_tokens:5,output_tokens:1}}}}];
 const projection=createHistoryAnalytics();
 let generation={events,revision:1,appendFrom:0};
 assert.deepEqual(projection.read(generation,tasks,catalog).analytics,reference(events,tasks,catalog));
 const before=projection.diagnostics();
 projection.read(generation,tasks,catalog);
 assert.deepEqual(projection.diagnostics(),before);
 generation={events:[...events,{provider:'typesafe',task_id:'t',model:'missing'}],revision:2,appendFrom:events.length};
 assert.deepEqual(projection.read(generation,tasks,catalog).analytics,reference(generation.events,tasks,catalog));
 tasks[1].measurement.usage.input_tokens=50;tasks[0].status='done';
 assert.deepEqual(projection.read(generation,tasks,catalog).analytics,reference(generation.events,tasks,catalog));
 const repriced={...catalog,models:catalog.models.map(p=>({...p,input_per_million:10}))};
 assert.deepEqual(projection.read(generation,tasks,repriced).analytics,reference(generation.events,tasks,repriced));
 assert.deepEqual(projection.read({events:[],revision:3,appendFrom:null},tasks,repriced).analytics,reference([],tasks,repriced));
});

test('indexed projections preserve unknown totals, thresholds, ordering and fallbacks across deterministic sequences',()=>{
 const projection=createHistoryAnalytics();let events=[],revision=0;
 const tasks=[{id:'a',title:'A',status:'planning',measurement:{model:'worker',usage:{input_tokens:10,output_tokens:2},execution_ms:100}},
  {id:'b',title:'B',status:'review',measurement:{model:'unknown',usage:null,execution_ms:null}}];
 const prices={...catalog,models:[...catalog.models,{id:'openai/tiered',input_per_million:2,output_per_million:8,pricing_overrides:[{min_prompt_tokens:200}]}]};
 for(let i=0;i<70;i++){
  const task_id=i%3===0?undefined:i%2?'a':'b';
  const e=i%4===0?{kind:'task_finished',task_id,duration_ms:i%8===0?undefined:i*10}:
   {kind:i%3===0?'codex_usage':'jev_decision',provider:i%3===0?'openai':'typesafe',task_id,ok:i%5===0,cached:i%11===0?true:i%7===0?'yes':false,
    model:i%9===0?'tiered':i%3===0?'worker':'jev-1.13.0',usage:i%13===0?undefined:{input_tokens:i*13,output_tokens:i%5,cached_input_tokens:i%2}};
  const from=events.length;events=[...events,e];revision++;
  if(i%10===0)tasks[0].measurement.usage.input_tokens++;
  assert.deepEqual(projection.read({events,revision,appendFrom:from},tasks,prices).analytics,reference(events,tasks,prices),`step ${i}`);
 }
 const before=projection.diagnostics();tasks[0].title='Updated';
 projection.read({events,revision,appendFrom:events.length-1},tasks,prices);
 assert.equal(projection.diagnostics().taskProjections-before.taskProjections,1);
});
