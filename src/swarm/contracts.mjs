// Canonical host-side validators for swarm contracts. A validated contract has a correct
// shape; it is never a grant, a credential, an admission or proof that a resource exists.
const ID=/^[a-z0-9][a-z0-9-]{0,62}$/;
const VARIANT_ID=/^[a-z0-9][a-z0-9-]{0,62}--[a-z0-9][a-z0-9-]{0,40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const MAX_TEXT=4000,MAX_ITEMS=100,MAX_SKILL_REFS=10;
const RESERVED=new Set(['__proto__','prototype','constructor']);
const PHASES=['discovery','design','implementation','review'];
const STRATEGIES=['sdk_tools','codex_harness'];

const fail=code=>{throw Object.assign(new Error(code),{code});};
const record=(value,code)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail(code);
 for(const key of Object.keys(value))if(RESERVED.has(key))fail(code);
 return value;
};
const only=(value,code,keys)=>{for(const key of Object.keys(value))if(!keys.includes(key))fail(code);};
const id=(value,code)=>{if(typeof value!=='string'||!ID.test(value))fail(code);return value;};
const text=(value,code,{max=MAX_TEXT,nullable=false}={})=>{
 if(value==null){if(nullable)return value;fail(code);}
 if(typeof value!=='string'||!value.length||value.length>max)fail(code);
 return value;
};
const list=(value,code,each,{max=MAX_ITEMS,nullable=false,unique=true}={})=>{
 if(value==null){if(nullable)return value;fail(code);}
 if(!Array.isArray(value)||value.length>max)fail(code);
 value.forEach(each);
 if(unique&&new Set(value).size!==value.length)fail(code);
 return value;
};
const int=(value,code,{min=0,max=Number.MAX_SAFE_INTEGER,nullable=false}={})=>{
 if(value==null){if(nullable)return value;fail(code);}
 if(!Number.isInteger(value)||value<min||value>max)fail(code);
 return value;
};
const oneOf=(value,code,options)=>{if(!options.includes(value))fail(code);return value;};
const bool=(value,code)=>{if(typeof value!=='boolean')fail(code);return value;};
const object=(value,code,{nullable=false}={})=>{
 if(value==null){if(nullable)return value;fail(code);}
 return record(value,code);
};
const provenance=(value,code,{approval=false}={})=>{
 const p=object(value,code);
 text(p.proposed_by,code);text(p.proposed_at,code);
 if(approval){text(p.approved_by,code);text(p.decision_ref,code);}
 return p;
};

export function validateAgentDefinition(node){
 const code='invalid_agent_definition',value=record(node,code);
 only(value,code,['id','kind','parent_id','team_id','version','hash','name','scope','phases','skill_refs','tool_family_requirements','memory_policy','outputs','verification']);
 id(value.id,code);
 const kind=oneOf(value.kind,code,['central','leader','specialist']);
 if(kind==='central'){if(value.parent_id!=null||value.team_id!=null)fail(code);}
 else{id(value.parent_id,code);id(value.team_id,code);}
 int(value.version,code,{min:1});
 if(value.hash!=null&&!HEX64.test(value.hash))fail(code);
 text(value.name,code,{max:200});
 text(value.scope,code);
 list(value.phases,code,phase=>oneOf(phase,code,PHASES));
 list(value.skill_refs,code,ref=>text(ref,code,{max:160}));
 list(value.tool_family_requirements,code,ref=>id(ref,code),{nullable:true});
 oneOf(value.memory_policy??'scoped',code,['scoped','none','project']);
 list(value.outputs,code,ref=>text(ref,code,{max:160}),{nullable:true});
 list(value.verification,code,ref=>text(ref,code,{max:160}),{nullable:true});
 return true;
}

const VARIANT_PARAMS=['scope_overlay','extra_skill_refs','tool_requirements_delta','model_preference','budget_class'];
export function validateAgentVariant(variant){
 const code='invalid_agent_variant',value=record(variant,code);
 only(value,code,['id','base_id','workspace','version','params','provenance','status']);
 if(typeof value.id!=='string'||!VARIANT_ID.test(value.id)||!value.id.startsWith(value.base_id+'--'))fail(code);
 id(value.base_id,code);
 text(value.workspace,code,{max:500});
 int(value.version,code,{min:1});
 const params=object(value.params,code);only(params,code,VARIANT_PARAMS);
 text(params.scope_overlay,code,{max:500,nullable:true});
 list(params.extra_skill_refs,code,ref=>text(ref,code,{max:160}),{max:MAX_SKILL_REFS,nullable:true});
 if(params.tool_requirements_delta!=null){
  const delta=object(params.tool_requirements_delta,code);only(delta,code,['add','remove']);
  list(delta.add,code,ref=>id(ref,code),{max:MAX_SKILL_REFS,nullable:true});
  list(delta.remove,code,ref=>id(ref,code),{max:MAX_SKILL_REFS,nullable:true});
 }
 text(params.model_preference,code,{max:160,nullable:true});
 if(params.budget_class!=null)oneOf(params.budget_class,code,['minimal','standard','extended']);
 const status=oneOf(value.status,code,['proposed','active','suspended','revoked']);
 provenance(value.provenance,code,{approval:status!=='proposed'});
 return true;
}

