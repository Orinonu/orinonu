import test from 'node:test';
import assert from 'node:assert/strict';
import {autonomyProposal,holdRetryAt,unproductive,hostDefaultOption,BACKOFF_MS,HOLD_LIMIT,DECISION_CAP} from '../src/autonomy.mjs';
import {describeTask,flowReport,opportunityHold,OPPORTUNITY_HOLD_LIMIT} from '../src/decision-recovery.mjs';
import {triageRequest,readTriage} from '../src/pending-triage.mjs';

const plan=(pending=[],ready=pending.length===0)=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:ready,pending_decisions:pending,steps:['Edit the file'],verification:['Run the tests']})+'\n```';
const direction={objective:'Move every mission',success_criteria:'Real changes tested'};
const NOW=Date.parse('2026-10-04T12:00:00Z');
const task=(extra={})=>({id:'t'+Math.random().toString(16).slice(2),workspace:'/p',title:'Mission',goal:'Edit the defect',acceptance:'Tests pass',status:'backlog',max_minutes:10,created_at:'2026-10-04T10:00:00Z',attempt:{id:'a1',state:'terminal'},...extra});
const authorized=extra=>task({pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},...extra});
const describe=(row,extra={})=>describeTask(row,{direction,now:NOW,autonomous:true,...extra});

test('autonomous mode delegates unprepared and unauthorized missions, but never overrides an explicit stop',()=>{
 const fresh=task();
 assert.equal(autonomyProposal(fresh,direction,{now:NOW}).reason,'backlog_not_previously_prepared');
 const proposal=autonomyProposal(fresh,direction,{now:NOW,authorize:true});
 assert.equal(proposal.eligible,true);
 assert.equal(proposal.authorizes,true);
 assert.deepEqual(proposal.options.map(option=>option.id),['replan','hold']);
 assert.equal(autonomyProposal(authorized(),direction,{now:NOW,authorize:true}).authorizes,false);
 const stopped=task({pipeline:{auto_implement:false,cancelled:true}});
 assert.equal(autonomyProposal(stopped,direction,{now:NOW,authorize:true}).reason,'not_authorized_or_cancelled');
 assert.equal(describe(stopped).reason,'human_cancelled');
 assert.equal(describe(stopped).owner,'human');
});

test('a mission created moments ago is left alone briefly',()=>{
 const justNow=task({created_at:new Date(NOW-5000).toISOString()});
 const proposal=autonomyProposal(justNow,direction,{now:NOW,authorize:true});
 assert.equal(proposal.reason,'settling');
 assert.ok(proposal.retry_at_ms>NOW);
 assert.equal(describe(justNow).next_action,'backoff');
 assert.equal(autonomyProposal(justNow,direction,{now:NOW+31000,authorize:true}).eligible,true);
});

test('unclassified blocked missions get a read-only diagnosis, not implementation, and only twice',()=>{
 const blocked=authorized({status:'blocked',error:'Workspace ocupado por outra missão.',plan_report:plan()});
 const proposal=autonomyProposal(blocked,direction,{now:NOW,authorize:true});
 assert.equal(proposal.eligible,true);
 assert.equal(proposal.diagnosis,true);
 assert.deepEqual(proposal.options.map(option=>option.id),['replan','hold']);
 assert.match(proposal.options[0].text,/Diagnose/);
 assert.equal(autonomyProposal({...blocked,diagnosis:{count:2}},direction,{now:NOW,authorize:true}).reason,'diagnosis_limit');
 assert.equal(describe({...blocked,diagnosis:{count:2}}).reason,'diagnosis_limit');
 assert.equal(autonomyProposal({...blocked,error:'Codex: conecte sua assinatura ChatGPT.'},direction,{now:NOW,authorize:true}).reason,'requires_operator');
 assert.equal(describe({...blocked,error:'login required'}).reason,'authorization_required');
});

