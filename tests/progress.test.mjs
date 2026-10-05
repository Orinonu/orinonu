import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';

test('planning exposes ordered live tool feedback without leaking commands or outputs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-progress-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const current=async()=>(await(await fetch(app.url+'/api/state')).json()).tasks[0];
 try{
  const task=await(await post('/api/tasks',{title:'Research',workspace:dir,goal:'Inspect code',acceptance:'Evidence and plan',agent:'codex',profile:'discovery',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/prepare`,{});
  for(let i=0;i<30&&!child;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const firstState=await(await fetch(app.url+'/api/state')).json();
  assert(firstState.events.some(e=>e.kind==='jev_decision'&&e.task_id===task.id));
  assert.equal((await current()).progress.phase,'planning');
  child.stdout.write(JSON.stringify({type:'item.started',item:{id:'cmd1',type:'command_execution',command:'echo private-secret',status:'in_progress'}})+'\n');
  let observed=await current();assert.equal(observed.progress.events.at(-1).kind,'tool_started');
  assert.equal(observed.progress.events.at(-1).tool,'command_execution');
  child.stdout.write(JSON.stringify({type:'item.completed',item:{id:'cmd1',type:'command_execution',command:'echo private-secret',aggregated_output:'private-secret',exit_code:0,status:'completed'}})+'\n');
  observed=await current();assert.equal(observed.progress.events.at(-1).kind,'tool_completed');assert.equal(observed.progress.events.at(-1).state,'completed');
  assert(!JSON.stringify(observed.progress).includes('private-secret'));assert(!Object.hasOwn(observed.progress,'percent'));
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Evidence collected; plan ready.'}})+'\n');
  await current();child.emit('close',0);
  observed=await current();assert.equal(observed.progress.phase,'review');assert.equal(observed.progress.events.at(-1).kind,'execution_finished');
  assert.equal(observed.progress.events.at(-1).label,'Plano entregue · aguardando revisão');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('missions are monitored automatically while active and produce bounded failure recommendations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-live-evals-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 try{
  const task=await(await post('/api/tasks',{title:'Measured run',workspace:dir,goal:'Check behavior',acceptance:'Verified tests',agent:'codex',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/run`,{});
  assert.equal((await state()).mission_evals[0].status,'active');
  assert.equal((await state()).mission_evals[0].input_tokens,null);
  for(let i=0;i<40;i++)child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'web_search',status:'completed'}})+'\n');
  child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:120,output_tokens:30}})+'\n');
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'command_execution',exit_code:1,status:'failed',command:'private-command'}})+'\n');
  let observed=(await state()).mission_evals[0];assert.equal(observed.tool_events,41);assert.equal(observed.failed_tools,1);assert.equal(observed.input_tokens,120);
  child.emit('close',1);
  const completed=await state();observed=completed.mission_evals[0];
  assert.equal(observed.status,'failed');assert.equal(observed.delivery_quality,'unverified');assert.equal(observed.savings,'unmeasured');
  const proposals=completed.opportunities.filter(p=>p.source==='automatic_mission_observation');assert.equal(proposals.length,1);assert.equal(proposals[0].status,'pending');assert.equal(completed.tasks.length,1);
  assert(!JSON.stringify(observed).includes('private-command'));
  await state();assert.equal((await state()).opportunities.filter(p=>p.source==='automatic_mission_observation').length,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('activity is bounded, survives restart and records failed tools without their private payloads',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-progress-history-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 let app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'Inspect',workspace:dir,goal:'Inspect code',acceptance:'Review evidence',agent:'codex',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/run`,{});
  for(let i=0;i<40;i++)child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'web_search',query:'private-query',status:'completed'}})+'\n');
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',arguments:{key:'private-api-key'},result:{text:'private-output'},error:{message:'private-error'},status:'failed'}})+'\n');
  await fetch(app.url+'/api/state');child.emit('close',1);
  const before=(await(await fetch(app.url+'/api/state')).json()).tasks[0].progress;
  assert.equal(before.events.length,30);assert.equal(before.sequence,43);assert.equal(before.phase,'blocked');
  assert.equal(before.events.at(-2).state,'failed');assert(!JSON.stringify(before).includes('private-'));
  await app.close();app=createMissionServer({dataDir:dir});await app.listen(0);
  const after=(await(await fetch(app.url+'/api/state')).json()).tasks[0].progress;
  assert.deepEqual(after,before);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

import {startProgress,observeCodexProgress,progressContractInstructions} from '../src/progress.mjs';
const checklistMessage=(items,revision=1,attempt_id='attempt-1')=>({type:'item.completed',item:{type:'agent_message',text:'```nexo-progress\n'+JSON.stringify({version:1,attempt_id,phase:'implementation',revision,items})+'\n```'}});
const checklistItems=()=>Array.from({length:10},(_,i)=>({id:'item-'+i,title:'Entrega '+i,state:'pending',evidence:[]}));
test('checklist reports one of ten at 10%, two at 20%; session and turns never advance it',()=>{
 const progress=startProgress(false,{attempt_id:'attempt-1',phase:'implementation'});
 observeCodexProgress(progress,{type:'thread.started'});observeCodexProgress(progress,{type:'turn.completed'});
 assert.equal(progress.items,null);assert.equal(progress.measurement_kind,'task_checklist');
 const items=checklistItems();items[0]={...items[0],state:'completed',evidence:['Teste verificado']};
 observeCodexProgress(progress,checklistMessage(items));
 assert.equal(progress.items.filter(item=>item.state==='completed').length/progress.items.length*100,10);
 items[1]={...items[1],state:'completed',evidence:['Arquivo implementado']};
 observeCodexProgress(progress,checklistMessage(items,2));
 assert.equal(progress.items.filter(item=>item.state==='completed').length/progress.items.length*100,20);
 assert.equal(progress.checklist_revision,2);
});
test('checklist rejects stale attempts, missing evidence and denominator changes without leaking evidence',()=>{
 const progress=startProgress(false,{attempt_id:'attempt-1',phase:'implementation'}),items=checklistItems();
 observeCodexProgress(progress,checklistMessage(items,1,'old-attempt'));assert.equal(progress.items,null);
 items[0].state='completed';observeCodexProgress(progress,checklistMessage(items));assert.equal(progress.items,null);
 items[0].evidence=['private-secret command echo'];observeCodexProgress(progress,checklistMessage(items));
 assert.equal(progress.items[0].evidence_count,1);assert(!JSON.stringify(progress).includes('private-secret'));
 observeCodexProgress(progress,checklistMessage(items.slice(0,1),2));assert.equal(progress.items.length,10);
 observeCodexProgress(progress,checklistMessage(items,1));assert.equal(progress.checklist_revision,1);
 assert.match(progressContractInstructions({attempt_id:'attempt-1',phase:'implementation'}),/nexo-progress/);
});
test('ordinary messages and native todo claims cannot complete checklist work; a new phase starts unmeasured',()=>{
 const progress=startProgress(false,{attempt_id:'attempt-1',phase:'implementation'});
 for(const item of [{type:'agent_message',text:'All ten items completed; progress 100%'},{type:'todo_list',items:[{text:'All done',completed:true}]}])observeCodexProgress(progress,{type:'item.completed',item});
 assert.equal(progress.items,null);
 const items=checklistItems();observeCodexProgress(progress,checklistMessage(items));
 const duplicates=items.map(item=>({...item,id:'same'}));observeCodexProgress(progress,checklistMessage(duplicates,2));assert.equal(progress.checklist_revision,1);
 const wrongPhase=checklistMessage(items,2);wrongPhase.item.text=wrongPhase.item.text.replace('implementation','review');observeCodexProgress(progress,wrongPhase);assert.equal(progress.checklist_revision,1);
 const review=startProgress(true,{attempt_id:'attempt-2',phase:'review'});assert.equal(review.items,null);observeCodexProgress(review,checklistMessage(items,3));assert.equal(review.items,null);
});
