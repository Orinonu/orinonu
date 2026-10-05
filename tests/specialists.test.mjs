import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
import {specialists,findSpecialist,specialistPrompt,specialistPolicy,specialistCandidates} from '../src/specialists.mjs';
import {createEngine} from '../bundles/jev-decisions/engine.mjs';

test('candidate families satisfy the installed JEV engine contract without API calls',async()=>{
 const engine=createEngine({apiKey:'',fetcher:()=>{throw new Error('Unexpected paid request');}});
 const input=roles=>({category:'technical',delegated:true,goal:'Selecionar perfil entre opções disponíveis.',options:roles.map(role=>({id:role.id,text:role.scope}))});
 for(const parent of [null,...specialists.filter(role=>specialists.some(child=>child.parent===role.id)).map(role=>role.id)]){
  const output=await engine.call('resolve_decision',input(specialistCandidates(parent)));
  assert.equal(output.ok,false);assert.equal(output.error,'missing_TYPESAFE_API_KEY');
 }
 await assert.rejects(()=>engine.call('resolve_decision',input(specialists)),/invalid_tool_arguments/);
});

test('hierarchical candidate sets fit the real engine limit and reach every role',()=>{
 const reached=new Set();
 const visit=parent=>{const options=specialistCandidates(parent);assert.ok(options.length<=12);for(const role of options){if(reached.has(role.id))continue;reached.add(role.id);visit(role.id);}};
 visit(null);assert.equal(reached.size,specialists.length);
 assert.deepEqual(specialistCandidates('react').map(role=>role.id),['react']);
 assert.equal(specialistCandidates('backend-lead')[0].id,'backend-lead');
 assert.throws(()=>specialistCandidates('unknown'),/indisponível/);
 const role=findSpecialist('react'),previous=role.parent;
 try{role.parent='react';assert.throws(()=>specialistCandidates(),/Hierarquia/);}finally{role.parent=previous;}
});

test('expanded catalog keeps existing IDs, unique roles and valid acyclic leadership',()=>{
 const ids=specialists.map(role=>role.id);assert.equal(new Set(ids).size,ids.length);
 for(const id of ['opportunity-analyst','generalist','frontend-lead','backend-lead','nextjs','react','typescript','css','tailwind','reviewer'])assert.ok(findSpecialist(id));
 for(const role of specialists){
  assert.equal(findSpecialist(role.id),role);assert.ok(role.scope.length>40);
  const visited=new Set([role.id]);let parent=role.parent;
  while(parent){assert.ok(findSpecialist(parent),'parent exists: '+parent);assert.ok(!visited.has(parent),'acyclic hierarchy');visited.add(parent);parent=findSpecialist(parent).parent;}
 }
});

test('new roles suggest real session skills without claiming executable child agents',()=>{
 const available=new Set(['domain-modeling','tdd','supabase:supabase-postgres-best-practices','codebase-design','research','code-review','diagnosing-bugs','matt-skills-curated:workflow-designer','pr','matt-skills-curated:git-safety-guardrails','typesafe-ai','data-analytics:validate-data','data-analytics:design-kpis']);
 for(const id of ['database','api-contracts','research-analyst','ui-design-lead','ux-designer','ux-research','visual-identity','design-system','layout-interaction','motion-design','accessibility-design','qa-engineer','security-reviewer','infrastructure','release-engineer','memory-context','jev-evals','automation-scheduler']){
  const role=findSpecialist(id);assert.ok(role);for(const skill of role.skills)assert.ok(available.has(skill),skill);
  assert.match(specialistPrompt(id),/referências não concedem ferramentas nem permissões/);
 }
 assert.match(specialistPolicy.hierarchy,/ainda não inicia agentes filhos/);
});

test('design has separate leadership and passes specifications to frontend implementation',()=>{
 assert.equal(findSpecialist('ui-design-lead').parent,null);
 for(const id of ['ux-designer','ux-research','visual-identity','design-system','layout-interaction','motion-design','accessibility-design'])assert.equal(findSpecialist(id).parent,'ui-design-lead');
 for(const id of ['nextjs','react','typescript','css','tailwind'])assert.equal(findSpecialist(id).parent,'frontend-lead');
 assert.match(findSpecialist('ui-design-lead').scope,/frontend, que implementa/);
 assert.match(findSpecialist('motion-design').scope,/prefers-reduced-motion/);
 assert.match(findSpecialist('visual-identity').scope,/sem inventar símbolos sagrados/);
});

