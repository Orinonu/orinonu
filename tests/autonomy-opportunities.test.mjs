import {readRecommendations} from '../src/recommendations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {implementationOpportunity,researchEpoch,opportunityFingerprint,assertOpportunityPhase} from '../src/autonomy-opportunities.mjs';
test('read-only audit cannot become a writer through preparation, restoration or review',()=>{
 const audit=Object.freeze({id:'audit',opportunity_audit:true,pipeline:{auto_implement:true},plan_report:'Preserved investigation report',structured_plan:{ready_for_implementation:true}});
 const before=JSON.stringify(audit);
 assert.doesNotThrow(()=>assertOpportunityPhase(audit,'planning'));
 for(const task of [audit,JSON.parse(before)])for(const phase of ['implementation','review',undefined]){
  assert.throws(()=>assertOpportunityPhase(task,phase),error=>error.status===409&&error.code==='audit_read_only');
 }
 assert.equal(JSON.stringify(audit),before);
 for(const phase of ['planning','implementation','review'])assert.doesNotThrow(()=>assertOpportunityPhase({opportunity_audit:false},phase));
});
test('audit provenance and explicit implementation objective are required for admission',()=>{
 const source={workspace:'/p',goal:'Investigate only',opportunity_audit:true,attempt:{id:'a',state:'terminal'},recommendation_processed:true,discovery_result:{status:'completed'}};
 source.id='id';source.plan_report='```nexo-opportunities\n'+JSON.stringify([{title:'Fix defect',goal:'Fix file defect',acceptance:'Test passes',recommendation:'Correct issue',risk:'Bounded',evidence:['file defect reproduced']}])+'\n```';const proposal=readRecommendations(source.plan_report,'/p','id')[0];
 assert.equal(implementationOpportunity(proposal,source),true);
 for(const change of [{goal:source.goal},{evidence:[]},{source:'unverified'}])assert.equal(implementationOpportunity({...proposal,...change},source),false);
 assert.equal(implementationOpportunity(proposal,{...source,discovery_result:{status:'completed_empty'}}),false);
 assert.notEqual(opportunityFingerprint(proposal,{objective:'x'},source),opportunityFingerprint(proposal,{objective:'y'},source));
});
test('research epoch renews only with verified integration; empty research and wording cannot reset allowance',()=>{
 const policy={},done=t=>t.done===true;
 const first=researchEpoch(policy,[],done);first.investigations=3;first.reserved_minutes=30;
 assert.equal(researchEpoch(policy,[{done:false,discovery_result:{status:'completed_empty'}}],done),first);
 policy.objective='Rephrase';assert.equal(researchEpoch(policy,[],done),first);
 const next=researchEpoch(policy,[{id:'actual',done:true,integration:{snapshot_digest:'verified'}}],done);assert.equal(next.investigations,0);assert.equal(next.reserved_minutes,0);
});
