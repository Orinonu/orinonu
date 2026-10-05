import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTypesafeSettings,createLiveTypesafeSettings} from '../src/typesafe-settings.mjs';
import {readHarnessConfiguration} from '../bundles/fast-jev-compaction-codex/scripts/settings.mjs';
import {createMissionServer} from '../src/server.mjs';

test('MCP and compaction share private model configuration; unchanged reads preserve engine configuration',async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'nexo-shared-'));
  try{
    const options={dataDir,repositoryRoot:process.cwd(),environmentKey:'fixture-env'};
    const live=createLiveTypesafeSettings(options);assert.equal(live().model,'jev-latest');
    const settings=createTypesafeSettings(options);settings.update({jev_model:'jev-preview'});assert.equal(live().model,'jev-preview');
    const hook=await readHarnessConfiguration({dataDir,environmentKey:'fixture-env',loadModule:()=>import('../src/typesafe-settings.mjs')});
    assert.deepEqual(hook,{apiKey:'fixture-env',model:'jev-preview'});
    const fallback=await readHarnessConfiguration({environmentKey:'fixture-env',loadModule:()=>{throw Object.assign(new Error('absent'),{code:'ERR_MODULE_NOT_FOUND'});}});
    assert.deepEqual(fallback,{apiKey:'fixture-env'});
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

test('private configuration defaults to latest, preserves ENV and never exposes the key',()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'nexo-settings-'));
  try{
    const settings=createTypesafeSettings({dataDir,repositoryRoot:process.cwd(),environmentKey:'fixture-env'});
    assert.equal(settings.metadata().model,'jev-latest');assert.equal(settings.metadata().key_source,'environment');
    settings.update({jev_model:'jev-preview'});
    assert.equal(settings.credentials().apiKey,'fixture-env');
    assert(!JSON.stringify(settings.metadata()).includes('fixture-env'));
    assert(!readFileSync(join(dataDir,'private','typesafe-settings.json'),'utf8').includes('fixture-env'));
    assert.throws(()=>settings.update({typesafe_api_key:''}));
    assert.throws(()=>settings.update({jev_model:'https://untrusted.invalid'}));
    assert.equal(settings.metadata().model,'jev-preview');
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

test('Windows DPAPI survives restart without plaintext and explicit private key takes precedence', {skip:process.platform!=='win32'},()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'nexo-dpapi-'));const key='test-only-typesafe-credential';
  try{
    const options={dataDir,repositoryRoot:process.cwd(),environmentKey:'fixture-env'};
    const settings=createTypesafeSettings(options);settings.update({typesafe_api_key:key,jev_model:'jev-latest'});
    assert(!readFileSync(join(dataDir,'private','typesafe-settings.json'),'utf8').includes(key));
    const reloaded=createTypesafeSettings(options);assert.equal(reloaded.credentials().apiKey,key);assert.equal(reloaded.metadata().key_source,'private_store');
    assert(!JSON.stringify(reloaded.metadata()).includes(key));
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

test('settings endpoint enforces local Origin, preserves omitted credential, and shares Codex auth state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nexo-settings-http-'));
  const app=createMissionServer({dataDir:dir,apiKey:'test-env-credential',authController:{state:()=>({status:'chatgpt'}),cancel(){}}});
  await app.listen(0);
  try{
    let response=await fetch(app.url+'/api/settings');let state=await response.json();
    assert.equal(state.codex_auth.status,'chatgpt');assert.equal(state.typesafe.model,'jev-latest');assert(!JSON.stringify(state).includes('test-env-credential'));
    const update=(body,origin=app.url)=>fetch(app.url+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
    assert.equal((await update({jev_model:'jev-preview'},'https://outside.invalid')).status,403);
    response=await update({jev_model:'jev-preview'});assert.equal(response.status,200);state=await response.json();assert.equal(state.typesafe.key_source,'environment');assert.equal(state.typesafe.model,'jev-preview');
    assert.equal((await update({typesafe_api_key:''})).status,400);
    response=await fetch(app.url+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"typesafe_api_key":"test-secret-fragment" broken'});
    assert.equal(response.status,400);assert(!(await response.text()).includes('test-secret-fragment'));
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed protection is atomic and external exceptions cannot expose credentials',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nexo-settings-fail-'));
  const settings=createTypesafeSettings({dataDir:dir,repositoryRoot:process.cwd(),protect:()=>{throw new Error('fixture-secret-leak');}});
  const app=createMissionServer({dataDir:dir,apiKey:'',settingsController:settings});await app.listen(0);
  try{
    const response=await fetch(app.url+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({typesafe_api_key:'fixture-secret-leak',jev_model:'jev-preview'})});
    assert.equal(response.status,400);assert(!(await response.text()).includes('fixture-secret-leak'));assert.equal(settings.metadata().model,'jev-latest');assert.equal(settings.metadata().configured,false);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
