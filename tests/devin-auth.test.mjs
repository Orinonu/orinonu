import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDevinAuth,devinCliLoggedIn} from '../src/devin-auth.mjs';
import {createAntigravityAuth} from '../src/antigravity-auth.mjs';

test('an installed editor with a CLI that is not logged in is reported as unauthenticated, with the exact action',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-devin-auth-')),cli=join(dir,'devin.exe');writeFileSync(cli,'');
 try{
  const out=createDevinAuth({env:{},executablePath:cli,cliPath:cli,cliLogin:()=>false,planExpiry:'2999-01-01T00:00:00Z'}).state();
  assert.equal(out.status,'unauthenticated');assert.equal(out.cli_authenticated,false);assert.match(out.detail,/devin auth login/);
  const ok=createDevinAuth({env:{},executablePath:cli,cliPath:cli,cliLogin:()=>true,planExpiry:'2999-01-01T00:00:00Z'}).state();
  assert.notEqual(ok.status,'unauthenticated');assert.equal(ok.cli_authenticated,true);
  const unknown=createDevinAuth({env:{},executablePath:cli,cliPath:cli,cliLogin:()=>null,planExpiry:'2999-01-01T00:00:00Z'}).state();
  assert.equal(unknown.cli_authenticated,null);assert.notEqual(unknown.status,'unauthenticated');
  const expired=createDevinAuth({env:{},executablePath:cli,cliPath:cli,cliLogin:()=>false,planExpiry:'2000-01-01T00:00:00Z'}).state();
  assert.equal(expired.status,'expired');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a configured token cannot bypass a failed CLI login and new installations have no invented expiry',()=>{
 const providerSettings={credentials:()=>({key:'SENTINEL_FAKE_KEY',model:'devin-2.0'})};
 const auth=createDevinAuth({providerSettings,env:{},executablePath:null,cliPath:process.execPath,cliLogin:()=>false});
 const out=auth.state();
 assert.equal(out.cli_authenticated,false);
 assert.equal(out.verification.cli_authenticated,false);
 assert.equal(out.status,'unauthenticated');
 assert.equal(out.plan_active_until,null);
 assert.equal(out.days_remaining,null);
});

test('configured credentials and a local expiration policy are not presented as verified CLI or subscription facts',()=>{
 const providerSettings={credentials:()=>({key:'SENTINEL_FAKE_KEY',model:'devin-2.0'})};
 const out=createDevinAuth({providerSettings,executablePath:null,cliPath:null,cliLogin:()=>{throw Error('no real probe');},planExpiry:'2999-01-01T00:00:00Z',env:{}}).state();
 assert.equal(out.verification.credential_configured,true);
 assert.equal(out.verification.cli_authenticated,null);
 assert.equal(out.verification.subscription_expires_at,null);
 assert.equal(out.plan_active_until_source,'local_policy');
 assert.doesNotMatch(out.detail,/Plano.*ativo|autenticado com token/i);
 assert.doesNotMatch(JSON.stringify(out),/SENTINEL_FAKE_KEY/);
});

test('connect adapters forward canonical keys while keeping configured credentials separate from verification',()=>{
 const sentinel='SENTINEL_FAKE_CONNECT_KEY';
 for(const [id,createAuth,options,request] of [
  ['devin',createDevinAuth,{cliPath:null},{api_key:sentinel,model:'windsurf-cascade'}],
  ['devin',createDevinAuth,{cliPath:null},{token:sentinel,model:'devin-2.0'}],
  ['antigravity',createAntigravityAuth,{}, {api_key:sentinel,model:'gemini-2.5-pro'}],
 ]){
  let key='',model='',updates=0;
  const providerSettings={credentials:()=>({key,model}),update:payload=>{
   updates++;
   assert.deepEqual(payload,{providers:{[id]:{enabled:true,key:sentinel,model:request.model}}});
   key=payload.providers[id].key;
   model=payload.providers[id].model;
  }};
  const auth=createAuth({providerSettings,env:{},executablePath:null,...options});
  const out=auth.connect(request);
  assert.equal(updates,1);
  assert.equal(out.verification.credential_configured,true);
  assert.equal(out.verification.subscription_expires_at,null);
  assert.equal(id==='devin'?out.verification.cli_authenticated:out.verification.authenticated,null);
  assert.equal(out.verification.checked_at??null,null);
  assert.doesNotMatch(out.detail,/Plano.*ativo|autenticado com token/i);
  assert.match(out.detail,id==='devin'?/não comprova/i:/não foram verificadas/i);
  assert.doesNotMatch(JSON.stringify(out),/SENTINEL_FAKE_CONNECT_KEY/);
 }
});

test('verified CLI login never substitutes for observed subscription expiry',()=>{
 const providerSettings={credentials:()=>({key:'',model:'devin-2.0'})};
 const out=createDevinAuth({providerSettings,env:{},executablePath:null,cliPath:process.execPath,cliLogin:()=>true,planExpiry:'2999-01-01T00:00:00Z'}).state();
 assert.equal(out.status,'authenticated');
 assert.equal(out.verification.cli_authenticated,true);
 assert.equal(out.verification.subscription_expires_at,null);
 assert.equal(out.plan_active_until_source,'local_policy');
 assert.match(out.detail,/validade da assinatura não foi observada/i);
});

test('CLI authentication caching never transfers login evidence between binaries',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-cli-cache-scope-')),a=join(dir,'a.exe'),b=join(dir,'b.exe');writeFileSync(a,'');writeFileSync(b,'');
 try{
  assert.equal(devinCliLoggedIn(a,{now:1000000,run:()=>({status:0,stdout:'Logged in',stderr:''})}),true);
  assert.equal(devinCliLoggedIn(b,{now:1000001,run:()=>({status:1,stdout:'Not logged in',stderr:''})}),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the CLI login answer is read from `auth status`, cached briefly, and absent CLIs are unknown',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-devin-cli-')),cli=join(dir,'devin.exe');writeFileSync(cli,'');
 try{
  let calls=0;const reply=result=>(...args)=>{calls++;assert.deepEqual(args[1],['auth','status']);return result;};
  assert.equal(devinCliLoggedIn(cli,{now:1000,run:reply({status:1,stdout:'Not logged in.',stderr:''})}),false);
  assert.equal(devinCliLoggedIn(cli,{now:2000,run:reply({status:0,stdout:'Logged in',stderr:''})}),false,'cached inside the ttl');
  assert.equal(calls,1);
  assert.equal(devinCliLoggedIn(cli,{now:100000,run:reply({status:0,stdout:'Logged in as me',stderr:''})}),true);
  assert.equal(devinCliLoggedIn(cli,{now:300000,run:reply({status:0,stdout:'Not logged in.',stderr:''})}),false);
  assert.equal(devinCliLoggedIn(cli,{now:600000,run:reply({status:null,error:new Error('timeout'),stdout:'',stderr:''})}),null);
  assert.equal(devinCliLoggedIn(join(dir,'missing.exe'),{now:900000,run:()=>{throw new Error('must not run');}}),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
