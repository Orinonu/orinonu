import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {schedulerLimits,admissibleQueue} from '../src/queue.mjs';
import {createMissionServer} from '../src/server.mjs';
test('new installations default to seven workers in each phase, without weakening workspace isolation',()=>{
 assert.deepEqual(schedulerLimits(),{planning_limit:7,implementation_limit:7,review_limit:7});
 for(const phase of ['planning','implementation','review']){
  const tasks=Array.from({length:8},(_,i)=>({id:String(i),workspace:'C:/repo-'+i,queue:{phase,status:'queued',enqueued_at:String(i)}}));
  assert.equal(admissibleQueue(tasks,[],schedulerLimits()).length,7);
 }
 const shared=[0,1].map(i=>({id:String(i),workspace:'C:/shared',queue:{phase:'implementation',status:'queued',enqueued_at:String(i)}}));
 assert.equal(admissibleQueue(shared,[],schedulerLimits()).length,1);
});
test('saved limits override defaults independently and inputs are not mutated',()=>{
 const saved={planning_limit:3,implementation_limit:2,review_limit:1};
 assert.deepEqual(schedulerLimits(saved),saved);
 assert.deepEqual(schedulerLimits({implementation_limit:4}),{planning_limit:7,implementation_limit:4,review_limit:7});
 const fresh=schedulerLimits();fresh.planning_limit=1;assert.equal(schedulerLimits().planning_limit,7);
});
test('native scheduler controls use the server values instead of inventing missing limits',async()=>{
 const source=await readFile(new URL('../frontend/src/components/native-operations.tsx',import.meta.url),'utf8');
 assert.match(source,/scheduler\?\.\[.*phase.*_limit/);
 assert.match(source,/todos os projetos desta instalação/);
});
test('server starts with seven and keeps operator limits after a restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-default-queue-'));
 let app;
 try{
  app=createMissionServer({dataDir:dir,apiKey:'',codexPath:process.execPath});await app.listen(0);
  let state=await(await fetch(app.url+'/api/state')).json();
  for(const phase of ['planning','implementation','review'])assert.equal(state.scheduler[phase+'_limit'],7);
  const saved={planning_limit:3,implementation_limit:2,review_limit:1};
  assert.equal((await fetch(app.url+'/api/scheduler',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(saved)})).status,200);
  await app.close();app=null;
  app=createMissionServer({dataDir:dir,apiKey:'',codexPath:process.execPath});await app.listen(0);
  state=await(await fetch(app.url+'/api/state')).json();
  for(const [key,value] of Object.entries(saved))assert.equal(state.scheduler[key],value);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
