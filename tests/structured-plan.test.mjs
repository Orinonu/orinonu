import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';

const step=(id,dependencies=[])=>({id,title:`Etapa ${id}`,specialist:'backend-lead',files:['src/pipeline.mjs'],dependencies,skills:['tdd'],tools:['exec_command'],mcps:[],inputs:['Objetivo aprovado'],outputs:['Implementação testada'],verification:['Teste de regressão passa'],max_minutes:15});
const contract=steps=>({version:2,ready_for_implementation:true,pending_decisions:[],steps,verification:['Suíte existente passa']});
async function planningCase(plan,autoImplement,check,reportPrefix=''){
 const dir=mkdtempSync(join(tmpdir(),'nexo-structured-'));const children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
 const decisionEngine={call:async(_tool,input)=>({ok:true,action:'recommend',selected_id:input.goal.startsWith('Recuperação limitada')?'preserve_for_review':input.options[0].id})};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,decisionEngine});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'Plano de agentes',workspace:dir,goal:'Implementar contrato definido',acceptance:'Teste de regressão passa',agent:'codex',profile:'discovery',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/prepare`,{auto_implement:autoImplement});
  for(let n=0;!children.length&&n<40;n++)await new Promise(r=>setTimeout(r,5));
  assert.equal(children.length,1);
  children[0].stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:reportPrefix+'```nexo-plan\n'+JSON.stringify(plan)+'\n```'}})+'\n');
  await fetch(app.url+'/api/state');children[0].emit('close',0);
  await new Promise(r=>setTimeout(r,30));
  await check((await(await fetch(app.url+'/api/state')).json()).tasks[0],children.length);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
}
test('planning preserves structured specialists and dependencies without claiming execution',async()=>{
 await planningCase(contract([step('api'),step('review',['api'])]),false,(task,count)=>{
  assert.equal(count,1);assert.equal(task.status,'review');
  assert.equal(task.structured_plan.version,2);
  assert.deepEqual(task.structured_plan.execution_order,['api','review']);
  assert.equal(task.structured_plan.steps[0].specialist,'backend-lead');
  assert.equal(task.structured_plan.steps[0].status,'planned');
  assert.equal(task.structured_plan.resources_status,'proposed_not_granted');
 });
});
for(const [name,steps] of [
 ['cycle',[step('api',['review']),step('review',['api'])]],
 ['missing dependency',[step('api',['missing'])]],
 ['duplicate ID',[step('api'),step('api')]],
 ['unknown specialist',[{...step('api'),specialist:'uninstalled'}]],
 ['outside workspace',[{...step('api'),files:['../other/secrets']}]],
])test(`planning rejects ${name} before automatic implementation`,async()=>{
 await planningCase(contract(steps),true,(task,count)=>{
  assert.equal(count,1);assert.equal(task.structured_plan,null);
  assert.match(task.plan_contract_error,/Plano inválido/);
  assert.notEqual(task.status,'running');
  assert.equal(task.pipeline.status,'needs_review');
  assert.ok(!task.progress.events.some(event=>event.kind==='queued'&&event.label?.includes('implementation')));
 });
});
test('pending decisions retain the proposed plan without starting implementation',async()=>{
 await planningCase({...contract([step('api')]),ready_for_implementation:false,pending_decisions:['Preferência não definida']},true,(task,count)=>{
  assert.equal(count,1);assert.equal(task.structured_plan.ready_for_implementation,false);
  assert.notEqual(task.status,'running');
 });
});
test('authorized structured plan advances to a separate implementation process',async()=>{
 await planningCase(contract([step('api'),step('review',['api'])]),true,(task,count)=>{
  assert.equal(count,2);assert.equal(task.status,'running');
  assert.deepEqual(task.structured_plan.execution_order,['api','review']);
  assert.equal(task.structured_plan.steps[0].status,'planned');
 });
});

test('long planning evidence preserves the complete contract before dispatch',async()=>{
 await planningCase(contract([step('api')]),true,(task,count)=>{
  assert.equal(count,2);assert.equal(task.status,'running');
  assert.equal(task.structured_plan.steps[0].id,'api');
  assert.ok(task.plan_report.endsWith('\n```'));
 },'Evidência de investigação.\n'.repeat(1000));
});

test('oversized planning reports fail explicitly without dispatching truncated contracts',async()=>{
 await planningCase(contract([step('api')]),true,(task,count)=>{
  assert.equal(count,1);assert.equal(task.status,'blocked');
  assert.match(task.error,/Relatório excede/);
  assert.equal(task.plan_report,null);
 },'x'.repeat(1024*1024+1));
});
