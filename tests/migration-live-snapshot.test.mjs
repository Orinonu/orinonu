import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore,readDurableState} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';

// Synthetic content only. Counts and field shapes observed read-only on 2026-10-04;
// this test never opens the user's live data directory or copies its reports.
function sanitizedSnapshot(workspace){
 const common={workspace,agent:'codex',profile:'design',specialist:'generalist',max_minutes:60,
  title:'Synthetic mission',goal:'Verify safe migration',acceptance:'Preserve intent and evidence',created_at:'2026-10-04T10:00:00Z'};
 const reports={plan_report:'Synthetic retained plan',planning_run:{report:'Synthetic research'},
  measurement:{usage:{input_tokens:120,output_tokens:20}},observation:{note:'Synthetic evidence'},
  phase_specialists:{planning:'planner',implementation:'developer'},history:[{event:'synthetic'}]};
 const planning=Array.from({length:5},(_,i)=>({...common,...reports,id:`planner-${i}`,status:'planning',
  started_at:'2026-10-04T10:01:00Z',queue:null,pipeline:{status:'planning',auto_implement:true}}));
 const queued=Array.from({length:9},(_,i)=>({...common,...reports,id:`queued-${i}`,status:'queued',
  queue:{id:`intent-${i}`,phase:'implementation',status:'queued',enqueued_at:`2026-10-04T10:02:0${i}Z`},
  pipeline:{status:'waiting_implementation',auto_implement:true}}));
 return {tasks:[...planning,...queued,{...common,...reports,id:'11111111-1111-4111-8111-111111111111',status:'done'},
  {...common,...reports,id:'done-2',status:'done'},{...common,id:'blocked-1',status:'blocked',error:'Synthetic failure'}],
  opportunities:Array.from({length:10},(_,i)=>({id:`proposal-${i}`,status:'pending',evidence:['Synthetic finding']})),
  profiles:{design:{skill:'wayfinder'}},evaluations:[{id:'synthetic-evaluation',score:0.8}],
  scheduler:{planning_limit:8,implementation_limit:8,review_limit:8},last_compaction_time:null};
}

test('sanitized live JSON shape preserves 9 queue intentions and all reports; ambiguous planners reserve workspaces once',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-live-shape-')),legacy=sanitizedSnapshot(dir);
 const original=JSON.stringify(legacy);writeFileSync(join(dir,'state.json'),original);let store;
 try{
  store=createStore(dir,{});let state=store.load();assert.deepEqual(state,legacy);
  store.reconcile(state);
  assert.equal(state.tasks.length,17);assert.deepEqual(state.opportunities,legacy.opportunities);
  assert.deepEqual(state.scheduler,legacy.scheduler);assert.deepEqual(state.evaluations,legacy.evaluations);
  const planners=state.tasks.filter(t=>t.id.startsWith('planner-'));
  assert.equal(planners.length,5);
  for(const task of planners){
   assert.equal(task.status,'blocked');assert.equal(task.attempt.state,'outcome_unknown');
   assert.equal(task.attempt.generation,1);assert.equal(task.pipeline.status,'needs_review');
   assert.equal(task.plan_report,'Synthetic retained plan');assert.equal(task.planning_run.report,'Synthetic research');
   assert.deepEqual(task.measurement,legacy.tasks.find(t=>t.id===task.id).measurement);
   assert.throws(()=>store.admit(state,task.id,'run',{},()=>({ok:true})),{status:409});
  }
  const queued=state.tasks.filter(t=>t.queue?.status==='queued');assert.equal(queued.length,9);
  for(const task of queued){
   assert.deepEqual(task.queue,legacy.tasks.find(t=>t.id===task.id).queue);
   assert.equal(store.claim(state,task.id),false,'Unknown legacy ownership blocks overlapping implementation');
  }
  assert.equal(store.occupants().length,5);
  const identities=planners.map(t=>t.attempt.id);store.close();store=null;
  store=createStore(dir,{});state=store.load();store.reconcile(state);
  assert.deepEqual(state.tasks.filter(t=>t.id.startsWith('planner-')).map(t=>t.attempt.id),identities);
  assert.equal(store.occupants().length,5);assert.deepEqual(readDurableState(dir),state);
  assert.equal(readFileSync(join(dir,'state.json'),'utf8'),original,'Migration leaves original JSON untouched');
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('startup and restart of migrated live-shaped state launch zero executors and reject legacy writer drift',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-live-startup-'));let app,launches=0,decisions=0;
 const legacy=sanitizedSnapshot(dir);writeFileSync(join(dir,'state.json'),JSON.stringify(legacy));
 const options={dataDir:dir,codexPath:process.execPath,runner:()=>{launches++;throw new Error('Unexpected executor');},
  decisionEngine:{call:async()=>{decisions++;throw new Error('Unexpected paid decision');}}};
 try{
  app=createMissionServer(options);await app.listen(0);
  let state=await(await fetch(app.url+'/api/state')).json();
  assert.equal(state.tasks.filter(t=>t.queue?.status==='queued').length,9);
  assert.equal(state.tasks.filter(t=>t.attempt?.state==='outcome_unknown').length,5);
  await app.close();app=null;app=createMissionServer(options);await app.listen(0);
  state=await(await fetch(app.url+'/api/state')).json();
  assert.equal(state.tasks.length,17);assert.equal(launches,0);assert.equal(decisions,0);
  writeFileSync(join(dir,'state.json'),JSON.stringify({...legacy,last_compaction_time:'synthetic-old-writer'}));
  const response=await fetch(app.url+`/api/tasks/${legacy.tasks[14].id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,409);assert.equal(launches,0);assert.equal(decisions,0);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
