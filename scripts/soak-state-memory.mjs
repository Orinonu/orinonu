import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createMissionServer} from '../src/server.mjs';
import {historyFixture,writeHistoryFixture} from '../tests/fixtures/state-history.mjs';

if(!global.gc)throw new Error('Run with --expose-gc.');
const results=[];
for(const historyVerification of ['bytes','digest']){
 const dir=mkdtempSync(join(tmpdir(),'nexo-state-soak-'));
 let fixture=historyFixture(100000);writeHistoryFixture(dir,fixture);fixture=null;global.gc();
 const app=createMissionServer({dataDir:dir,apiKey:'',codexPath:null,hermesPath:null,historyVerification});await app.listen(0);
 const request=async()=>{const response=await fetch(app.url+'/api/state');assert.equal(response.status,200);await response.json();};
 try{
  for(let i=0;i<50;i++)await request();global.gc();
  const baseline=app.historyDiagnostics(),samples=[{requests:50,memory:process.memoryUsage()}];
  for(let batch=0;batch<5;batch++){
   for(let i=0;i<100;i++)await request();global.gc();
   samples.push({requests:150+batch*100,memory:process.memoryUsage()});
  }
  assert.deepEqual(app.historyDiagnostics(),baseline,'Fixed history must require no new parsing or projections.');
  const heap=samples.map(s=>s.memory.heapUsed),spread=Math.max(...heap)-Math.min(...heap);
  // A finite soak cannot prove absence of every leak. This bound catches retained
  // response/history copies rather than enforcing allocator-specific RSS behavior.
  assert.ok(spread<2*1024*1024,`Retained heap spread ${spread} exceeds 2 MiB`);
  results.push({policy:historyVerification,node:process.version,events:100000,tasks:100,requests:550,heap_spread_bytes:spread,samples,work:baseline});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});global.gc();}
}
writeFileSync(process.argv[2]??'docs/state-memory-soak.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({policy:r.policy,requests:r.requests,heap_spread_bytes:r.heap_spread_bytes})),null,2));
