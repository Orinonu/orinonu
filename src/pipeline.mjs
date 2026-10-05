import {createHash} from 'node:crypto';
import {findSpecialist} from './specialists.mjs';
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=2000&&!value.includes('\0');
const list=(value,empty=false)=>Array.isArray(value)&&value.length<=(empty?40:20)&&(empty||value.length>0)&&value.every(text);
const fail=reason=>{throw new Error(`Plano inválido: ${reason}; permanece para revisão.`);};
const id=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const relative=value=>text(value)&&!value.startsWith('/')&&!value.startsWith('\\')&&!value.includes(':')&&!value.split(/[\\/]/).some(part=>part==='..');

export const DECISION_KINDS=['technical','preference','authorization','budget','external'];
// v3 decisions: a reversible technical choice the plan itself recommends is settled by the plan (and reviewed with it);
// everything else, or any technical choice with an irreversible option or no recommendation, stays a question for a person.
function readDecisions(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>12)fail('decisões inválidas');
 const seen=new Set();
 return value.map(raw=>{
  if(!raw||typeof raw!=='object'||!id(raw.id)||raw.id.length>32||seen.has(raw.id)||!DECISION_KINDS.includes(raw.kind)||!text(raw.question)||!Array.isArray(raw.options)||raw.options.length<2||raw.options.length>4)fail('decisão incompleta ou com opções inválidas');
  seen.add(raw.id);
  const optionIds=new Set();
  const options=raw.options.map(option=>{
   if(!option||typeof option!=='object'||!id(option.id)||optionIds.has(option.id)||!text(option.label)||!text(option.effect)||typeof option.reversible!=='boolean')fail('opção de decisão inválida');
   optionIds.add(option.id);return {id:option.id,label:option.label,effect:option.effect,reversible:option.reversible};
  });
  if(raw.recommendation!==undefined&&!optionIds.has(raw.recommendation))fail('recomendação fora das opções');
  if(raw.rationale!==undefined&&!text(raw.rationale))fail('justificativa inválida');
  const resolved_by_plan=raw.kind==='technical'&&raw.recommendation!==undefined&&options.every(option=>option.reversible);
  return {id:raw.id,kind:raw.kind,question:raw.question,options,recommendation:raw.recommendation??null,rationale:raw.rationale??null,resolved_by_plan};
 });
}

// Resource lists are proposals, never tool grants or completed milestones.
export function readPlanContract(report){
 const matches=[...String(report??'').matchAll(/```nexo-plan\s*\n([\s\S]*?)\n```/g)];
 if(matches.length!==1)fail('forneça um único contrato nexo-plan');
 let plan;try{plan=JSON.parse(matches[0][1]);}catch{fail('JSON malformado');}
 if(!plan||typeof plan!=='object'||typeof plan.ready_for_implementation!=='boolean'||!list(plan.pending_decisions,true)||!list(plan.verification))fail('pendências ou verificações inválidas');
 if(plan.version===undefined||plan.version===1){
  if(!list(plan.steps))fail('etapas textuais inválidas');
  return {version:1,ready_for_implementation:plan.ready_for_implementation,pending_decisions:plan.pending_decisions,steps:plan.steps,verification:plan.verification};
 }
 if(![2,3].includes(plan.version)||!Array.isArray(plan.steps)||plan.steps.length<1||plan.steps.length>20)fail('versão ou subtarefas inválidas');
 const decisions=plan.version===3?readDecisions(plan.decisions):[];
 if(plan.version===2&&plan.decisions!==undefined)fail('decisões exigem a versão 3');
 const steps=plan.steps.map(s=>{
  if(!s||typeof s!=='object'||!id(s.id)||!text(s.title)||!findSpecialist(s.specialist)||!Array.isArray(s.dependencies)||s.dependencies.length>20||!s.dependencies.every(id)||new Set(s.dependencies).size!==s.dependencies.length||!list(s.files,true)||!s.files.every(relative)||!list(s.skills,true)||!list(s.tools,true)||!list(s.mcps,true)||!list(s.inputs)||!list(s.outputs)||!list(s.verification)||!Number.isInteger(s.max_minutes)||s.max_minutes<1||s.max_minutes>720)fail('subtarefa incompleta, especialista ou escopo inválido');
  return {id:s.id,title:s.title,specialist:s.specialist,files:s.files,dependencies:s.dependencies,skills:s.skills,tools:s.tools,mcps:s.mcps,inputs:s.inputs,outputs:s.outputs,verification:s.verification,max_minutes:s.max_minutes,status:'planned'};
 });
 const byId=new Map(steps.map(s=>[s.id,s]));if(byId.size!==steps.length)fail('IDs de subtarefas duplicados');
 const order=[],visiting=new Set(),visited=new Set();
 function visit(key){
  if(visited.has(key))return;if(visiting.has(key))fail('dependências cíclicas');
  const step=byId.get(key);if(!step)fail('dependência inexistente');
  visiting.add(key);for(const dependency of step.dependencies)visit(dependency);
  visiting.delete(key);visited.add(key);order.push(key);
 }
 for(const step of steps)visit(step.id);
 if(plan.version===3){
  const open=decisions.filter(decision=>!decision.resolved_by_plan);
  return {version:3,ready_for_implementation:plan.ready_for_implementation,pending_decisions:[...plan.pending_decisions,...open.map(decision=>decision.question)],decisions,decided_by_plan:decisions.filter(decision=>decision.resolved_by_plan).map(({id,question,recommendation})=>({id,question,option_id:recommendation})),steps,verification:plan.verification,execution_order:order,resources_status:'proposed_not_granted'};
 }
 return {version:2,ready_for_implementation:plan.ready_for_implementation,pending_decisions:plan.pending_decisions,steps,verification:plan.verification,execution_order:order,resources_status:'proposed_not_granted'};
}
export const TRIAGE_VERSION='pending-triage-v2';
export const planDigest=report=>createHash('sha256').update(String(report??'')).digest('hex');
export const pendingDigest=text=>createHash('sha256').update(String(text??'')).digest('hex').slice(0,16);
// A triage record only lifts a plan's pending list when it is bound to this exact report,
// covers every item in order, and judged each one non-human with confidence.
export function resolutionCovers(report,plan,resolution){
 return !!resolution&&resolution.version===TRIAGE_VERSION&&resolution.plan_digest===planDigest(report)&&Array.isArray(resolution.items)&&resolution.items.length===plan.pending_decisions.length
  &&resolution.items.every((item,index)=>item.index===index&&item.verdict==='delegated'&&item.text_digest===pendingDigest(plan.pending_decisions[index]));
}
export function implementationPlan(report,resolution){
 const plan=readPlanContract(report);
 if(plan.ready_for_implementation&&!plan.pending_decisions.length)return plan;
 if(plan.pending_decisions.length&&resolutionCovers(report,plan,resolution))return {...plan,ready_for_implementation:true,pending_decisions:[],delegated_decisions:plan.pending_decisions};
 fail('pendências não resolvidas');
}
