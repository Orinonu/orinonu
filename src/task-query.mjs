import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

// Read-only, project-scoped, paginated discovery of missions. It answers "what work already exists here?" for a session
// that must not read the whole global state or the eight-task consultation snapshot. It never persists anything, never
// returns reports, plans or full requirements unless asked, and refuses a cursor once the scoped set has changed.
export const STATUSES=['backlog','planning','queued','running','reviewing','review','blocked','ready','done'];
export const DEFAULT_FIELDS=['id','title','status','specialist','plan_available','created_at'];
const SCALARS={
 id:t=>String(t.id),title:t=>String(t.title??'').slice(0,160),status:t=>String(t.status),agent:t=>String(t.agent??''),profile:t=>String(t.profile??''),
 specialist:t=>String(t.specialist??''),created_at:t=>t.created_at??null,ended_at:t=>t.ended_at??null,max_minutes:t=>t.max_minutes??null,
 plan_available:t=>!!t.plan_report,has_implementation:t=>!!t.implementation_run,review_decision:t=>t.review_contract?.decision??null,
 integration_status:t=>t.integration?.status??null,depends_on:t=>Array.isArray(t.depends_on)?t.depends_on.map(String).slice(0,20):[],
 goal:t=>String(t.goal??'').slice(0,600),acceptance:t=>String(t.acceptance??'').slice(0,600),
};
export const FIELDS=Object.keys(SCALARS);
export const MAX_LIMIT=50,DEFAULT_LIMIT=20;
const invalid=(message,code='invalid_query')=>Object.assign(new Error(message),{status:400,code});
const key=path=>resolve(path).replace(/[\\/]+$/,'').toLowerCase();
const within=(path,root)=>typeof root==='string'&&(key(path)===key(root)||key(path).startsWith(key(root)+sep));

/** The project a path belongs to: a mission workspace itself, a folder inside it, or the isolated copy of one of its writers. */
export function projectOf(tasks,path){
 const direct=tasks.find(t=>within(path,t.workspace));
 if(direct)return direct.workspace;
 return tasks.find(t=>within(path,t.execution_workspace))?.workspace??null;
}
const list=(value,allowed,name)=>{
 if(value==null||value==='')return null;
 const items=String(value).split(',').map(item=>item.trim()).filter(Boolean);
 if(!items.length||items.length>allowed.length||items.some(item=>!allowed.includes(item)))throw invalid(`${name} inválido; permitidos: ${allowed.join(', ')}.`);
 return [...new Set(items)];
};
export function queryTasks(tasks,params){
 tasks=tasks.filter(task=>!task.executor_probe);
 const {workspace}=params;
 if(typeof workspace!=='string'||!workspace.trim())throw invalid('Informe o workspace do projeto.');
 const project=projectOf(tasks,workspace);
 const fields=list(params.fields,FIELDS,'fields')??DEFAULT_FIELDS;
 const statuses=list(params.status,STATUSES,'status');
 const limit=params.limit==null||params.limit===''?DEFAULT_LIMIT:Number(params.limit);
 if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)throw invalid(`limit deve ser um inteiro de 1 a ${MAX_LIMIT}.`);
 const scoped=project===null?[]:tasks.filter(t=>key(t.workspace)===key(project)&&!t.archived_at).sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??''))||String(a.id).localeCompare(String(b.id)));
 const matching=statuses?scoped.filter(t=>statuses.includes(t.status)):scoped;
 const revision=createHash('sha256').update(JSON.stringify({project:project&&key(project),statuses,rows:scoped.map(t=>[t.id,t.revision??0,t.status])})).digest('hex').slice(0,24);
 let offset=0;
 if(params.cursor){
  let cursor;try{cursor=JSON.parse(Buffer.from(String(params.cursor),'base64url').toString('utf8'));}catch{throw invalid('Cursor inválido.');}
  if(!cursor||!Number.isInteger(cursor.o)||cursor.o<0||typeof cursor.r!=='string')throw invalid('Cursor inválido.');
  if(cursor.r!==revision)throw Object.assign(new Error('O conjunto de missões mudou; recomece a consulta sem cursor.'),{status:409,code:'cursor_invalidated'});
  offset=Math.min(cursor.o,matching.length);
 }
 const page=matching.slice(offset,offset+limit);
 const next=offset+page.length<matching.length?Buffer.from(JSON.stringify({r:revision,o:offset+page.length})).toString('base64url'):null;
 return {
  scope:{project:project??null,known_project:project!==null},
  total:matching.length,returned:page.length,incomplete:next!==null,next_cursor:next,revision,filters:{status:statuses,fields,limit},
  items:page.map(task=>Object.fromEntries(fields.map(field=>[field,SCALARS[field](task)]))),
 };
}
