import {implementationPlan,readPlanContract} from './pipeline.mjs';
import {createHash} from 'node:crypto';
import {findSpecialist} from './specialists.mjs';
import {technicalCompletion,unmetDependencies} from './queue.mjs';
// Completion and dependency semantics belong to the scheduler module; existing consumers keep importing them from here.
export {technicalCompletion,unmetDependencies};

// A decision that did not launch work. Only these consume the hold budget; planning,
// implementation, review and integration decisions are bounded by budget minutes instead.
export const PRODUCTIVE=new Set(['replan','realign','implement','review','integrate']);
export const HOLD_LIMIT=3,DECISION_CAP=12,BACKOFF_MS=[300000,1200000,3600000];
// A mission just created in an autonomous project is left alone briefly so the person can follow up (plan, edit, run).
export const SETTLE_MS=30000;
// An interrupted attempt is only auto-released once its last state transition is this old, so a
// supervisor that is still shutting down cannot race the liveness check.
export const INTERRUPT_SETTLE_MS=120000;
// Every launch (any phase, any origin) is counted on the mission; the cycle stops launching on its own after this many,
// and a person can extend the allowance in steps.
export const MAX_LAUNCHES=8,LAUNCH_EXTENSION=4;
export const launchAllowance=task=>MAX_LAUNCHES+(task.launch_extensions??0)*LAUNCH_EXTENSION;
export const unproductive=history=>history.filter(row=>!PRODUCTIVE.has(row.status));
// A person's explicit "resume" renews the automatic limits: decisions made before it no longer count against the mission.
export const sinceResume=(task,rows=[])=>{const at=Date.parse(task.autonomy_resume_at??'');return Number.isFinite(at)?(rows??[]).filter(row=>Date.parse(row.ended_at??row.time??'')>at):(rows??[]);};
// In an autonomous project nobody is waiting to supervise: after this many unproductive decisions the host
// applies the deterministic progression (all options are already host-validated and bounded) instead of
// asking again. Independent review, budget, isolation and the decision cap still apply.
export const HOST_DEFAULT_AFTER=1;
export const MAX_BUDGET_EXTENSIONS=2;
export const hostDefaultOption=options=>options.find(option=>option.id!=='hold')?.id??null;
export function holdRetryAt(history){
 const rows=unproductive(history),ended=Date.parse(rows.at(-1)?.ended_at??'');
 return rows.length&&Number.isFinite(ended)?ended+BACKOFF_MS[Math.min(rows.length,BACKOFF_MS.length)-1]:null;
}
const KNOWN_FAILURES=['execution_failed','tool_failed','verification_failed','missing_report','transient_executor_failure'];
const OPERATOR_ERROR=/auth|credential|quota|rate.limit|permission|login|assinatura|cancelad/i;

export function coordinatorRetry(task){
  const review=task.integration?.status==='awaiting_review'&&!!task.implementation_run?.attempt_id&&!!task.implementation_workspace?.workspace&&task.implementation_evidence?.changes?.length>0&&task.implementation_evidence.implementation_attempt_id===task.implementation_run.attempt_id;
  if(!review){try{implementationPlan(task.plan_report,task.pending_resolution);}catch{return false;}}
  const questionVersion=review?'review-coordinator-v1':'implementation-coordinator-v3';
  const trace=task.planning?.decision?.selection_trace;
  if(task.planning?.decision?.action!=='abstain'||!Array.isArray(trace)||trace.length<2||trace[0].parent!==null||trace[0].decision?.ok!==true||trace[0].decision?.action!=='recommend'||trace.at(-1).decision?.action!=='abstain'||task.specialist_selection_history?.some(row=>row.question_version===questionVersion))return false;
  const root=findSpecialist(trace[0].decision.selected_id);
  if(!root||root.parent!==null)return false;
  let parent=findSpecialist(trace.at(-1).parent);
  for(let n=0;n<8&&parent;n++){if(parent.id===root.id)return true;parent=findSpecialist(parent.parent);}
  return false;
}
// Coordinator abstentions predate narrowed re-asks; one retry is allowed per mission.
export const narrowRetry=task=>task.planning?.decision?.action==='abstain'&&!task.coordinator_narrow_retry&&!!task.plan_report;
export const autonomyFingerprint=(task,direction)=>createHash('sha256').update(JSON.stringify({question_version:coordinatorRetry(task)?(task.integration?.status==='awaiting_review'?'review-coordinator-v1':'implementation-coordinator-v3'):'mission-priority-score-v3',status:task.status,attempt:task.attempt?.id,goal:task.goal,acceptance:task.acceptance,direction,report:task.plan_report,review_report:task.review_report,integration:task.integration,resolution:task.pending_resolution?.items?.map(item=>item.verdict),diagnoses:task.diagnosis?.count??0,realigned:task.realignment?.basis??null})).digest('hex');

