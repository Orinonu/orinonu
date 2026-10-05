import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {acceptance,mission,queuedPlanning,orphanTask,plantOrphan,wait} from './harness.mjs';

const plan=(pending=[])=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:pending.length===0,pending_decisions:pending,steps:['Edit file.txt'],verification:['Run the tests']})+'\n```';
const humanOnly=input=>({ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.97}))});
const items=async f=>(await f.get('/api/decisions')).items;
const interventions=async(f,q='')=>(await f.get('/api/interventions'+q));

test('a human gate answer is recorded as a durable intervention with full identity, once',async t=>{
  const id=randomUUID();
  const f=await acceptance(t,{evaluate:humanOnly,tasks:[w=>mission(w,{id,status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0},attempt:{id:randomUUID(),state:'terminal'},plan_report:plan(['Pick the pricing tier']),planning:{status:'prepared'}})]});
  await wait(async()=>(await items(f)).some(i=>i.kind==='plan_pending'),20000);
  const [item]=await items(f);
  const body={request_id:'r1',option_id:'proceed_by_charter'};
  assert.equal((await f.request(`/api/decisions/${item.id}/answer`,body)).status,200);
  // Idempotent replay of the same request does not record a second intervention.
  assert.equal((await f.request(`/api/decisions/${item.id}/answer`,body)).status,200);
  const view=await interventions(f);
  const mine=view.items.filter(r=>r.task_id===id);
  assert.equal(mine.length,1);
  const [record]=mine;
  assert.equal(record.origin,'decision_inbox');assert.equal(record.category,'planned_approval');
  assert.equal(record.action,'plan_pending:proceed_by_charter');assert.equal(record.project,f.workspace);
  assert.ok(record.at&&record.evidence.includes(item.id));
  assert.equal(view.summary.total,1);assert.equal(view.summary.by_category.planned_approval,1);assert.equal(view.summary.active_seconds,null);
});

test('a written clarification and a manual cancel land in distinct categories',async t=>{
  const id=randomUUID(),queuedId=randomUUID();
  const f=await acceptance(t,{evaluate:humanOnly,tasks:[
    w=>mission(w,{id,status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0},attempt:{id:randomUUID(),state:'terminal'},plan_report:plan(['Choose retention']),planning:{status:'prepared'}}),
    w=>queuedPlanning(w,{id:queuedId})]});
  await wait(async()=>(await items(f)).some(i=>i.kind==='plan_pending'),20000);
  const [item]=await items(f);
  assert.equal((await f.request(`/api/decisions/${item.id}/answer`,{request_id:'w1',option_id:'answer',note:'Keep 30 days.'})).status,200);
  assert.equal((await f.request(`/api/tasks/${queuedId}/stop`,{})).status,200);
  const view=await interventions(f);
  const clarify=view.items.find(r=>r.task_id===id),cancel=view.items.find(r=>r.task_id===queuedId);
  assert.equal(clarify.category,'clarification');
  assert.equal(cancel.origin,'task_stop');assert.equal(cancel.category,'correction');
  assert.equal(view.summary.total,2);assert.equal(view.summary.by_category.clarification,1);assert.equal(view.summary.by_category.correction,1);
  // Filtering by task and workspace narrows the read without touching records.
  assert.equal((await interventions(f,`?task_id=${queuedId}`)).summary.total,1);
});

test('an operator reconcile is a planned approval tied to the released attempt',async t=>{
  const id=randomUUID(),attemptId=randomUUID();
  const f=await acceptance(t,{tasks:[w=>orphanTask(w,attemptId,{id})],seed:(raw,{workspace})=>plantOrphan(raw,{taskId:id,attemptId,workspace})});
  const res=await f.request(`/api/tasks/${id}/reconcile`,{confirm:'no_executor_process_running'});
  assert.equal(res.status,200);
  const view=await interventions(f);
  const [record]=view.items.filter(r=>r.task_id===id);
  assert.equal(record.category,'planned_approval');assert.equal(record.origin,'operator_request');
  assert.equal(record.attempt_id,attemptId);
  // Reconciling the same attempt again is a conflict, and no second record appears.
  assert.equal((await f.request(`/api/tasks/${id}/reconcile`,{confirm:'no_executor_process_running'})).status,409);
  assert.equal((await interventions(f)).items.length,1);
});

test('equivalent executions can be compared on recorded human effort without treating needed approval as failure',async t=>{
  const a=randomUUID(),b=randomUUID();
  const done=(id)=>w=>mission(w,{id,status:'done',measurement:{duration_ms:60000,model:'m',effort:'low',phase:'implementation',usage:{input_tokens:10,output_tokens:20}},review_contract:{decision:'approved'},integration:{status:'merged'}});
  const f=await acceptance(t,{tasks:[done(a),done(b)],interventions:[w=>({id:'i1',key:'seeded-1',project:w,task_id:a,attempt_id:null,origin:'decision_inbox',action:'budget_exhausted:extend_budget',category:'planned_approval',at:'2026-10-05T01:00:00Z',evidence:'decision:x'})]});
  const res=await f.request('/api/comparisons/from-tasks',{baseline_id:a,candidate_id:b,benchmark_id:'bench-1',controlled:true});
  assert.equal(res.status,200);
  const summary=await res.json();
  // The baseline needed one planned approval; that approval is recorded effort, not a failure: both arms stay accepted.
  assert.equal(summary.accepted_pairs,1);assert.equal(summary.regressions,0);
  assert.equal(summary.proven_saved_interventions,1);
  // Without measurement on one arm the saving stays unknown instead of being filled.
  const second=await f.request('/api/comparisons/import',{pairs:[{id:'p2',benchmark_id:'b2',controlled:true,project:f.workspace,baseline:{config:'x',accepted:true,seconds:60,cost_usd:null,evidence:'e',tokens:null},candidate:{config:'y',accepted:true,seconds:50,cost_usd:null,evidence:'e',tokens:null}}]});
  assert.equal(second.status,200);
  const merged=await second.json();
  assert.equal(merged.proven_saved_interventions,null);
  assert.equal(merged.assessment.status,'improve'); // fewer than 10 controlled pairs stays ineligible regardless.
});
