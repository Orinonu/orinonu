import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';

test('restart preserves foreign unknown execution isolation without acquiring its reservation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-startup-isolation-'));
 const id='5d4e3c5a-78bb-400d-9e0e-123456789abc',workspace=join(dir,'isolated');
 const seed={profiles:{implementation:{skill:'tdd',model:'gpt-6.1-sol',effort:'medium'}},tasks:[{id,title:'Interrupted isolated writer',workspace:dir,execution_workspace:workspace,goal:'Local change',acceptance:'Verified changes',status:'backlog',agent:'codex',profile:'implementation',max_minutes:1,queue:{id:'prior-queue',phase:'implementation',status:'queued'},implementation_workspace:{workspace,baseline:'preserved'},implementation_evidence:{changed_files:['src/file.mjs']}}]};
 const prior=createStore(dir,seed),db=prior.load();assert.equal(prior.claim(db,id),true);
 const task=db.tasks[0];prior.transition(task,'starting');prior.transition(task,'running',{pid:2147483600});task.status='running';task.queue=null;prior.save(db);const oldAttempt=task.attempt.id;prior.close();
 let app,launches=0;
 try{
  app=createMissionServer({dataDir:dir,codexPath:process.execPath,runner:()=>{launches++;throw Error('must never launch');}});await app.listen(0);
  const state=await(await fetch(app.url+'/api/state')).json(),current=state.tasks[0];
  assert.equal(current.status,'blocked');assert.equal(current.attempt.state,'outcome_unknown');assert.equal(current.attempt.id,oldAttempt);
  assert.equal(current.execution_workspace,workspace);assert.deepEqual(current.implementation_workspace,seed.tasks[0].implementation_workspace);assert.deepEqual(current.implementation_evidence,seed.tasks[0].implementation_evidence);
  assert.equal(state.scheduler.running.implementation,1);assert.equal(launches,0);
  assert.equal((await fetch(app.url+`/api/tasks/${id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,409);
 }finally{if(app)await app.close();try{rmSync(dir,{recursive:true,force:true});}catch{}}
});

