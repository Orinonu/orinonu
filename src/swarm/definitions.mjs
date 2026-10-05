import {specialists} from '../specialists.mjs';

const leaders=new Set(['frontend-lead','backend-lead','ui-design-lead','reviewer','opportunity-analyst','engineering-lead']);
const ALL_PHASES=['discovery','design','implementation','review'];
// Phase envelopes follow the team's function: quality reviews, research discovers, design
// specifies and engineering implements. They bound work, never grant tools by themselves.
const phasesFor=(id,kind)=>{
 if(kind!=='specialist')return ALL_PHASES;
 if(id==='qa-engineer'||id==='security-reviewer')return ['review'];
 if(id==='research-analyst')return ['discovery'];
 if(['ux-designer','ux-research','visual-identity','design-system','layout-interaction','motion-design','accessibility-design'].includes(id))return ['design'];
 return ['design','implementation'];
};
const freeze=node=>Object.freeze({...node,version:node.version??1,phases:Object.freeze(node.phases??phasesFor(node.id,node.kind)),skill_refs:Object.freeze([...(node.skill_refs??[])]),memory_policy:node.memory_policy??'scoped'});
export const agentDefinitions=Object.freeze([
 freeze({id:'orchestrator',name:'Orquestrador central',kind:'central',parent_id:null,team_id:null,scope:'Coordenar líderes com System 1/JEV e System 2, dentro dos contratos validados pelo host.',skill_refs:['codebase-design','typesafe-ai']}),
 ...specialists.map(role=>{
  const parent=role.id==='generalist'||role.id==='release-engineer'?'engineering-lead':role.parent??'orchestrator';
  return freeze({id:role.id,name:role.name,kind:leaders.has(role.id)?'leader':'specialist',parent_id:parent,team_id:leaders.has(role.id)?role.id:parent,scope:role.scope,skill_refs:role.skills});
 }),
 freeze({id:'engineering-lead',name:'Líder de engenharia transversal',kind:'leader',parent_id:'orchestrator',team_id:'engineering-lead',scope:'Coordenar engenharia geral e preparação de release; integrar contratos sem publicação automática.',skill_refs:['codebase-design','code-review']}),
 freeze({id:'postgresql',name:'PostgreSQL',kind:'specialist',parent_id:'backend-lead',team_id:'backend-lead',scope:'Projetar schemas, índices e migrações PostgreSQL com dados sintéticos; acesso a banco real exige concessão própria.',skill_refs:['domain-modeling','tdd']}),
]);
// JEV choices are bounded: the central never faces more than 9 leaders and no leader faces
// more than 12 direct children. Bigger domains need an intermediate leader, not a flat list.
export const MAX_LEADERS=9,MAX_CHILDREN=12;
export function validateAgentDefinitions(nodes){
 const fail=()=>{throw new Error('invalid_agent_hierarchy');};
 if(!Array.isArray(nodes)||!nodes.length||nodes.length>100)fail();
 const byId=new Map();
 for(const node of nodes){
  if(!node||typeof node.id!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(node.id)||byId.has(node.id)||!['central','leader','specialist'].includes(node.kind))fail();
  byId.set(node.id,node);
 }
 const roots=nodes.filter(node=>node.kind==='central');
 if(roots.length!==1||roots[0].parent_id!==null||roots[0].team_id!==null)fail();
 const fanOut=new Map();
 for(const node of nodes){
  if(node===roots[0])continue;
  const parent=byId.get(node.parent_id);
  if(!parent||parent===node||parent.kind==='specialist'||parent.kind==='central'&&node.kind!=='leader'||node.kind==='leader'&&node.team_id!==node.id||node.kind==='specialist'&&node.team_id!==node.parent_id)fail();
  const count=(fanOut.get(parent.id)??0)+1;
  if(count>(parent.kind==='central'?MAX_LEADERS:MAX_CHILDREN))fail();
  fanOut.set(parent.id,count);
 }
 const visiting=new Set(),visited=new Set();
 const visit=node=>{
  if(visited.has(node.id))return;
  if(visiting.has(node.id))fail();
  visiting.add(node.id);if(node.parent_id!==null)visit(byId.get(node.parent_id));visiting.delete(node.id);visited.add(node.id);
 };
 for(const node of nodes)visit(node);
 return true;
}
validateAgentDefinitions(agentDefinitions);
export const findAgentDefinition=id=>agentDefinitions.find(node=>node.id===id)??null;
export function delegationTargets(parentId){
 if(!findAgentDefinition(parentId))throw new Error('agent_definition_missing');
 return agentDefinitions.filter(node=>node.parent_id===parentId);
}
