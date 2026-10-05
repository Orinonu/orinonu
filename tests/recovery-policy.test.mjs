import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecoveryProposal,validateRecoverySelection} from '../src/recovery-policy.mjs';

const input=()=>({task:{id:'mission',goal:'Repair parser',acceptance:'Parser tests pass',workspace:'C:/project',max_minutes:30,pipeline:{auto_implement:true},attempt:{id:'attempt-1',state:'terminal'}},failure:{attempt_id:'attempt-1',code:'verification_failed',evidence:['Parser rejects valid fixture; test failed.']},history:[],budget:{remaining_attempts:2,remaining_minutes:20}});

test('authorized failed mission can request bounded read-only diagnosis without repeating implementation',()=>{
 const proposal=buildRecoveryProposal(input());
 assert.equal(proposal.eligible,true);
 assert.deepEqual(proposal.options.map(row=>row.id),['replan','preserve_for_review','hold']);
 const action=validateRecoverySelection(proposal,{option_id:'replan',abstained:false},input());
 assert.equal(action.accepted,true);
 assert.equal(action.action.phase,'planning');
 assert.equal(action.action.read_only,true);
 assert.equal(action.action.goal,'Repair parser');
 assert.equal(action.action.acceptance,'Parser tests pass');
 assert.equal(action.action.max_minutes,20);
 assert.equal(action.action.auto_execute_implementation,false);
});

test('cancellation, unknown outcomes and unsafe failure classes never launch recovery',()=>{
 const mutations=[x=>x.task.pipeline.cancelled=true,x=>x.task.pipeline.auto_implement=false,x=>x.task.opportunity_audit=true,x=>x.task.attempt.state='outcome_unknown',x=>x.task.integration={status:'blocked'},...['scope_change','credential_missing','missing_user_preference','jev_abstention','integration_conflict','unknown'].map(code=>x=>x.failure.code=code),x=>x.failure.evidence=[]];
 for(const mutate of mutations){const state=input();mutate(state);assert.equal(buildRecoveryProposal(state).eligible,false);}
});

test('same failed attempt cannot be retried twice and only two recovery rounds are allowed',()=>{
 const state=input();state.history=[{attempt_id:'attempt-1',status:'reserved'}];
 assert.equal(buildRecoveryProposal(state).reason,'already_considered');
 state.history=[{attempt_id:'previous-1'},{attempt_id:'previous-2'}];
 assert.equal(buildRecoveryProposal(state).reason,'recovery_limit');
 state.history=[{attempt_id:'previous-1'}];
 assert.equal(buildRecoveryProposal(state).round,2);
 state.budget.remaining_attempts=0;
 assert.equal(buildRecoveryProposal(state).reason,'budget_exhausted');
});

test('fresh state rejects stale JEV response after requirements, evidence or budget changes',()=>{
 for(const mutate of [x=>x.task.acceptance='New requirement',x=>x.failure.evidence.push('New finding'),x=>x.budget.remaining_minutes=10,x=>x.task.attempt.id='new-attempt',x=>x.task.pipeline.cancelled=true]){
  const state=input(),proposal=buildRecoveryProposal(state);mutate(state);
  assert.equal(validateRecoverySelection(proposal,{option_id:'replan',abstained:false},state).accepted,false);
 }
});

test('abstention and invalid selection stay blocked; review selection never dispatches',()=>{
 const state=input(),proposal=buildRecoveryProposal(state);
 for(const selection of [null,{option_id:'replan',abstained:true},{option_id:'run',abstained:false},{option_id:'replan'}])assert.equal(validateRecoverySelection(proposal,selection,state).accepted,false);
 for(const option_id of ['hold','preserve_for_review'])assert.equal(validateRecoverySelection(proposal,{option_id,abstained:false},state).action.launch,false);
});

test('proposal preserves input evidence and narrows original execution budget',()=>{
 const state=input();state.task.max_minutes=5;const baseline=structuredClone(state);
 const proposal=buildRecoveryProposal(state);
 assert.equal(proposal.context.max_minutes,5);
 assert.deepEqual(state,baseline);
 assert.equal(buildRecoveryProposal({...state,failure:{...state.failure,attempt_id:'old'}}).reason,'stale_failure');
});