test('holds back off in time and escalate to a human gate after the hold budget',()=>{
 const entry=(minutesAgo,status='hold')=>({status,fingerprint:'x'+minutesAgo,ended_at:new Date(NOW-minutesAgo*60000).toISOString()});
 const one=authorized({autonomy_history:[entry(1)]});
 const waiting=autonomyProposal(one,direction,{now:NOW,authorize:true});
 assert.equal(waiting.reason,'backoff');
 assert.equal(waiting.retry_at_ms,NOW-60000+BACKOFF_MS[0]);
 assert.deepEqual([describe(one).status,describe(one).owner,describe(one).retry_at_ms],['waiting','host-scheduler',waiting.retry_at_ms]);
 const later=authorized({autonomy_history:[entry(6)]});
 assert.equal(autonomyProposal(later,direction,{now:NOW,authorize:true}).eligible,true);
 // Nobody supervises an autonomous project: spent holds no longer gate it, the host default progresses instead.
 const spent=authorized({autonomy_history:[entry(300),entry(200),entry(100)]});
 assert.equal(autonomyProposal(spent,direction,{now:NOW,authorize:true}).eligible,true);
 assert.equal(autonomyProposal(spent,direction,{now:NOW}).reason,'decision_limit');
 const capped=authorized({autonomy_history:Array.from({length:DECISION_CAP},(_,index)=>entry(1000-index,'replan'))});
 assert.equal(autonomyProposal(capped,direction,{now:NOW,authorize:true}).reason,'decision_limit');
 const gate=describe(capped);
 assert.deepEqual([gate.status,gate.owner,gate.reason],['gate','human','decision_limit']);
 assert.equal(hostDefaultOption([{id:'implement'},{id:'replan'},{id:'hold'}]),'implement');
 assert.equal(hostDefaultOption([{id:'realign'},{id:'hold'}]),'realign');
 assert.equal(hostDefaultOption([{id:'hold'}]),null);
 // Productive decisions never consume the hold budget.
 const productive=authorized({autonomy_history:[entry(500,'replan'),entry(400,'implement'),entry(300,'review'),entry(200,'replan')]});
 assert.equal(unproductive(productive.autonomy_history).length,0);
 assert.equal(autonomyProposal(productive,direction,{now:NOW,authorize:true}).eligible,true);
 assert.equal(holdRetryAt([entry(10,'replan')]),null);
 assert.equal(HOLD_LIMIT,3);
});

test('pending decisions wait for JEV triage, then become precise human questions or proceed',()=>{
 const row=authorized({plan_report:plan(['Choose the retry policy','Provide a monthly budget'])});
 assert.equal(autonomyProposal(row,direction,{now:NOW,authorize:true}).reason,'semantic_pending');
 const before=describe(row);
 assert.deepEqual([before.status,before.reason,before.owner,before.next_action],['waiting','pending_triage','host-scheduler','redecide']);
 const request=triageRequest(row,direction);
 const mixed=readTriage(request,{ok:true,conditions:[{id:'p0',p_yes:0.02},{id:'p1',p_yes:0.99}]});
 const gated=describe({...row,pending_resolution:mixed});
 assert.deepEqual([gated.status,gated.reason,gated.owner],['gate','human_scope_required','human']);
 assert.deepEqual(gated.questions,['Provide a monthly budget']);
 const clear=readTriage(request,{ok:true,conditions:[{id:'p0',p_yes:0.02},{id:'p1',p_yes:0.1}]});
 const lifted=autonomyProposal({...row,pending_resolution:clear},direction,{now:NOW,authorize:true});
 assert.equal(lifted.eligible,true);
 assert.ok(lifted.options.some(option=>option.id==='implement'));
 // A triage the engine could not answer is finished by the host's charter default; it never becomes a blanket human gate.
 const failed=describe({...row,pending_triage:{status:'failed',attempts:2,plan_digest:'x'}});
 assert.deepEqual([failed.status,failed.reason,failed.owner],['waiting','pending_triage','host-scheduler']);
});

