#!/usr/bin/env node
// Bridge between an interactive coding session (Devin, Codex, any shell) and Nexo Mission Control.
// It only talks to the local HTTP API: list missions, read one, reserve it for this session, report checklist progress and
// release it. A release records a receipt for review; it never marks a mission done, never integrates and grants nothing.
import {randomUUID} from 'node:crypto';

const BASE=(process.env.NEXO_URL??'http://127.0.0.1:18792').replace(/\/+$/,'');
const USAGE=`Uso: node scripts/mission-control-cli.mjs <comando> [opções]

  list    --workspace <pasta> [--status backlog,blocked,review] [--limit 20] [--cursor <c>] [--fields id,title,goal]
  show    <id|prefixo>                      requisitos, plano e evidências da missão
  claim   <id|prefixo> --items "a|b|c" [--phase implementation] [--session <id>] [--owner <nome>]
  check   <id|prefixo> <item-id>...         marca itens do checklist como concluídos
  uncheck <id|prefixo> <item-id>...
  finish  <id|prefixo> [--outcome completed|cancelled]   libera a reserva (completed exige checklist completo)
  receipt <id|prefixo> --items "a|b|c"      recibo retrospectivo: trabalho já feito, checklist todo marcado

Variáveis: NEXO_URL (padrão ${BASE}), NEXO_SESSION, NEXO_OWNER.`;

const slug=(text,index)=>(String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'item')+'-'+(index+1);
export function checklistFrom(items){
 const labels=String(items??'').split('|').map(label=>label.trim()).filter(Boolean);
 if(!labels.length||labels.length>100)throw new Error('Informe de 1 a 100 itens separados por "|".');
 return labels.map((label,index)=>({id:slug(label,index),label:label.slice(0,160),done:false}));
}
export function parseArguments(argv){
 const positional=[],options={};
 for(let index=0;index<argv.length;index++){
  const value=argv[index];
  if(value.startsWith('--')){const key=value.slice(2);const next=argv[index+1];if(next===undefined||next.startsWith('--'))options[key]=true;else{options[key]=next;index++;}}
  else positional.push(value);
 }
 return {positional,options};
}
async function call(path,{method='GET',body}={}){
 const response=await fetch(BASE+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={raw:text};}
 if(!response.ok)throw Object.assign(new Error(data.error??`HTTP ${response.status}`),{status:response.status,data});
 return data;
}
async function resolveTask(reference){
 if(!reference)throw new Error('Informe o id (ou prefixo) da missão.');
 const state=await call('/api/state');
 const matches=state.tasks.filter(task=>task.id===reference||task.id.startsWith(reference));
 if(matches.length!==1)throw new Error(matches.length?`Prefixo ambíguo: ${matches.map(task=>task.id.slice(0,8)).join(', ')}`:'Missão não encontrada.');
 return matches[0];
}
const identity=options=>({session_id:String(options.session??process.env.NEXO_SESSION??'devin-session'),owner:String(options.owner??process.env.NEXO_OWNER??'devin')});
const print=value=>console.log(typeof value==='string'?value:JSON.stringify(value,null,2));

export async function run(argv){
 const {positional,options}=parseArguments(argv);
 const [command,...rest]=positional;
 switch(command){
  case 'list':{
   const workspace=options.workspace??process.cwd();
   const query=new URLSearchParams({workspace});
   for(const key of ['status','limit','cursor','fields'])if(options[key]&&options[key]!==true)query.set(key,options[key]);
   const page=await call('/api/tasks?'+query);
   console.log(`${page.returned}/${page.total} missões${page.incomplete?' (há mais; use --cursor '+page.next_cursor+')':''}`);
   for(const item of page.items)console.log([item.id?.slice(0,8),String(item.status??'').padEnd(9),item.plan_available===undefined?'':item.plan_available?'plano':'sem-plano',item.title??''].filter(Boolean).join('  '));
   return page;
  }
  case 'show':{
   const task=await resolveTask(rest[0]);
   print({id:task.id,title:task.title,status:task.status,specialist:task.specialist,goal:task.goal,acceptance:task.acceptance,plan_report:task.plan_report?String(task.plan_report).slice(0,12000):null,review_contract:task.review_contract??null,integration:task.integration??null,external_work:task.external_work??null,error:task.error??null});
   return task;
  }
  case 'claim':{
   const task=await resolveTask(rest[0]);
   const result=await call(`/api/tasks/${task.id}/session-work`,{method:'POST',body:{action:'claim',phase:options.phase??'implementation',checklist:checklistFrom(options.items),...identity(options)}});
   print({claimed:task.id,external_work:result.external_work??result});
   return result;
  }
  case 'check':case 'uncheck':{
   const task=await resolveTask(rest[0]);
   const ids=rest.slice(1);
   if(!ids.length)throw new Error('Informe ao menos um item.');
   const current=task.external_work?.checklist;
   if(!current?.length)throw new Error('A missão não tem checklist reservado por esta sessão.');
   const unknown=ids.filter(id=>!current.some(item=>item.id===id));
   if(unknown.length)throw new Error('Itens desconhecidos: '+unknown.join(', '));
   const checklist=current.map(item=>ids.includes(item.id)?{...item,done:command==='check'}:item);
   const result=await call(`/api/tasks/${task.id}/session-work`,{method:'POST',body:{action:'update',checklist,...identity(options)}});
   print(result.external_work?.checklist??result);
   return result;
  }
  case 'finish':{
   const task=await resolveTask(rest[0]);
   const result=await call(`/api/tasks/${task.id}/session-work`,{method:'POST',body:{action:'release',outcome:options.outcome??'completed',...identity(options)}});
   print({released:task.id,status:result.status,external_work:result.external_work??null});
   return result;
  }
  case 'receipt':{
   const task=await resolveTask(rest[0]);
   const checklist=checklistFrom(options.items).map(item=>({...item,done:true}));
   const result=await call(`/api/tasks/${task.id}/session-work`,{method:'POST',body:{action:'record',phase:'review',checklist,...identity(options)}});
   print({recorded:task.id,status:result.status,external_work:result.external_work??null});
   return result;
  }
  default:
   console.log(USAGE);return null;
 }
}
if(process.argv[1]&&import.meta.url===new URL(`file:///${process.argv[1].replace(/\\/g,'/')}`).href){
 run(process.argv.slice(2)).catch(error=>{console.error('Erro: '+error.message);process.exitCode=1;});
}
void randomUUID;
