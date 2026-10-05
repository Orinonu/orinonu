import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDirectionAssistance,readDirectionDraft} from '../src/direction-assistance.mjs';
import {createMissionServer} from '../src/server.mjs';
const proposal={mission:'Coordenar agentes',vision:'Entregas verificáveis',values:'Autonomia',principles:'Evidências primeiro',objective:'Melhorar planejamento',success_criteria:'Testes passam',repositories:['https://github.com/paperclipai/paperclip'],research_focus:'Orquestração'};
const report=draft=>'```nexo-direction-draft\n'+JSON.stringify(draft)+'\n```';
test('direction draft validates bounded fields, references and alignment consistency',()=>{
 assert.equal(buildDirectionAssistance({workspace:process.cwd(),user_context:'Minha preferência'}).max_minutes,10);
 assert.throws(()=>buildDirectionAssistance({workspace:process.cwd(),user_context:'x'.repeat(4001)}));
 assert.equal(readDirectionDraft(report({status:'proposed',proposal,questions:[],reason:'Evidências locais'}),process.cwd()).proposal.principles,'Evidências primeiro');
 assert.throws(()=>readDirectionDraft(report({status:'proposed',proposal,questions:['Escolha?'],reason:''}),process.cwd()));
 assert.throws(()=>readDirectionDraft(report({status:'needs_alignment',proposal,questions:[],reason:''}),process.cwd()));
 assert.throws(()=>readDirectionDraft(report({status:'proposed',proposal:{...proposal,repositories:['https://outside.invalid/x']},questions:[],reason:''}),process.cwd()));
});
test('assistance uses read-only Codex, exposes real progress and draft without saving or implementing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-direction-'));let child,args;
 const runner=(_cmd,argv)=>{args=argv;child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const response=await post('/api/project-direction/assist',{workspace:dir,...proposal,user_context:'Poucas perguntas'});assert.equal(response.status,202);const request=await response.json();
  for(let i=0;i<40&&!child;i++)await new Promise(r=>setTimeout(r,10));assert(child);assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.match(child.stdinText,/nexo-direction-draft/);assert.doesNotMatch(child.stdinText,/Termine com um único bloco Markdown nexo-plan/);
  assert.equal((await post(`/api/tasks/${request.task_id}/run`,{})).status,409);
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:report({status:'needs_alignment',proposal,questions:['Qual objetivo tem prioridade?'],reason:'Objetivos concorrentes'})}})+'\n');
  await fetch(app.url+'/api/state');child.emit('close',0);
  const state=await(await fetch(app.url+`/api/project-direction/assist/${request.task_id}`)).json();assert.equal(state.status,'needs_alignment');assert.equal(state.proposal.mission,proposal.mission);assert(state.progress);assert.equal(state.usage,null);
  const full=await(await fetch(app.url+'/api/state')).json();assert.equal((full.project_directions??[]).length,0);assert.equal(full.tasks.length,1);assert.equal(full.tasks[0].pipeline.auto_implement,false);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('invalid delivery is held and cancellation never releases a proposal for applying',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-direction-stop-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/project-direction/assist',{workspace:dir})).json();for(let i=0;i<40&&!child;i++)await new Promise(r=>setTimeout(r,10));
  await post(`/api/tasks/${task.task_id}/stop`,{});const result=await(await fetch(app.url+`/api/project-direction/assist/${task.task_id}`)).json();assert.equal(result.status,'held');assert.equal(result.proposal,null);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
