import {createHash} from 'node:crypto';
import {validateAgentBinding,validateAgentVariant,validateProjectPolicy} from './contracts.mjs';
import {validateAgentDefinitions} from './definitions.mjs';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now=()=>Date.now();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const PACK_STATUSES=['registered','active','suspended'];
const VARIANT_STATUSES=['proposed','active','suspended','revoked'];

const SCHEMA=`CREATE TABLE IF NOT EXISTS agent_definitions(
 id TEXT NOT NULL,definition_version INTEGER NOT NULL,hash TEXT NOT NULL,kind TEXT NOT NULL,
 parent_id TEXT,team_id TEXT,pack_id TEXT,payload TEXT NOT NULL,seeded_at INTEGER NOT NULL,
 PRIMARY KEY(id,definition_version));
CREATE TABLE IF NOT EXISTS swarm_catalog_packs(
 pack_id TEXT NOT NULL,wave INTEGER NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,
 status TEXT NOT NULL,payload TEXT NOT NULL,registered_at INTEGER NOT NULL,activated_at INTEGER,
 PRIMARY KEY(pack_id,version));
CREATE TABLE IF NOT EXISTS agent_variants(
 id TEXT NOT NULL,workspace TEXT NOT NULL,version INTEGER NOT NULL,base_id TEXT NOT NULL,
 status TEXT NOT NULL,params_hash TEXT NOT NULL,provenance TEXT NOT NULL,payload TEXT NOT NULL,
 updated_at INTEGER NOT NULL,PRIMARY KEY(id,workspace,version));
CREATE TABLE IF NOT EXISTS agent_bindings(
 workspace TEXT NOT NULL,agent_id TEXT NOT NULL,phase TEXT NOT NULL,revision INTEGER NOT NULL,
 payload TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,agent_id,phase));
CREATE TABLE IF NOT EXISTS swarm_project_policies(
 workspace TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_autonomy_mandates(
 workspace TEXT PRIMARY KEY,level INTEGER NOT NULL,revision INTEGER NOT NULL,
 payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_resources(
 id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,source TEXT,
 status TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS swarm_resource_probes(
 id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,kind TEXT NOT NULL,result TEXT NOT NULL,
 evidence TEXT NOT NULL,probed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_capability_gaps(
 id TEXT PRIMARY KEY,run_id TEXT,node_id TEXT,missing_kind TEXT NOT NULL,missing_ref TEXT NOT NULL,
 action_class TEXT NOT NULL,proposal_ref TEXT,resume_condition TEXT,status TEXT NOT NULL,
 payload TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER);
CREATE TABLE IF NOT EXISTS swarm_selection_records(
 id TEXT PRIMARY KEY,run_id TEXT,node_id TEXT,profile_hash TEXT NOT NULL,
 admissible_hash TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_selection_outcomes(
 selection_id TEXT PRIMARY KEY,delivery_status TEXT NOT NULL,review_fit TEXT,
 payload TEXT NOT NULL,recorded_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_runs(
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL,root_attempt_ref TEXT,workspace TEXT NOT NULL,
 goal_hash TEXT NOT NULL,criteria_hash TEXT NOT NULL,contract_hash TEXT NOT NULL,
 status TEXT NOT NULL,revision INTEGER NOT NULL,owner TEXT NOT NULL,payload TEXT NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_plan_versions(
 run_id TEXT NOT NULL,plan_version INTEGER NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,
 payload TEXT NOT NULL,admitted_at INTEGER NOT NULL,PRIMARY KEY(run_id,plan_version));
CREATE TABLE IF NOT EXISTS swarm_nodes(
 run_id TEXT NOT NULL,plan_version INTEGER NOT NULL,node_id TEXT NOT NULL,
 parent_node_id TEXT,actor_id TEXT NOT NULL,team_id TEXT,phase TEXT,status TEXT NOT NULL,
 composition TEXT,artifacts TEXT,verification TEXT,payload TEXT NOT NULL,
 PRIMARY KEY(run_id,plan_version,node_id),
 FOREIGN KEY(run_id,plan_version) REFERENCES swarm_plan_versions(run_id,plan_version));
CREATE TABLE IF NOT EXISTS swarm_node_attempts(
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL,node_id TEXT NOT NULL,owner TEXT NOT NULL,
 generation INTEGER NOT NULL,status TEXT NOT NULL,binding_hash TEXT,grant_hash TEXT,
 started_at INTEGER,ended_at INTEGER,payload TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS active_swarm_node ON swarm_node_attempts(run_id,node_id)
 WHERE status NOT IN ('completed','partial','blocked','cancelled','failed','outcome_unknown');
CREATE TABLE IF NOT EXISTS swarm_messages(
 request_id TEXT PRIMARY KEY,intent_hash TEXT NOT NULL,sender_id TEXT NOT NULL,
 recipient_id TEXT NOT NULL,generation INTEGER NOT NULL,payload TEXT NOT NULL,
 status TEXT NOT NULL,result_ref TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_events(
 attempt_id TEXT NOT NULL,event_id TEXT NOT NULL,seq INTEGER NOT NULL,hash TEXT NOT NULL,
 kind TEXT NOT NULL,metadata TEXT,PRIMARY KEY(attempt_id,event_id));
CREATE TABLE IF NOT EXISTS swarm_checkpoints(
 id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,sdk_hash TEXT NOT NULL,protocol_version INTEGER NOT NULL,
 encrypted_ref TEXT,digest TEXT NOT NULL,replayable INTEGER NOT NULL,payload TEXT NOT NULL,
 created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_resource_leases(
 resource_key TEXT PRIMARY KEY,holder TEXT NOT NULL,generation INTEGER NOT NULL,mode TEXT NOT NULL,
 expires_at INTEGER NOT NULL,process_identity TEXT,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_capacity_slots(
 id TEXT PRIMARY KEY,class TEXT NOT NULL,phase TEXT,holder TEXT NOT NULL,
 generation INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER);
CREATE TABLE IF NOT EXISTS swarm_artifacts(
 id TEXT PRIMARY KEY,hash TEXT NOT NULL,base TEXT,producer TEXT NOT NULL,criteria TEXT,
 scope TEXT,pathref TEXT,status TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_memory_items(
 id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,
 content_hash TEXT NOT NULL,source TEXT,valid_until INTEGER,payload TEXT NOT NULL,
 created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_memory_reviews(
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL,reviewer TEXT NOT NULL,decision TEXT NOT NULL,
 payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS swarm_approvals(
 id TEXT PRIMARY KEY,action TEXT NOT NULL,scope TEXT NOT NULL,versions TEXT NOT NULL,
 status TEXT NOT NULL,decision_ref TEXT,payload TEXT NOT NULL,created_at INTEGER NOT NULL,
 applied_at INTEGER);`;

