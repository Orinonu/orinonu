import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {acceptance,mission,reviewable,queuedPlanning,orphanTask,plantOrphan,plantFinished,wait,sleep} from './harness.mjs';

const lowScore=input=>({ok:true,priority:input.candidates.map(c=>({id:c.id,score:0.3,confidence:0.54}))});
const saturated={planning_limit:1,implementation_limit:3,review_limit:3};
const phaseChoices=f=>f.calls.decide.filter(call=>/Choose only the next phase/.test(call.goal));
const revisionOf=async(f,id)=>(await f.state()).tasks.find(t=>t.id===id).revision??0;

test('finish first: a verified implementation is reviewed even when the charter score is low and planning is saturated',async t=>{
 const f=await acceptance(t,{scheduler:saturated,tasks:[w=>queuedPlanning(w),w=>queuedPlanning(w),w=>reviewable(w)],rank:lowScore});
 await wait(()=>phaseChoices(f).some(call=>call.options.some(o=>o.id==='review')),8000);
});

test('a candidate that cannot be launched does not spin the autonomous cycle',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{scheduler:saturated,tasks:[w=>queuedPlanning(w),w=>queuedPlanning(w),w=>mission(w,{id,status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0,status:'needs_review'},attempt:{id:randomUUID(),state:'terminal'},plan_report:'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Edit file.txt'],verification:['Run the tests']})+'\n```'})],rank:lowScore});
 await sleep(1500);
 const before=await revisionOf(f,id),ranks=f.calls.rank.length,events=f.events().filter(e=>e.kind==='autonomy_priority_decision').length;
 await sleep(7000);
 const growth=(await revisionOf(f,id))-before,newRanks=f.calls.rank.length-ranks,newEvents=f.events().filter(e=>e.kind==='autonomy_priority_decision').length-events;
 assert.ok(growth<=2,`revision grew by ${growth}`);
 assert.ok(newRanks<=2,`rank_missions called ${newRanks} times while nothing changed`);
 assert.ok(newEvents<=2,`${newEvents} empty priority decisions were logged`);
});

test('an idle first autonomous project yields to eligible work in a later project',async t=>{
 const id=randomUUID(),f=await acceptance(t,{tasks:[workspace=>mission(workspace,{id})],seed:(raw,{workspace})=>{
  raw.prepare('UPDATE entities SET payload=?,revision=revision+1 WHERE key=?').run(JSON.stringify([{workspace:workspace+'-idle',mode:'autonomous',discovery_enabled:false},{workspace,mode:'autonomous',discovery_enabled:false}]),'meta/autonomy_policies');
  raw.prepare('UPDATE entities SET payload=?,revision=revision+1 WHERE key=?').run(JSON.stringify([{workspace:workspace+'-idle',objective:'Idle first project'},{workspace,objective:'Complete eligible missions'}]),'meta/project_directions');
 }});
 await wait(()=>f.children.length===1,8000);
 assert.equal((await f.state()).tasks.find(task=>task.id===id).status,'planning');
 assert.equal(f.children[0].options.cwd,f.workspace);
});

const orphanFixture=(t,{mode='supervised',heartbeat=0,executorPid=99999999,spawnedAt=null,phase='planning'}={})=>{
 const orphanId=randomUUID(),attemptId=randomUUID(),waiting=randomUUID();
 return acceptance(t,{mode,scheduler:saturated,
  tasks:[w=>orphanTask(w,attemptId,{id:orphanId}),w=>queuedPlanning(w,{id:waiting})],
  seed:(raw,{workspace})=>plantOrphan(raw,{taskId:orphanId,attemptId,phase,workspace,heartbeat,executorPid,spawnedAt})}).then(f=>({...f,orphanId,waiting}));
};
const row=async(f,id)=>(await f.state()).tasks.find(t=>t.id===id);

test('the host frees a slot held by a dead attempt in supervised mode and the queue drains without a click',async t=>{
 const f=await orphanFixture(t);
 await wait(async()=>(await row(f,f.orphanId)).attempt.state==='terminal',15000);
 assert.equal((await row(f,f.orphanId)).reconciliation.confirmed_by,'host_liveness_check');
 await wait(()=>f.children.length===1,10000);
 assert.equal((await row(f,f.orphanId)).status,'blocked');
});

