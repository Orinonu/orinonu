import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
const report=pending=>'```nexo-plan\n'+JSON.stringify({ready_for_implementation:true,pending_decisions:pending,steps:['Implement within goal'],verification:['Run acceptance tests']})+'\n```';
for(const scenario of ['authorized','pending','planning-only','abstention'])test(`planning pipeline: ${scenario}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-pipeline-'));const children=[],args=[];
 const runner=(cmd,argv)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);args.push(argv);return child;};
 let calls=0;
 const decisionEngine={call:async(tool,input)=>{calls++;return scenario==='abstention'?{ok:true,action:'abstain'}:{ok:true,action:'recommend',selected_id:input.options[0].id};}};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:'',decisionEngine});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'Bounded change',workspace:dir,goal:'Implement defined behavior',acceptance:'Acceptance tests pass',agent:'codex',profile:'discovery',max_minutes:1})).json();
  assert.equal((await post(`/api/tasks/${task.id}/prepare`,{auto_implement:scenario!=='planning-only'})).status,200);
  children[0].stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:report(scenario==='pending'?['Unknown user preference']:[])}})+'\n');
  await fetch(app.url+'/api/state');children[0].emit('close',0);
  await new Promise(resolve=>setTimeout(resolve,30));
  const state=await(await fetch(app.url+'/api/state')).json();
  assert(args[0].includes('read-only'));
  if(scenario==='authorized'){assert.equal(children.length,2);assert(args[1].includes('workspace-write'));assert.equal(state.tasks[0].status,'running');assert.equal(state.tasks[0].pipeline.status,'implementing');assert(calls>=3);children[1].emit('close',0);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(children.length,3);assert(args[2].includes('read-only'));let reviewing=(await(await fetch(app.url+'/api/state')).json()).tasks[0];assert.equal(reviewing.pipeline.status,'reviewing');assert(reviewing.implementation_run);children[2].stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Review evidence and acceptance checks'}})+'\n');await fetch(app.url+'/api/state');children[2].emit('close',0);assert.equal((await(await fetch(app.url+'/api/state')).json()).tasks[0].pipeline.status,'review');}
  else{assert.equal(children.length,1);assert.equal(state.tasks[0].status,'review');if(scenario!=='planning-only')assert.equal(state.tasks[0].pipeline.status,'needs_review');}
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
