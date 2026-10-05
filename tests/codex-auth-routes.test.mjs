import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
test('subscription connection routes expose sanitized controller state and preserve API authentication',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-auth-route-'));let probes=0,starts=0,cancels=0;
 const authController={state:()=>({status:'api_key',login:{status:'idle'}}),probe:async()=>{probes++;return authController.state();},start:async()=>{starts++;return {...authController.state(),action:'manual_login_required'};},cancel:()=>{cancels++;return authController.state();}};
 const app=createMissionServer({dataDir:dir,apiKey:'',authController,subscriptionOnly:true});await app.listen(0);
 const post=async path=>(await fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
 try{
  assert.equal((await post('/api/codex/auth/refresh')).status,'api_key');
  assert.equal((await post('/api/codex/auth/connect')).action,'manual_login_required');
  assert.equal((await post('/api/codex/auth/cancel')).status,'api_key');
  const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.codex_auth.subscription_only,true);assert.equal(probes,2);assert.equal(starts,1);assert.equal(cancels,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('subscription-only dispatch blocks API-key sessions before JEV or executor calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-auth-block-'));let decisions=0,executions=0;
 const authController={state:()=>({status:'api_key',login:{status:'idle'}}),probe:async()=>authController.state(),cancel:()=>authController.state()};
 const app=createMissionServer({dataDir:dir,apiKey:'',codexPath:process.execPath,subscriptionOnly:true,authController,decisionEngine:{call:async()=>{decisions++;throw Error('must not run');}},runner:()=>{executions++;throw Error('must not run');}});await app.listen(0);
 const post=async(path,body)=>(await fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
 try{
  const task=await post('/api/tasks',{title:'Test',goal:'Test',acceptance:'Tests',workspace:dir,agent:'codex',profile:'implementation',max_minutes:1});
  await post(`/api/tasks/${task.id}/prepare`,{auto_implement:true});
  await new Promise(resolve=>setTimeout(resolve,20));
  const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.tasks[0].status,'blocked');assert.match(state.tasks[0].error,/assinatura/);assert.equal(decisions,0);assert.equal(executions,0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
