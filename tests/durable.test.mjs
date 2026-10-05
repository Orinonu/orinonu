import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
import {missionContext} from '../src/context.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const post=(app,path,body={},method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const state=async app=>(await fetch(app.url+'/api/state')).json();
const spec=dir=>({title:'Durable mission',workspace:dir,goal:'Prevent duplicate execution',acceptance:'One executor',agent:'codex',profile:'implementation',max_minutes:1});

test('planning receipt replay performs each delegated selection once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-plan-replay-'));let calls=0,spawns=0;
 const decisionEngine={call:async(_,input)=>{calls++;return {ok:true,action:'recommend',selected_id:input.options[0].id};}};
 const runner=()=>{spawns++;const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 try{
  const task=await(await post(app,'/api/tasks',spec(dir))).json(),path=`/api/tasks/${task.id}/prepare`,body={request_id:'plan-replay',expected_revision:task.revision};
  const responses=await Promise.all([post(app,path,body),post(app,path,body)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
  assert.equal(calls,3);assert.equal(spawns,1);assert.equal((await post(app,path,body)).status,200);assert.equal(calls,3);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('two supervisors preserve independent missions and the hook reads the current authority',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-durable-'));
 const a=createMissionServer({dataDir:dir}),b=createMissionServer({dataDir:dir});
 await a.listen(0);await b.listen(0);
 try{
  const x=await(await post(a,'/api/tasks',spec(dir))).json();
  const y=await(await post(b,'/api/tasks',{...spec(dir),title:'Second mission'})).json();
  assert.deepEqual((await state(a)).tasks.map(t=>t.id).sort(),[x.id,y.id].sort());
  assert.equal(missionContext(dir,dir).tasks.length,2);
 }finally{await a.close();await b.close();rmSync(dir,{recursive:true,force:true});}
});

test('duplicate clicks replay the durable receipt, reject changed intent and never spawn twice',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-receipt-')),children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
 try{
  const task=await(await post(app,'/api/tasks',spec(dir))).json();
  const path=`/api/tasks/${task.id}/run`,intent={request_id:'click-1',expected_revision:task.revision};
  const responses=await Promise.all([post(app,path,intent),post(app,path,intent)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  const receipts=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(receipts[0],receipts[1]);
  assert.equal(children.length,1);
  assert.equal((await post(app,path,{...intent,expected_revision:999})).status,409);
  assert.equal((await post(app,path,{request_id:'different-click'})).status,409);
  children[0].emit('close',0);
  assert.deepEqual(await(await post(app,path,intent)).json(),receipts[0]);
  assert.equal(children.length,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('second supervisor observes the first owner and cannot launch its mission or overlapping writer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-owners-')),children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
 const a=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await a.listen(0);let b;
 try{
  const task=await(await post(a,'/api/tasks',spec(dir))).json();await post(a,`/api/tasks/${task.id}/run`);
  b=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await b.listen(0);
  assert.equal((await state(b)).tasks[0].status,'running');
  assert.equal((await post(b,`/api/tasks/${task.id}/run`,{request_id:'other-owner'})).status,409);
  const other=await(await post(b,'/api/tasks',{...spec(dir),title:'Overlapping writer'})).json();
  await post(b,`/api/tasks/${other.id}/run`);await state(b);
  assert.equal(children.length,1);
  assert.equal((await state(b)).tasks.find(t=>t.id===other.id).queue.status,'queued');
 }finally{if(b)await b.close();await a.close();rmSync(dir,{recursive:true,force:true});}
});

test('migration preserves missions, unknown fields and history and cannot reimport stale JSON',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-migration-'));
 const legacy={tasks:[{...spec(dir),id:'11111111-1111-4111-8111-111111111111',status:'review',plan_report:'Original plan',history:[{tokens:120,result:'review'}],unknown_extension:{keep:['all',0,false]}}],profiles:{implementation:{skill:'tdd',model:'gpt-6.1-sol',effort:'medium'}},opportunities:[{id:'proposal',status:'pending',extension:{source:'fixture'}}],future_config:{retain:true}};
 const original=JSON.stringify(legacy);writeFileSync(join(dir,'state.json'),original);
 let app=createMissionServer({dataDir:dir});await app.listen(0);
 try{
  const migrated=await state(app);assert.deepEqual(migrated.tasks,legacy.tasks);assert.deepEqual(migrated.opportunities,legacy.opportunities);assert.deepEqual(migrated.future_config,legacy.future_config);
  assert.equal(readFileSync(join(dir,'state.json'),'utf8'),original);
  assert.equal((await post(app,'/api/tasks/'+legacy.tasks[0].id,{title:'Updated mission'},'PATCH')).status,200);
  await app.close();app=createMissionServer({dataDir:dir});await app.listen(0);
  const current=await state(app);assert.equal(current.tasks.length,1);assert.equal(current.tasks[0].title,'Updated mission');assert.deepEqual(current.tasks[0].history,legacy.tasks[0].history);assert.deepEqual(current.tasks[0].unknown_extension,legacy.tasks[0].unknown_extension);
  assert.equal(missionContext(dir,dir).tasks[0].title,'Updated mission');
  writeFileSync(join(dir,'state.json'),JSON.stringify({...legacy,future_config:{legacy_writer:true}}));
  assert.equal((await post(app,'/api/tasks/'+legacy.tasks[0].id+'/run',{request_id:'mixed-version'})).status,409);
  assert.equal((await state(app)).tasks[0].title,'Updated mission');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('late events from an old execution cannot alter the next generation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-stale-events-')),children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
 try{
  const task=await(await post(app,'/api/tasks',spec(dir))).json();const path=`/api/tasks/${task.id}/run`;
  await post(app,path,{request_id:'generation-one'});children[0].emit('close',0);
  await post(app,path,{request_id:'generation-two'});
  children[0].stdout.write(JSON.stringify({type:'thread.started',thread_id:'stale-thread'})+'\n');children[0].emit('close',1);
  const running=(await state(app)).tasks[0];assert.equal(running.status,'running');assert.notEqual(running.thread_id,'stale-thread');assert.equal(running.attempt.generation,2);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('executor event IDs deduplicate usage and reject foreign attempt generations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-event-replay-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
 try{
  const task=await(await post(app,'/api/tasks',spec(dir))).json();await post(app,`/api/tasks/${task.id}/run`);
  const row={type:'turn.completed',event_id:'turn-1',usage:{input_tokens:100,output_tokens:20}};
  child.stdout.write(JSON.stringify(row)+'\n'+JSON.stringify(row)+'\n');
  child.stdout.write(JSON.stringify({...row,event_id:'foreign',generation:999})+'\n');
  assert.deepEqual((await state(app)).tasks[0].measurement.usage,{input_tokens:100,output_tokens:20,cached_input_tokens:0});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
