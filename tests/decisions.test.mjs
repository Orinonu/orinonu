import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisions,adviceOptions,readAdvice,applyAnswer,KINDS,NOTE_LIMIT} from '../src/decisions.mjs';
import {planDigest} from '../src/pipeline.mjs';
import {resolutionCovers,readPlanContract} from '../src/pipeline.mjs';

const plan=pending=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:pending.length===0,pending_decisions:pending,steps:['Edit'],verification:['Test']})+'\n```';
const flow=(gates,stalled=[])=>({workspace:'/p',gates,health:{stalled}});
const gate=(extra={})=>({kind:'mission',task_id:'t1',title:'Mission',reason:'budget_exhausted',resume_condition:'explicit_budget_extension',questions:['O orçamento de tempo da missão acabou; amplie-o para continuar.'],since:'2026-10-05T01:00:00Z',...extra});

test('every gate becomes one typed question, oldest first, with stable ids that change when the cause changes',()=>{
 const task={id:'t1',title:'Mission',max_minutes:10,pipeline:{budget_minutes:10,spent_ms:600000}};
 const [item]=buildDecisions({flow:flow([gate()]),tasks:[task]});
 assert.equal(item.kind,'budget_exhausted');assert.deepEqual(item.options.map(o=>o.id),['extend_budget','archive']);
 assert.equal(item.owner,'human');assert.deepEqual(item.recommendation,{state:'none'});
 assert.equal(buildDecisions({flow:flow([gate()]),tasks:[task]})[0].id,item.id);
 const extended={...task,pipeline:{...task.pipeline,budget_minutes:20,budget_extensions:[{}]}};
 assert.notEqual(buildDecisions({flow:flow([gate()]),tasks:[extended]})[0].id,item.id);
 const ordered=buildDecisions({flow:flow([gate({task_id:'t2',since:'2026-10-05T02:00:00Z'}),gate({task_id:'t1'})]),tasks:[task,{...task,id:'t2'}]});
 assert.deepEqual(ordered.map(row=>row.task_id),['t1','t2']);
 assert.deepEqual(buildDecisions({flow:null}),[]);
 assert.deepEqual(buildDecisions({flow:flow([gate({reason:'something_new'})]),tasks:[task]}),[]);
});

test('plan pending items, stalls, projects and opportunities each map to their own kind',()=>{
 const task={id:'t1',title:'Mission',plan_report:plan(['Pick a tier'])};
 const items=buildDecisions({flow:flow([
   gate({reason:'human_scope_required'}),
   {kind:'project',reason:'breaker_open',title:'Disjuntor',questions:['q'],since:'2026-10-05T00:00:00Z'},
   {kind:'opportunity',opportunity_id:'o1',reason:'abstained',title:'Proposal',questions:['q']}],[{task_id:'t3',reason:'priority_not_served',owner:'host-scheduler',since:'2026-10-05T00:30:00Z',quiet_ms:3600000}]),tasks:[task,{id:'t3',title:'Quiet'}]});
 assert.deepEqual(items.map(row=>row.kind).sort(),['breaker_open','opportunity_gate','plan_pending','stalled']);
 assert.equal(items.find(row=>row.kind==='stalled').question.includes('60 min'),true);
 assert.equal(buildDecisions({flow:flow([gate({reason:'human_scope_required'})]),tasks:[{id:'t1',title:'No plan'}]})[0].kind,'stalled');
});

test('advice is built only from reversible options a person could pick without writing anything',()=>{
 const item=buildDecisions({flow:flow([gate({reason:'human_scope_required'})]),tasks:[{id:'t1',title:'M',plan_report:plan(['x'])}]})[0];
 assert.deepEqual(adviceOptions(item).map(o=>o.id),['proceed_by_charter','replan']);
 const lean=readAdvice({ok:true,action:'abstain',choice:'proceed_by_charter',confidence:0.75,probabilities:{proceed_by_charter:0.75,replan:0.2,abstain:0.05,invented:0.9},reason:'confidence_below_threshold'},item,'T');
 assert.deepEqual([lean.state,lean.option_id,lean.confidence],['leaning','proceed_by_charter',0.75]);
 assert.equal('invented' in lean.probabilities,false);
 assert.equal(readAdvice({ok:true,action:'recommend',selected_id:'replan',confidence:0.9},item).state,'ready');
 assert.equal(readAdvice({ok:true,action:'recommend',selected_id:'answer',confidence:0.9},item).state,'abstained');
 assert.equal(readAdvice({ok:true,action:'abstain',choice:'abstain',confidence:0.4},item).state,'abstained');
 assert.equal(readAdvice({ok:true,action:'abstain',choice:'archive',confidence:0.7},item).state,'abstained');
 assert.equal(readAdvice({ok:false,error:'busy_retry_later'},item).state,'failed');
});

test('answers map to enumerated effects on the mission and never to permissions',()=>{
 const now='2026-10-05T03:00:00.000Z',kind=name=>({id:'i',kind:name,options:KINDS[name].options});
 const budget={max_minutes:10,pipeline:{budget_minutes:10}};
 applyAnswer(budget,kind('budget_exhausted'),'extend_budget',undefined,{now});
 assert.equal(budget.pipeline.budget_minutes,20);assert.equal(budget.pipeline.budget_extensions[0].reason,'human_decision');assert.equal(budget.autonomy_resume_at,now);
 const launches={launches:8};applyAnswer(launches,kind('launch_limit'),'extend_launches',undefined,{now});assert.equal(launches.launch_extensions,1);
 const diagnosis={diagnosis:{count:2}};applyAnswer(diagnosis,kind('diagnosis_limit'),'allow_diagnosis',undefined,{now});assert.equal(diagnosis.diagnosis.count,1);
 const operator={error:'login required'};applyAnswer(operator,kind('authorization_required'),'operator_cleared',undefined,{now});assert.deepEqual(operator.operator_cleared,{error:'login required',at:now});
 const stopped={pipeline:{cancelled:true}};applyAnswer(stopped,kind('human_cancelled'),'reauthorize',undefined,{now});assert.equal(stopped.pipeline.cancelled,false);
 const archived={};applyAnswer(archived,kind('stalled'),'archive',undefined,{now});assert.equal(archived.archived_at,now);assert.equal(archived.autonomy_resume_at,undefined);
 assert.throws(()=>applyAnswer({},kind('stalled'),'extend_budget'),/inexistente/);
});

test('a plan answer lifts the pending list through the same record the triage uses, bound to the exact report',()=>{
 const task={plan_report:plan(['Pick a tier','Pick a region'])};
 const item={id:'i',kind:'plan_pending',options:KINDS.plan_pending.options};
 assert.throws(()=>applyAnswer({...task},item,'answer',''),/exige uma resposta/);
 const note='x'.repeat(NOTE_LIMIT+200);
 const answered={...task};const {record}=applyAnswer(answered,item,'answer',note,{now:'T'});
 assert.equal(record.note.length,NOTE_LIMIT);
 assert.equal(answered.pending_resolution.model,'human');assert.equal(answered.pending_resolution.resolved_all,true);
 assert.equal(resolutionCovers(answered.plan_report,readPlanContract(answered.plan_report),answered.pending_resolution),true);
 assert.equal(answered.pending_resolution.plan_digest,planDigest(task.plan_report));
 // The same answer cannot lift a different report.
 assert.equal(resolutionCovers(plan(['Pick a tier','Pick a region','Another']),readPlanContract(plan(['Pick a tier','Pick a region','Another'])),answered.pending_resolution),false);
 assert.throws(()=>applyAnswer({plan_report:plan([])},item,'proceed_by_charter'),/não tem mais pendências/);
});
