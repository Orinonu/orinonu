import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';

async function fixture(run,decisionEngine) {
 const dir=mkdtempSync(join(tmpdir(),'nexo-session-gates-')),children=[];
 const runner=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.emit('close',0);return true;};children.push(child);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,decisionEngine:decisionEngine??{call:async(_tool,input)=>({ok:true,action:'recommend',selected_id:input.options[0].id})}});
 await app.listen(0);
 const request=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=> (await fetch(app.url+'/api/state')).json();
 const create=async(workspace=dir)=>(await request('/api/tasks',{title:'Session gate',workspace,goal:'Verify scoped session work',acceptance:'Evidence preserved',profile:'design',agent:'codex',max_minutes:1})).json();
 try{await run({dir,children,request,state,create});}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
}
const session=(action,phase='planning')=>({action,phase,session_id:'test-session',owner:'test-owner',checklist:[{id:'verified',label:'Verified locally',done:true}]});

test('HTTP session claims protect nested writers, coexist for reads, and receipts take no lease',async()=>{
 await fixture(async({dir,children,request,state,create})=>{
  const nested=join(dir,'nested');mkdirSync(nested);
  const writer=await create(),other=await create(nested);
  assert.equal((await request(`/api/tasks/${writer.id}/session-work`,session('claim','implementation'))).status,200);
  assert.equal((await request(`/api/tasks/${other.id}/session-work`,session('claim'))).status,409);
  assert.equal((await request(`/api/tasks/${other.id}/run`,{})).status,409);
  const record=session('record','review');
  const response=await request(`/api/tasks/${other.id}/session-work`,record);assert.equal(response.status,200);
  const receipt=await response.json();assert.equal(receipt.status,'review');assert.equal(receipt.external_work.status,'ready_for_integration');
  assert.deepEqual((await(await request(`/api/tasks/${other.id}/session-work`,record)).json()).external_work,receipt.external_work);
  let snapshot=await state();assert.equal(snapshot.scheduler.running.implementation,1);assert.equal(snapshot.scheduler.running.review,0);assert.equal(children.length,0);
  assert.equal((await request(`/api/tasks/${writer.id}/session-work`,{...session('release'),outcome:'cancelled'})).status,200);
  assert.equal((await request(`/api/tasks/${writer.id}/session-work`,session('claim'))).status,200);
  assert.equal((await request(`/api/tasks/${other.id}/session-work`,session('claim'))).status,409);
  snapshot=await state();assert.equal(snapshot.scheduler.running.planning,1);assert.equal(children.length,0);
 });
});

test('JEV recommendation cannot overwrite a session claimed while the request is pending',async()=>{
 for(const action of ['plan','specialist']){
  let release,entered;const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const decisionEngine={call:async(_tool,input)=>{entered();return new Promise(resolve=>{release=()=>resolve({ok:true,action:'recommend',selected_id:input.options[0].id});});}};
  await fixture(async({request,state,create,children})=>{
   const task=await create();const pending=request(`/api/tasks/${task.id}/${action}`,{});
   await enteredPromise;
   assert.equal((await request(`/api/tasks/${task.id}/session-work`,session('claim'))).status,200);
   release();assert.ok((await pending).status>=400);
   const current=(await state()).tasks.find(row=>row.id===task.id);
   assert.equal(current.external_work.status,'active');assert.equal(current.profile,task.profile);assert.equal(current.specialist,task.specialist);assert.equal(children.length,0);
  },decisionEngine);
 }
});