test('structured-plan pending items stay held even when the report itself is ready',()=>{
 const row=authorized({plan_report:plan(),structured_plan:{pending_decisions:['Choose preference']}});
 assert.equal(autonomyProposal(row,direction,{now:NOW,authorize:true}).reason,'semantic_pending');
});

test('human-owned conditions are explained with a resume condition',()=>{
 const outcome=describe(authorized({status:'blocked',attempt:{id:'a',state:'outcome_unknown'}}));
 assert.deepEqual([outcome.status,outcome.reason,outcome.resume_condition,outcome.owner],['gate','execution_outcome_unconfirmed','host_executor_outcome_confirmed','human']);
 assert.match(outcome.questions[0],/reconcile/);
 const budget=describe(authorized({pipeline:{auto_implement:true,budget_minutes:1,spent_ms:60000}}));
 assert.deepEqual([budget.reason,budget.resume_condition],['budget_exhausted','explicit_budget_extension']);
 const replanned={status:'replan',snapshot:{integration:{status:'blocked'}}};
 const retry=describe(authorized({status:'blocked',integration:{status:'blocked'},recovery_history:[{failure:{attempt_id:'a1',code:'execution_failed'}}],autonomy_history:[replanned]}));
 assert.equal(retry.reason,'awaiting_priority');
 const conflict=describe(authorized({status:'blocked',integration:{status:'blocked'},recovery_history:[{failure:{attempt_id:'a1',code:'execution_failed'}}],autonomy_history:[replanned,{...replanned,fingerprint:'second'}]}));
 assert.equal(conflict.reason,'integration_conflict');
 assert.equal(describe(authorized({status:'review',queue:{phase:'planning',status:'queued'}})),null);
 assert.equal(describe(authorized({status:'done'})),null);
 assert.equal(describe(authorized({opportunity_audit:true})),null);
 assert.equal(describeTask(authorized(),{direction,now:NOW,autonomous:false}),null);
});

test('a running diagnosis or realignment is visible while it executes',()=>{
 const diagnosing=describe(authorized({status:'planning',queue:{phase:'planning',status:'queued'},diagnosis:{status:'running'}}));
 assert.deepEqual([diagnosing.status,diagnosing.next_action],['diagnosing','diagnosing']);
 const realigning=describe(authorized({status:'planning',realignment:{status:'replanning'}}));
 assert.equal(realigning.reason,'realigning');
});

test('the flow report converges: active, stuck on human gates, idle',()=>{
 const policy={mode:'autonomous',workspace:'/p'};
 const gate=authorized({status:'blocked',error:'login required'});
 const stuck=flowReport([gate],{workspace:'/p',direction,policy,now:NOW});
 assert.equal(stuck.convergence,'stuck');
 assert.equal(stuck.gates.length,1);
 assert.equal(stuck.gates[0].reason,'authorization_required');
 assert.match(stuck.stuck_message,/aguardam decisão humana/);
 assert.equal(stuck.lanes.blocked.gated_human,1);
 const moving=flowReport([gate,authorized({id:'ready',created_at:new Date(NOW-60000).toISOString()})],{workspace:'/p',direction,policy,now:NOW});
 assert.equal(moving.convergence,'active');
 assert.equal(moving.lanes.backlog.awaiting_priority,1);
 const running=flowReport([gate,authorized({status:'running',started_at:new Date(NOW-60000).toISOString()})],{workspace:'/p',direction,policy,now:NOW});
 assert.equal(running.active,1);
 assert.equal(flowReport([],{workspace:'/p',direction,policy,now:NOW}).convergence,'empty');
 assert.equal(flowReport([authorized({status:'done'})],{workspace:'/p',direction,policy,now:NOW}).convergence,'idle');
 assert.equal(flowReport([gate],{workspace:'/p',direction,policy:{mode:'supervised'},now:NOW}).gates.length,0);
});

