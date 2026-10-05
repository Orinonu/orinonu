import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordInstallation} from '../src/installation-info.mjs';
import {createHash} from 'node:crypto';
import {verifyEvalManifest} from '../src/evolution.mjs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {readInstallation} from '../src/updates.mjs';

test('installation records code provenance without private state, and edited installed code is detected',()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-install-'));
 try{
  mkdirSync(join(dir,'src'));mkdirSync(join(dir,'data'));writeFileSync(join(dir,'package.json'),JSON.stringify({version:'0.0.5'}));writeFileSync(join(dir,'src','sample.mjs'),'export const value=1;');writeFileSync(join(dir,'data','private.json'),'private fixture');
  const record=recordInstallation(dir,dir,{git:()=>({commit:'a'.repeat(40),branch:'main'})});
  assert.equal(record.commit,'a'.repeat(40));assert.equal(record.version,'0.0.5');assert.ok(record.files['src/sample.mjs']);assert.equal(record.files['data/private.json'],undefined);
  assert.equal(readInstallation(dir).dirty,false);writeFileSync(join(dir,'src','sample.mjs'),'export const value=2;');assert.equal(readInstallation(dir).dirty,true);
  assert.doesNotMatch(readFileSync(join(dir,'installation.json'),'utf8'),/private fixture/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('installation provenance includes immutable evaluation artifacts and detects subsequent edits',()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-install-evals-'));
 try{
  mkdirSync(join(dir,'evals'));
  writeFileSync(join(dir,'package.json'),JSON.stringify({version:'0.0.5'}));
  const fixture='{"cases":["local"]}\n',hash=createHash('sha256').update(fixture).digest('hex');
  writeFileSync(join(dir,'evals','fixtures.json'),fixture);
  writeFileSync(join(dir,'evals','MANIFEST.json'),JSON.stringify({files:{'fixtures.json':hash}}));
  const record=recordInstallation(dir,dir,{git:()=>({commit:'b'.repeat(40),branch:'main'})});
  assert.ok(record.files['evals/MANIFEST.json']);
  assert.equal(record.files['evals/fixtures.json'],hash);
  assert.equal(verifyEvalManifest(join(dir,'evals')).valid,true);
  assert.equal(readInstallation(dir).dirty,false);
  writeFileSync(join(dir,'evals','fixtures.json'),'altered fixture');
  assert.equal(verifyEvalManifest(join(dir,'evals')).valid,false);
  assert.equal(readInstallation(dir).dirty,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

const evalFixture=(root,text)=>{
 mkdirSync(join(root,'evals'),{recursive:true});
 writeFileSync(join(root,'evals','fixtures.json'),text);
 writeFileSync(join(root,'evals','MANIFEST.json'),JSON.stringify({files:{'fixtures.json':createHash('sha256').update(text).digest('hex')}}));
};
async function promotionFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'orinonu-promotion-')),source=join(dir,'source'),installed=join(dir,'installed'),data=join(dir,'state');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(source,'scripts'),{recursive:true});mkdirSync(join(source,'src'));
 writeFileSync(join(source,'package.json'),JSON.stringify({version:'0.0.5',type:'module'}));
 for(const file of ['scripts/promote-autonomy.ps1','scripts/record-installation.mjs','src/installation-info.mjs','src/evolution.mjs','src/server.mjs','src/decisions.mjs','src/stall.mjs','src/breaker.mjs','src/receipts.mjs'])writeFileSync(join(source,file),readFileSync(new URL('../'+file,import.meta.url)));
 evalFixture(source,'new immutable benchmark');
 const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 return {source,installed,data,run:()=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(source,'scripts','promote-autonomy.ps1'),'-InstalledRoot',installed,'-DataRoot',data,'-ApiPort',String(port),'-SkipTests','-NoRestart'],{encoding:'utf8',timeout:30000,windowsHide:true})};
}

test('promotion copies and verifies evaluation artifacts in a clean isolated installation',{skip:process.platform!=='win32'},async t=>{
 const f=await promotionFixture(t),result=f.run();
 assert.equal(result.status,0,result.stderr);
 assert.equal(verifyEvalManifest(join(f.installed,'evals')).valid,true);
 assert.equal(readFileSync(join(f.installed,'evals','fixtures.json'),'utf8'),'new immutable benchmark');
 assert.ok(JSON.parse(readFileSync(join(f.installed,'installation.json'),'utf8')).files['evals/fixtures.json']);
});

test('failed promotion restores the prior evaluation manifest and dataset before returning an error',{skip:process.platform!=='win32'},async t=>{
 const f=await promotionFixture(t);
 mkdirSync(f.installed);writeFileSync(join(f.installed,'package.json'),JSON.stringify({version:'0.0.5',type:'module'}));evalFixture(f.installed,'previous immutable benchmark');
 const script=join(f.source,'scripts','record-installation.mjs');
 writeFileSync(script,'import {writeFileSync} from "node:fs";\nif(process.argv[2]!=="--verify-evals")writeFileSync(process.argv[3]+"/evals/fixtures.json","tampered fixture");\n'+readFileSync(script,'utf8'));
 const result=f.run();
 assert.notEqual(result.status,0);
 assert.match(result.stdout,/rolling back to the backup/);
 assert.equal(readFileSync(join(f.installed,'evals','fixtures.json'),'utf8'),'previous immutable benchmark');
 assert.equal(verifyEvalManifest(join(f.installed,'evals')).valid,true);
});
