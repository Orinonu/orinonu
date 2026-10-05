import {resolve,sep} from 'node:path';
import {criteriaCurrent} from './criteria.mjs';
export const defaultScheduler={planning_limit:7,implementation_limit:7,review_limit:7};
export function schedulerLimits(input={}){
 const result={...defaultScheduler};
 for(const key of Object.keys(result))if(input[key]!==undefined){if(!Number.isInteger(input[key])||input[key]<1||input[key]>10)throw new Error('Limite por fase deve estar entre 1 e 10.');result[key]=input[key];}
 return result;
}
export function overlappingWorkspaces(a,b){
 const key=value=>resolve(value).replace(/[\\/]+$/,'').toLowerCase();const x=key(a),y=key(b);
 return x===y||x.startsWith(y+sep)||y.startsWith(x+sep);
}
// A mission is technically complete only when the whole evidence chain for the same attempt is closed:
// approved review over the verified snapshot, integration of that exact snapshot, and a criteria set that
// still matches the mission's acceptance text. Anything less does not unblock dependents.
export function technicalCompletion(task){
 return task.review_contract?.decision==='approved'&&task.integration?.status==='merged'
  &&task.implementation_evidence?.changes?.length>0
  &&task.implementation_evidence.implementation_attempt_id===task.implementation_run?.attempt_id
  &&task.review_contract.snapshot_digest===task.review_snapshot?.snapshot_digest
  &&typeof task.review_snapshot?.snapshot_digest==='string'
  &&task.integration.snapshot_digest===task.review_snapshot.snapshot_digest
  &&!!task.review_snapshot.review_attempt_id
  &&task.integration.review_attempt_id===task.review_snapshot.review_attempt_id
  &&!!task.implementation_run?.attempt_id
  &&task.review_snapshot.implementation_attempt_id===task.implementation_run.attempt_id
  // An approval only counts for the criteria it covered, and only while the mission's acceptance text still yields that set.
  &&criteriaCurrent(task.review_snapshot,task.acceptance)
  &&(!task.review_snapshot.criteria||task.review_contract.criteria_hash===task.review_snapshot.criteria.hash);
}
/** Dependencies that are not yet technically complete. A missing or unfinished reference stays unmet. */
export const unmetDependencies=(task,tasks)=>(task.depends_on??[]).filter(id=>!tasks.some(other=>other.id===id&&other.status==='done'&&(technicalCompletion(other)||other.completion?.kind==='session_receipt_verified')));
const invalid=message=>Object.assign(new Error(message),{status:400});
/** Validates a depends_on write: real non-archived missions of this project, unique, never the mission
 * itself, and acyclic across the whole set. Returns the id list or null when the field is absent. */
