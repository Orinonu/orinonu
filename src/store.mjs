import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {overlappingWorkspaces,schedulerLimits,unmetDependencies} from './queue.mjs';
import {pidReused} from './orphans.mjs';

export const conflict=message=>Object.assign(new Error(message),{status:409});
export function assertSqlite(db){
 const version=db.prepare('SELECT sqlite_version() AS version').get().version;
 const [major,minor,patch]=version.split('.').map(Number);
 if(major<3||(major===3&&(minor<51||(minor===51&&patch<3))))throw new Error('SQLite >= 3.51.3 obrigatório.');
 return version;
}
const encode=JSON.stringify;
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const flatten=state=>{
 const rows=new Map();
 for(const [key,value] of Object.entries(state)){
  if(key==='tasks'||key==='opportunities')for(const item of value){const entity=key+'/'+item.id;if(rows.has(entity))throw new Error('IDs duplicados na migração.');rows.set(entity,encode(item));}
  else rows.set('meta/'+key,encode(value));
 }
 return rows;
};
const expand=rows=>{
 const result={tasks:[],opportunities:[]};
 for(const row of rows){const [kind,...parts]=row.key.split('/'),value=JSON.parse(row.payload);if(kind==='meta')Object.defineProperty(result,parts.join('/'),{value,writable:true,enumerable:true,configurable:true});else result[kind].push(value);}
 return result;
};
export function readDurableState(dataDir){
 const db=new DatabaseSync(join(dataDir,'state.sqlite'),{readOnly:true});
 try{if(db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value!=='1')throw new Error('Versão de persistência incompatível.');return expand(db.prepare('SELECT key,payload FROM entities ORDER BY rowid').all());}finally{db.close();}
}

