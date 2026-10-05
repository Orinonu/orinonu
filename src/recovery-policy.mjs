import {createHash} from 'node:crypto';

/** Pure proposal/validation boundary. Failure codes are facts supplied by the
 * supervisor, never inferred from prose. Unknown classifications fail closed.
 * The caller must atomically reserve recovery_key in history before enqueueing,
 * persist this proposal with its revision, and retain original error evidence.
 * A replan runs read-only; the normal plan/authorization gate remains mandatory
 * before another implementation. This module neither calls JEV nor launches work.
 */
const recoverable=new Set(['execution_failed','tool_failed','verification_failed','missing_report','transient_executor_failure','quota_exhausted','rate_limited']);
const text=value=>typeof value==='string'&&value.trim().length>0;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const revision=input=>createHash('sha256').update(JSON.stringify(stable(input))).digest('hex');

export function buildRecoveryProposal({task={},failure={},history=[],budget={}}={}){
 const hold=reason=>({eligible:false,reason,options:[]});
 if(task.pipeline?.auto_implement!==true||task.pipeline?.cancelled||task.cancelled)return hold('not_authorized');
 if(task.opportunity_audit)return hold('audit_only');
 if(!text(task.id)||!text(task.goal)||!text(task.acceptance)||!text(task.workspace))return hold('missing_requirements');
 if(task.attempt?.state!=='terminal'||!text(task.attempt?.id))return hold('outcome_not_confirmed');
 if(failure.attempt_id!==task.attempt.id)return hold('stale_failure');
 if(task.integration?.status==='blocked'||!recoverable.has(failure.code))return hold('requires_review');
 if(!Array.isArray(failure.evidence)||!failure.evidence.length||failure.evidence.some(row=>!text(row)))return hold('missing_evidence');
 if(!Array.isArray(history)||history.some(row=>!row||!text(row.attempt_id)))return hold('invalid_history');
 if(history.some(row=>row.attempt_id===task.attempt.id))return hold('already_considered');
 if(history.length>=2)return hold('recovery_limit');
 if(!Number.isInteger(budget.remaining_attempts)||budget.remaining_attempts<1||!Number.isFinite(budget.remaining_minutes)||budget.remaining_minutes<=0)return hold('budget_exhausted');
 const maxMinutes=Math.min(budget.remaining_minutes,Number.isFinite(task.max_minutes)&&task.max_minutes>0?task.max_minutes:budget.remaining_minutes);
 return {eligible:true,recovery_key:`${task.id}:${task.attempt.id}`,revision:revision({task,failure,history,budget}),round:history.length+1,
  context:{task_id:task.id,attempt_id:task.attempt.id,goal:task.goal,acceptance:task.acceptance,workspace:task.workspace,failure:{code:failure.code,evidence:failure.evidence.slice(0,8).map(row=>row.slice(0,1500))},max_minutes:maxMinutes},
  options:[{id:'replan',description:'Diagnose the recorded failure read-only; preserve goal, acceptance, evidence and budget. Produce a revised plan and verifiable checks before implementation.'},{id:'preserve_for_review',description:'Preserve evidence and changes for review; do not launch any executor.'},{id:'hold',description:'Keep the mission blocked pending more evidence; do not launch any executor.'}]};
}

/** Validate against fresh state after JEV returns. Accepted is a bounded action
 * proposal, not a permission grant. Caller rechecks/reserves in its transaction.
 */
export function validateRecoverySelection(proposal,selection,input){
 const current=buildRecoveryProposal(input);
 const reject=reason=>({accepted:false,reason,action:null});
 if(!current.eligible)return reject(current.reason);
 if(!proposal?.eligible||proposal.revision!==current.revision||proposal.recovery_key!==current.recovery_key)return reject('stale_revision');
 if(!selection||selection.abstained!==false||!current.options.some(option=>option.id===selection.option_id))return reject('no_valid_selection');
 if(selection.option_id!=='replan')return {accepted:true,action:{kind:selection.option_id,launch:false,recovery_key:current.recovery_key,revision:current.revision}};
 return {accepted:true,action:{kind:'replan',phase:'planning',read_only:true,auto_execute_implementation:false,launch:true,...current.context,recovery_key:current.recovery_key,revision:current.revision,round:current.round}};
}
