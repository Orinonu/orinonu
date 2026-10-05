import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';

test('stdin failure with a spawned PID retains an uncertain writer reservation despite zero/nonzero close',async()=>{
 for(const exitCode of [0,1]){
  const dir=mkdtempSync(join(tmpdir(),'nexo-input-uncertain-'));let launches=0,kills=0;
  const runner=()=>{launches++;const child=new EventEmitter();child.pid=2147483600;child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.end=()=>{throw new Error('test input transport failure');};child.kill=()=>{kills++;child.emit('close',exitCode);return true;};return child;};
  const id='3118f48b-7267-45e1-87d8-de50a1226795';
  writeFileSync(join(dir,'state.json'),JSON.stringify({profiles:{implementation:{skill:'tdd',model:'gpt-6.1-sol',effort:'medium'}},tasks:[{id,title:'Input uncertainty',workspace:dir,goal:'Verified local change',acceptance:'Tests pass',profile:'implementation',agent:'codex',max_minutes:1,status:'backlog',plan_report:'Verified bounded context. '.repeat(3000)}]}));
  const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
  const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
   const task={id};
   await post(`/api/tasks/${task.id}/run`,{});
   let snapshot;for(let n=0;n<100;n++){snapshot=await(await fetch(app.url+'/api/state')).json();if(snapshot.tasks[0].status==='blocked')break;await new Promise(resolve=>setTimeout(resolve,10));}
   const current=snapshot.tasks[0];assert.equal(current.status,'blocked');assert.equal(current.attempt.state,'outcome_unknown');assert.match(current.error,/stdin/);assert.equal(snapshot.scheduler.running.implementation,1);assert.equal(kills,1);
   assert.equal((await post(`/api/tasks/${task.id}/run`,{})).status,409);
   assert.equal((await post(`/api/tasks/${task.id}/session-work`,{action:'record',phase:'review',session_id:'receipt',owner:'tester',checklist:[{id:'done',label:'Done',done:true}]})).status,409);
   assert.equal(launches,1);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
 }
});
