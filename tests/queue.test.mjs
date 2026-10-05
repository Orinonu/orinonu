import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {admissibleQueue,schedulerLimits,queueWaitReason} from '../src/queue.mjs';
import {createMissionServer} from '../src/server.mjs';
const queued=(id,workspace,phase)=>({id,workspace,queue:{phase,status:'queued',enqueued_at:id}});
test('phase limits validate and admission permits readers but excludes overlapping writers',()=>{
 assert.throws(()=>schedulerLimits({planning_limit:0}));assert.throws(()=>schedulerLimits({review_limit:1.5}));
 const tasks=[queued('1','C:/repo','planning'),queued('2','C:/repo','planning'),queued('3','C:/repo','implementation'),queued('4','C:/other','implementation')];
 assert.deepEqual(admissibleQueue(tasks,[],schedulerLimits({planning_limit:2,implementation_limit:2})).map(t=>t.id),['1','2','4']);
 assert.deepEqual(admissibleQueue(tasks,[{phase:'implementation',workspace:'C:/repo/sub'}],schedulerLimits({implementation_limit:2})).map(t=>t.id),['4']);
});
const tick=()=>new Promise(r=>setTimeout(r,20));
test('persistent queue applies phase limits, cancellation and immutable running requirements',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-queue-')),children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
 const decisionEngine={call:async(_,input)=>({ok:true,action:'recommend',selected_id:input.options[0].id})};
 const app=createMissionServer({dataDir:dir,runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 const request=(path,body,method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await request('/api/scheduler',{planning_limit:1},'PATCH')).status,200);
  const tasks=[];for(let i=0;i<3;i++)tasks.push(await(await request('/api/tasks',{title:'Task '+i,workspace:dir,goal:'Defined change',acceptance:'Regression passes',agent:'codex',profile:'implementation',max_minutes:1})).json());
  for(const task of tasks)assert.equal((await request(`/api/tasks/${task.id}/prepare`,{})).status,200);
  await tick();assert.equal(children.length,1);
  const persisted=await(await fetch(app.url+'/api/state')).json();assert.equal(persisted.tasks[1].queue.status,'queued');
  assert.equal((await request(`/api/tasks/${tasks[1].id}`,{goal:'Changed'},'PATCH')).status,409);
  assert.equal((await request('/api/scheduler',{planning_limit:11},'PATCH')).status,400);
  assert.equal((await request('/api/scheduler',{planning_limit:2},'PATCH')).status,200);await tick();assert.equal(children.length,2);
  await request(`/api/tasks/${tasks[2].id}/stop`,{});children[0].emit('close',1);await tick();assert.equal(children.length,2);
  const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.tasks[2].queue,null);assert.equal(state.tasks[2].status,'blocked');assert.equal(state.tasks[2].progress.phase,'blocked');
  assert.equal((await request(`/api/tasks/${tasks[0].id}`,{phase_limits:{planning:2,implementation:3,review:4}},'PATCH')).status,200);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('stop during delegated selection cannot launch a stale queued mission',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-queue-cancel-'));let resolveDecision,launches=0;
 const decisionEngine={call:async()=>await new Promise(resolve=>{resolveDecision=resolve;})};
 const app=createMissionServer({dataDir:dir,codexPath:process.execPath,decisionEngine,runner:()=>{launches++;throw new Error('Unexpected launch');}});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'Task',workspace:dir,goal:'Defined',acceptance:'Tests',agent:'codex',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/prepare`,{auto_implement:true});await tick();await post(`/api/tasks/${task.id}/stop`,{});
  resolveDecision({ok:true,action:'recommend',selected_id:'discovery'});await tick();assert.equal(launches,0);
  assert.equal((await(await fetch(app.url+'/api/state')).json()).tasks[0].status,'blocked');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('restart readmits queued intentions but blocks interrupted selection, and missing executor blocks cleanly',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-queue-restart-'));const base={title:'Task',workspace:dir,goal:'Defined',acceptance:'Tests',agent:'codex',profile:'implementation',max_minutes:1,status:'queued'};
 mkdirSync(join(dir,'queued'));mkdirSync(join(dir,'interrupted'));
 writeFileSync(join(dir,'state.json'),JSON.stringify({scheduler:{implementation_limit:2},tasks:[{...base,id:'a',workspace:join(dir,'queued'),queue:{id:'qa',phase:'implementation',status:'queued',enqueued_at:'1'}},{...base,id:'b',workspace:join(dir,'interrupted'),queue:{id:'qb',phase:'implementation',status:'selecting',enqueued_at:'2'}}],profiles:{implementation:{skill:'tdd',model:'gpt-6.1-sol',effort:'medium'}}}));
 const app=createMissionServer({dataDir:dir,apiKey:'',codexPath:join(dir,'missing')});await app.listen(0);
 try{let state;for(let i=0;i<25;i++){await tick();state=await(await fetch(app.url+'/api/state')).json();if(state.tasks[0].status==='blocked')break;}assert.equal(state.tasks[0].status,'blocked');assert.equal(state.tasks[0].queue,null);assert.match(state.tasks[0].error,/executor não encontrado/);assert.equal(state.tasks[1].status,'blocked');assert.match(state.tasks[1].error,/interrompida/);}
 finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('ten independent writers can be admitted without allowing overlapping workspaces',()=>{
 const limits=schedulerLimits({planning_limit:10,implementation_limit:10,review_limit:10});
 const tasks=Array.from({length:12},(_,i)=>queued(String(i).padStart(2,'0'),'C:/independent-'+i,'implementation'));
 assert.equal(admissibleQueue(tasks,[],limits).length,10);
 tasks.splice(1,0,queued('00b','C:/independent-0/sub','implementation'));
 const selected=admissibleQueue(tasks,[],limits);assert.equal(selected.length,10);assert.ok(!selected.some(t=>t.id==='00b'));
 assert.throws(()=>schedulerLimits({review_limit:11}));
});

test('queue explains workspace reservation separately from phase capacity',()=>{
 const task=queued('1','C:/repo','implementation'),limits=schedulerLimits({implementation_limit:10});
 assert.equal(queueWaitReason(task,[{task_id:'reader',phase:'planning',workspace:'C:/repo'}],limits).code,'workspace_busy');
 assert.deepEqual(queueWaitReason(task,[{task_id:'reader',phase:'planning',workspace:'C:/repo'}],limits).blocking_task_ids,['reader']);
 assert.equal(queueWaitReason(task,Array.from({length:10},(_,i)=>({phase:'implementation',workspace:'C:/other-'+i})),limits).code,'phase_capacity');
 assert.equal(queueWaitReason(task,[],limits).code,'awaiting_dispatch');
 assert.equal(queueWaitReason({...task,queue:null},[],limits),null);
});

test('background failure investigations never delay a mission that is moving through the flow',async()=>{
 const {admissibleQueue,isDeferred}=await import('../src/queue.mjs');
 const row=(id,title,at)=>({id,title,workspace:'/p',queue:{phase:'planning',status:'queued',enqueued_at:at}});
 const tasks=[row('diag-old','Investigar falha: Mission A','2026-10-04T10:00:00Z'),row('mission-new','Mission B','2026-10-04T11:00:00Z'),row('diag-older','Investigar falha: Mission C','2026-10-04T09:00:00Z')];
 assert.equal(isDeferred(tasks[0]),true);
 assert.equal(isDeferred(tasks[1]),false);
 assert.deepEqual(admissibleQueue(tasks,[],{planning_limit:1,implementation_limit:1,review_limit:1}).map(t=>t.id),['mission-new']);
 assert.deepEqual(admissibleQueue(tasks,[],{planning_limit:3,implementation_limit:1,review_limit:1}).map(t=>t.id),['mission-new','diag-older','diag-old']);
 const manyDeferred=[row('d1','Investigar falha: 1','2026-10-04T01:00:00Z'),row('d2','Investigar falha: 2','2026-10-04T02:00:00Z'),row('d3','Investigar falha: 3','2026-10-04T03:00:00Z'),row('m1','Regular Mission','2026-10-04T04:00:00Z')];
 assert.deepEqual(admissibleQueue(manyDeferred,[],{planning_limit:7,implementation_limit:7,review_limit:7}).map(t=>t.id),['m1','d1','d2']);
});

test('diagnostic admission counts durable occupants by mission ID across successive drains',()=>{
 const workspace='C:/diagnostic-limit',limits=schedulerLimits();
 const active=[1,2].map(n=>({id:'active-'+n,title:'Investigar falha: '+n,workspace}));
 const waiting=[3,4].map(n=>({...queued('waiting-'+n,workspace,'planning'),title:'Investigar falha: '+n}));
 const tasks=[...active,...waiting];
 const occupants=active.map(task=>({task_id:task.id,workspace,phase:'planning',state:'running'}));
 assert.deepEqual(admissibleQueue(tasks,occupants,limits),[]);
 const selected=admissibleQueue(tasks,occupants.slice(0,1),limits);
 assert.equal(selected.length,1);
 const next=[occupants[0],{task_id:selected[0].id,workspace,phase:'planning',state:'running'}];
 assert.deepEqual(admissibleQueue(tasks,next,limits),[]);
});

test('a failed diagnostic never spawns a diagnostic of itself',async()=>{
 const {failureRecommendation}=await import('../src/mission-observation.mjs');
 const failed={status:'failed',failed_tools:2};
 assert.ok(failureRecommendation({id:'a',title:'Real mission',workspace:'/p'},failed));
 assert.equal(failureRecommendation({id:'b',title:'Investigar falha: Real mission',workspace:'/p'},failed),null);
 assert.equal(failureRecommendation({id:'c',title:'Investigar: Investigar falha: Real mission',workspace:'/p'},failed),null);
 assert.equal(failureRecommendation({id:'d',title:'Audit',workspace:'/p',opportunity_audit:true},failed),null);
});

test('queue order serves the better charter score first, never starves an old mission and keeps FIFO on equal footing',async()=>{
 const {admissibleQueue}=await import('../src/queue.mjs');
 const now=Date.parse('2026-10-05T12:00:00Z'),at=minutes=>new Date(now-minutes*60000).toISOString();
 const task=(id,minutes,score,title='Mission '+id)=>({id,title,workspace:'/p',queue:{status:'queued',phase:'planning',enqueued_at:at(minutes)},...(score===undefined?{}:{flow_priority:{score}})});
 const limits={planning_limit:1,implementation_limit:1,review_limit:1};
 assert.deepEqual(admissibleQueue([task('old',50),task('best',10,2.5),task('mid',30,1)],[],limits,now).map(t=>t.id),['best']);
 assert.deepEqual(admissibleQueue([task('a',20),task('b',30)],[],limits,now).map(t=>t.id),['b']);
 assert.deepEqual(admissibleQueue([task('fresh-best',10,3),task('aged-low',180,0.2)],[],limits,now).map(t=>t.id),['aged-low']);
 assert.deepEqual(admissibleQueue([task('aged-diag',300,0.1,'Investigar falha: x'),task('fresh',5,1)],[],limits,now).map(t=>t.id),['aged-diag']);
});