export function validateCatalogPackManifest(manifest){
 const code='invalid_catalog_pack',value=record(manifest,code);
 only(value,code,['pack_id','wave','version','required_tool_families','definitions','provenance']);
 id(value.pack_id,code);
 int(value.wave,code,{min:1,max:4});
 int(value.version,code,{min:1});
 list(value.required_tool_families,code,ref=>id(ref,code),{nullable:true});
 const defs=list(value.definitions,code,node=>{
  record(node,code);only(node,code,['id','kind','name','parent_id','scope','skill_refs','phases','tool_family_requirements']);
  id(node.id,code);if(node.kind!=null)oneOf(node.kind,code,['leader','specialist']);
  text(node.name,code,{max:200});text(node.scope,code);
  list(node.phases,code,phase=>oneOf(phase,code,PHASES),{nullable:true});
  list(node.skill_refs,code,ref=>text(ref,code,{max:160}),{nullable:true});
  list(node.tool_family_requirements,code,ref=>id(ref,code),{nullable:true});
 },{max:40});
 if(!defs.length)fail(code);
 const byId=new Map(defs.map(node=>[node.id,node]));
 for(const node of defs){
  const parent=node.parent_id==='orchestrator'?'orchestrator':byId.get(node.parent_id);
  if(!parent)fail(code);
  const declared=node.kind??(node.parent_id==='orchestrator'?'leader':'specialist');
  if(parent!=='orchestrator'){
   const parentKind=parent.kind??(parent.parent_id==='orchestrator'?'leader':'specialist');
   if(declared==='specialist'&&parentKind!=='leader')fail(code);
   if(declared==='leader'&&parentKind!=='leader')fail(code);
  }
 }
 for(const node of defs){
  const seen=new Set([node.id]);let current=node;
  while(current.parent_id!=='orchestrator'){
   current=byId.get(current.parent_id);
   if(!current||seen.has(current.id)||seen.size>6)fail(code);
   seen.add(current.id);
  }
 }
 provenance(value.provenance,code,{approval:true});
 return true;
}

export function validateAgentBinding(binding){
 const code='invalid_agent_binding',value=record(binding,code);
 only(value,code,['workspace','agent_id','variant_id','phase','revision','model_connection_ref','model_id','settings','execution_strategy','harness_connection_ref','harness_model_id','limits','capability_requirements','fallback_policy','data_policy']);
 text(value.workspace,code,{max:500});
 id(value.agent_id,code);
 if(value.variant_id!=null&&typeof value.variant_id!=='string')fail(code);
 oneOf(value.phase,code,[...PHASES,'all']);
 int(value.revision,code,{min:1});
 text(value.model_connection_ref,code,{max:200,nullable:true});
 text(value.model_id,code,{max:200,nullable:true});
 object(value.settings,code,{nullable:true});
 oneOf(value.execution_strategy,code,STRATEGIES);
 text(value.harness_connection_ref,code,{max:200,nullable:true});
 text(value.harness_model_id,code,{max:200,nullable:true});
 if(value.limits!=null){
  const limits=object(value.limits,code);only(limits,code,['max_turns','deadline_minutes','context_tokens','max_requests']);
  for(const key of Object.keys(limits))int(limits[key],code,{min:1});
 }
 list(value.capability_requirements,code,ref=>id(ref,code),{nullable:true});
 if(value.fallback_policy!=null){
  const policy=object(value.fallback_policy,code);only(policy,code,['allowed','targets','data_policy']);
  bool(policy.allowed,code);
  list(policy.targets,code,ref=>text(ref,code,{max:200}),{nullable:true});
 }
 text(value.data_policy,code,{max:500,nullable:true});
 return true;
}

export function validateProjectPolicy(policy){
 const code='invalid_project_policy',value=record(policy,code);
 only(value,code,['workspace','revision','requested','enabled','readiness','approved_bindings','limits','autonomy_mandate_ref','mode']);
 text(value.workspace,code,{max:500});
 int(value.revision,code,{min:1});
 oneOf(value.requested,code,['legacy','swarm']);
 bool(value.enabled,code);
 const readiness=object(value.readiness,code);only(readiness,code,['state','reasons','checked_at']);
 oneOf(readiness.state,code,['ready','blocked','unverified']);
 list(readiness.reasons,code,reason=>text(reason,code,{max:300}),{nullable:true});
 if(value.enabled&&readiness.state!=='ready')fail(code);
 list(value.approved_bindings,code,ref=>text(ref,code,{max:200}),{nullable:true});
 object(value.limits,code,{nullable:true});
 if(value.mode!=null)oneOf(value.mode,code,['supervised','autonomous']);
 return true;
}

const MANDATE_ACTIONS=['read_workspace','propose','bounded_write','replan_in_budget','delegate_team','external_effect'];
export function validateAutonomyMandate(mandate){
 const code='invalid_autonomy_mandate',value=record(mandate,code);
 only(value,code,['workspace','level','permitted_actions','evidence','promoted_by','promoted_at','demotion_triggers','revision']);
 text(value.workspace,code,{max:500});
 const level=int(value.level,code,{min:0,max:4});
 list(value.permitted_actions,code,action=>oneOf(action,code,MANDATE_ACTIONS));
 const evidence=object(value.evidence,code);only(evidence,code,['verified_deliveries','review_passes','interventions','unknown_effects','last_delivery_at']);
 for(const key of ['verified_deliveries','review_passes','interventions','unknown_effects'])int(evidence[key],code);
 text(evidence.last_delivery_at,code,{nullable:true});
 if(level>0){text(value.promoted_by,code);text(value.promoted_at,code);}
 if(level>2&&evidence.verified_deliveries<1)fail(code);
 list(value.demotion_triggers,code,trigger=>text(trigger,code,{max:300}),{nullable:true});
 int(value.revision,code,{min:1});
 return true;
}