test('held opportunities are asked again after backoff and become human gates after the limit',()=>{
 const hold=(attempts,retry)=>({id:'o',title:'Proposal',status:'pending',workspace:'/p',autonomy_decision:{status:'hold',attempts,retry_at_ms:retry,time:new Date(NOW).toISOString()}});
 assert.equal(opportunityHold(hold(1,NOW+1000),NOW).state,'waiting');
 assert.equal(opportunityHold(hold(1,NOW-1000),NOW).state,'ready');
 assert.equal(opportunityHold(hold(OPPORTUNITY_HOLD_LIMIT,null),NOW).state,'gate');
 assert.equal(opportunityHold({status:'pending',autonomy_decision:{status:'investigating'}},NOW),null);
 const policy={mode:'autonomous'};
 const report=flowReport([],{direction,policy,opportunities:[hold(OPPORTUNITY_HOLD_LIMIT,null),hold(1,NOW+1000)],now:NOW});
 assert.equal(report.gates.length,1);
 assert.equal(report.gates[0].kind,'opportunity');
 assert.equal(report.waiting.length,1);
});

test('health tells progress from motion that does not move: silent executors, unserved missions and receipts the cycle skips',()=>{
 const policy={mode:'autonomous',workspace:'/p'},later=NOW+3600000;
 const silent=authorized({id:'silent',status:'running',started_at:new Date(NOW).toISOString()});
 const report=flowReport([silent],{workspace:'/p',direction,policy,now:later});
 assert.equal(report.health.state,'stalled');assert.equal(report.health.stalled[0].reason,'executor_silent');
 assert.equal(report.convergence,'stuck');assert.equal(report.active,0);
 const receipt=authorized({id:'receipt',status:'review',external_work:{status:'ready_for_integration',phase:'review'},ended_at:new Date(NOW).toISOString()});
 const parked=flowReport([receipt],{workspace:'/p',direction,policy,now:later});
 assert.equal(parked.waiting[0].reason,'session_receipt');
 assert.equal(parked.health.stalled[0].reason,'session_receipt');
 const fresh=flowReport([receipt],{workspace:'/p',direction,policy,now:NOW+60000});
 assert.equal(fresh.health.state,'progressing');
 const dependent=authorized({id:'dependent',depends_on:['missing'],status:'backlog'});
 const waiting=flowReport([dependent],{workspace:'/p',direction,policy,now:later});
 assert.equal(waiting.waiting[0].reason,'waiting_dependency');assert.deepEqual(waiting.waiting[0].blocked_by,['missing']);
 assert.equal(waiting.health.state,'progressing');
 const full=describeTask(authorized(),{direction,now:NOW+60000,autonomous:true,capacityOf:()=>false});
 assert.equal(full.reason,'waiting_capacity');
});

test('queued work behind reservations nobody can prove finished is stalled only after the SLA',()=>{
 const policy={mode:'autonomous',workspace:'/p'};
 const queued=wait=>authorized({id:'q',status:'planning',queue:{id:'q1',phase:'planning',status:'queued',enqueued_at:new Date(NOW).toISOString()},queue_wait:wait});
 const held={code:'capacity_held_by_unconfirmed',blocking_since_ms:NOW};
 assert.equal(flowReport([queued(held)],{workspace:'/p',direction,policy,now:NOW+600000}).health.state,'progressing');
 assert.equal(flowReport([queued(held)],{workspace:'/p',direction,policy,now:NOW+3600000}).health.stalled[0].reason,'capacity_held_by_unconfirmed');
 const line=flowReport([queued({code:'phase_capacity'})],{workspace:'/p',direction,policy,now:NOW+36000000});
 assert.equal(line.health.state,'progressing');assert.equal(line.active,1);
 const dispatch=flowReport([queued({code:'awaiting_dispatch'})],{workspace:'/p',direction,policy,now:NOW+600000,dispatchStuck:new Set(['q'])});
 assert.equal(dispatch.health.stalled[0].reason,'dispatch_stuck');
});
