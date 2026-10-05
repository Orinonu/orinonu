import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlanContract,implementationPlan,planDigest,resolutionCovers} from '../src/pipeline.mjs';
import {buildDecisions,openPlanDecisions,applyAnswer} from '../src/decisions.mjs';

const step={id:'s1',title:'Edit file.txt',specialist:'generalist',files:['file.txt'],dependencies:[],skills:[],tools:[],mcps:[],inputs:['requirements'],outputs:['change'],verification:['tests'],max_minutes:10};
const option=(id,reversible=true)=>({id,label:'Option '+id,effect:'Effect of '+id,reversible});
const technical={id:'retry',kind:'technical',question:'Which retry policy?',options:[option('fixed'),option('backoff')],recommendation:'backoff',rationale:'Matches the existing client.'};
const preference={id:'tier',kind:'preference',question:'Which price tier for the beta?',options:[option('free'),option('paid')]};
const plan=(decisions,extra={})=>'```nexo-plan\n'+JSON.stringify({version:3,ready_for_implementation:true,pending_decisions:[],steps:[step],verification:['tests'],decisions,...extra})+'\n```';
const invalid=(report,pattern)=>assert.throws(()=>readPlanContract(report),pattern);

test('a v3 plan settles reversible technical choices itself and leaves the rest as typed questions',()=>{
 const read=readPlanContract(plan([technical,preference]));
 assert.equal(read.version,3);
 assert.deepEqual(read.pending_decisions,['Which price tier for the beta?']);
 assert.deepEqual(read.decided_by_plan,[{id:'retry',question:'Which retry policy?',option_id:'backoff'}]);
 assert.deepEqual(read.decisions.map(d=>[d.id,d.resolved_by_plan]),[['retry',true],['tier',false]]);
 assert.throws(()=>implementationPlan(plan([technical,preference])),/pendências não resolvidas/);
 const settled=implementationPlan(plan([technical]));
 assert.equal(settled.version,3);assert.deepEqual(settled.pending_decisions,[]);
});

test('a technical choice is only settled by the plan with a recommendation and no irreversible option',()=>{
 const risky={...technical,id:'drop',options:[option('keep'),option('drop',false)],recommendation:'keep'};
 const unrecommended={...technical,id:'pick',recommendation:undefined};
 const read=readPlanContract(plan([risky,unrecommended]));
 assert.deepEqual(read.decisions.map(d=>d.resolved_by_plan),[false,false]);
 assert.equal(read.pending_decisions.length,2);
});

test('v3 decisions are validated strictly and earlier versions keep working',()=>{
 invalid(plan([{...technical,options:[option('only')]}]),/opções inválidas|incompleta/);
 invalid(plan([{...technical,options:[option('a'),option('a')]}]),/opção de decisão inválida/);
 invalid(plan([{...technical,recommendation:'ghost'}]),/recomendação fora das opções/);
 invalid(plan([{...technical,kind:'whim'}]),/incompleta/);
 invalid(plan([technical,technical]),/incompleta/);
 invalid(plan(Array.from({length:13},(_,n)=>({...technical,id:'d'+n}))),/decisões inválidas/);
 invalid(plan([{...technical,options:[{...option('a'),reversible:'yes'},option('b')]}]),/opção de decisão inválida/);
 invalid(plan([technical]).replace('"version":3','"version":2'),/decisões exigem a versão 3/);
 const v1='```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Edit'],verification:['Test']})+'\n```';
 assert.equal(readPlanContract(v1).version,1);
 const v2='```nexo-plan\n'+JSON.stringify({version:2,ready_for_implementation:true,pending_decisions:[],steps:[step],verification:['tests']})+'\n```';
 assert.equal(readPlanContract(v2).version,2);
 assert.equal(readPlanContract(plan([])).version,3);
});

test('open plan decisions become typed inbox items and answering them all lifts the gate through the shared record',()=>{
 const report=plan([technical,preference,{...preference,id:'region',question:'Which region?'}]);
 const task={id:'t1',title:'Mission',plan_report:report};
 assert.deepEqual(openPlanDecisions(task).map(d=>d.id),['tier','region']);
 const flow={workspace:'/p',gates:[{kind:'mission',task_id:'t1',title:'Mission',reason:'human_scope_required',questions:['x'],since:'2026-10-05T00:00:00Z'}],health:{stalled:[]}};
 const all=buildDecisions({flow,tasks:[task]});
 assert.equal(all.length,2);
 assert.deepEqual(all.map(i=>i.kind),['plan_decision','plan_decision']);
 const items=['Which price tier for the beta?','Which region?'].map(question=>all.find(i=>i.question===question));
 assert.deepEqual(items[0].options.map(o=>o.id),['choose__free','choose__paid','replan']);
 assert.notEqual(items[0].id,items[1].id);

 applyAnswer(task,items[0],'choose__paid',undefined,{now:'T1'});
 assert.deepEqual(openPlanDecisions(task).map(d=>d.id),['region']);
 assert.equal(task.pending_resolution,undefined);
 assert.match(task.human_answers[0].note,/Which price tier for the beta\? → Option paid: Effect of paid/);

 applyAnswer(task,items[1],'choose__free',undefined,{now:'T2'});
 assert.deepEqual(openPlanDecisions(task),[]);
 const parsed=readPlanContract(report);
 assert.equal(resolutionCovers(report,parsed,task.pending_resolution),true);
 assert.equal(task.pending_resolution.items[0].source,'human_choice');
 assert.equal(task.pending_resolution.plan_digest,planDigest(report));
 assert.equal(implementationPlan(report,task.pending_resolution).ready_for_implementation,true);
 // A different report never inherits those answers.
 const other=plan([technical,preference,{...preference,id:'region',question:'Which region now?'}]);
 assert.deepEqual(openPlanDecisions({...task,plan_report:other}).map(d=>d.id),['tier','region']);
 // Answering a decision that is no longer open is a conflict, not a second effect.
 assert.throws(()=>applyAnswer(task,items[0],'choose__free'),/mudou ou já foi respondida/);
});
