import test from 'node:test';
import assert from 'node:assert/strict';
import {agentDefinitions,validateAgentDefinitions,findAgentDefinition} from '../src/swarm/definitions.mjs';
import {materializeCatalogPack,catalogWithPack,resolveVariant} from '../src/swarm/catalog.mjs';

const provenance={proposed_by:'user',proposed_at:'2026-10-05T00:00:00Z',approved_by:'user',decision_ref:'d-9'};
const dataPack={
 pack_id:'data-ai',wave:2,version:1,required_tool_families:['python','test-db'],provenance,
 definitions:[
  {id:'data-lead',name:'Líder de dados',parent_id:'orchestrator',scope:'Coordena dados/IA.',skill_refs:['research']},
  {id:'data-engineer',name:'Engenharia de dados',parent_id:'data-lead',scope:'Pipelines.',skill_refs:['tdd'],tool_family_requirements:['python']},
  {id:'eval-scientist',name:'Cientista de avaliação',parent_id:'data-lead',scope:'Avaliações controladas.',skill_refs:['typesafe-ai']},
 ],
};

test('a pack materializes leaders, specialists and team rollups without touching the base catalog',()=>{
 const before=JSON.stringify(agentDefinitions);
 const defs=materializeCatalogPack(dataPack);
 assert.equal(defs.length,3);
 assert.equal(defs.find(d=>d.id==='data-lead').kind,'leader');
 assert.equal(defs.find(d=>d.id==='data-lead').team_id,'data-lead');
 assert.equal(defs.find(d=>d.id==='data-engineer').kind,'specialist');
 assert.equal(defs.find(d=>d.id==='data-engineer').team_id,'data-lead');
 assert.equal(defs.find(d=>d.id==='data-engineer').version,1);
 assert.equal(JSON.stringify(agentDefinitions),before);
});

test('merging a pack yields a validated bigger tree and rejects id collisions with the base catalog',()=>{
 const merged=catalogWithPack(agentDefinitions,dataPack);
 assert.equal(merged.length,agentDefinitions.length+3);
 assert.equal(validateAgentDefinitions(merged),true);
 assert.equal(merged.find(d=>d.id==='data-lead').parent_id,'orchestrator');
 const collision={...dataPack,definitions:[{id:'nextjs',name:'clone',parent_id:'orchestrator',scope:'x'}]};
 assert.throws(()=>catalogWithPack(agentDefinitions,collision),/invalid_agent_hierarchy|definition_id_conflict/);
 const orphan={...dataPack,definitions:[{id:'ghost',name:'ghost',parent_id:'nowhere',scope:'x'}]};
 assert.throws(()=>catalogWithPack(agentDefinitions,orphan),/invalid/);
});

test('fan-out limits keep every JEV family inside option bounds: max 12 children per parent and 9 leaders at the central',()=>{
 const extra=id=>({id,name:id,kind:'specialist',parent_id:'frontend-lead',team_id:'frontend-lead',version:1,scope:'x'});
 const crowded=[...agentDefinitions,...Array.from({length:12},(_,i)=>extra('crowd-'+i))];
 assert.throws(()=>validateAgentDefinitions(crowded),/invalid_agent_hierarchy/);
 const leader=id=>({id,name:id,kind:'leader',parent_id:'orchestrator',team_id:id,version:1,scope:'x'});
 const crowdedTop=[...agentDefinitions,...Array.from({length:4},(_,i)=>leader('lead-x'+i))];
 assert.throws(()=>validateAgentDefinitions(crowdedTop),/invalid_agent_hierarchy/);
 assert.equal(validateAgentDefinitions([...agentDefinitions,...Array.from({length:3},(_,i)=>leader('lead-x'+i))]),true);
});

test('variants resolve inside the base envelope: id, scope overlay, skills union and tool delta',()=>{
 const base=findAgentDefinition('nextjs');
 const variant={
  id:'nextjs--app-router-strict',base_id:'nextjs',workspace:'c:/proj',version:1,
  params:{scope_overlay:'App Router apenas.',extra_skill_refs:['grill-with-docs'],tool_requirements_delta:{add:['browser'],remove:['fs']},model_preference:'gpt-6.1-sol',budget_class:'standard'},
  provenance:{proposed_by:'orchestrator',proposed_at:'2026-10-05T00:00:00Z'},status:'proposed',
 };
 const resolved=resolveVariant(base,variant);
 assert.equal(resolved.id,'nextjs--app-router-strict');
 assert.equal(resolved.base_id,'nextjs');
 assert.equal(resolved.kind,'specialist');
 assert.equal(resolved.parent_id,'frontend-lead');
 assert.equal(resolved.team_id,'frontend-lead');
 assert.match(resolved.scope,/Renderização/);
 assert.match(resolved.scope,/App Router apenas/);
 assert.ok(resolved.skill_refs.includes('tdd'));
 assert.ok(resolved.skill_refs.includes('grill-with-docs'));
 assert.deepEqual(resolved.tool_family_requirements,['browser']);
 assert.equal(resolved.model_preference,'gpt-6.1-sol');
 assert.throws(()=>resolveVariant(base,{...variant,id:'other--thing'}),/invalid_agent_variant/);
});

test('a resolved variant can never widen the envelope: over-cap unions and out-of-contract params are rejected',()=>{
 const base=findAgentDefinition('nextjs');
 const make=params=>({id:'nextjs--v',base_id:'nextjs',workspace:'w',version:1,params,provenance:{proposed_by:'u',proposed_at:'t'},status:'proposed'});
 assert.equal(resolveVariant(base,make({})).kind,'specialist');
 assert.throws(()=>resolveVariant(base,make({extra_skill_refs:Array(20).fill('x')})),/invalid_agent_variant/);
 const fat={...base,skill_refs:Object.freeze(Array.from({length:11},(_,i)=>'skill-'+i))};
 assert.throws(()=>resolveVariant(fat,make({extra_skill_refs:['one','two']})),/variant_out_of_envelope/);
});
