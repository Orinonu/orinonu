import {buildFailureProposal} from './mission-observation.mjs';

// A failed mission may get one investigation proposal. When that investigation itself ends blocked, the failure belongs to the same
// lineage (root mission, originating task, attempt): the continuation is recorded on the root proposal instead of creating yet
// another successor. A genuinely different, known cause may open at most MAX_LINEAGE_DEPTH more proposals, and unknown causes are
// recorded on their own (never fused into a known cause). Approval of every proposal stays with the existing flow.
export const MAX_LINEAGE_DEPTH=2,MAX_CONTINUATIONS=20;

/** Cause classes come from facts the host recorded, never from reading prose for blame. */
export function failureCause(task,observation){
 const text=String(task?.error??'');
 if(task?.usage_limit_hold||/limite de uso|usage limit/i.test(text))return 'usage_limit';
 if(/auth|credential|credencial|login|assinatura|permission/i.test(text))return 'authorization';
 if(/Revisão não aprovou|abstained|rejected/i.test(text))return 'review_not_approved';
 if(/tempo/i.test(text)&&/limite/i.test(text))return 'timeout';
 if(Number.isFinite(observation?.failed_tools)&&observation.failed_tools>0)return 'tool_failed';
 if(/Executor terminou|código \d+/i.test(text))return 'execution_failed';
 return 'unknown';
}

const lineageOpportunity=(task,opportunities)=>(task.opportunity_id?opportunities.find(row=>row.id===task.opportunity_id&&row.lineage):null)??null;

/** Returns null (nothing to do), {kind:'propose',proposal} or {kind:'continue',opportunity_id,entry}. */
export function planFailure(task,observation,{opportunities=[]}={}){
 if(observation?.status!=='failed'||task.opportunity_audit)return null;
 const cause=failureCause(task,observation);
 if(cause==='usage_limit')return null;
 const parent=lineageOpportunity(task,opportunities);
 if(!parent){
  // A failed investigation whose origin record is gone has no lineage to extend; it must not start a new chain.
  if(/Investigar falha:/.test(task.title??''))return null;
  return {kind:'propose',proposal:buildFailureProposal(task,observation,{root_task_id:task.id,origin_task_id:task.id,origin_attempt_id:task.attempt?.id??null,depth:0,cause,causes:[cause]})};
 }
 const root=opportunities.find(row=>row.lineage?.root_task_id===parent.lineage.root_task_id&&row.lineage.depth===0)??parent;
 const known=new Set([...(root.lineage?.causes??[]),...(parent.lineage?.causes??[])]);
 const entry={task_id:task.id,attempt_id:task.attempt?.id??null,cause,time:new Date().toISOString()};
 const depth=(parent.lineage.depth??0)+1;
 if(cause!=='unknown'&&!known.has(cause)&&depth<=MAX_LINEAGE_DEPTH){
  const proposal=buildFailureProposal(task,observation,{root_task_id:parent.lineage.root_task_id,origin_task_id:task.id,origin_attempt_id:task.attempt?.id??null,depth,cause,causes:[cause]});
  return {kind:'propose',proposal:{...proposal,key:`mission-failure:${parent.lineage.root_task_id}:${cause}`}};
 }
 return {kind:'continue',opportunity_id:root.id,entry};
}

/** Applies a plan to the opportunity list; returns what changed for the event log. */
export function applyFailurePlan(plan,opportunities,{id,now=new Date().toISOString()}){
 if(!plan)return null;
 if(plan.kind==='propose'){
  if(opportunities.some(row=>row.key===plan.proposal.key))return {applied:'duplicate'};
  opportunities.push({...plan.proposal,id,created_at:now});
  return {applied:'proposed',lineage:plan.proposal.lineage};
 }
 const root=opportunities.find(row=>row.id===plan.opportunity_id);
 if(!root)return {applied:'orphan'};
 root.continuations=[...(root.continuations??[]),plan.entry].slice(-MAX_CONTINUATIONS);
 root.lineage={...root.lineage,causes:[...new Set([...(root.lineage?.causes??[]),plan.entry.cause])]};
 return {applied:'continued',opportunity_id:root.id,cause:plan.entry.cause};
}