// The report is authoritative; the stored structured plan is only a fallback and can never be lifted by a triage record.
export function pendingItems(task){
  if(task.plan_report?.includes('```nexo-plan')){try{const items=readPlanContract(task.plan_report).pending_decisions;if(items.length)return items;}catch{}}
  return task.structured_plan?.pending_decisions??[];
}
const reportPending=task=>{try{return readPlanContract(task.plan_report).pending_decisions;}catch{return [];}};
/** `authorize` is the host's statement that the project runs in autonomous mode: the saved
 * policy delegates technical, reversible decisions for every non-cancelled mission of that
 * workspace. An explicit user stop is never overridden. */
export function autonomyProposal(task,direction,{now=Date.now(),authorize=false}={}){
  const history=sinceResume(task,task.autonomy_history);
  const hold=(reason,extra={})=>({eligible:false,reason,...extra});
  if(!direction?.objective?.trim())return hold('project_objective_required');
  if(!['backlog','review','blocked'].includes(task.status)||task.queue||task.archived_at||task.direction_assist||task.opportunity_audit||task.executor_probe)return hold('not_candidate');
  if(task.pipeline?.cancelled)return hold('not_authorized_or_cancelled',{cancelled:true});
  const settleAt=Date.parse(task.created_at??'')+SETTLE_MS;
  if(authorize&&settleAt>now&&!history.length)return hold('settling',{retry_at_ms:settleAt});
  if(!authorize){
    if(task.status==='backlog'&&!task.plan_report&&!history.length&&!task.admission)return hold('backlog_not_previously_prepared');
    if(!task.pipeline?.auto_implement)return hold('not_authorized_or_cancelled');
  }
  if(task.attempt&&task.attempt.state!=='terminal')return hold('execution_outcome_unconfirmed');
  if(task.recovery?.status==='selecting'||task.autonomy?.status==='selecting'||task.pending_triage?.status==='selecting')return hold('decision_in_progress');
  const pending=pendingItems(task);
  let canImplement=false;try{implementationPlan(task.plan_report,task.pending_resolution);canImplement=true;}catch{}
  if(pending.length&&!(canImplement&&reportPending(task).length))return hold('semantic_pending',{pending});
  const abstained=task.planning?.decision?.action==='abstain'&&!coordinatorRetry(task);
  const narrow=abstained&&authorize&&narrowRetry(task)&&canImplement;
  // A specialist is only prompt personalisation: when the project is autonomous the host falls back to a deterministic
  // specialist instead of waiting for a person.
  if(abstained&&!narrow&&!authorize)return hold('semantic_pending',{detail:'specialist_abstained'});
  const knownFailure=task.recovery_history?.some(row=>row.failure?.attempt_id===task.attempt?.id&&KNOWN_FAILURES.includes(row.failure?.code));
  // A person who fixed the credential, permission or quota outside the panel clears exactly that recorded error.
  const operator=OPERATOR_ERROR.test(task.error??'')&&task.operator_cleared?.error!==task.error;
  let diagnosis=false;
  if(task.status==='blocked'&&!coordinatorRetry(task)&&!knownFailure){
    if(!authorize)return hold('unknown_failure');
    if(operator)return hold('requires_operator');
    if((task.diagnosis?.count??0)>=2)return hold('diagnosis_limit');
    diagnosis=true;
  }
  if(task.post_review_decision?.status==='hold'&&(!authorize||sinceResume(task,task.post_review_history).length>=3))return hold('post_review_hold');
  const conflict=task.integration?.status==='blocked';
  if(conflict&&(!authorize||history.filter(row=>row.status==='replan'&&row.snapshot?.integration?.status==='blocked').length>=2))return hold('integration_conflict');
  if(operator)return hold('requires_operator');
  if((history.length>=DECISION_CAP||(!authorize&&unproductive(history).length>=HOLD_LIMIT))&&!(task.integration?.status==='awaiting_review'&&coordinatorRetry(task)))return hold('decision_limit');
  if((task.launches??0)>=launchAllowance(task))return hold('launch_limit');
  const fingerprint=autonomyFingerprint(task,direction);
  const retryAt=holdRetryAt(history);
  if(retryAt&&now<retryAt)return hold('backoff',{retry_at_ms:retryAt,fingerprint});
  // A timed hold may be asked again once its backoff elapsed; any other identical evidence was already evaluated.
  if(history.some(row=>row.fingerprint===fingerprint&&!(row.status==='hold'&&Number.isFinite(Date.parse(row.ended_at??'')))))return hold('already_evaluated',{fingerprint});
  const remainingMinutes=(task.pipeline?.budget_minutes??task.max_minutes)-(task.pipeline?.spent_ms??0)/60000;
  if(!(remainingMinutes>0))return hold('budget_exhausted',{fingerprint});
  const canReview=task.integration?.status!=='revision_required'&&!!task.implementation_run?.attempt_id&&!!task.implementation_workspace?.workspace&&task.implementation_evidence?.changes?.length>0&&task.implementation_evidence.implementation_attempt_id===task.implementation_run?.attempt_id;
  const rework=!conflict&&!diagnosis;
  const options=[
    ...(rework&&canImplement&&!canReview?[{id:'implement',text:task.integration?.status==='revision_required'?'Re-implement in an isolated workspace addressing the review findings and criteria before re-submitting for review.':'Implement the existing host-validated plan in an isolated workspace; then review real changes.'}]:[]),
    ...(rework&&canReview?[{id:'review',text:'Review the existing verified isolated implementation read-only; the host validates snapshots, tests and integration.'}]:[]),
    {id:'replan',text:diagnosis?'Diagnose the blocked state read-only from the recorded error and reports, identify the cause and produce a corrected implementation plan; no file is edited and no authorization is widened.':conflict?'Re-plan read-only against the current workspace after the integration conflict; the reviewed copy is preserved and a new isolated implementation follows only with a valid plan.':'Create the missing detailed implementation plan read-only for these unchanged established requirements; then implement in isolation and review.'},
    {id:'hold',text:authorize?'Postpone only if a prerequisite the host cannot obtain (a secret, credential, private data or external account) is genuinely missing; product, scope and design choices follow the saved charter and are never a reason to hold.':'Preserve evidence and seek supervision if actual scope, preferences, authorization or safety are unresolved.'}
  ];
  return {eligible:true,fingerprint,remainingMinutes,options,authorizes:!task.pipeline?.auto_implement,diagnosis,narrow_retry:narrow};
}

