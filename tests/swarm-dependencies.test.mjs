import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readDependencyIds,unmetDependencies,admissibleQueue,queueWaitReason} from '../src/queue.mjs';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';
import {acceptance,mission,profiles} from './acceptance/harness.mjs';

const wait=async(predicate,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out');};
const doneDep=id=>({id,status:'done',completion:{kind:'session_receipt_verified'}});

test('dependency ids are validated: duplicates, unknown, archived, self and cycles are rejected',()=>{
 const a={id:'a',status:'backlog'},b={id:'b',status:'backlog',depends_on:['a']},archived={id:'old',status:'done',archived_at:'2026-01-01'};
 const tasks=[a,b,archived];
 assert.equal(readDependencyIds(undefined,tasks,'c'),null);
 assert.deepEqual(readDependencyIds(['a'],tasks,'c'),['a']);
 assert.throws(()=>readDependencyIds('a',tasks,'c'),{status:400});
 assert.throws(()=>readDependencyIds(['a','a'],tasks,'c'),{status:400});
 assert.throws(()=>readDependencyIds(['missing'],tasks,'c'),{status:400});
 assert.throws(()=>readDependencyIds(['old'],tasks,'c'),{status:400});
 assert.throws(()=>readDependencyIds(['b'],tasks,'b'),{status:400});
 assert.throws(()=>readDependencyIds(['b'],tasks,'a'),{status:400});
 assert.throws(()=>readDependencyIds([...Array(21).keys()].map(String),tasks,'c'),{status:400});
});

test('a dependency counts as met only when the referenced mission is technically complete',()=>{
 const dep=doneDep('dep');
 assert.deepEqual(unmetDependencies({depends_on:['dep']},[dep]),[]);
 assert.deepEqual(unmetDependencies({depends_on:['dep']},[{id:'dep',status:'done'}]),['dep']);
 assert.deepEqual(unmetDependencies({depends_on:['dep']},[{id:'dep',status:'blocked'}]),['dep']);
 assert.deepEqual(unmetDependencies({depends_on:['dep']},[]),['dep']);
 assert.deepEqual(unmetDependencies({},[dep]),[]);
});

test('queued work with unmet dependencies is inadmissible and explains the wait',()=>{
 const dep={id:'dep',status:'blocked',workspace:'/p'};
 const queued={id:'q',workspace:'/p',depends_on:['dep'],queue:{id:'q1',phase:'implementation',status:'queued',enqueued_at:'2026-01-01T00:00:00Z'}};
 const limits={planning_limit:5,implementation_limit:5,review_limit:5};
 assert.deepEqual(admissibleQueue([queued,dep],[],limits),[]);
 const reason=queueWaitReason(queued,[],limits,[queued,dep]);
 assert.equal(reason.code,'waiting_dependency');
 assert.deepEqual(reason.blocking_task_ids,['dep']);
 assert.equal(admissibleQueue([queued,doneDep('dep')],[],limits)[0].id,'q');
});

test('the durable admission refuses a claim while a dependency is not complete',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-deps-'));
 const store=createStore(dir,{scheduler:{planning_limit:5,implementation_limit:5,review_limit:5},tasks:[
  {id:'dep',workspace:dir,status:'blocked'},
  {id:'q',workspace:dir,status:'queued',depends_on:['dep'],queue:{id:'q1',phase:'implementation',status:'queued',enqueued_at:'2026-01-01T00:00:00Z'}}
 ]});
 try{
  const state=store.load();
  assert.equal(store.claim(state,'q'),false);
  state.tasks.find(t=>t.id==='dep').status='done';
  state.tasks.find(t=>t.id==='dep').completion={kind:'session_receipt_verified'};
  store.save(state);
  assert.equal(store.claim(state,'q'),true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('POST /api/tasks accepts depends_on and rejects invalid references',async t=>{
 const {workspace,request,get}=await acceptance(t,{mode:'supervised'});
 const dep=await(await request('/api/tasks',{title:'Dep',workspace,goal:'First',acceptance:'Done',agent:'codex',profile:'design',max_minutes:5})).json();
 const ok=await request('/api/tasks',{title:'Next',workspace,goal:'Second',acceptance:'Done',agent:'codex',profile:'design',max_minutes:5,depends_on:[dep.id]});
 assert.equal(ok.status,201);
 assert.deepEqual((await ok.json()).depends_on,[dep.id]);
 for(const depends_on of [['missing'],[dep.id,dep.id],'nope'])
  assert.equal((await request('/api/tasks',{title:'Bad',workspace,goal:'x',acceptance:'y',agent:'codex',profile:'design',max_minutes:5,depends_on})).status,400);
});

test('PATCH depends_on enforces the same validation and detects cycles',async t=>{
 const {workspace,request}=await acceptance(t,{mode:'supervised'});
 const make=async()=>(await(await request('/api/tasks',{title:'M',workspace,goal:'g',acceptance:'a',agent:'codex',profile:'design',max_minutes:5})).json());
 const a=await make(),b=await make();
 assert.equal((await request(`/api/tasks/${a.id}`,{depends_on:[b.id]},'PATCH')).status,200);
 assert.equal((await request(`/api/tasks/${b.id}`,{depends_on:[a.id]},'PATCH')).status,400);
 assert.equal((await request(`/api/tasks/${a.id}`,{depends_on:[a.id]},'PATCH')).status,400);
 assert.equal((await request(`/api/tasks/${a.id}`,{depends_on:[b.id]},'PATCH')).status,200);
 assert.equal((await request(`/api/tasks/${a.id}`,{depends_on:[]},'PATCH')).status,200);
});

test('a queued mission dispatches only after its dependencies complete',async t=>{
 const depId=randomUUID();
 const dependent=workspace=>mission(workspace,{status:'queued',depends_on:[depId],profile:'implementation',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0,status:'queued'},queue:{id:randomUUID(),phase:'implementation',status:'queued',enqueued_at:new Date().toISOString()}});
 const blockedDep=workspace=>mission(workspace,{id:depId,status:'blocked'});
 {
  const {children,state}=await acceptance(t,{tasks:[blockedDep,dependent],mode:'supervised'});
  await new Promise(r=>setTimeout(r,1400));
  assert.equal(children.length,0);
  const row=(await state()).tasks.find(task=>task.depends_on?.includes(depId));
  assert.equal(row.queue_wait.code,'waiting_dependency');
  assert.deepEqual(row.queue_wait.blocking_task_ids,[depId]);
 }
 {
  const {children,state}=await acceptance(t,{tasks:[workspace=>({...mission(workspace),id:depId,status:'done',completion:{kind:'session_receipt_verified'}}),dependent],mode:'supervised'});
  await wait(()=>children.length>0);
  assert.notEqual((await state()).tasks.find(task=>task.depends_on?.includes(depId)).queue?.status,'queued');
 }
});
