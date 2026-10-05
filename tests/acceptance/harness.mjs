import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../../src/store.mjs';
import {createMissionServer} from '../../src/server.mjs';

// Acceptance harness: seeds durable state, then drives only the public HTTP API with a fake runner and a fake JEV engine.
export const profiles={design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}};
export const wait=async(fn,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timeout');};
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const planText='```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Edit file.txt'],verification:['Run the tests']})+'\n```';
export const mission=(workspace,extra={})=>({id:randomUUID(),workspace,title:'Mission '+Math.random().toString(16).slice(2,6),goal:'Edit the existing defect in file.txt',acceptance:'Tests pass',status:'backlog',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z',...extra});
// A mission whose implementation is verified and waits for the independent review: a "finish first" candidate.
export const reviewable=(workspace,extra={})=>mission(workspace,{status:'review',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0,status:'needs_review'},attempt:{id:randomUUID(),state:'terminal'},integration:{status:'awaiting_review'},implementation_run:{attempt_id:'impl-1'},implementation_workspace:{workspace:join(workspace,'..','isolated')},implementation_evidence:{implementation_attempt_id:'impl-1',changes:[{path:'file.txt'}]},plan_report:planText,...extra});
export const queuedPlanning=(workspace,extra={})=>mission(workspace,{status:'planning',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0,status:'queued'},queue:{id:randomUUID(),phase:'planning',status:'queued',enqueued_at:new Date().toISOString()},...extra});
export const orphanTask=(workspace,attemptId,extra={})=>mission(workspace,{status:'blocked',attempt:{id:attemptId,owner_id:'dead-owner',generation:1,state:'outcome_unknown'},error:'Execução interrompida; resultado desconhecido. Reserva mantida; investigação necessária antes de retomar.',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:0,status:'needs_review'},...extra});
/** Plants the durable rows an abandoned supervisor leaves behind. */
export function plantOrphan(raw,{taskId,attemptId,phase='planning',workspace,ownerId='dead-owner',executorPid=99999999,heartbeat=0,spawnedAt=null}){
  raw.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,?,?,1)').run(ownerId,0,0);
  raw.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,executor_pid,heartbeat) VALUES(?,?,?,?,?,?,?,?,?,?)').run(attemptId,taskId,'queue-'+attemptId,ownerId,1,phase,workspace,'outcome_unknown',executorPid,heartbeat);
  if(spawnedAt!==null)raw.prepare('UPDATE attempts SET spawned_at=? WHERE id=?').run(spawnedAt,attemptId);
}
/** Plants finished attempts, the durable count of stages a project has completed. */
export function plantFinished(raw,{taskId,count,workspace}){
  raw.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,?,?,1)').run('finished-owner',0,0);
  for(let n=0;n<count;n++)raw.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,heartbeat) VALUES(?,?,?,?,?,?,?,?,?)').run('done-'+taskId+'-'+n,taskId,'queue-done-'+taskId+'-'+n,'finished-owner',n+1,'planning',workspace,'terminal',0);
}
const readEvents=dataDir=>{const file=join(dataDir,'events.ndjson');return existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];};

/** `seed(raw,{workspace,dataDir})` runs against the raw SQLite handle before the server starts. */
export async function acceptance(t,{tasks=[],opportunities=[],interventions=[],scheduler,mode='autonomous',policy={},rank,decide,evaluate,seed,direction={},serverOptions={}}={}){
  const dir=mkdtempSync(join(tmpdir(),'nexo-accept-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
  const store=createStore(dataDir,{tasks:[],profiles}),db=store.load();
  db.tasks=tasks.map(build=>typeof build==='function'?build(workspace):build);
  db.opportunities=opportunities.map(build=>typeof build==='function'?build(workspace):build);
  db.interventions=interventions.map(build=>typeof build==='function'?build(workspace):build);
  db.project_directions=[{workspace,objective:'Improve this project',success_criteria:'Real changes tested',mission:'Ship reliable autonomy',vision:'Nothing stalls',values:'Evidence first',principles:'Code validates, JEV recommends',repositories:[],...direction}];
  db.autonomy_policies=[{workspace,mode,discovery_enabled:false,...policy}];
  if(scheduler)db.scheduler=scheduler;
  store.save(db);store.close();
  if(seed){const raw=new DatabaseSync(join(dataDir,'state.sqlite'));try{seed(raw,{workspace,dataDir});}finally{raw.close();}}
  const calls={rank:[],decide:[],evaluate:[]},children=[];
  const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
  const engine={call:async(name,input)=>{
    if(name==='rank_missions'){calls.rank.push(input);return rank?rank(input):{ok:true,priority:input.candidates.map(c=>({id:c.id,score:2,confidence:1}))};}
    if(name==='evaluate_conditions'){calls.evaluate.push(input);return evaluate?evaluate(input):{ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.5}))};}
    calls.decide.push(input);return decide?decide(input):{ok:true,action:'recommend',selected_id:input.options[0].id};
  }};
  const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,isolationRoot:join(dir,'isolated'),...serverOptions});await app.listen(0);
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const request=(path,body,method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const get=async path=>(await fetch(app.url+path)).json();
  return {app,dir,dataDir,workspace,calls,children,request,get,state:()=>get('/api/state'),events:()=>readEvents(dataDir)};
}
