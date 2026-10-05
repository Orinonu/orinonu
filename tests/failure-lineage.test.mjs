import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {failureCause,planFailure,applyFailurePlan,MAX_LINEAGE_DEPTH,MAX_CONTINUATIONS} from '../src/failure-lineage.mjs';
import {failureRecommendation} from '../src/mission-observation.mjs';
import {createMissionServer} from '../src/server.mjs';

const failed={status:'failed',failed_tools:0};
const mission={id:'m1',title:'Real mission',workspace:'/p',error:'Executor terminou com código 1.',attempt:{id:'a1'}};

test('causes come from recorded facts and a quota failure is never investigated',()=>{
 assert.equal(failureCause({error:'Limite de uso do Codex atingido'},failed),'usage_limit');
 assert.equal(failureCause({usage_limit_hold:{phase:'planning'},error:'x'},failed),'usage_limit');
 assert.equal(failureCause({error:'Revisão não aprovou integração: rejected'},failed),'review_not_approved');
 assert.equal(failureCause({error:'Limite de tempo atingido.'},failed),'timeout');
 assert.equal(failureCause({error:'Executor terminou com código 2.'},{status:'failed',failed_tools:3}),'tool_failed');
 assert.equal(failureCause({error:'Executor terminou com código 2.'},failed),'execution_failed');
 assert.equal(failureCause({error:'algo inesperado'},failed),'unknown');
 assert.equal(planFailure({...mission,error:'Limite de uso do Codex atingido'},failed),null);
 assert.equal(planFailure(mission,{status:'active'}),null);
 assert.equal(planFailure({...mission,opportunity_audit:true},failed),null);
});

test('a failed mission opens one proposal that records its root, originating task and attempt',()=>{
 const plan=planFailure(mission,failed,{opportunities:[]});
 assert.equal(plan.kind,'propose');
 assert.deepEqual(plan.proposal.lineage,{root_task_id:'m1',origin_task_id:'m1',origin_attempt_id:'a1',depth:0,cause:'execution_failed',causes:['execution_failed']});
 assert.equal(plan.proposal.key,'mission-failure:m1');
 assert.equal(plan.proposal.status,'pending');
 const list=[];
 assert.equal(applyFailurePlan(plan,list,{id:'o1'}).applied,'proposed');
 assert.equal(applyFailurePlan(plan,list,{id:'o2'}).applied,'duplicate');
 assert.equal(list.length,1);
 assert.equal(list[0].id,'o1');
});

test('when the investigation of that failure fails too, the same cause or an unknown one continues the lineage without a successor',()=>{
 const root={id:'o1',key:'mission-failure:m1',status:'approved',...planFailure(mission,failed).proposal};
 const investigation={id:'inv1',title:'Investigar falha: Real mission',workspace:'/p',opportunity_id:'o1',attempt:{id:'ia1'}};
 const opportunities=[root];
 const sameCause=planFailure({...investigation,error:'Executor terminou com código 1.'},failed,{opportunities});
 assert.deepEqual([sameCause.kind,sameCause.opportunity_id,sameCause.entry.cause,sameCause.entry.task_id,sameCause.entry.attempt_id],['continue','o1','execution_failed','inv1','ia1']);
 const unknownCause=planFailure({...investigation,error:'algo inesperado'},failed,{opportunities});
 assert.deepEqual([unknownCause.kind,unknownCause.entry.cause],['continue','unknown']);
 assert.equal(applyFailurePlan(sameCause,opportunities,{id:'x'}).applied,'continued');
 assert.equal(applyFailurePlan(unknownCause,opportunities,{id:'y'}).applied,'continued');
 assert.equal(opportunities.length,1);
 assert.deepEqual(root.continuations.map(row=>row.cause),['execution_failed','unknown']);
 assert.deepEqual(root.lineage.causes,['execution_failed','unknown']);
 // Many repeated failures keep only a bounded record.
 for(let index=0;index<MAX_CONTINUATIONS+5;index++)applyFailurePlan(planFailure({...investigation,error:'x'},failed,{opportunities}),opportunities,{id:'z'+index});
 assert.equal(root.continuations.length,MAX_CONTINUATIONS);
 assert.equal(opportunities.length,1);
});