// ---- Shared eligibility: the cycle and the wait explanation read the same predicates, so a mission can never be
// ---- described as "waiting for the host" while the cycle is built to skip it (and vice versa).
/** The phase an option launches (mirrors the server's `phaseOf`). */
export const optionPhase=id=>id==='review'?'review':id==='implement'?'implementation':'planning';
/** Options the cycle can launch now: `hold` is always possible, a phase option needs a free slot in its phase. */
export const launchableOptions=(options,capacityOf)=>options.filter(option=>option.id==='hold'||capacityOf(optionPhase(option.id)));
/** Conditions outside `autonomyProposal` that keep the cycle away from a mission. Null when the cycle may consider it.
 * `receiptReview` is true once the host knows how to verify a session receipt on its own. */
export function tickBlocker(task,{tasks=[],receiptReview=false}={}){
  if(task.external_work?.status==='active'||task.desktop_review?.status==='active'&&Date.parse(task.desktop_review.expires_at)>Date.now())return {code:'session_active',owner:'session'};
  // Receipts have their own verification path (an independent read-only review); the general cycle never replans them.
  if(task.external_work?.status==='ready_for_integration')return {code:'session_receipt',owner:'host-scheduler'};
  const unmet=unmetDependencies(task,tasks);
  if(unmet.length)return {code:'waiting_dependency',owner:'host-scheduler',blocked_by:unmet};
  return null;
}
