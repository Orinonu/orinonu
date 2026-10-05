import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUpdateChecker,readInstallation} from '../src/updates.mjs';

const installed={version:'0.0.5',commit:'a'.repeat(40),branch:'main',dirty:false};
const response=value=>({ok:true,status:200,json:async()=>value});
const main='b'.repeat(40);
const packageResponse=()=>response({encoding:'base64',content:Buffer.from(JSON.stringify({version:'0.0.5'})).toString('base64')});
const fetcher=(compare={status:'ahead',ahead_by:8,behind_by:0})=>async url=>url.includes('/compare/')?response(compare):url.includes('/contents/')?packageResponse():response({sha:main});

test('new main commits are distance, not an automatic release increment; GitHub comparison directions are translated correctly',async()=>{
 const checker=createUpdateChecker({getInstallation:()=>installed,fetcher:fetcher()});
 const result=await checker.check();
 assert.equal(result.behind,8);assert.equal(result.ahead,0);assert.equal(result.status,'update_available');
 assert.equal(result.installed.version,'0.0.5');assert.equal(result.latest.version,'0.0.5');assert.equal(result.latest.commit,main);
});

test('divergence and local changes cannot be presented as a safe fast-forward update',async()=>{
 const diverged=await createUpdateChecker({getInstallation:()=>installed,fetcher:fetcher({status:'diverged',ahead_by:3,behind_by:2})}).check();
 assert.equal(diverged.status,'diverged');assert.equal(diverged.behind,3);assert.equal(diverged.ahead,2);
 const changed=await createUpdateChecker({getInstallation:()=>({...installed,dirty:true}),fetcher:fetcher()}).check();
 assert.equal(changed.status,'local_changes');
});

test('missing provenance and offline or invalid responses remain unknown without fabricated commit counts',async()=>{
 const untracked=await createUpdateChecker({getInstallation:()=>({...installed,commit:null}),fetcher:fetcher()}).check();
 assert.equal(untracked.status,'untracked');assert.equal(untracked.behind,null);
 for(const fn of [async()=>{throw new Error('private transport text');},async()=>response({sha:'invented'})]){
  const result=await createUpdateChecker({getInstallation:()=>installed,fetcher:fn}).check();
  assert.equal(result.status,'unavailable');assert.equal(result.behind,null);assert.doesNotMatch(JSON.stringify(result),/private transport text/);
 }
});

test('checking main is read-only, single-flight and restricted to the official public repository',async()=>{
 let calls=0;
 const checker=createUpdateChecker({getInstallation:()=>installed,fetcher:async url=>{calls++;assert.ok(url.startsWith('https://api.github.com/repos/Orinonu/orinonu/'));return fetcher()(url);}});
 const [a,b]=await Promise.all([checker.check(),checker.check()]);assert.deepEqual(a,b);assert.equal(calls,3);
 assert.equal(checker.status().behind,8);
});

test('cached distances are invalidated when the installed commit changes',async()=>{
 let current=installed;
 const checker=createUpdateChecker({getInstallation:()=>current,fetcher:fetcher()});await checker.check();
 current={...installed,commit:main};
 assert.equal(checker.status().status,'not_checked');assert.equal(checker.status().behind,null);
});

test('installed provenance is explicit; a non-Git source is not attributed an invented commit',()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-version-'));
 try{
  writeFileSync(join(dir,'package.json'),JSON.stringify({version:'0.0.5'}));
  assert.equal(readInstallation(dir).commit,null);
  writeFileSync(join(dir,'installation.json'),JSON.stringify({version:'0.0.5',commit:installed.commit,branch:'main',files:{}}));
  assert.equal(readInstallation(dir).commit,installed.commit);
  writeFileSync(join(dir,'installation.json'),JSON.stringify({version:'0.0.5',commit:'invalid'}));
  assert.equal(readInstallation(dir).commit,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
