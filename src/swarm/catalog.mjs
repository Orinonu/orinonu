import {validateAgentDefinitions} from './definitions.mjs';
import {validateCatalogPackManifest,validateAgentVariant} from './contracts.mjs';

const freeze=node=>Object.freeze({...node,skill_refs:Object.freeze([...(node.skill_refs??[])])});
const MAX_SKILL_REFS=12;
const DEFAULT_PHASES=Object.freeze(['discovery','design','implementation','review']);

// A pack manifest becomes immutable operational definitions. Kind derives from the parent:
// direct child of the central is a leader, everything else is a specialist unless a deeper
// intermediate leader was explicitly declared in the manifest.
export function materializeCatalogPack(manifest){
 validateCatalogPackManifest(manifest);
 const byId=new Map(manifest.definitions.map(node=>[node.id,node]));
 const kindOf=node=>node.kind??(node.parent_id==='orchestrator'?'leader':'specialist');
 // team_id follows the tree validator: leaders own their own id, specialists report to their parent.
 const teamOf=node=>kindOf(node)==='leader'?node.id:node.parent_id;
 return Object.freeze(manifest.definitions.map(node=>freeze({
  id:node.id,name:node.name,kind:kindOf(node),parent_id:node.parent_id,team_id:teamOf(node),
  version:1,scope:node.scope,phases:[...(node.phases??DEFAULT_PHASES)],
  skill_refs:node.skill_refs??[],
  ...(node.tool_family_requirements?{tool_family_requirements:[...node.tool_family_requirements]}:{}),
  pack_id:manifest.pack_id,
 })));
}

export function catalogWithPack(base,manifest){
 const materialized=materializeCatalogPack(manifest);
 const ids=new Set(base.map(node=>node.id));
 for(const node of materialized)if(ids.has(node.id))throw new Error('definition_id_conflict');
 const merged=Object.freeze([...base,...materialized]);
 validateAgentDefinitions(merged);
 return merged;
}

// A variant is a bounded derivation of a base definition: same tree position and kind, with
// overlay scope, skills union and tool-requirements delta applied. Anything outside the
// parameter envelope was already rejected by the contract; the merge itself re-checks the caps.
export function resolveVariant(base,variant){
 if(!base||variant.base_id!==base.id)throw new Error('invalid_agent_variant');
 validateAgentVariant(variant);
 const params=variant.params??{};
 const skillRefs=[...new Set([...(base.skill_refs??[]),...(params.extra_skill_refs??[])])];
 if(skillRefs.length>MAX_SKILL_REFS)throw new Error('variant_out_of_envelope');
 const delta=params.tool_requirements_delta??{};
 const tools=[...new Set([...(base.tool_family_requirements??[]),...(delta.add??[])])].filter(ref=>!(delta.remove??[]).includes(ref));
 const scope=[base.scope,params.scope_overlay].filter(Boolean).join(' ');
 if(scope.length>4500)throw new Error('variant_out_of_envelope');
 return freeze({
  ...base,id:variant.id,base_id:base.id,scope,skill_refs:skillRefs,
  ...(tools.length?{tool_family_requirements:tools}:{}),
  ...(params.model_preference?{model_preference:params.model_preference}:{}),
  ...(params.budget_class?{budget_class:params.budget_class}:{}),
 });
}
