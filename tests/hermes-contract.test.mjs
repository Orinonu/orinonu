import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HERMES_CONTRACT,HERMES_PROVIDER,HERMES_REQUIRED_ARGS,defaultHermesCli,verifyHermes} from '../src/hermes.mjs';
import {createMissionServer} from '../src/server.mjs';
import {createQuotaTracker} from '../src/quota-tracker.mjs';
// Probes a fake hermes binary: spawnSync result per argv.
function fakeRun({version='Hermes Agent v0.21.4',help,auth={}}={}){
 const helpText=help??'--query-file --oneshot --format stream-json --max-turns --in --source --resume --run-budget';
 const calls=[];
 const run=(file,args)=>{
  calls.push(args);
  if(args[0]==='--version')return {status:0,stdout:version+'\n',stderr:''};
  if(args[0]==='chat'&&args.includes('--help'))return {status:0,stdout:helpText,stderr:''};
  if(args[0]==='auth'&&args[1]==='status'){const p=args[2];return {status:0,stdout:(auth[p]??'not logged in')+'\n',stderr:''};}
  return {status:1,stdout:'',stderr:'unknown command'};
 };
 return {run,calls};
}

test('verifyHermes verifies binary, required chat flags and the pooled credential status',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-verify-'));const bin=join(dir,'hermes.exe');writeFileSync(bin,'');
 try{
  const {run,calls}=fakeRun({auth:{'openai-codex':'openai-codex: logged in'}});
  const v=verifyHermes({hermesPath:bin,run,ttlMs:0});
  assert.equal(v.ok,true);assert.equal(v.version,'0.21.4');assert.equal(v.provider,HERMES_PROVIDER);assert.equal(v.logged_in,true);
  assert.deepEqual(v.missing_flags,[]);
  assert.ok(calls.some(a=>a[0]==='chat'&&a.includes('--help')),'capability probe reads the real chat surface');
  assert.ok(calls.some(a=>a[0]==='auth'&&a[1]==='status'&&a[2]==='openai-codex'),'auth probe targets the configured provider');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('verifyHermes fails closed: missing binary, missing flag, or credential not logged in',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-verify-bad-'));const bin=join(dir,'hermes.exe');writeFileSync(bin,'');
 try{
  assert.equal(verifyHermes({hermesPath:join(dir,'absent.exe'),run:fakeRun().run,ttlMs:0}).ok,false);
  const noFlag=verifyHermes({hermesPath:bin,run:fakeRun({help:'--oneshot only'}).run,ttlMs:0});
  assert.equal(noFlag.ok,false);assert.ok(noFlag.missing_flags.includes('--query-file'));
  const noAuth=verifyHermes({hermesPath:bin,run:fakeRun({auth:{}}).run,ttlMs:0});
  assert.equal(noAuth.ok,false);assert.equal(noAuth.logged_in,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the Hermes contract records signal cancellation, durable session and no approval bypass',()=>{
 assert.equal(HERMES_CONTRACT.cancellation,'signal');
 assert.equal(HERMES_CONTRACT.durable_session,'--resume');
 assert.equal(HERMES_CONTRACT.approval_bypass,false);
 assert.ok(HERMES_CONTRACT.usage_fields.includes('input')&&HERMES_CONTRACT.usage_fields.includes('output'));
 assert.ok(HERMES_REQUIRED_ARGS.includes('--query-file')&&HERMES_REQUIRED_ARGS.includes('--resume'));
});

const okVerify=()=>({ok:true,verified_at:'2026-10-05T04:00:00.000Z',version:'0.21.4',provider:HERMES_PROVIDER,logged_in:true,missing_flags:[]});

test('a Hermes mission dispatches in the default policy only when the executor verifies',async()=>{
 for(const verified of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-gate-'));const children=[];let spawned;
  const runner=(file,args)=>{spawned={file,args};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
  const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,hermesPath:process.execPath,hermesVerify:verified?okVerify:()=>({ok:false,detail:'auth status: not logged in'})});
  await app.listen(0);
  try{
   const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const created=await post('/api/tasks',{title:'Hermes gate',workspace:dir,goal:'Implement locally',acceptance:'Verified change',agent:'hermes',profile:'implementation',max_minutes:1});
   if(!verified){
    assert.equal(created.status,400,'an unverified Hermes is refused at admission, not queued');
    assert.equal(children.length,0);
   }else{
    const task=await created.json();
    const run=await post(`/api/tasks/${task.id}/run`,{});
    const state=await(await fetch(app.url+'/api/state')).json();const row=state.tasks.find(t=>t.id===task.id);
    assert.equal(run.status,200);assert.ok(spawned,'executor spawned');
    assert.ok(spawned.args.includes('--query-file'),'hermes chat invocation');
    assert.equal(row.executor_verification.ok,true);
    assert.equal(row.executor_contract.cancellation,'signal');
    assert.equal(row.executor_contract.approval_bypass,false);
   }
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('the effective model reported by the event stream is recorded on the mission measurement',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-model-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,hermesPath:process.execPath,hermesVerify:okVerify});
 await app.listen(0);
 try{
  const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const task=await(await post('/api/tasks',{title:'Modelo efetivo',workspace:dir,goal:'Implement locally',acceptance:'Verified change',agent:'hermes',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/run`,{});
  child.stdout.write(JSON.stringify({type:'system',session_id:'s-1',model:'anthropic/claude-real'})+'\n');
  child.stdout.write(JSON.stringify({type:'result',exit_code:0,session_id:'s-1',model:'anthropic/claude-real',text:'done',tokens:{input:9,output:2}})+'\n');
  child.emit('close',0);
  await new Promise(r=>setTimeout(r,150));
  const state=await(await fetch(app.url+'/api/state')).json();
  const row=state.tasks.find(t=>t.id===task.id);
  assert.equal(row.actual_model,'anthropic/claude-real');
  assert.equal(row.measurement.effective_model,'anthropic/claude-real','modelo efetivo registrado na medição');
  assert.deepEqual(row.measurement.usage,{input_tokens:9,output_tokens:2,cached_input_tokens:0},'uso do resultado terminal registrado');
  assert.equal(row.status,'review');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('quota eligibility treats Hermes as eligible only when verified',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-quota-'));mkdirSync(join(dir,'private'),{recursive:true});
 try{
  const cli=join(dir,'hermes.exe');writeFileSync(cli,'');
  const trackerOk=createQuotaTracker({hermesPath:cli,hermesProbe:()=>({ok:true})});
  const trackerBad=createQuotaTracker({hermesPath:cli,hermesProbe:()=>({ok:false})});
  const trackerAbsent=createQuotaTracker({hermesPath:join(dir,'none.exe'),hermesProbe:()=>({ok:true})});
  assert.equal(trackerOk.isEligible('hermes'),true);
  assert.equal(trackerBad.isEligible('hermes'),false);
  assert.equal(trackerAbsent.isEligible('hermes'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('defaultHermesCli resolves the installed binary location',()=>{
 assert.match(defaultHermesCli({LOCALAPPDATA:'C:/x'}),/hermes[\\/]bin[\\/]hermes\.exe$/i);
 assert.equal(typeof defaultHermesCli(),'string');
});
