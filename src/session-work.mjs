const phases=new Set(['planning','implementation','review']);
const conflict=message=>Object.assign(new Error(message),{status:409});
const invalid=message=>Object.assign(new Error(message),{status:400});
export function hasActiveSessionWork(task){return task?.external_work?.status==='active';}
export function sessionWorkOccupants(tasks){return tasks.filter(hasActiveSessionWork).map(task=>({task_id:task.id,phase:task.external_work.phase,workspace:task.workspace}));}
export function assertSessionWorkspace(task,phase,occupants,workspace=task.workspace){
 if(occupants.some(other=>other.task_id!==task.id&&(phase==='implementation'||other.phase==='implementation')&&overlappingWorkspaces(workspace,other.workspace)))throw conflict('Workspace reservado por outra sessão ou executor; use isolamento ou aguarde liberação.');
}
export function sessionWorkProgress(work){
 const items=work?.checklist??[],total=items.length,completed=items.filter(item=>item.done===true).length;
 return {completed,total,percent:total?Math.floor(completed*100/total):null};
}
function checklist(items){
 if(!Array.isArray(items)||items.length>100)throw invalid('Checklist inválido.');
 const ids=new Set();
 return items.map(item=>{
  if(!item||typeof item.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(item.id)||ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label.length>160||typeof item.done!=='boolean')throw invalid('Item de checklist inválido.');
  ids.add(item.id);return {id:item.id,label:item.label,done:item.done};
 });
}
export function applySessionWork(task,input,{now=new Date().toISOString()}={}){
 if(!input||typeof input.session_id!=='string'||!input.session_id.trim()||input.session_id.length>160||typeof input.owner!=='string'||!input.owner.trim()||input.owner.length>160)throw invalid('Sessão e responsável obrigatórios.');
 const prior=task.external_work,same=prior?.session_id===input.session_id&&prior?.owner===input.owner;
 if(hasActiveSessionWork(task)&&!same)throw conflict('Outra sessão já reservou esta missão.');
 if(input.action==='record'){
  if(hasActiveSessionWork(task)||task.queue||task.attempt&&task.attempt.state!=='terminal'||['running','planning','reviewing'].includes(task.status))throw conflict('Missão possui reserva ou execução ativa.');
  if(task.archived_at||task.status==='done')throw conflict('Missão concluída ou arquivada.');
  if(input.phase!=='review')throw invalid('Recibo exige etapa review; não inicia execução.');
  const items=checklist(input.checklist);
  if(!items.length||items.some(item=>!item.done))throw conflict('Recibo exige checklist completo.');
  if(same&&prior?.status==='ready_for_integration'&&JSON.stringify(prior.checklist)===JSON.stringify(items))return structuredClone(task);
  const next=structuredClone(task);next.external_work={session_id:input.session_id,owner:input.owner,phase:'review',status:'ready_for_integration',recorded_at:now,updated_at:now,checklist:items};next.status='review';return next;
 }
 if(input.action==='claim'){
  if(task.queue||task.attempt&&task.attempt.state!=='terminal'||['running','planning','reviewing'].includes(task.status))throw conflict('Missão possui executor ou tentativa ativa.');
  if(task.archived_at||task.status==='done')throw conflict('Missão concluída ou arquivada.');
  if(!phases.has(input.phase))throw invalid('Etapa inválida.');
  assertOpportunityPhase(task,input.phase);
  if(hasActiveSessionWork(task)&&same){if(input.phase!==prior.phase)throw conflict('Libere a etapa atual antes de reservar outra.');return structuredClone(task);}
  const rework=receiptNeedsRework(task);
  if(prior?.status==='ready_for_integration'&&!rework)throw conflict('Recibo aguardando revisão independente.');
  if(rework&&input.phase!=='implementation')throw conflict('Recibo reprovado exige uma nova implementação.');
  if(task.pipeline?.cancelled)throw conflict('Missão cancelada; reautorização explícita obrigatória.');
  const next=structuredClone(task);
  if(rework){
   next.execution_history??=[];next.execution_history.push({reason:'session_receipt_rework',time:now,external_work:prior,receipt_review:task.receipt_review,review_report:task.review_report,review_contract:task.review_contract,review_snapshot:task.review_snapshot,desktop_review:task.desktop_review});
   next.rework_feedback=structuredClone(task.review_contract??{decision:'rejected',reason:task.receipt_review.reason,checks:[]});
   for(const key of ['receipt_review','review_contract','review_snapshot','review_report','desktop_review','completion'])next[key]=null;
  }
  next.external_work={session_id:input.session_id,owner:input.owner,phase:input.phase,status:'active',claimed_at:now,updated_at:now,checklist:checklist(input.checklist??[])};return next;
 }
 if(!hasActiveSessionWork(task)||!same)throw conflict('Reserva ativa desta sessão não encontrada.');
 const next=structuredClone(task);
 if(input.action==='update'){
  const items=checklist(input.checklist);
  if(prior.checklist.length&&(items.length!==prior.checklist.length||items.some((item,index)=>item.id!==prior.checklist[index].id||item.label!==prior.checklist[index].label)))throw conflict('Mantenha todos os itens e identificadores da etapa.');
  next.external_work.checklist=items;
 }else if(input.action==='release'){
  if(!['completed','cancelled'].includes(input.outcome))throw invalid('Resultado de liberação inválido.');
  if(input.outcome==='completed'&&(!prior.checklist.length||prior.checklist.some(item=>!item.done)))throw conflict('Checklist incompleto.');
  next.external_work.status=input.outcome==='completed'?'ready_for_integration':'released';next.external_work.released_at=now;
  if(input.outcome==='completed')next.status='review';
 }else throw invalid('Ação inválida.');
 next.external_work.updated_at=now;return next;
}
import {overlappingWorkspaces} from './queue.mjs';
import {assertOpportunityPhase} from './autonomy-opportunities.mjs';
import {receiptNeedsRework} from './receipts.mjs';