test('quality and security review remain independent from implementation',()=>{
 for(const id of ['qa-engineer','security-reviewer']){
  const role=findSpecialist(id);assert.equal(role.parent,'reviewer');assert.match(role.scope,/leitura/);
 }
 assert.match(findSpecialist('qa-engineer').scope,/sem corrigir a implementação/);
 assert.match(findSpecialist('security-reviewer').scope,/nem aplicar correções/);
 assert.match(findSpecialist('release-engineer').scope,/Não publicar/);
});

test('missions retain a specialist while nonexistent roles are rejected',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jev-specialists-'));
  let app=createMissionServer({dataDir:dir});await app.listen(0);
  try{
    const create=role=>fetch(app.url+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Interface acessível',workspace:dir,goal:'Implementar interface',acceptance:'Navegação por teclado verificada',agent:'codex',profile:'implementation',specialist:role,max_minutes:10})});
    assert.equal((await create('unavailable-agent')).status,400);
    const inherited=await fetch(app.url+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Invalid profile',workspace:dir,goal:'Goal',acceptance:'Check',agent:'codex',profile:'toString',max_minutes:10})});
    assert.equal(inherited.status,400);
    const response=await create('frontend-lead');assert.equal(response.status,201);
    const task=await response.json();assert.equal(task.specialist,'frontend-lead');
    await app.close();app=createMissionServer({dataDir:dir});await app.listen(0);
    const state=await (await fetch(app.url+'/api/state')).json();
    assert.equal(state.tasks[0].specialist,'frontend-lead');
    assert.equal(state.specialists.find(s=>s.id==='react').parent,'frontend-lead');
    assert.equal(state.specialist_policy.memory_status,'not_connected');
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('public specialist runtime reports prompt contracts rather than an operational Agents SDK swarm',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jev-specialist-runtime-'));
 const app=createMissionServer({dataDir:dir,apiKey:''});await app.listen(0);
 try{
  const response=await fetch(app.url+'/api/state');assert.equal(response.status,200);
  const state=await response.json();
  assert.deepEqual(state.specialist_policy.runtime,{kind:'executor_prompt',openai_agents_sdk:'not_integrated',handoffs:'not_connected'});
  assert.equal(state.specialist_policy.tool_allowlist_status,'not_enforced');
  assert.equal(state.specialist_policy.memory_status,'not_connected');
  assert.equal(state.specialists.length,specialists.length);
  for(const role of state.specialists)assert.ok(specialistPrompt(role.id).includes('Especialista: '+role.name+'. Contrato: '+role.scope));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('JEV abstention preserves the assigned specialist and never starts a worker',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jev-role-abstain-'));
  const app=createMissionServer({dataDir:dir,apiKey:''});await app.listen(0);
  try{
    const request=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const task=await (await request('/api/tasks',{title:'API',workspace:dir,goal:'Corrigir contrato da API',acceptance:'Teste de integração passa',agent:'codex',profile:'implementation',specialist:'backend-lead',max_minutes:10})).json();
    const response=await request(`/api/tasks/${task.id}/specialist`,{});
    assert.equal(response.status,200);assert.equal((await response.json()).ok,false);
    const state=await (await fetch(app.url+'/api/state')).json();
    assert.equal(state.tasks[0].specialist,'backend-lead');assert.equal(state.tasks[0].status,'backlog');
    assert.equal(state.events.find(e=>e.kind==='jev_decision').decision_kind,'specialist');
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('the host default specialist is derived from code, never grants anything and stays inside the catalog',async()=>{
 const {defaultSpecialist,findSpecialist}=await import('../src/specialists.mjs');
 assert.equal(defaultSpecialist({review:true}),'reviewer');
 assert.equal(defaultSpecialist({current:'react'}),'react');
 assert.equal(defaultSpecialist({current:'nonexistent'}),'generalist');
 const steps=[{specialist:'react'},{specialist:'nextjs'},{specialist:'database'},{specialist:'reviewer'},'plain text step'];
 assert.equal(defaultSpecialist({implementation:true,steps}),'frontend-lead');
 assert.equal(defaultSpecialist({implementation:true,steps:[{specialist:'qa-engineer'}],current:'api-contracts'}),'backend-lead');
 assert.equal(defaultSpecialist({implementation:true,steps:[],current:'reviewer'}),'generalist');
 assert.equal(defaultSpecialist({implementation:true,steps:[],current:'opportunity-analyst'}),'generalist');
 for(const input of [{review:true},{implementation:true,steps},{current:'x'}])assert.ok(findSpecialist(defaultSpecialist(input)));
});
