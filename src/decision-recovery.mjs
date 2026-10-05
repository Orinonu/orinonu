import {autonomyProposal,tickBlocker,launchableOptions} from './autonomy.mjs';
import {classifyMission,healthReport} from './stall.mjs';
import {receiptReviewRequest} from './receipts.mjs';
import {humanQuestions,triageState} from './pending-triage.mjs';

/** Derives, from persisted facts only, why an idle mission is waiting, who owns the next
 * step and what resumes it. Nothing here launches work, calls JEV or grants permission.
 * Codes follow the vocabulary already rendered by both mission boards.
 */
export const OPPORTUNITY_HOLD_LIMIT=3;
export const OPPORTUNITY_BACKOFF_MS=[300000,1200000,3600000];
const HOST='host-scheduler',HUMAN='human';
const rule=(status,reason,owner,resume_condition,next_action,question)=>({status,reason,owner,resume_condition,next_action,...(question?{question}:{})});
const BY_PROPOSAL={
 project_objective_required:rule('gate','human_scope_required',HUMAN,'human_scope_or_permission_clarified','monitor_resume_condition','Defina o objetivo permanente do projeto para liberar o fluxo autônomo.'),
 execution_outcome_unconfirmed:rule('gate','execution_outcome_unconfirmed',HUMAN,'host_executor_outcome_confirmed','monitor_resume_condition','Confirme que nenhum processo da tentativa anterior segue ativo e libere a reserva (POST /api/tasks/:id/reconcile).'),
 decision_in_progress:rule('waiting','decision_in_progress',HOST,'current_decision_finished','monitor_resume_condition'),
 requires_operator:rule('gate','authorization_required',HUMAN,'explicit_human_authorization','monitor_resume_condition','A falha registrada exige autenticação, permissão ou cota; resolva fora do painel e retome a missão.'),
 diagnosis_limit:rule('gate','diagnosis_limit',HUMAN,'new_host_evidence_or_explicit_recovery_limit_extension','monitor_resume_condition','Dois diagnósticos somente leitura não resolveram o bloqueio; revise o relatório ou altere os requisitos.'),
 post_review_hold:rule('gate','technical_hold',HUMAN,'distinct_host_evidence','monitor_resume_condition','A decisão pós-revisão preservou a implementação isolada; decida se a integração deve prosseguir.'),
 integration_conflict:rule('gate','integration_conflict',HUMAN,'host_integration_receipt','monitor_resume_condition','A integração encontrou conflito e o replanejamento já foi tentado; resolva ou replaneje manualmente.'),
 decision_limit:rule('gate','decision_limit',HUMAN,'new_host_evidence_or_explicit_recovery_limit_extension','monitor_resume_condition','A missão atingiu o limite total de decisões automáticas sem convergir; forneça evidência nova, edite os requisitos ou decida manualmente.'),
 launch_limit:rule('gate','launch_limit',HUMAN,'explicit_launch_budget_extension','monitor_resume_condition','A missão já foi lançada várias vezes pelo ciclo sem concluir; estenda o orçamento de lançamentos, arquive-a ou edite os requisitos.'),
 budget_exhausted:rule('gate','budget_exhausted',HUMAN,'explicit_budget_extension','monitor_resume_condition','O orçamento de tempo da missão acabou; amplie-o para continuar.'),
 already_evaluated:rule('waiting','already_evaluated',HOST,'distinct_host_evidence','monitor_resume_condition'),
 backoff:rule('waiting','backoff',HOST,'retry_deadline_reached','backoff'),
};
const idle=task=>['backlog','review','blocked'].includes(task.status)&&!task.queue&&task.external_work?.status!=='active';

