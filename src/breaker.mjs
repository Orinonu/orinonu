/** Productivity circuit breaker for an autonomous project. Pure: the host supplies counters, this module decides.
 * It protects the subscription from a cycle that keeps spending stages without any verifiable advance. It does not
 * judge quality: an "advance" is a fact the host can see on a mission (a valid plan, real changes, an approved review,
 * a merge, a completion, a gate a person resolved). State: closed -> open -> half_open -> closed. */
export const WINDOW=8,PROBE_STAGES=2;

const count=(condition)=>condition?1:0;
/** Verifiable advances visible on one mission. */
export const missionMarks=task=>{
  if(!task||task.archived_at||task.opportunity_audit||task.direction_assist||task.executor_probe)return 0;
  const plan=task.structured_plan;
  return count(plan?.ready_for_implementation===true&&!plan.pending_decisions?.length)
    +count(task.implementation_evidence?.changes?.length>0)
    +count(task.review_contract?.decision==='approved')
    +count(task.integration?.status==='merged')
    +count(task.status==='done')
    +count(!!task.completion?.kind)
    +(task.human_answers?.length??0);
};
export const progressMarks=tasks=>tasks.reduce((total,task)=>total+missionMarks(task),0);

const fresh=({finished,marks})=>({state:'closed',last_marks:marks,advances:0,anchor_finished:finished,anchor_advances:0});

/** `finished` counts terminal attempts of the project; `marks` the current verifiable advances. */
export function evaluateBreaker(breaker,{finished,marks,now=Date.now()}){
  if(!breaker||!['closed','open','half_open'].includes(breaker.state))return {breaker:fresh({finished,marks}),changed:true,transition:null};
  const next={...breaker};
  const delta=marks-(breaker.last_marks??marks);
  if(delta>0)next.advances=(breaker.advances??0)+delta;
  next.last_marks=marks;
  let transition=null;
  const advanced=next.advances>(breaker.anchor_advances??0),stages=finished-(breaker.anchor_finished??finished);
  if(breaker.state==='closed'){
    if(advanced){next.anchor_finished=finished;next.anchor_advances=next.advances;}
    else if(stages>=WINDOW){Object.assign(next,{state:'open',opened_at:new Date(now).toISOString(),reason:'no_verified_advance',window_stages:stages});transition='opened';}
  }else if(breaker.state==='half_open'){
    if(advanced){Object.assign(next,{state:'closed',anchor_finished:finished,anchor_advances:next.advances});delete next.reason;delete next.opened_at;transition='closed';}
    else if(stages>=PROBE_STAGES){Object.assign(next,{state:'open',opened_at:new Date(now).toISOString(),reason:'probe_without_advance',window_stages:stages});transition='reopened';}
  }
  const changed=JSON.stringify(next)!==JSON.stringify(breaker);
  return {breaker:next,changed,transition};
}

/** A person resumes the project: `probe` lets two stages run and closes on the first advance, `full` closes now. */
export function resumeBreaker(breaker,mode,{finished,marks,now=Date.now()}){
  if(breaker?.state!=='open')throw new Error('Disjuntor não está aberto.');
  if(!['probe','full'].includes(mode))throw new Error('Modo de retomada inválido.');
  const base={...breaker,last_marks:marks,anchor_finished:finished,anchor_advances:breaker.advances??0,resumed_at:new Date(now).toISOString(),resumed_mode:mode};
  delete base.reason;delete base.opened_at;
  return {...base,state:mode==='full'?'closed':'half_open'};
}
