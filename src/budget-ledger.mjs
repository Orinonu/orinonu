import {existsSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {metrics,amounts,validateBudgetPolicy,budgetError,checkedAdd} from './budget-policy.mjs';
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>JSON.stringify(canonical(v));
const hash=v=>createHash('sha256').update(encode(v)).digest('hex');
const identity=v=>{if(typeof v!=='string'||!v.trim()||v.length>256)throw budgetError('budget_invalid_identity');return v;};
export function budgetScope({workspace,task_id=null}){
 identity(workspace);if(task_id!==null)identity(task_id);
 const path=existsSync(workspace)?realpathSync(workspace):resolve(workspace);
 return {workspace:process.platform==='win32'?path.toLowerCase():path,task_id};
}
const key=s=>encode(budgetScope(s));
export function createBudgetLedger({sql,transaction}){
 transaction(()=>{
  const version=sql.prepare("SELECT value FROM metadata WHERE key='budget_schema'").get();
  if(version&&version.value!=='1')throw budgetError('budget_schema_incompatible');
  sql.exec(`CREATE TABLE IF NOT EXISTS budget_policies(scope TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,window_start INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS budget_operations(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,task_id TEXT,payload TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS budget_workspace ON budget_operations(workspace,task_id);
   CREATE TABLE IF NOT EXISTS budget_events(operation_id TEXT NOT NULL REFERENCES budget_operations(id),event_id TEXT NOT NULL,revision INTEGER NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(operation_id,event_id,revision));
   CREATE TABLE IF NOT EXISTS budget_config_receipts(id TEXT PRIMARY KEY,hash TEXT NOT NULL,payload TEXT NOT NULL);`);
  sql.prepare("INSERT OR IGNORE INTO metadata VALUES('budget_schema','1')").run();
 });
 const policies=scope=>[...new Set([key({workspace:scope.workspace}),key(scope)])].map(k=>sql.prepare('SELECT * FROM budget_policies WHERE scope=?').get(k)).filter(Boolean).map(r=>({...r,policy:JSON.parse(r.payload)})).filter(r=>r.policy.enabled);
 const read=id=>{const row=sql.prepare('SELECT payload FROM budget_operations WHERE id=?').get(id);if(!row)throw budgetError('budget_operation_missing');return JSON.parse(row.payload);};
 const put=op=>sql.prepare('UPDATE budget_operations SET payload=? WHERE id=?').run(encode(op),op.id);
 function projection(scope,window=0){
  const s=budgetScope(scope),ops=sql.prepare('SELECT payload FROM budget_operations WHERE workspace=?').all(s.workspace).map(r=>JSON.parse(r.payload)).filter(o=>(s.task_id===null||o.task_id===s.task_id)&&o.created_at>=window);
  const known=Object.fromEntries(metrics.map(k=>[k,0])),reserved={...known},unknown={...known};
  for(const op of ops){if(op.state==='released')continue;for(const m of metrics){known[m]=checkedAdd(known[m],op.usage[m]??op.known?.[m]??0);reserved[m]=checkedAdd(reserved[m],op.complete.includes(m)?0:Math.max(0,(op.envelope[m]??0)-(op.usage[m]??op.known?.[m]??0)));if(op.state!=='reserved'&&!op.complete.includes(m))unknown[m]++;}}
  return {known,reserved,unknown,ops};
 }
 function check(scope,extra={},exclude=null){
  for(const row of policies(scope)){
   const p=projection(JSON.parse(row.scope),row.window_start);
   for(const [m,limit] of Object.entries(row.policy.limits)){
    const unknown=p.ops.some(o=>o.id!==exclude&&o.state!=='reserved'&&o.state!=='released'&&!o.complete.includes(m));
    if(row.policy.unknown_policy==='block'&&unknown)throw budgetError('budget_unknown',JSON.parse(row.scope));
    if(checkedAdd(checkedAdd(p.known[m],p.reserved[m]),extra[m]??0)>limit)throw budgetError('budget_exhausted',JSON.parse(row.scope));
   }
  }
 }
 return {
  configure(scope,value,{expected_revision,request_id}={}){return transaction(()=>{
   const s=budgetScope(scope),k=key(s),policy=validateBudgetPolicy(value);identity(request_id);
   if(!Number.isSafeInteger(expected_revision)||expected_revision<0)throw budgetError('budget_revision_required');
   const signature=hash({scope:s,policy,expected_revision}),receipt=sql.prepare('SELECT * FROM budget_config_receipts WHERE id=?').get(request_id);
   if(receipt){if(receipt.hash!==signature)throw budgetError('budget_receipt_conflict');return JSON.parse(receipt.payload);}
   const old=sql.prepare('SELECT * FROM budget_policies WHERE scope=?').get(k);
   if((old?.revision??0)!==expected_revision)throw budgetError('budget_revision_conflict');
   const revision=expected_revision+1,window_start=old?.window_start??Date.now();
   sql.prepare('INSERT INTO budget_policies VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(k,revision,encode(policy),window_start);
   const result={scope:s,revision,policy,window_start};sql.prepare('INSERT INTO budget_config_receipts VALUES(?,?,?)').run(request_id,signature,encode(result));return result;
  });},
  reserve(input){return transaction(()=>{
   const s=budgetScope(input);identity(input.id);identity(input.provider);identity(input.phase);
   const intent={...input,...s};const old=sql.prepare('SELECT payload FROM budget_operations WHERE id=?').get(input.id);
   if(old){const op=JSON.parse(old.payload);if(op.intent_hash!==hash(intent))throw budgetError('budget_receipt_conflict');if(op.state==='released')throw budgetError('budget_operation_released');return op;}
   const applicable=policies(s);if(!applicable.length)return null;
   const envelope={};for(const row of applicable){const e=row.policy.envelopes[input.phase];if(!e)throw budgetError('budget_configuration_required');for(const [m,n] of Object.entries(e))envelope[m]=Math.max(envelope[m]??0,n);}
   check(s,envelope);
   const op={...intent,intent_hash:hash(intent),created_at:Date.now(),state:'reserved',envelope,usage:{},complete:[],mode:null};
   sql.prepare('INSERT INTO budget_operations VALUES(?,?,?,?)').run(op.id,s.workspace,s.task_id,encode(op));return op;
  });},
  authorizeStart(id){if(!id)return null;return transaction(()=>{const op=read(id);if(op.state==='released'||op.state==='settled'||op.state==='unknown')throw budgetError('budget_invalid_start');check(op,{},id);op.state='running';put(op);return op;});},
  release(id){if(!id)return;return transaction(()=>{const op=read(id);if(op.state!=='reserved')throw budgetError('budget_release_unproven');op.state='released';put(op);});},
  observe(id,event){if(!id)return null;return transaction(()=>{
   const op=read(id);identity(event.event_id);identity(event.source);identity(event.observed_at);
   if(!Number.isSafeInteger(event.revision)||event.revision<1||!['delta','snapshot'].includes(event.mode))throw budgetError('budget_invalid_usage');
   const usage=amounts(event.usage,{partial:true});if(op.state==='released')throw budgetError('budget_release_conflict');
   if(op.mode&&op.mode!==event.mode)throw budgetError('budget_usage_mode_conflict');
   const signature=hash(event),prior=sql.prepare('SELECT hash FROM budget_events WHERE operation_id=? AND event_id=? AND revision=?').get(id,event.event_id,event.revision);
   if(prior){if(prior.hash!==signature)throw budgetError('budget_receipt_conflict');return op;}
   sql.prepare('INSERT INTO budget_events VALUES(?,?,?,?,?)').run(id,event.event_id,event.revision,signature,encode({...event,usage}));
   const rows=sql.prepare('SELECT payload FROM budget_events WHERE operation_id=? ORDER BY revision DESC,event_id').all(id).map(r=>JSON.parse(r.payload));
   const latest=[...new Map(rows.slice().reverse().map(e=>[e.event_id,e])).values()];
   op.mode=event.mode;op.usage={};op.known={};
   if(event.mode==='snapshot'){
    // One cumulative stream: revision uniquely identifies a provider snapshot.
    const max=rows[0].revision,top=rows.filter(e=>e.revision===max);
    if(top.some(e=>encode(e.usage)!==encode(top[0].usage)))throw budgetError('budget_snapshot_conflict');
    op.usage={...top[0].usage};
   }else for(const m of metrics){const values=latest.map(e=>e.usage[m]);if(values.some(v=>v===null||v===undefined))op.usage[m]=null;else op.usage[m]=values.reduce((a,v)=>checkedAdd(a,v),0);}
   for(const m of metrics){const selected=event.mode==='snapshot'?[{usage:op.usage}]:latest;op.known[m]=selected.reduce((sum,e)=>checkedAdd(sum,e.usage[m]??0),0);}
   op.complete=op.complete.filter(m=>op.usage[m]!==undefined&&op.usage[m]!==null);put(op);return op;
  });},
  settle(id,{complete=[]}={}){if(!id)return null;return transaction(()=>{const op=read(id);if(op.state==='reserved'||op.state==='released')throw budgetError('budget_invalid_settlement');if(!Array.isArray(complete)||complete.some(m=>!metrics.includes(m)||op.usage[m]===undefined||op.usage[m]===null))throw budgetError('budget_invalid_settlement');op.complete=[...new Set([...op.complete,...complete])];op.state=metrics.every(m=>op.complete.includes(m))?'settled':'unknown';put(op);return op;});},
  reconcile(id,event,{complete=[]}={}){return transaction(()=>{this.observe(id,event);return this.settle(id,{complete});});},
  summary(scope){return transaction(()=>{
   const s=budgetScope(scope),row=sql.prepare('SELECT * FROM budget_policies WHERE scope=?').get(key(s)),p=projection(s,row?.window_start??0);
   return {version:1,scope:s,revision:row?.revision??0,policy:row?JSON.parse(row.payload):{version:1,enabled:false},window_start:row?.window_start??null,known:p.known,reserved:p.reserved,unknown:p.unknown,observed:Object.fromEntries(metrics.map(m=>[m,p.unknown[m]||!row&&!p.ops.length?null:p.known[m]])),provenance:p.ops.slice(-8).flatMap(op=>sql.prepare('SELECT payload FROM budget_events WHERE operation_id=? ORDER BY revision DESC LIMIT 8').all(op.id).map(r=>{const e=JSON.parse(r.payload);return {operation_id:op.id,source:e.source,observed_at:e.observed_at,revision:e.revision,metadata:e.metadata??null};})).slice(-8),quota:null,coverage:'partial_supervised_operations',warning:'Chamadas em andamento podem ultrapassar envelopes e tetos; franquia desconhecida não é dinheiro.'};
  });},
  operation:read,
  configured(){return Boolean(sql.prepare('SELECT 1 FROM budget_policies LIMIT 1').get());},
  enabled(){return sql.prepare('SELECT payload FROM budget_policies').all().some(r=>JSON.parse(r.payload).enabled);},
  check(scope){return transaction(()=>check(scope));},
 };
}