// Additive store over the existing SQLite host: every write happens inside the host transaction,
// legacy entities/metadata stay readable and the schema marker lets old supervisors detect the
// swarm layer without a second database or a scheduler of its own.
export function createSwarmStore(store){
 const sql=store.sql;
 const migrate=()=>store.transaction(()=>{
  sql.exec(SCHEMA);
  sql.prepare("INSERT INTO metadata VALUES('swarm_schema','1') ON CONFLICT(key) DO NOTHING").run();
 });
 return {
  migrate,
  seedDefinitions(defs){store.transaction(()=>{
   validateAgentDefinitions(defs);
   const insert=sql.prepare('INSERT OR IGNORE INTO agent_definitions(id,definition_version,hash,kind,parent_id,team_id,pack_id,payload,seeded_at) VALUES(?,?,?,?,?,?,?,?,?)');
   for(const def of defs)insert.run(def.id,def.version??1,sha(def),def.kind,def.parent_id??null,def.team_id??null,def.pack_id??null,JSON.stringify(def),now());
  });},
  listDefinitions(){
   return sql.prepare('SELECT payload FROM agent_definitions ORDER BY id').all().map(row=>JSON.parse(row.payload));
  },
  getDefinition(id){
   const row=sql.prepare('SELECT payload FROM agent_definitions WHERE id=? ORDER BY definition_version DESC LIMIT 1').get(id);
   return row?JSON.parse(row.payload):null;
  },
  upsertBinding(binding){
   store.transaction(()=>{
    validateAgentBinding(binding);
    const current=sql.prepare('SELECT revision FROM agent_bindings WHERE workspace=? AND agent_id=? AND phase=?').get(binding.workspace,binding.agent_id,binding.phase);
    if(current&&binding.revision!==current.revision+1)fail('binding_revision_conflict');
    if(!current&&binding.revision!==1)fail('binding_revision_conflict');
    sql.prepare('INSERT OR REPLACE INTO agent_bindings(workspace,agent_id,phase,revision,payload,updated_at) VALUES(?,?,?,?,?,?)')
     .run(binding.workspace,binding.agent_id,binding.phase,binding.revision,JSON.stringify(binding),now());
   });
  },
  getBinding(workspace,agentId,phase){
   const row=sql.prepare('SELECT payload FROM agent_bindings WHERE workspace=? AND agent_id=? AND phase=?').get(workspace,agentId,phase);
   return row?JSON.parse(row.payload):null;
  },
  registerPack(pack){
   store.transaction(()=>{
    const status=pack.status??'registered';
    if(!PACK_STATUSES.includes(status))fail('invalid_pack_status');
    sql.prepare('INSERT INTO swarm_catalog_packs(pack_id,wave,version,hash,status,payload,registered_at) VALUES(?,?,?,?,?,?,?)')
     .run(pack.pack_id,pack.wave,pack.version??1,pack.hash,status,JSON.stringify(pack.payload??pack),now());
   });
  },
  setPackStatus(packId,status){
   if(!PACK_STATUSES.includes(status))fail('invalid_pack_status');
   store.transaction(()=>{
    const row=sql.prepare('SELECT pack_id,version FROM swarm_catalog_packs WHERE pack_id=? ORDER BY version DESC LIMIT 1').get(packId);
    if(!row)fail('pack_missing');
    sql.prepare('UPDATE swarm_catalog_packs SET status=?,activated_at=CASE WHEN ?=\'active\' THEN ? ELSE activated_at END WHERE pack_id=? AND version=?')
     .run(status,status,now(),packId,row.version);
   });
  },
  packStatus(packId){
   const row=sql.prepare('SELECT pack_id,wave,version,status,hash,activated_at,payload FROM swarm_catalog_packs WHERE pack_id=? ORDER BY version DESC LIMIT 1').get(packId);
   if(!row)return null;
   return {...row,payload:JSON.parse(row.payload)};
  },
  upsertVariant(variant){
   store.transaction(()=>{
    validateAgentVariant(variant);
    sql.prepare('INSERT OR REPLACE INTO agent_variants(id,workspace,version,base_id,status,params_hash,provenance,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
     .run(variant.id,variant.workspace,variant.version,variant.base_id,variant.status,sha(variant.params??{}),JSON.stringify(variant.provenance),JSON.stringify(variant),now());
   });
  },
  setVariantStatus(id,status){
   if(!VARIANT_STATUSES.includes(status))fail('invalid_variant_status');
   store.transaction(()=>{
    const row=sql.prepare('SELECT id,workspace,version,provenance,payload FROM agent_variants WHERE id=? ORDER BY version DESC LIMIT 1').get(id);
    if(!row)fail('variant_missing');
    if(status==='active'){
     const provenance=JSON.parse(row.provenance);
     if(!provenance.approved_by||!provenance.decision_ref)fail('variant_activation_requires_approval');
    }
    const payload={...JSON.parse(row.payload),status};
    sql.prepare('UPDATE agent_variants SET status=?,payload=?,updated_at=? WHERE id=? AND workspace=? AND version=?')
     .run(status,JSON.stringify(payload),now(),id,row.workspace,row.version);
   });
  },
  listVariants(workspace){
   return sql.prepare(`SELECT payload FROM agent_variants a
    WHERE workspace=? AND version=(SELECT MAX(version) FROM agent_variants WHERE id=a.id AND workspace=a.workspace)
    ORDER BY id`).all(workspace).map(row=>JSON.parse(row.payload));
  },
  upsertPolicy(policy){
   store.transaction(()=>{
    validateProjectPolicy(policy);
    const current=sql.prepare('SELECT revision FROM swarm_project_policies WHERE workspace=?').get(policy.workspace);
    if(current&&policy.revision!==current.revision+1)fail('policy_revision_conflict');
    if(!current&&policy.revision!==1)fail('policy_revision_conflict');
    sql.prepare('INSERT OR REPLACE INTO swarm_project_policies(workspace,revision,payload,updated_at) VALUES(?,?,?,?)')
     .run(policy.workspace,policy.revision,JSON.stringify(policy),now());
   });
  },
  getPolicy(workspace){
   const row=sql.prepare('SELECT payload FROM swarm_project_policies WHERE workspace=?').get(workspace);
   return row?JSON.parse(row.payload):null;
  },
 };
}
