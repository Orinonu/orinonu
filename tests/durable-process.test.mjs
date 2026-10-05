import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const post=(app,path,body={},method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const state=async app=>(await fetch(app.url+'/api/state')).json();
const spec=workspace=>({title:'OS competition',workspace,goal:'One execution',acceptance:'No duplicate spawn',agent:'codex',profile:'implementation',max_minutes:1});
async function supervisor(dir,fault=''){
 const child=fork(fileURLToPath(new URL('./fixtures/durable-supervisor.mjs',import.meta.url)),[dir,fault],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 const messages=[],waiters=[];let error='';child.stderr.on('data',chunk=>error+=chunk);
 child.on('message',row=>{messages.push(row);for(const notify of waiters.splice(0))notify();});
 const wait=async kind=>{const deadline=Date.now()+8000;while(!messages.some(m=>m.kind===kind)){if(Date.now()>deadline||child.exitCode!==null)throw Error(`Missing ${kind}: ${error}`);await new Promise(resolve=>{const timer=setTimeout(resolve,50);waiters.push(()=>{clearTimeout(timer);resolve();});});}return messages.find(m=>m.kind===kind);};
 const exited=new Promise(resolve=>child.once('exit',resolve));
 const ready=await wait('ready');
 return {child,url:ready.url,messages,wait,exited,async close(){if(child.exitCode===null){child.send('close');await exited;}}};
}
const kill=pid=>{try{process.kill(pid);}catch{}};

test('phase capacity is global across OS supervisors in independent workspaces',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-capacity-')),first=join(dir,'first'),second=join(dir,'second');mkdirSync(first);mkdirSync(second);
 const a=await supervisor(dir),b=await supervisor(dir);
 try{
  await post(a,'/api/scheduler',{implementation_limit:1},'PATCH');
  const task=await(await post(a,'/api/tasks',spec(first))).json();await post(a,`/api/tasks/${task.id}/run`,{request_id:'first'});await a.wait('executor-ready');
  const other=await(await post(b,'/api/tasks',spec(second))).json();await post(b,`/api/tasks/${other.id}/run`,{request_id:'second'});
  assert.equal((await state(b)).tasks.find(t=>t.id===other.id).queue.status,'queued');assert.equal(b.messages.filter(m=>m.kind==='spawn').length,0);
  await post(b,'/api/scheduler',{implementation_limit:2},'PATCH');await b.wait('executor-ready');
  assert.equal([...a.messages,...b.messages].filter(m=>m.kind==='spawn').length,2);
 }finally{await b.close();await a.close();for(const m of [...a.messages,...b.messages])if(m.kind==='spawn')kill(m.pid);rmSync(dir,{recursive:true,force:true});}
});

test('OS supervisors compete for one receipt and reserve overlapping workspaces globally',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-os-')),a=await supervisor(dir),b=await supervisor(dir);
 try{
  assert.notEqual(a.child.pid,b.child.pid);
  const task=await(await post(a,'/api/tasks',spec(dir))).json();
  const path=`/api/tasks/${task.id}/run`,body={request_id:'same-click',expected_revision:task.revision};
  const responses=await Promise.all([post(a,path,body),post(b,path,body)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.deepEqual(await responses[0].json(),await responses[1].json());
  const started=await Promise.race([a.wait('executor-ready'),b.wait('executor-ready')]);
  assert(Number.isInteger(started.pid));
  await post(b,'/api/scheduler',{implementation_limit:2},'PATCH');
  const nested=join(dir,'nested');mkdirSync(nested);
  const other=await(await post(b,'/api/tasks',spec(nested))).json();await post(b,`/api/tasks/${other.id}/run`,{request_id:'nested-writer'});
  assert.equal((await state(a)).tasks.find(t=>t.id===other.id).queue.status,'queued');
  assert.equal([...a.messages,...b.messages].filter(m=>m.kind==='spawn').length,1);
  assert.equal((await post(b,path,{request_id:'other-click'})).status,409);
 }finally{await b.close();await a.close();for(const m of [...a.messages,...b.messages])if(m.kind==='spawn')kill(m.pid);rmSync(dir,{recursive:true,force:true});}
});

for(const fault of ['selection','before-spawn','after-spawn'])test(`restart after ${fault} preserves uncertainty and never redispatches`,{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-crash-')),a=await supervisor(dir,fault);let b;
 try{
  const task=await(await post(a,'/api/tasks',spec(dir))).json();
  // A crash can lose the HTTP response; the durable intention still exists.
  try{await post(a,`/api/tasks/${task.id}/${fault==='selection'?'prepare':'run'}`,{request_id:'crash-intent'});}catch{}
  if(fault==='selection'){await a.wait('selecting');a.child.kill();}
  await a.exited;
  b=await supervisor(dir);
  const recovered=(await state(b)).tasks.find(t=>t.id===task.id);
  assert.equal(recovered.status,'blocked');assert.equal(recovered.attempt.state,'outcome_unknown');
  assert.equal((await post(b,`/api/tasks/${task.id}/run`,{request_id:'retry-new'})).status,409);
  assert.equal(b.messages.filter(m=>m.kind==='spawn').length,0);
  if(fault==='after-spawn'){const executor=a.messages.find(m=>m.kind==='spawn');process.kill(executor.pid,0);}
 }finally{if(a.child.exitCode===null)a.child.kill();if(b)await b.close();for(const m of a.messages)if(m.kind==='spawn')kill(m.pid);rmSync(dir,{recursive:true,force:true});}
});

test('cancelled OS executor keeps its reservation until remaining writers can be investigated',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-stop-')),a=await supervisor(dir);
 try{
  const task=await(await post(a,'/api/tasks',spec(dir))).json();await post(a,`/api/tasks/${task.id}/run`);await a.wait('executor-ready');
  assert.equal((await post(a,`/api/tasks/${task.id}/stop`)).status,200);await a.wait('executor-closed');
  const stopped=(await state(a)).tasks[0];assert.equal(stopped.status,'blocked');assert.equal(stopped.attempt.state,'outcome_unknown');
  await post(a,'/api/scheduler',{implementation_limit:2},'PATCH');
  const other=await(await post(a,'/api/tasks',spec(dir))).json();await post(a,`/api/tasks/${other.id}/run`);
  assert.equal((await state(a)).tasks.find(t=>t.id===other.id).queue.status,'queued');
  assert.equal(a.messages.filter(m=>m.kind==='spawn').length,1);
 }finally{await a.close();for(const m of a.messages)if(m.kind==='spawn')kill(m.pid);rmSync(dir,{recursive:true,force:true});}
});