test('a slot held by a recent unconfirmed attempt is explained instead of looking like ordinary capacity',async t=>{
 const f=await orphanFixture(t,{heartbeat:Date.now()});
 await sleep(2600);
 const waiting=await row(f,f.waiting);
 assert.equal(waiting.queue_wait.code,'capacity_held_by_unconfirmed');
 assert.deepEqual(waiting.queue_wait.blocking_task_ids,[f.orphanId]);
 assert.equal((await row(f,f.orphanId)).attempt.state,'outcome_unknown');
});

test('a live PID that started after the attempt spawned its executor is a reused PID and does not hold the slot',{skip:process.platform!=='win32'},async t=>{
 const f=await orphanFixture(t,{executorPid:process.pid,spawnedAt:1});
 await wait(async()=>(await row(f,f.orphanId)).attempt.state==='terminal',20000);
 const evidence=(await row(f,f.orphanId)).reconciliation.evidence;
 assert.equal(evidence.pid_reused,true);
});

test('a live PID with no proof of reuse is never released',async t=>{
 const f=await orphanFixture(t,{executorPid:process.pid,spawnedAt:null});
 await sleep(3000);
 assert.equal((await row(f,f.orphanId)).attempt.state,'outcome_unknown');
});

const reasons=async f=>Object.fromEntries((await f.get('/api/flow'))[0].waiting.map(w=>[w.task_id,w.reason]));
const bigScheduler={planning_limit:10,implementation_limit:10,review_limit:10};

test('the pipeline ceiling queues the rest in the backlog with an honest reason instead of flooding every phase',async t=>{
 const ids=[1,2,3,4].map(()=>randomUUID());
 const f=await acceptance(t,{scheduler:bigScheduler,policy:{max_wip:2},tasks:ids.map(id=>w=>mission(w,{id}))});
 await wait(()=>f.children.length===2,15000);
 await sleep(5000);
 assert.equal(f.children.length,2);
 const waiting=Object.values(await reasons(f));
 assert.equal(waiting.filter(reason=>reason==='wip_wait').length,2);
 const flow=(await f.get('/api/flow'))[0];
 assert.equal(flow.health.wip.max,2);assert.equal(flow.health.wip.full,true);assert.equal(flow.health.stalled.length,0);
});

test('a mission launched too many times stops at a gate instead of being relaunched forever',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{scheduler:bigScheduler,tasks:[w=>mission(w,{id,launches:8})]});
 await sleep(3500);
 assert.equal(f.children.length,0);
 const flow=(await f.get('/api/flow'))[0];
 assert.equal(flow.gates.find(g=>g.task_id===id).reason,'launch_limit');
});

test('the productivity breaker opens after a window of finished stages with no verifiable advance and stops new admissions',async t=>{
 const id=randomUUID(),idle=randomUUID();
 const f=await acceptance(t,{scheduler:bigScheduler,
  policy:{breaker:{state:'closed',last_marks:0,advances:0,anchor_finished:0,anchor_advances:0}},
  tasks:[w=>mission(w,{id:idle,status:'blocked',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0,status:'needs_review'},error:'Revisão não aprovou integração: rejected',attempt:{id:'x',state:'terminal'}}),w=>mission(w,{id})],
  seed:(raw,{workspace})=>plantFinished(raw,{taskId:idle,count:8,workspace})});
 await wait(async()=>(await f.state()).autonomy_policies[0].breaker?.state==='open',15000);
 await sleep(2500);
 assert.equal(f.children.length,0);
 const flow=(await f.get('/api/flow'))[0];
 assert.ok(flow.gates.some(g=>g.kind==='project'&&g.reason==='breaker_open'));
 assert.equal(flow.health.breaker.state,'open');
 assert.ok(f.events().some(e=>e.kind==='autonomy_breaker_changed'&&e.transition==='opened'));
});
