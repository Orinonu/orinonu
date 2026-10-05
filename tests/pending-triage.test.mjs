import test from 'node:test';
import assert from 'node:assert/strict';
import {implementationPlan,planDigest,TRIAGE_VERSION} from '../src/pipeline.mjs';
import {triageRequest,readTriage,humanQuestions,triageState,alignmentBasis,charterBrief,MAX_TRIAGE_ITEMS} from '../src/pending-triage.mjs';

const plan=(pending,ready=false)=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:ready,pending_decisions:pending,steps:['Edit the file'],verification:['Run the tests']})+'\n```';
const direction={mission:'Ship reliable autonomy',vision:'Nothing stalls',objective:'Move every mission',success_criteria:'Real changes tested'};
const task=(pending,extra={})=>({id:'t1',goal:'Fix the defect',acceptance:'Tests pass',plan_report:plan(pending),...extra});
const answer=(request,values)=>({ok:true,model:'jev-test',conditions:request.conditions.map((condition,index)=>({id:condition.id,p_yes:values[index]}))});

test('a triage request is bounded, bound to the exact report and only exists for pending plans',()=>{
 const row=task(['Pick the index structure','Provide a monthly budget']);
 const request=triageRequest(row,direction);
 assert.equal(request.eligible,true);
 assert.equal(request.conditions.length,2);
 assert.equal(request.plan_digest,planDigest(row.plan_report));
 assert.match(request.state,/pending_items/);
 assert.match(request.state,/\[1\] Provide a monthly budget/);
 assert.ok(request.state.length<16000);
 assert.equal(triageRequest(task([]),direction).reason,'no_pending');
 assert.equal(triageRequest({...row,plan_report:'no contract'},direction).reason,'invalid_plan');
 const many=Array.from({length:MAX_TRIAGE_ITEMS+1},(_,index)=>`Item ${index}`);
 assert.equal(triageRequest(task(many),direction).reason,'too_many_pending');
});

test('only confidently non-human items lift the pending list; uncertainty fails closed',()=>{
 const row=task(['Pick the index structure','Provide a monthly budget','Confirm scope']);
 const request=triageRequest(row,direction);
 const record=readTriage(request,answer(request,[0.04,0.97,0.5]));
 assert.deepEqual(record.items.map(item=>item.verdict),['delegated','human','uncertain']);
 assert.equal(record.resolved_all,false);
 assert.deepEqual(record.human_items,[1,2]);
 const held={...row,pending_resolution:record};
 assert.throws(()=>implementationPlan(held.plan_report,held.pending_resolution),/pendências não resolvidas/);
 assert.equal(triageState(held),'human');
 assert.deepEqual(humanQuestions(held),['Provide a monthly budget','Confirm scope']);

 const clear=readTriage(request,answer(request,[0.01,0.1,0.15]));
 assert.equal(clear.resolved_all,true);
 const lifted=implementationPlan(row.plan_report,clear);
 assert.equal(lifted.ready_for_implementation,true);
 assert.deepEqual(lifted.pending_decisions,[]);
 assert.deepEqual(lifted.delegated_decisions,['Pick the index structure','Provide a monthly budget','Confirm scope']);
 assert.equal(triageState({...row,pending_resolution:clear}),'delegated');
});

test('a triage record is bound to its report and cannot be reused, reordered or forged',()=>{
 const row=task(['Choose retry policy']);
 const request=triageRequest(row,direction);
 const record=readTriage(request,answer(request,[0.02]));
 assert.equal(implementationPlan(row.plan_report,record).pending_decisions.length,0);
 const edited=plan(['Choose retry policy','Another question']);
 assert.throws(()=>implementationPlan(edited,record),/pendências/);
 assert.throws(()=>implementationPlan(plan(['Choose a different policy']),record),/pendências/);
 assert.throws(()=>implementationPlan(row.plan_report,{...record,version:'other'}),/pendências/);
 assert.throws(()=>implementationPlan(row.plan_report,{...record,items:[{...record.items[0],verdict:'human'}]}),/pendências/);
 assert.throws(()=>implementationPlan(row.plan_report,null),/pendências/);
 assert.equal(record.version,TRIAGE_VERSION);
 assert.equal(triageState({...row,plan_report:edited,pending_resolution:record}),'pending');
});

test('engine answers that do not match the request are rejected instead of guessed',()=>{
 const request=triageRequest(task(['One','Two']),direction);
 assert.equal(readTriage(request,{ok:false}),null);
 assert.equal(readTriage(request,{ok:true,conditions:[]}),null);
 assert.equal(readTriage(request,answer(request,[0.1])),null);
 assert.equal(readTriage(request,answer(request,[0.1,'high'])),null);
 assert.equal(readTriage(request,{ok:true,conditions:[{id:'p0',p_yes:0.1},{id:'other',p_yes:0.1}]}),null);
 assert.equal(readTriage(request,answer(request,[0.1,1.5])),null);
});

test('the charter brief and alignment basis change with the charter text, not with unrelated fields',()=>{
 assert.match(charterBrief(direction),/mission: Ship reliable autonomy/);
 assert.equal(charterBrief(undefined),'');
 const base=alignmentBasis({goal:'a',acceptance:'b'},direction);
 assert.equal(base,alignmentBasis({goal:'a',acceptance:'b',title:'ignored'},direction));
 assert.notEqual(base,alignmentBasis({goal:'a',acceptance:'b'},{...direction,vision:'Different'}));
 assert.notEqual(base,alignmentBasis({goal:'changed',acceptance:'b'},direction));
});

test('an autonomous project settles uncertain items by the charter, keeping only sensitive ones and confident human answers',()=>{
 const row=task(['Pick the index structure','Rotate the API key for billing','Confirm scope','Choose the naming scheme']);
 const request=triageRequest(row,direction);
 assert.deepEqual(request.items.map(item=>item.sensitive),[false,true,false,false]);
 assert.match(request.state,/HUMAN-ONLY only when/);
 assert.match(request.state,/saved project charter/);
 const strict=readTriage(request,answer(request,[0.5,0.5,0.5,0.5]));
 assert.deepEqual(strict.items.map(item=>item.verdict),['uncertain','uncertain','uncertain','uncertain']);
 const record=readTriage(request,answer(request,[0.5,0.5,0.97,0.5]),{delegateUncertain:true});
 assert.deepEqual(record.items.map(item=>item.verdict),['delegated','uncertain','human','delegated']);
 assert.deepEqual(record.items.map(item=>item.basis),['charter_default',undefined,undefined,'charter_default']);
 assert.deepEqual(record.human_items,[1,2]);
 assert.equal(record.resolved_all,false);
 const clear=readTriage(triageRequest(task(['Pick the index structure','Choose the naming scheme']),direction),{ok:true,conditions:[{id:'p0',p_yes:0.5},{id:'p1',p_yes:0.1}]},{delegateUncertain:true});
 assert.equal(clear.resolved_all,true);
 assert.equal(implementationPlan(plan(['Pick the index structure','Choose the naming scheme']),clear).pending_decisions.length,0);
});

test('a record written under an older triage rule never lifts or holds a plan',()=>{
 const row=task(['Choose retry policy']);
 const request=triageRequest(row,direction);
 const record={...readTriage(request,answer(request,[0.02])),version:'pending-triage-v1'};
 assert.throws(()=>implementationPlan(row.plan_report,record),/pendências/);
 const stale={...row,pending_resolution:{...record,items:[{...record.items[0],verdict:'human'}],resolved_all:false,human_items:[0]}};
 assert.equal(triageState(stale),'pending');
});
