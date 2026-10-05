import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBudgetLedger} from '../src/budget-ledger.mjs';
import {budgetDecisionEngine} from '../src/budget-dispatch.mjs';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';
const phases=['planning','implementation','review','recovery','jev'];
const policy={version:1,enabled:true,activation:'from_configuration',unknown_policy:'retain_reservation',limits:{total_tokens:0},envelopes:Object.fromEntries(phases.map(p=>[p,{total_tokens:1}]))};
for(const phase of ['planning','implementation'])test(`configured exhaustion prevents ${phase} inference and preserves queue intention`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'budget-api-'));let inference=0;
 const app=createMissionServer({dataDir:dir,codexPath:process.execPath,runner:()=>{inference++;throw Error('should not dispatch');},decisionEngine:{call:async()=>{inference++;throw Error('should not infer');}}});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/api/budgets',{workspace:dir,policy,expected_revision:0,request_id:'policy'})).status,200);
  const t=await(await post('/api/tasks',{title:'Budget',workspace:dir,goal:'Defined',acceptance:'No inference',agent:'codex',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${t.id}/${phase==='implementation'?'run':'prepare'}`,{});
  await new Promise(r=>setTimeout(r,30));
  const state=await(await fetch(app.url+'/api/state')).json();
  assert.equal(inference,0);assert.equal(state.tasks[0].queue.status,'queued');assert.equal(state.tasks[0].queue_wait.code,'budget_exhausted');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

for(const phase of ['review','recovery'])test(`durable ${phase} queue is blocked before selection or spawn`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'budget-phase-'));let inference=0,app;
 const options={dataDir:dir,codexPath:process.execPath,runner:()=>{inference++;throw Error('unexpected spawn');},decisionEngine:{call:async()=>{inference++;throw Error('unexpected inference');}}};
 try{
 app=createMissionServer(options);await app.listen(0);
 const post=(p,b)=>fetch(app.url+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 await post('/api/budgets',{workspace:dir,policy,expected_revision:0,request_id:'policy'});
 const t=await(await post('/api/tasks',{title:'Durable phase',workspace:dir,goal:'Budget',acceptance:'No call',agent:'codex',profile:'implementation',max_minutes:1})).json();
 await app.close();app=null;
 const s=createStore(dir,{tasks:[],opportunities:[]});const db=s.load(),task=db.tasks.find(x=>x.id===t.id);
 task.queue={id:'durable-'+phase,phase:phase==='recovery'?'planning':'review',status:'queued',enqueued_at:new Date().toISOString()};task.status='queued';task.pipeline={auto_implement:false,status:'queued'};if(phase==='recovery')task.recovery_execution_minutes=1;s.save(db);s.close();
 app=createMissionServer(options);await app.listen(0);await new Promise(r=>setTimeout(r,60));const state=await(await fetch(app.url+'/api/state')).json();assert.equal(inference,0);assert.equal(state.tasks[0].queue.status,'queued');assert.equal(state.tasks[0].queue_wait.code,'budget_exhausted');
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('exhausted JEV budget prevents provider invocation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'budget-jev-')),s=createStore(dir,{tasks:[],opportunities:[]}),b=createBudgetLedger(s);let calls=0;
 try{b.configure({workspace:dir},policy,{expected_revision:0,request_id:'config'});const engine=budgetDecisionEngine(b,{call:async()=>{calls++;return {};}},{workspace:dir});await assert.rejects(()=>engine.call('resolve_decision',{}),/budget_exhausted/);assert.equal(calls,0);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