test('a different known cause may open a bounded number of new proposals in the same lineage; causes are never fused',()=>{
 const opportunities=[{id:'o1',key:'mission-failure:m1',status:'approved',...planFailure(mission,failed).proposal}];
 const investigation=(id,error,opportunity_id)=>({id,title:'Investigar falha: Real mission',workspace:'/p',opportunity_id,error,attempt:{id:id+'-a'}});
 const second=planFailure(investigation('inv1','Limite de tempo atingido.','o1'),failed,{opportunities});
 assert.equal(second.kind,'propose');
 assert.equal(second.proposal.lineage.root_task_id,'m1');
 assert.equal(second.proposal.lineage.depth,1);
 assert.equal(second.proposal.lineage.cause,'timeout');
 assert.equal(second.proposal.key,'mission-failure:m1:timeout');
 applyFailurePlan(second,opportunities,{id:'o2'});
 assert.equal(opportunities.length,2);
 const third=planFailure(investigation('inv2','Revisão não aprovou integração: rejected','o2'),failed,{opportunities});
 assert.equal(third.kind,'propose');
 assert.equal(third.proposal.lineage.depth,2);
 applyFailurePlan(third,opportunities,{id:'o3'});
 const beyond=planFailure(investigation('inv3','Executor terminou com código 1.','o3'),{status:'failed',failed_tools:4},{opportunities});
 assert.equal(MAX_LINEAGE_DEPTH,2);
 assert.equal(beyond.kind,'continue','depth is bounded: no fourth proposal');
 assert.equal(beyond.opportunity_id,'o1');
 assert.equal(opportunities.length,3);
 // The earlier cause stays separate and is not rewritten by the later ones.
 assert.deepEqual(opportunities[0].lineage.causes.slice(0,1),['execution_failed']);
 assert.deepEqual(opportunities[1].lineage.causes,['timeout']);
});

test('an investigation whose origin record is missing starts no chain, and the compatibility entry point keeps refusing diagnostics',()=>{
 assert.equal(planFailure({id:'inv',title:'Investigar falha: Real mission',workspace:'/p',opportunity_id:'gone',error:'x',attempt:{id:'a'}},failed,{opportunities:[]}),null);
 assert.equal(failureRecommendation({id:'inv',title:'Investigar falha: X',workspace:'/p'},failed),null);
 assert.ok(failureRecommendation({id:'m',title:'Real',workspace:'/p'},failed).lineage);
});

test('end to end: mission failure, approved investigation, investigation failure → one proposal and a recorded continuation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-lineage-'));const children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 const wait=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,15));}throw new Error('timeout');};
 try{
  const task=await(await post('/api/tasks',{title:'Real mission',workspace:dir,goal:'Plan the change',acceptance:'A valid plan',agent:'codex',profile:'design',max_minutes:5})).json();
  assert.equal((await post(`/api/tasks/${task.id}/prepare`,{})).status,200);
  await wait(()=>children.length===1);children[0].emit('close',1);
  await wait(async()=>(await state()).opportunities.length===1);
  const root=(await state()).opportunities[0];
  assert.equal(root.lineage.root_task_id,task.id);assert.equal(root.lineage.depth,0);assert.equal(root.status,'pending');
  const approved=await(await post(`/api/opportunities/${root.id}/approve`,{})).json();
  assert.equal(approved.opportunity_id,root.id);
  assert.equal((await post(`/api/tasks/${approved.id}/prepare`,{})).status,200);
  await wait(()=>children.length===2);children[1].emit('close',1);
  await wait(async()=>(await state()).opportunities[0].continuations?.length===1);
  const after=await state();
  assert.equal(after.opportunities.length,1);
  assert.equal(after.opportunities[0].continuations[0].task_id,approved.id);
  assert.equal(after.opportunities[0].status,'approved');
  assert.ok(after.events.some(row=>row.kind==='failure_lineage'&&row.applied==='continued'));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