export function readDependencyIds(input,tasks,selfId){
 if(input===undefined)return null;
 if(!Array.isArray(input)||input.length>20||input.some(value=>typeof value!=='string'||!value.trim())||new Set(input).size!==input.length)throw invalid('Dependências inválidas: informe até 20 ids de missões, sem repetições.');
 const ids=input.map(value=>value.trim()),byId=new Map(tasks.map(task=>[task.id,task]));
 for(const id of ids){
  const dependency=byId.get(id);
  if(!dependency)throw invalid('Dependência inexistente: '+id+'.');
  if(dependency.archived_at)throw invalid('Dependência arquivada nunca conclui: '+id+'.');
  if(id===selfId)throw invalid('Uma missão não pode depender de si mesma.');
 }
 const edges=new Map(tasks.map(task=>[task.id,task.depends_on??[]]));if(selfId!==undefined)edges.set(selfId,ids);
 const visiting=new Set(),visited=new Set();
 const reaches=start=>{if(start===selfId)return true;if(visited.has(start))return false;if(visiting.has(start))return false;visiting.add(start);const found=(edges.get(start)??[]).some(reaches);visiting.delete(start);visited.add(start);return found;};
 if(ids.some(reaches))throw invalid('Dependências cíclicas não são permitidas.');
 return ids;
}
export function queueWaitReason(task,occupants,limits,tasks){
 if(task.queue?.status!=='queued')return null;
 const phase=task.queue.phase;
 const unmet=tasks?unmetDependencies(task,tasks):[];
 if(unmet.length)return {code:'waiting_dependency',phase,blocking_task_ids:unmet,message:`Depende de ${unmet.length} ${unmet.length===1?'missão ainda não concluída':'missões ainda não concluídas'}; o despacho ocorre sozinho quando cada uma terminar.`};
 const conflicts=occupants.filter(other=>(phase==='implementation'||other.phase==='implementation')&&overlappingWorkspaces(task.execution_workspace??task.workspace,other.workspace));
 if(conflicts.length)return {code:'workspace_busy',phase,blocking_task_ids:conflicts.map(row=>row.task_id??row.id).filter(Boolean),message:`Workspace reservado por ${conflicts.length} ${conflicts.length===1?'execução':'execuções'}; escrita exige isolamento ou término dessas execuções.`};
 const count=occupants.filter(row=>row.phase===phase).length;
 const unconfirmed=occupants.filter(row=>row.phase===phase&&row.state==='outcome_unknown');
 // Reservations nobody can prove finished hold slots: say so, because the person cannot see them on the board.
 if(count>=limits[phase+'_limit']&&unconfirmed.length)return {code:'capacity_held_by_unconfirmed',phase,blocking_task_ids:unconfirmed.map(row=>row.task_id).filter(Boolean),blocking_since_ms:Math.min(...unconfirmed.map(row=>row.heartbeat).filter(Number.isFinite)),message:`${unconfirmed.length} de ${count} vagas desta etapa estão reservadas por tentativas interrompidas com resultado desconhecido; o host as libera quando comprova que não há processo vivo.`};
 if(count>=limits[phase+'_limit'])return {code:'phase_capacity',phase,message:`Limite de ${limits[phase+'_limit']} execuções simultâneas nesta etapa.`};
 return {code:'awaiting_dispatch',phase,message:'Aguardando seleção do especialista e despacho do executor.'};
}
// Automatic failure investigations are background diagnostics: they never delay a mission that is moving through the flow.
export const isDeferred=task=>/^Investigar falha:/.test(task?.title??'');
export const DEFERRED_PLANNING_LIMIT=2;
// Read-only workers may share a workspace; any writer remains exclusive.
// Missions that close something already paid for come first, then the better charter score; anything waiting past
// AGING_MS moves up a class so a low score can delay a mission but never starve it. Equal footing keeps FIFO.
export const AGING_MS=7200000;
const enqueuedOf=task=>String(task.queue.enqueued_at??task.queue.queued_at??'');
export function queueOrder(now=Date.now()){
 const aged=task=>{const waited=now-Date.parse(enqueuedOf(task));return Number.isFinite(waited)&&waited>AGING_MS;};
 const rank=task=>isDeferred(task)?(aged(task)?1:3):(aged(task)?0:2);
 const score=task=>Number.isFinite(task.flow_priority?.score)?task.flow_priority.score:1;
 return (a,b)=>rank(a)-rank(b)||(rank(a)===2?score(b)-score(a):0)||enqueuedOf(a).localeCompare(enqueuedOf(b));
}
export function admissibleQueue(tasks,occupants,limits,now=Date.now()){
 const counts={planning:0,implementation:0,review:0};
 const deferredCounts={planning:0,implementation:0,review:0};
 const byId=new Map(tasks.map(task=>[task.id,task]));
 for(const item of occupants){
  counts[item.phase]++;
  if(isDeferred(item)||isDeferred(byId.get(item.task_id)))deferredCounts[item.phase]++;
 }
 const selected=[],claims=[...occupants];
 for(const task of tasks.filter(t=>t.queue?.status==='queued').sort(queueOrder(now))){
  const phase=task.queue.phase;
  // A dependency that is not technically complete keeps the mission queued; the next drain admits it on its own.
  if(unmetDependencies(task,tasks).length)continue;
  if(counts[phase]>=limits[phase+'_limit'])continue;
  if(phase==='planning'&&isDeferred(task)&&deferredCounts.planning>=DEFERRED_PLANNING_LIMIT)continue;
  if(claims.some(other=>(phase==='implementation'||other.phase==='implementation')&&overlappingWorkspaces(task.execution_workspace??task.workspace,other.workspace)))continue;
  selected.push(task);claims.push({phase,workspace:task.execution_workspace??task.workspace,title:task.title});counts[phase]++;
  if(isDeferred(task))deferredCounts[phase]++;
 }
 return selected;
}