export function describeTask(task,{direction,now=Date.now(),autonomous=false,tasks=[],capacityOf=null,receiptReview=false,wipFull=false,breakerOpen=false}={}){
 if(!autonomous||task.opportunity_audit||task.direction_assist||task.archived_at)return null;
 const executingDiagnosis=task.diagnosis?.status==='running'||task.realignment?.status==='replanning';
 if(executingDiagnosis&&(task.queue||task.status==='planning'))return {status:'diagnosing',visible:true,reason:task.realignment?.status==='replanning'?'realigning':'unknown_recovery_cause',owner:HOST,resume_condition:'diagnosis_or_decision_completed',next_action:'diagnosing'};
 if(!idle(task))return null;
 const proposal=autonomyProposal(task,direction,{now,authorize:true});
 const since=task.ended_at??task.autonomy_history?.at(-1)?.ended_at??task.created_at;
 const make=(base,extra={})=>({status:base.status,visible:true,reason:base.reason,owner:base.owner,resume_condition:base.resume_condition,next_action:base.next_action,...(base.question?{questions:[base.question]}:{}),...(since?{since}:{}),...extra});
 // The cycle skips these missions before it ever asks JEV, so the explanation must say the same thing.
 const blocker=proposal.reason==='not_authorized_or_cancelled'?null:tickBlocker(task,{tasks,receiptReview});
 if(blocker?.code==='session_receipt'){
  const request=receiptReviewRequest(task);
  if(request.rejected)return make(rule('gate','session_receipt_rejected',HUMAN,'receipt_reverified_or_archived','monitor_resume_condition',task.receipt_review?.reason?`A revisão independente não comprovou o recibo da sessão: ${String(task.receipt_review.reason).slice(0,300)}`:'A revisão independente não comprovou o recibo da sessão.'));
  return make(rule('waiting','session_receipt',HOST,'receipt_verified_by_independent_review','verify_receipt'),request.retry_at_ms?{retry_at_ms:request.retry_at_ms}:{});
 }
 if(blocker?.code==='waiting_dependency')return make(rule('waiting','waiting_dependency',HOST,'dependencies_technically_complete','wait_for_dependencies'),{blocked_by:blocker.blocked_by});
 if(proposal.eligible){
  if(breakerOpen)return make(rule('waiting','breaker_open',HUMAN,'breaker_resumed_by_human','monitor_resume_condition'));
  if(capacityOf&&launchableOptions(proposal.options,capacityOf).length<2)return make(rule('waiting','waiting_capacity',HOST,'phase_capacity_available','wait_for_capacity'));
  if(wipFull&&!proposal.options.some(option=>option.id==='review'))return make(rule('waiting','wip_wait',HOST,'pipeline_slot_available','wait_for_pipeline_slot'));
  return make(rule('waiting','awaiting_priority',HOST,'diagnosis_or_decision_completed','redecide'));
 }
 if(proposal.reason==='settling')return make(rule('waiting','awaiting_priority',HOST,'retry_deadline_reached','backoff'),{retry_at_ms:proposal.retry_at_ms});
 if(proposal.reason==='not_authorized_or_cancelled')return make(rule('gate','human_cancelled',HUMAN,'explicit_human_reauthorization','monitor_resume_condition','A execução foi cancelada pelo usuário; reautorize explicitamente para retomar.'));
 if(proposal.reason==='semantic_pending'){
  if(proposal.detail==='specialist_abstained')return make(rule('gate','abstained',HUMAN,'distinct_host_evidence_or_explicit_recovery_limit_extension','monitor_resume_condition','JEV se absteve ao escolher o especialista mesmo com a consulta reduzida; escolha o especialista na missão ou edite os requisitos.'));
  const state=triageState(task);
  // Records from an older triage rule are ignored: the host re-triages them under the current rule.
  if(state==='pending')return make(rule('waiting','pending_triage',HOST,'diagnosis_or_decision_completed','redecide'));
  const questions=humanQuestions(task);
  return make(rule('gate','human_scope_required',HUMAN,'human_scope_or_permission_clarified','monitor_resume_condition'),{questions:questions.length?questions:['Pendência do plano sem texto legível; revise o relatório.']});
 }
 const base=BY_PROPOSAL[proposal.reason];
 if(!base)return null;
 return make(base,proposal.retry_at_ms?{retry_at_ms:proposal.retry_at_ms}:{});
}

export function opportunityHold(opportunity,now=Date.now()){
 const decision=opportunity.autonomy_decision;
 if(decision?.status!=='hold')return null;
 const attempts=decision.attempts??1,retryAt=decision.retry_at_ms??null;
 if(attempts>=OPPORTUNITY_HOLD_LIMIT)return {state:'gate',attempts,retry_at_ms:null};
 return {state:retryAt&&now<retryAt?'waiting':'ready',attempts,retry_at_ms:retryAt};
}

