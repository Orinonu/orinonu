import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBreaker,resumeBreaker,missionMarks,progressMarks,WINDOW,PROBE_STAGES} from '../src/breaker.mjs';

const step=(breaker,finished,marks)=>evaluateBreaker(breaker,{finished,marks,now:Date.parse('2026-10-05T00:00:00Z')});

test('verifiable advances are facts on the mission, never prose or exit codes',()=>{
 assert.equal(missionMarks({structured_plan:{ready_for_implementation:true,pending_decisions:[]}}),1);
 assert.equal(missionMarks({structured_plan:{ready_for_implementation:true,pending_decisions:['x']}}),0);
 assert.equal(missionMarks({status:'done',integration:{status:'merged'},review_contract:{decision:'approved'},implementation_evidence:{changes:[{path:'a'}]}}),4);
 assert.equal(missionMarks({status:'review',review_contract:{decision:'rejected'},implementation_evidence:{changes:[]}}),0);
 assert.equal(missionMarks({archived_at:'x',status:'done'}),0);
 assert.equal(missionMarks({opportunity_audit:true,status:'done'}),0);
 assert.equal(missionMarks({human_answers:[{},{}]}),2);
 assert.equal(progressMarks([{status:'done'},{status:'done'}]),2);
});

test('the breaker opens after a window of finished stages without advance, and an advance resets the window',()=>{
 let state=step(null,10,3);assert.equal(state.breaker.state,'closed');
 let breaker=state.breaker;
 for(let n=1;n<WINDOW;n++){state=step(breaker,10+n,3);breaker=state.breaker;assert.equal(breaker.state,'closed');}
 // one advance right before the limit restarts the count
 state=step(breaker,10+WINDOW-1,4);breaker=state.breaker;assert.equal(breaker.state,'closed');assert.equal(breaker.advances,1);
 for(let n=1;n<WINDOW;n++){state=step(breaker,10+WINDOW-1+n,4);breaker=state.breaker;assert.equal(breaker.state,'closed');}
 state=step(breaker,10+2*WINDOW-1,4);
 assert.equal(state.breaker.state,'open');assert.equal(state.transition,'opened');assert.equal(state.breaker.reason,'no_verified_advance');
});

test('an open breaker waits for a person; a probe closes on the first advance or reopens after two idle stages',()=>{
 let breaker=step(null,0,0).breaker;breaker=step(breaker,WINDOW,0).breaker;
 assert.equal(breaker.state,'open');
 assert.equal(step(breaker,WINDOW+50,0).breaker.state,'open');
 assert.throws(()=>resumeBreaker({state:'closed'},'probe',{finished:0,marks:0}),/não está aberto/);
 assert.throws(()=>resumeBreaker(breaker,'maybe',{finished:0,marks:0}),/inválido/);
 const probing=resumeBreaker(breaker,'probe',{finished:WINDOW+1,marks:0});
 assert.equal(probing.state,'half_open');
 const good=step(probing,WINDOW+2,1);assert.equal(good.breaker.state,'closed');assert.equal(good.transition,'closed');
 const bad=step(step(probing,WINDOW+2,0).breaker,WINDOW+1+PROBE_STAGES,0);assert.equal(bad.breaker.state,'open');assert.equal(bad.breaker.reason,'probe_without_advance');
 assert.equal(resumeBreaker(breaker,'full',{finished:WINDOW,marks:0}).state,'closed');
});

test('a drop in marks (a restarted implementation) is not an advance and does not break the counters',()=>{
 let breaker=step(null,0,5).breaker;
 breaker=step(breaker,1,3).breaker;
 assert.equal(breaker.advances,0);assert.equal(breaker.last_marks,3);
 breaker=step(breaker,2,4).breaker;assert.equal(breaker.advances,1);
});

test('garbage state restarts closed instead of throwing',()=>{
 assert.equal(step({state:'weird'},4,2).breaker.state,'closed');
});
