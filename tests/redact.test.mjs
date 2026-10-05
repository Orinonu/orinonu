import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {redact,createRedactor} from '../src/redact.mjs';
import {readPlanContract} from '../src/pipeline.mjs';
import {createMissionServer} from '../src/server.mjs';

// Every value below is a fictitious sentinel.
const SENTINELS=['hunter2-sentinel','ya29.FAKE-ACCESS-SENTINEL','1//0gFAKE-REFRESH-SENTINEL','sk-proj-FAKEFAKEFAKEFAKEFAKE01','ghp_FAKEFAKEFAKEFAKEFAKEFAKE01','AKIAFAKEFAKEFAKE0123','abcdef1234567890SENTINEL','AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12'];
const leaks=text=>SENTINELS.filter(value=>String(text).includes(value));

test('passwords, access and refresh tokens, authorization headers and known key shapes are removed',()=>{
 const text=['password=hunter2-sentinel','{"access_token":"ya29.FAKE-ACCESS-SENTINEL","refresh_token":"1//0gFAKE-REFRESH-SENTINEL"}','OPENAI=sk-proj-FAKEFAKEFAKEFAKEFAKE01','gh ghp_FAKEFAKEFAKEFAKEFAKEFAKE01','aws AKIAFAKEFAKEFAKE0123','Authorization: Bearer abcdef1234567890SENTINEL','api_key: "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12"','-----BEGIN PRIVATE KEY-----\nMIIFAKE\n-----END PRIVATE KEY-----'].join('\n');
 const clean=redact(text);
 assert.deepEqual(leaks(clean),[]);
 assert.doesNotMatch(clean,/MIIFAKE/);
 assert.match(clean,/\[redacted\]/);
});

test('non-sensitive evidence and numeric token fields survive redaction',()=>{
 const evidence='src/server.mjs:120 uses tokens (count=3); {"max_tokens":2048,"token_budget":50,"user":"ana"}';
 assert.equal(redact(evidence),evidence);
 assert.equal(redact(undefined),'');
});

test('a structured report stays a valid contract after redaction and keeps its non-sensitive steps',()=>{
 const plan='```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Log in with password=hunter2-sentinel','Edit file.txt'],verification:['Run the tests']})+'\n```';
 const clean=redact(plan);
 assert.deepEqual(leaks(clean),[]);
 const contract=readPlanContract(clean);
 assert.equal(contract.steps.length,2);
 assert.match(contract.steps[1].title??contract.steps[1],/Edit file\.txt/);
});

test('a secret split across output chunks is never emitted in pieces',()=>{
 const stream=createRedactor(500);
 const views=['start password=hun','ter2-sentinel done sk-proj-FAKEFAK','EFAKEFAKEFAKE01 end'].map(chunk=>stream.push(chunk));
 assert.deepEqual(leaks(views.at(-1)),[]);
 assert.match(views.at(-1),/done \[redacted\] end/);
 assert.equal(stream.text(),views.at(-1));
});

test('executor reports and diagnostics are persisted without credentials and the plan stays valid',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-redact-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'Redact',workspace:dir,goal:'Plan the change',acceptance:'A valid plan',agent:'codex',profile:'design',max_minutes:5})).json();
  assert.equal((await post(`/api/tasks/${task.id}/prepare`,{})).status,200);
  for(let n=0;n<200&&!child;n++)await new Promise(r=>setTimeout(r,10));
  const plan='Evidence token=hunter2-sentinel\n```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:false,pending_decisions:[],steps:['Use password=hunter2-sentinel'],verification:['Run the tests']})+'\n```';
  child.stderr.write('warn password=hun');child.stderr.write('ter2-sentinel leaked?');
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:plan}})+'\n');
  await fetch(app.url+'/api/state');child.emit('close',0);
  let current;for(let n=0;n<200;n++){current=(await(await fetch(app.url+'/api/state')).json()).tasks[0];if(current.status!=='planning')break;await new Promise(r=>setTimeout(r,10));}
  assert.deepEqual(leaks(JSON.stringify(current)),[]);
  assert.ok(current.plan_report.includes('```nexo-plan'));
  assert.ok(current.structured_plan);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
