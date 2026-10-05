import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarnessSupervisor} from '../src/harness-supervisor.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const task=(id='one')=>({id,workspace:'project',goal:'Improve project',acceptance:'Tests pass',revision:4,attempt:{id:'attempt-'+id,state:'terminal'},measurement:{duration_ms:200,usage:{input_tokens:10,output_tokens:2}}});
function setup(call,items=[task()]){const db={tasks:items,opportunities:[]};const supervisor=createHarnessSupervisor({db,save:()=>{},engine:{call}});return {db,supervisor};}
test('completion records real dimensions once and sends only decision schema',async()=>{
 let calls=0;const {db,supervisor}=setup(async(tool,request)=>{calls++;assert.equal(tool,'resolve_decision');assert.equal(request.supervisor,undefined);return {ok:true,action:'recommend',selected_id:'measurement'};});
 const first=supervisor.record(db.tasks[0],'review');assert.equal(supervisor.record(db.tasks[0],'review'),first);
 await tick();assert.equal(calls,1);assert.equal(db.harness_campaigns.length,1);assert.equal(db.harness_campaigns[0].status,'proposed');
 assert.equal(first.observation.total_tokens,12);assert.equal(first.evaluation.cost.score,null);assert.equal(first.evaluation.time.score,null);
 assert.equal(db.opportunities.length,1);assert.equal(db.opportunities[0].status,'pending');assert.match(db.opportunities[0].goal,/Investigar/);
 for(let i=0;i<4;i++)supervisor.summary();await tick();assert.equal(calls,1);
});
test('attempt or revision changes during decision discard proposal with evidence intact',async()=>{
 let resolve;const {db,supervisor}=setup(()=>new Promise(r=>{resolve=r;}));supervisor.record(db.tasks[0],'implementation');await tick();
 db.tasks[0].revision++;resolve({ok:true,action:'recommend',selected_id:'performance'});await tick();
 assert.equal(db.harness_campaigns[0].status,'superseded');assert.equal(db.opportunities.length,0);assert.equal(db.harness_campaigns[0].observation.duration_ms,200);
});
test('unknown, stopped and cancelled work never triggers research',async()=>{
 let calls=0;const {db,supervisor}=setup(async()=>{calls++;});
 db.tasks[0].attempt.state='outcome_unknown';assert.equal(supervisor.record(db.tasks[0],'review'),null);
 db.tasks[0].attempt.state='terminal';supervisor.record(db.tasks[0],'review',{stopped:true});await tick();assert.equal(calls,0);assert.equal(db.harness_campaigns[0].status,'cancelled');
});
test('one in-flight decision coalesces pending phases and preserves abstentions',async()=>{
 let resolve,calls=0;const tasks=[task('a'),task('b')];const {db,supervisor}=setup(()=>{calls++;return calls===1?new Promise(r=>{resolve=r;}):Promise.resolve({ok:false,action:'abstain'});},tasks);
 supervisor.record(tasks[0],'planning');await tick();supervisor.record(tasks[1],'planning');tasks[1].attempt.id='new-b';supervisor.record(tasks[1],'review');await tick();assert.equal(calls,1);
 resolve({ok:false,action:'abstain'});await tick();assert.equal(calls,2);assert.equal(db.harness_campaigns.filter(c=>c.status==='abstained').length,2);assert.equal(db.harness_campaigns.filter(c=>c.status==='superseded').length,1);
});
test('provider failure is visible and never retried automatically',async()=>{
 const {db,supervisor}=setup(async()=>{throw new Error('secret provider error');});supervisor.record(db.tasks[0],'review');await tick();assert.equal(db.harness_campaigns[0].status,'failed');assert.doesNotMatch(db.harness_campaigns[0].reason,/secret/);assert.equal(db.opportunities.length,0);
});