export function createStore(dataDir,defaults){
 mkdirSync(dataDir,{recursive:true});
 const sql=new DatabaseSync(join(dataDir,'state.sqlite'));
 assertSqlite(sql);
 sql.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
 sql.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entities (key TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS supervisors (id TEXT PRIMARY KEY,pid INTEGER NOT NULL,heartbeat INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY,task_id TEXT NOT NULL,queue_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL REFERENCES supervisors(id),generation INTEGER NOT NULL,phase TEXT NOT NULL,workspace TEXT NOT NULL,state TEXT NOT NULL,executor_pid INTEGER,executor_path TEXT,thread_id TEXT,heartbeat INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS active_task ON attempts(task_id) WHERE state!='terminal';
 CREATE TABLE IF NOT EXISTS desktop_review_leases (id TEXT PRIMARY KEY,task_id TEXT NOT NULL,session_id TEXT NOT NULL,owner TEXT NOT NULL,token_hash TEXT NOT NULL,workspace TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS active_desktop_review ON desktop_review_leases(task_id) WHERE status='active';
 CREATE TABLE IF NOT EXISTS receipts (request_id TEXT PRIMARY KEY,hash TEXT NOT NULL,response TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attempt_events (attempt_id TEXT NOT NULL REFERENCES attempts(id),event_id TEXT NOT NULL,PRIMARY KEY(attempt_id,event_id));
 `);
 // Additive column: older supervisors ignore it. It lets the host prove that a live PID is not the recorded executor.
 if(!sql.prepare('PRAGMA table_info(attempts)').all().some(column=>column.name==='spawned_at'))sql.exec('ALTER TABLE attempts ADD COLUMN spawned_at INTEGER');
 let depth=0;
 const transaction=fn=>{
  if(depth)return fn();
  sql.exec('BEGIN IMMEDIATE');depth++;
  const priorBaseline=new Map(baseline),priorRevisions=new Map(revisions);
  try{const result=fn();sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');baseline=priorBaseline;revisions=priorRevisions;throw error;}finally{depth--;}
 };
 let baseline=new Map(),revisions=new Map(),reconciling=false;
 try{transaction(()=>{
  const schema=sql.prepare("SELECT value FROM metadata WHERE key='schema'").get();
  if(schema){if(schema.value!=='1')throw new Error('Versão de persistência incompatível.');return;}
  const file=join(dataDir,'state.json'),source=existsSync(file)?readFileSync(file,'utf8'):null;
  const initial=source?JSON.parse(source):defaults;
  const entries=flatten(initial);
  for(const [key,payload] of entries)sql.prepare('INSERT INTO entities VALUES(?,?,0)').run(key,payload);
  // Verify the imported content before any recovery transformation.
  const imported=flatten(expand(sql.prepare('SELECT key,payload FROM entities').all()));
  if(imported.size!==entries.size||[...entries].some(([key,payload])=>imported.get(key)!==payload))throw new Error('Migração divergiu da origem.');
  sql.prepare('INSERT INTO metadata VALUES(?,?)').run('source_sha256',source?createHash('sha256').update(source).digest('hex'):'new');
  sql.prepare('INSERT INTO metadata VALUES(?,?)').run('schema','1');
 });
 if(sql.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||sql.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Integridade SQLite inválida.');
 }catch(error){sql.close();throw error;}
 const assertLegacyUnchanged=()=>{
  const file=join(dataDir,'state.json'),source=existsSync(file)?createHash('sha256').update(readFileSync(file,'utf8')).digest('hex'):'new';
  if(source!==sql.prepare("SELECT value FROM metadata WHERE key='source_sha256'").get().value)throw conflict('JSON legado alterado após migração; pare versões antigas e investigue antes de despachar.');
 };
 const owner=randomUUID();
 sql.prepare('INSERT INTO supervisors(id,pid,heartbeat) VALUES(?,?,?)').run(owner,process.pid,Date.now());
 const read=()=>sql.prepare('SELECT key,payload,revision FROM entities ORDER BY rowid').all();
 const remember=rows=>{baseline=new Map(rows.map(r=>[r.key,r.payload]));revisions=new Map(rows.map(r=>[r.key,r.revision]));};
 const load=()=>{const rows=read();remember(rows);return expand(rows);};
 // A merge can only change local objects when some remote entity actually moved; comparing
 // key+revision first lets the hot paths skip the full read+parse+stringify when nothing did.
 const remoteUnchanged=()=>{const rows=sql.prepare('SELECT key,revision FROM entities').all();return rows.length===revisions.size&&rows.every(row=>revisions.get(row.key)===row.revision);};
 const refresh=(state,discard=false)=>{
  if(!discard&&remoteUnchanged())return state;
  const local=flatten(state);
  if(!discard&&[...local].some(([key,payload])=>baseline.get(key)!==payload))throw conflict('Estado local ainda não persistido.');
  const rows=read(),fresh=expand(rows);
  for(const kind of ['tasks','opportunities'])fresh[kind]=fresh[kind].map(item=>{
   const previous=state[kind]?.find(t=>t.id===item.id);
   if(!previous)return item;
   for(const key of Object.keys(previous))if(!Object.hasOwn(item,key))delete previous[key];
   Object.assign(previous,item);return previous;
  });
  for(const key of Object.keys(state))if(!Object.hasOwn(fresh,key))delete state[key];
  Object.assign(state,fresh);remember(rows);return state;
 };
 const save=state=>transaction(()=>{
  const rows=flatten(state),changed=[...rows].filter(([key,payload])=>baseline.get(key)!==payload),written=new Map();
  for(const [key,initialPayload] of changed){
   const old=revisions.get(key),next=(old??-1)+1;
   let payload=initialPayload;
   if(key.startsWith('tasks/')){
    const task=state.tasks.find(t=>'tasks/'+t.id===key);
    const attempt=sql.prepare("SELECT owner_id FROM attempts WHERE task_id=? AND state!='terminal'").get(task.id);
    if(attempt&&attempt.owner_id!==owner&&!reconciling)throw conflict('Missão pertence a outro supervisor ou exige recuperação.');
    task.revision=next;payload=encode(task);
   }
   if(old===undefined)sql.prepare('INSERT INTO entities VALUES(?,?,?)').run(key,payload,next);
   else if(!sql.prepare('UPDATE entities SET payload=?,revision=? WHERE key=? AND revision=?').run(payload,next,key,old).changes)throw conflict('Missão mudou em outro supervisor; atualize antes de tentar.');
   written.set(key,payload);
  }
  // Only remember committed local entities, never adopt unseen remote changes. The payload just
  // written is already the post-mutation encoding, so no second flatten is needed here.
  for(const [key] of changed){baseline.set(key,written.get(key));revisions.set(key,(revisions.get(key)??-1)+1);}
 });
 const reviewOccupants=()=>sql.prepare("SELECT task_id,'review' AS phase,workspace,'running' AS state FROM desktop_review_leases WHERE status='active' AND expires_at>?").all(Date.now());
 const reviewing=taskId=>!!sql.prepare("SELECT id FROM desktop_review_leases WHERE task_id=? AND status='active' AND expires_at>?").get(taskId,Date.now());
 return {sql,owner,transaction,load,refresh,save,assertLegacyUnchanged,reviewing,
  // Terminal attempts of the given missions: the durable count of stages the project has finished.
  terminalAttempts(taskIds){const ids=new Set(taskIds);return sql.prepare("SELECT task_id FROM attempts WHERE state='terminal'").all().filter(row=>ids.has(row.task_id)).length;},
  occupants(){return [...sql.prepare("SELECT task_id,phase,workspace,state,heartbeat FROM attempts WHERE state!='terminal'").all(),...reviewOccupants()];},
  owns(task){return !!task.attempt&&!!sql.prepare("SELECT id FROM attempts WHERE id=? AND owner_id=? AND generation=? AND state NOT IN ('terminal','outcome_unknown')").get(task.attempt.id,owner,task.attempt.generation);},
  claim(state,taskId,{reserveBudget=()=>null}={}){return transaction(()=>{
   assertLegacyUnchanged();
   refresh(state);
   const task=state.tasks.find(t=>t.id===taskId);if(task?.queue?.status!=='queued'||reviewing(taskId))return false;
   // Dependencies are checked at admission, not only by the cycle that queued the mission: a dependency
   // that regressed after the enqueue (or was queued by an older supervisor) keeps the mission waiting.
   if(unmetDependencies(task,state.tasks).length)return false;
   const requested=task.execution_workspace??task.workspace,workspace=existsSync(requested)?realpathSync(requested):requested;
   const phase=task.queue.phase,limits=schedulerLimits(state.scheduler);
   const occupants=[...sql.prepare("SELECT task_id,phase,workspace FROM attempts WHERE state!='terminal'").all(),...reviewOccupants()];
   if(occupants.filter(t=>t.phase===phase).length>=limits[phase+'_limit']||occupants.some(t=>(phase==='implementation'||t.phase==='implementation')&&overlappingWorkspaces(t.workspace,workspace)))return false;
   const generation=Number(sql.prepare('SELECT COALESCE(MAX(generation),0)+1 AS value FROM attempts WHERE task_id=?').get(task.id).value);
   const id=randomUUID();
   const budget=reserveBudget({id:'executor:'+id,workspace:task.workspace,task_id:task.id,phase:task.recovery_execution_minutes?'recovery':phase,provider:task.agent??'codex',attempt_id:id,generation});
   sql.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,heartbeat) VALUES(?,?,?,?,?,?,?,?,?)').run(id,task.id,task.queue.id,owner,generation,phase,workspace,'selecting',Date.now());
   if(budget)task.budget_operation_id=budget.id;else delete task.budget_operation_id;task.attempt={id,owner_id:owner,generation,state:'selecting'};task.queue.status='selecting';save(state);return true;
  });},
  acquireIntegration(task){return transaction(()=>{
   assertLegacyUnchanged();
   if(!task.attempt||!sql.prepare("SELECT id FROM attempts WHERE id=? AND owner_id=? AND state='running'").get(task.attempt.id,owner))return false;
   const conflicts=[...sql.prepare("SELECT workspace FROM attempts WHERE state!='terminal' AND id!=?").all(task.attempt.id),...reviewOccupants()];
   if(conflicts.some(other=>overlappingWorkspaces(other.workspace,task.workspace)))return false;
    return !!sql.prepare("UPDATE attempts SET workspace=?,phase='implementation' WHERE id=? AND owner_id=? AND state='running'").run(task.workspace,task.attempt.id,owner).changes;
  });},
  transition(task,state,identity={}){
   if(!task.attempt)throw conflict('Tentativa durável ausente.');
   const a=task.attempt;
   const current=sql.prepare('SELECT state FROM attempts WHERE id=? AND owner_id=? AND generation=?').get(a.id,owner,a.generation);
   const transitions={selecting:['starting','terminal','outcome_unknown'],starting:['running','outcome_unknown'],running:['running','terminal','outcome_unknown']};
   if(!current||!transitions[current.state]?.includes(state))throw conflict('Transição sem posse vigente ou inválida.');
   const changed=sql.prepare('UPDATE attempts SET state=?,executor_pid=COALESCE(?,executor_pid),executor_path=COALESCE(?,executor_path),thread_id=COALESCE(?,thread_id),spawned_at=COALESCE(?,spawned_at),heartbeat=? WHERE id=? AND owner_id=? AND generation=? AND state=?').run(state,identity.pid??null,identity.path??null,identity.thread_id??null,identity.pid!==undefined?Date.now():null,Date.now(),a.id,owner,a.generation,current.state).changes;
   if(!changed)throw conflict('Posse da tentativa não é vigente.');
   task.attempt={...a,state,...identity};
  },
  reconcile(state){return transaction(()=>{
   refresh(state);reconciling=true;
   try{
    for(const task of state.tasks){
     if(!sql.prepare("SELECT id FROM attempts WHERE task_id=? AND state!='terminal'").get(task.id)&&(task.queue?.status==='selecting'||(['running','planning','reviewing'].includes(task.status)&&task.queue?.status!=='queued'))){
      const legacy='legacy-'+task.id;
      sql.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,0,0,1)').run(legacy);
      const workspace=existsSync(task.workspace)?realpathSync(task.workspace):task.workspace;
      const id=randomUUID();sql.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,heartbeat) VALUES(?,?,?,?,?,?,?,?,?)').run(id,task.id,task.queue?.id??randomUUID(),legacy,1,task.queue?.phase??(task.status==='planning'?'planning':task.status==='reviewing'?'review':'implementation'),workspace,'outcome_unknown',Date.now());
      task.attempt={id,owner_id:legacy,generation:1,state:'outcome_unknown'};
     }
    }
    for(const row of sql.prepare("SELECT a.*,s.pid,s.closed FROM attempts a JOIN supervisors s ON s.id=a.owner_id WHERE a.state!='terminal'").all()){
     let alive=false;if(!row.closed&&row.pid>0){try{process.kill(row.pid,0);alive=true;}catch(error){alive=error.code!=='ESRCH';}}
     if(alive)continue;
     const task=state.tasks.find(t=>t.id===row.task_id);if(!task)continue;
     sql.prepare("UPDATE attempts SET state='outcome_unknown' WHERE id=?").run(row.id);
     task.attempt={...task.attempt,state:'outcome_unknown'};task.status='blocked';task.queue=null;
     task.error='Execução interrompida; resultado desconhecido. Reserva mantida; investigação necessária antes de retomar.';
     if(task.pipeline){task.pipeline.status='needs_review';task.pipeline.reason=task.error;}
    }
    save(state);
   }finally{reconciling=false;}
  });},
  // Deterministic evidence that an interrupted attempt needs no operator: the owning supervisor
  // and the recorded executor are both verifiably gone and the attempt has been idle past the
  // settle window. Anything uncertain returns null, so the operator path stays the only fallback.
  interruptedEvidence(task,{minIdleMs=0,now=Date.now(),startTime}={}){
   if(!task?.attempt||task.attempt.state!=='outcome_unknown')return null;
   const row=sql.prepare('SELECT a.id,a.owner_id,a.state,a.executor_pid,a.spawned_at,a.heartbeat,s.pid AS owner_pid,s.closed FROM attempts a JOIN supervisors s ON s.id=a.owner_id WHERE a.id=?').get(task.attempt.id);
   if(!row||row.state!=='outcome_unknown')return null;
   const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
   if(row.owner_id!==owner&&!row.closed&&alive(row.owner_pid))return null;
   // A live PID only blocks the release when it may still be the recorded executor: a process that started after the attempt spawned it is a reused PID.
   const reused=alive(row.executor_pid)&&pidReused(row.executor_pid,row.spawned_at,startTime);
   if(alive(row.executor_pid)&&!reused)return null;
   if(!Number.isFinite(row.heartbeat)||now-row.heartbeat<minIdleMs)return null;
   return {attempt_id:row.id,executor_pid:row.executor_pid??null,owner_id:row.owner_id,idle_ms:now-row.heartbeat,...(reused?{pid_reused:true}:{})};
  },
  // Operator-confirmed release of an attempt whose outcome the host could not prove. The host still
  // refuses while the recorded executor or its owning supervisor looks alive; it never records success.
  reconcileUnknown(task,{acceptUnverifiedLiveness=false,executorPidReused=false}={}){return transaction(()=>{
   if(!task.attempt)throw conflict('Tentativa durável ausente.');
   const row=sql.prepare('SELECT a.id,a.owner_id,a.state,a.executor_pid,s.pid AS owner_pid,s.closed FROM attempts a JOIN supervisors s ON s.id=a.owner_id WHERE a.id=?').get(task.attempt.id);
   if(!row||row.state!=='outcome_unknown')throw conflict('Somente tentativas com resultado desconhecido podem ser reconciliadas.');
   const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
   const executorAlive=alive(row.executor_pid)&&!executorPidReused,ownerAlive=row.owner_id!==owner&&!row.closed&&alive(row.owner_pid);
   if((executorAlive||ownerAlive)&&!acceptUnverifiedLiveness)throw conflict(executorAlive?'O processo do executor registrado ainda parece ativo; encerre-o ou confirme que o PID foi reutilizado.':'O supervisor proprietário ainda parece ativo.');
   sql.prepare("UPDATE attempts SET state='terminal' WHERE id=? AND state='outcome_unknown'").run(row.id);
   task.attempt={...task.attempt,state:'terminal'};
   return {attempt_id:row.id,executor_pid:row.executor_pid??null,executor_alive:executorAlive,owner_alive:ownerAlive,liveness_override:acceptUnverifiedLiveness&&(executorAlive||ownerAlive),...(executorPidReused?{pid_reused:true}:{})};
  });},
  heartbeat(){sql.prepare('UPDATE supervisors SET heartbeat=? WHERE id=?').run(Date.now(),owner);},
  consumeEvent(task,row){
   if((row.attempt_id!==undefined&&row.attempt_id!==task.attempt.id)||(row.generation!==undefined&&row.generation!==task.attempt.generation))return false;
   const id=row.event_id??row.sequence??row.seq??row.turn_id??row.item?.id;
   if(id===undefined)return true;
   return !!sql.prepare('INSERT OR IGNORE INTO attempt_events VALUES(?,?)').run(task.attempt.id,String(row.type)+':'+String(id)).changes;
  },
  admit(state,taskId,action,body,fn){return transaction(()=>{
   const {request_id,...options}=body;
   if(request_id!==undefined&&(typeof request_id!=='string'||!request_id.trim()||request_id.length>200))throw Object.assign(new Error('request_id inválido.'),{status:400});
   const hash=createHash('sha256').update(encode(canonical({taskId,action,options}))).digest('hex');
   if(request_id){const receipt=sql.prepare('SELECT * FROM receipts WHERE request_id=?').get(request_id);if(receipt){if(receipt.hash!==hash)throw conflict('request_id reutilizado com intenção diferente.');return JSON.parse(receipt.response);}}
   refresh(state);
   const task=state.tasks.find(t=>t.id===taskId);
   assertLegacyUnchanged();
   if(body.expected_revision!==undefined&&body.expected_revision!==(task.revision??0))throw conflict('Revisão esperada diverge da missão.');
   if(task.queue||reviewing(taskId)||sql.prepare("SELECT id FROM attempts WHERE task_id=? AND state!='terminal'").get(taskId))throw conflict('Missão já está na fila, em execução, revisão ou recuperação.');
   const response=JSON.parse(encode(fn(task)));
   if(request_id)sql.prepare('INSERT INTO receipts VALUES(?,?,?)').run(request_id,hash,encode(response));
   return response;
  });},
  close(){sql.prepare('UPDATE supervisors SET closed=1 WHERE id=?').run(owner);sql.close();},
 };
}
