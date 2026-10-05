import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {acceptance,mission,wait,sleep} from './harness.mjs';

const plan=(pending=[])=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:pending.length===0,pending_decisions:pending,steps:['Edit file.txt'],verification:['Run the tests']})+'\n```';
const humanOnly=input=>({ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.97}))});
const advising=goal=>/Recommend which option a person should choose/.test(goal);
// The model abstains for lack of confidence but still names the option it leans to.
const leaning=input=>advising(input.goal)?{ok:true,action:'abstain',selected_id:null,choice:'proceed_by_charter',confidence:0.75,probabilities:{proceed_by_charter:0.75,answer:0.15,abstain:0.1},reason:'confidence_below_threshold',model:'jev-1.13.0'}:{ok:true,action:'recommend',selected_id:input.options[0].id};
const answer=(f,id,body)=>f.request(`/api/decisions/${id}/answer`,body);
const items=async f=>(await f.get('/api/decisions')).items;

test('a human gate becomes a typed question with the JEV lean attached; answering it unblocks the mission without a click elsewhere',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{evaluate:humanOnly,decide:leaning,tasks:[w=>mission(w,{id,status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0},attempt:{id:randomUUID(),state:'terminal'},plan_report:plan(['Pick the pricing tier for the beta']),planning:{status:'prepared'}})]});
 await wait(async()=>(await items(f)).some(item=>item.kind==='plan_pending'&&item.recommendation.state==='leaning'),20000);
 const [item]=await items(f);
 assert.equal(item.task_id,id);assert.equal(item.owner,'human');
 assert.deepEqual(item.options.map(o=>o.id),['proceed_by_charter','answer','replan']);
 assert.match(item.question,/pricing tier/);
 assert.equal(item.recommendation.option_id,'proceed_by_charter');assert.equal(item.recommendation.confidence,0.75);
 // Advice is shown, never applied: the mission is still waiting.
 assert.equal(f.children.length,0);

 // A choice that needs a written answer is refused without one; an unknown option is refused too.
 assert.equal((await answer(f,item.id,{request_id:'r0',option_id:'answer'})).status,400);
 assert.equal((await answer(f,item.id,{request_id:'r0b',option_id:'nonexistent'})).status,400);
 assert.equal((await answer(f,item.id,{request_id:'r0c'})).status,400);

 const body={request_id:'r1',option_id:'proceed_by_charter'};
 const first=await answer(f,item.id,body);assert.equal(first.status,200);
 const replay=await answer(f,item.id,body);assert.equal(replay.status,200);
 assert.deepEqual(await replay.json(),await (await answer(f,item.id,body)).json());
 assert.equal((await answer(f,item.id,{...body,option_id:'replan'})).status,409);
 await wait(()=>f.children.length===1,20000);
 const current=(await f.state()).tasks.find(row=>row.id===id);
 assert.equal(current.pending_resolution.model,'human');assert.equal(current.pending_resolution.items[0].source,'human_charter');
 assert.equal(current.human_answers[0].option,'proceed_by_charter');
 // The item is gone once the cause is resolved; answering it again is a conflict, not a second effect.
 assert.equal((await answer(f,item.id,{request_id:'r2',option_id:'proceed_by_charter'})).status,409);
 assert.ok(f.events().some(e=>e.kind==='decision_answered'&&e.option_id==='proceed_by_charter'));
});

test('a written human answer reaches the executor as labelled data and is recorded on the mission',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{evaluate:humanOnly,decide:leaning,tasks:[w=>mission(w,{id,status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0},attempt:{id:randomUUID(),state:'terminal'},plan_report:plan(['Choose the retention period']),planning:{status:'prepared'}})]});
 await wait(async()=>(await items(f)).length===1,20000);
 const [item]=await items(f);
 assert.equal((await answer(f,item.id,{request_id:'w1',option_id:'answer',note:'Keep logs for 30 days.'})).status,200);
 await wait(()=>f.children.length===1,20000);
 const prompt=f.children[0].args.at(-1)==='-'?f.children[0].child.stdinText:f.children[0].args.at(-1);
 assert.match(prompt,/Decisões registradas por uma pessoa/);assert.match(prompt,/Keep logs for 30 days\./);
 const current=(await f.state()).tasks.find(row=>row.id===id);
 assert.equal(current.human_answers[0].note,'Keep logs for 30 days.');
});

