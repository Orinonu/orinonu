import test from 'node:test';
import assert from 'node:assert/strict';
import {specialists} from '../src/specialists.mjs';
import {agentDefinitions,findAgentDefinition,delegationTargets,validateAgentDefinitions} from '../src/swarm/definitions.mjs';

test('operational definitions preserve all legacy IDs and add a closed central, transversal leader and PostgreSQL role',()=>{
 const before=JSON.stringify(specialists);
 assert.equal(agentDefinitions.length,31);
 assert.equal(new Set(agentDefinitions.map(node=>node.id)).size,31);
 for(const role of specialists)assert.ok(findAgentDefinition(role.id));
 assert.equal(findAgentDefinition('orchestrator').kind,'central');
 assert.deepEqual(delegationTargets('orchestrator').map(node=>node.id).sort(),['backend-lead','engineering-lead','frontend-lead','opportunity-analyst','reviewer','ui-design-lead']);
 assert.equal(findAgentDefinition('generalist').parent_id,'engineering-lead');
 assert.equal(findAgentDefinition('release-engineer').parent_id,'engineering-lead');
 assert.equal(findAgentDefinition('postgresql').parent_id,'backend-lead');
 assert.deepEqual(delegationTargets('nextjs'),[]);
 assert.equal(JSON.stringify(specialists),before);
 assert.equal(specialists.find(node=>node.id==='generalist').parent,null);
});

test('catalog validation rejects duplicate IDs, missing parents, cycles and central-to-leaf hierarchy',()=>{
 assert.equal(validateAgentDefinitions(agentDefinitions),true);
 const change=(id,patch)=>agentDefinitions.map(node=>node.id===id?{...node,...patch}:node);
 for(const invalid of [
  [...agentDefinitions,agentDefinitions[0]],
  change('nextjs',{parent_id:'missing'}),
  change('frontend-lead',{parent_id:'nextjs'}),
  change('nextjs',{parent_id:'orchestrator'}),
  agentDefinitions.map(node=>node.id==='frontend-lead'?{...node,parent_id:'backend-lead'}:node.id==='backend-lead'?{...node,parent_id:'frontend-lead'}:node),
 ])assert.throws(()=>validateAgentDefinitions(invalid),/invalid_agent_hierarchy/);
 assert.throws(()=>delegationTargets('missing'),/agent_definition_missing/);
});