const LANES=['backlog','review','blocked'];
export function flowReport(tasks,{workspace,direction,policy,opportunities=[],now=Date.now(),capacityOf=null,capacity=null,receiptReview=false,slaMs,dispatchStuck,noopSuppressed=0,wip=null,breaker=null}={}){
 const autonomous=policy?.mode==='autonomous';
 // The caller scopes tasks and opportunities to one workspace (canonical path comparison).
 const scoped=tasks.filter(task=>!task.opportunity_audit&&!task.direction_assist&&!task.executor_probe&&!task.archived_at);
 const lanes=Object.fromEntries(LANES.map(lane=>[lane,{total:0,awaiting_priority:0,waiting_host:0,gated_human:0}]));
 const gates=[],waiting=[],classes=[];
 const recoveryOf=task=>autonomous?describeTask(task,{direction,now,autonomous,tasks,capacityOf,receiptReview,wipFull:!!wip?.full,breakerOpen:breaker?.state==='open'}):null;
 for(const task of scoped){
  const idleLane=LANES.includes(task.status)&&!task.queue;
  const recovery=recoveryOf(task);
  if(autonomous)classes.push(classifyMission(task,{now,slaMs,recovery,dispatchStuck}));
  if(!idleLane)continue;
  const lane=lanes[task.status];lane.total++;
  if(!recovery)continue;
  if(recovery.status==='gate'){
   lane.gated_human++;
   gates.push({kind:'mission',task_id:task.id,title:String(task.title).slice(0,120),lane:task.status,reason:recovery.reason,resume_condition:recovery.resume_condition,questions:recovery.questions??[],since:recovery.since??null});
  }else{
   if(recovery.reason==='awaiting_priority')lane.awaiting_priority++;else lane.waiting_host++;
   waiting.push({task_id:task.id,title:String(task.title).slice(0,120),lane:task.status,reason:recovery.reason,retry_at_ms:recovery.retry_at_ms??null,...(recovery.blocked_by?{blocked_by:recovery.blocked_by}:{})});
  }
 }
 for(const opportunity of opportunities.filter(o=>o.status==='pending')){
  const hold=autonomous?opportunityHold(opportunity,now):null;
  if(hold?.state==='gate')gates.push({kind:'opportunity',opportunity_id:opportunity.id,title:String(opportunity.title).slice(0,120),lane:'opportunities',reason:'abstained',resume_condition:'distinct_host_evidence_or_explicit_recovery_limit_extension',questions:['Aprovar ou descartar esta proposta: JEV se absteve em '+hold.attempts+' avaliações.'],since:opportunity.autonomy_decision?.time??null});
  else if(hold)waiting.push({opportunity_id:opportunity.id,title:String(opportunity.title).slice(0,120),lane:'opportunities',reason:hold.state==='waiting'?'backoff':'awaiting_priority',retry_at_ms:hold.retry_at_ms});
 }
 if(autonomous&&breaker?.state==='open')gates.push({kind:'project',reason:'breaker_open',title:'Disjuntor de produtividade aberto',lane:'project',resume_condition:'breaker_resumed_by_human',questions:['O projeto gastou várias etapas sem nenhum avanço verificável e foi pausado. Retome com uma missão-sonda, retome por completo ou mantenha pausado.'],since:breaker.opened_at??null});
 const health={...healthReport(classes,{capacity,noopSuppressed}),wip,breaker:breaker?{state:breaker.state,reason:breaker.reason??null,opened_at:breaker.opened_at??null}:null};
 if(breaker?.state==='open'&&health.state!=='stalled')health.state=classes.some(row=>row&&['running','queued_admissible'].includes(row.state))?'progressing':'gated';
 // Only work that can really move counts as activity: a queue nobody can drain, or a mission nobody serves, is not progress.
 const active=autonomous?health.counts.running+health.counts.queued_admissible:scoped.filter(task=>task.queue||task.external_work?.status==='active'||['planning','queued','running','reviewing'].includes(task.status)).length;
 const moving=autonomous?active||health.counts.waiting_host:active||waiting.length;
 const convergence=!scoped.length?'empty':health.state==='stalled'&&!active?'stuck':moving?'active':gates.length?'stuck':'idle';
 return {workspace:workspace??null,mode:policy?.mode??'supervised',generated_at:new Date(now).toISOString(),convergence,active,health,lanes,gates,waiting,
  ...(convergence==='stuck'?{stuck_message:health.state==='stalled'?`${health.stalled.length} item(ns) estão parados além do prazo sem trabalho ativo; o host aplica a escada de recuperação ou abre um portão.`:`${gates.length} item(ns) aguardam decisão humana e não há trabalho ativo; resolva as condições de retomada para continuar.`}:{})};
}
