// Operational checks need no inference. These checks never certify delivery
// quality, infer prices, or promote an experiment into the live harness.
export function observeMission(task,now=Date.now()){
 if(!task.started_at)return null;
 const waiting=task.queue?.status==='queued';
 const active=!waiting&&['planning','running','reviewing'].includes(task.status);
 const elapsed=active?Math.max(0,now-Date.parse(task.started_at)):task.measurement?.execution_ms;
 const usage=task.measurement?.usage;
 const reason=waiting?'awaiting_executor':task.status==='blocked'?'execution_failed':active?'execution_in_progress':'acceptance_evidence_pending';
 return {id:task.id,task_id:task.id,title:task.title,workspace:task.workspace,time:task.ended_at??task.started_at,
  status:waiting?'waiting':active?'active':task.status==='blocked'?'failed':'awaiting_verification',phase:task.progress?.phase??task.status,
  execution_ms:Number.isFinite(elapsed)?elapsed:null,input_tokens:usage?.input_tokens??null,output_tokens:usage?.output_tokens??null,
  tool_events:task.progress?.tool_events??null,failed_tools:task.progress?.failed_tools??null,
  delivery_quality:'unverified',savings:'unmeasured',reasons:[reason]};
}
// Compatibility entry point: a failed diagnostic never spawns a diagnostic of itself. Lineage-aware planning lives in failure-lineage.mjs.
export function failureRecommendation(task,observation){
 if(observation?.status!=='failed')return null;
 if(/Investigar falha:/.test(task.title??'')||task.opportunity_audit)return null;
 return buildFailureProposal(task,observation,{root_task_id:task.id,origin_task_id:task.id,origin_attempt_id:task.attempt?.id??null,depth:0,cause:'unknown',causes:['unknown']});
}
export function buildFailureProposal(task,observation,lineage){
 return {key:`mission-failure:${task.id}`,lineage,title:`Investigar falha: ${task.title}`.slice(0,160),workspace:task.workspace,
  goal:'Investigar a execução interrompida desta missão e propor correção com evidências. Não implementar, repetir execução ou ampliar escopo automaticamente.',
  acceptance:'Identificar causa verificável ou lacunas de evidência; entregar plano de correção e testes. Não declarar qualidade ou economia sem medição.',
  evidence:[`Missão ${task.id}: execução bloqueada.`,`${observation.failed_tools??'Quantidade desconhecida de'} ferramentas reportaram falha; saída de processo não certifica entrega.`],
  recommendation:'JEV pode selecionar a investigação e o especialista após aprovação da proposta.',risk:'A causa requer investigação; a contagem de falhas não determina culpa ou qualidade.',
  max_minutes:20,status:'pending',source:'automatic_mission_observation'};
}