test('an exhausted launch allowance becomes a question; extending it lets the cycle continue',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{scheduler:{planning_limit:10,implementation_limit:10,review_limit:10},tasks:[w=>mission(w,{id,launches:8})]});
 await wait(async()=>(await items(f)).some(item=>item.kind==='launch_limit'),15000);
 const [item]=await items(f);
 assert.deepEqual(item.options.map(o=>o.id),['extend_launches','archive']);
 assert.equal(f.children.length,0);
 assert.equal((await answer(f,item.id,{request_id:'l1',option_id:'extend_launches'})).status,200);
 await wait(()=>f.children.length===1,20000);
 assert.equal((await f.state()).tasks.find(row=>row.id===id).launch_extensions,1);
});

test('the breaker gate is a project-level question and resuming it is a recorded human decision',async t=>{
 const f=await acceptance(t,{policy:{breaker:{state:'open',reason:'no_verified_advance',opened_at:'2026-10-05T00:00:00.000Z',last_marks:0,advances:0,anchor_finished:0,anchor_advances:0}},tasks:[w=>mission(w)]});
 await wait(async()=>(await items(f)).some(item=>item.kind==='breaker_open'),15000);
 const item=(await items(f)).find(row=>row.kind==='breaker_open');
 assert.deepEqual(item.options.map(o=>o.id),['resume_probe','resume_full','keep_paused']);
 assert.equal(item.task_id,null);
 assert.equal((await answer(f,item.id,{request_id:'b1',option_id:'keep_paused'})).status,200);
 assert.equal((await f.state()).autonomy_policies[0].breaker.state,'open');
 const again=(await items(f)).find(row=>row.kind==='breaker_open');
 assert.equal((await answer(f,again.id,{request_id:'b2',option_id:'resume_full'})).status,200);
 assert.equal((await f.state()).autonomy_policies[0].breaker.state,'closed');
 await wait(()=>f.children.length===1,20000);
});

const v3=decisions=>'```nexo-plan\n'+JSON.stringify({version:3,ready_for_implementation:true,pending_decisions:[],steps:[{id:'s1',title:'Edit file.txt',specialist:'generalist',files:['file.txt'],dependencies:[],skills:[],tools:[],mcps:[],inputs:['requirements'],outputs:['change'],verification:['tests'],max_minutes:10}],verification:['tests'],decisions})+'\n```';
const option=id=>({id,label:'Option '+id,effect:'Effect of '+id,reversible:true});

test('a v3 plan turns its human-only decision into a typed question; the chosen option reaches the executor and unblocks the mission',async t=>{
 const id=randomUUID();
 const decisions=[{id:'retry',kind:'technical',question:'Which retry policy?',options:[option('fixed'),option('backoff')],recommendation:'backoff'},{id:'tier',kind:'preference',question:'Which price tier for the beta?',options:[option('free'),option('paid')]}];
 const f=await acceptance(t,{evaluate:humanOnly,decide:leaning,tasks:[w=>mission(w,{id,status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0},attempt:{id:randomUUID(),state:'terminal'},plan_report:v3(decisions),planning:{status:'prepared'}})]});
 await wait(async()=>(await items(f)).some(item=>item.kind==='plan_decision'),20000);
 const found=(await items(f)).filter(item=>item.task_id===id);
 assert.equal(found.length,1);
 const [item]=found;
 assert.equal(item.question,'Which price tier for the beta?');
 assert.deepEqual(item.options.map(o=>o.id),['choose__free','choose__paid','replan']);
 assert.equal(f.children.length,0);
 assert.equal((await answer(f,item.id,{request_id:'p1',option_id:'choose__paid'})).status,200);
 await wait(()=>f.children.length===1,20000);
 const prompt=f.children[0].args.at(-1)==='-'?f.children[0].child.stdinText:f.children[0].args.at(-1);
 assert.match(prompt,/Which price tier for the beta\? → Option paid: Effect of paid/);
 assert.equal((await f.state()).tasks.find(row=>row.id===id).pending_resolution.items[0].source,'human_choice');
});
