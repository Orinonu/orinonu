import {createHash,randomUUID} from 'node:crypto';

/** Durable registry of human interventions in mission executions. One record per intervention, deduplicated by a
 * caller-chosen or derived key so retries never double-count. Identity fields (project, task, attempt) stay null
 * when the act cannot be attributed — unknown is preserved, never guessed. Intervention moments are counted;
 * elapsed waiting between records is never reported as active human time. */
export const INTERVENTION_CATEGORIES=['planned_approval','clarification','correction'];
export const INTERVENTION_LIMIT=2000;

const text=(value,max)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
const stampOf=value=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toISOString():null;};
const digest=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24);

// Options the flow already expects a person to grant (gates that exist by design) versus answers that inform it
// and versus answers that steer it. An option outside the three approved categories keeps category null.
const PLANNED_APPROVAL=new Set(['release_confirmed','operator_cleared','extend_budget','extend_launches','allow_diagnosis','reauthorize','resume','resume_probe','resume_full','approve_opportunity','proceed_by_charter']);
const CORRECTION=new Set(['replan','archive','reverify','dismiss_opportunity','keep_paused','cancel']);
export function decisionCategory(optionId){
  if(typeof optionId!=='string')return null;
  if(optionId.startsWith('choose__')||optionId==='answer')return 'clarification';
  if(PLANNED_APPROVAL.has(optionId))return 'planned_approval';
  if(CORRECTION.has(optionId))return 'correction';
  return null;
}

export function recordIntervention(list,input,{now=()=>new Date().toISOString()}={}){
  if(!Array.isArray(list))throw new Error('Registro de intervenções indisponível.');
  const at=stampOf(input?.at)??now();
  const key=text(input?.key,120)??digest(input?.origin??null,input?.action??null,input?.task_id??null,input?.attempt_id??null,at);
  const existing=list.find(row=>row.key===key);
  if(existing)return {record:existing,added:false};
  const record={id:randomUUID(),key,
    project:text(input?.project,1000),task_id:text(input?.task_id,80),attempt_id:text(input?.attempt_id,80),
    origin:text(input?.origin,60)??'unknown',action:text(input?.action,160),
    category:INTERVENTION_CATEGORIES.includes(input?.category)?input.category:null,
    at,evidence:text(input?.evidence,500)};
  list.push(record);
  if(list.length>INTERVENTION_LIMIT)list.splice(0,list.length-INTERVENTION_LIMIT);
  return {record,added:true};
}

export function summarizeInterventions(list,{project,task_id,attempt_id}={}){
  const rows=(Array.isArray(list)?list:[]).filter(row=>(project===undefined||row.project===project)&&(task_id===undefined||row.task_id===task_id)&&(attempt_id===undefined||row.attempt_id===attempt_id));
  const by_category=Object.fromEntries(INTERVENTION_CATEGORIES.map(category=>[category,0]));
  let unclassified=0;
  for(const row of rows){if(row.category===null)unclassified++;else if(row.category in by_category)by_category[row.category]++;}
  return {total:rows.length,by_category,unclassified,active_seconds:null,first_at:rows[0]?.at??null,last_at:rows[rows.length-1]?.at??null};
}

export function countTaskInterventions(list,taskId){return (Array.isArray(list)?list:[]).reduce((n,row)=>n+(row.task_id===taskId?1:0),0);}
