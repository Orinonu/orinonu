import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
test('opportunities require approval, preserve evidence and never start an executor',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-opportunities-'));let launches=0;
 const app=createMissionServer({dataDir:dir,apiKey:'',runner:()=>{launches++;throw new Error('unexpected');}});await app.listen(0);
 const post=async(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const response=await post('/api/opportunities/scan',{workspace:dir});assert.equal(response.status,200);
  const queue=await response.json();assert.ok(queue.length>0);assert.ok(queue[0].evidence.length>0);
  let state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.tasks.length,0);
  const approved=await post(`/api/opportunities/${queue[0].id}/approve`,{});assert.equal(approved.status,201);
  const task=await approved.json();assert.equal(task.status,'backlog');assert.equal(task.agent,'codex');assert.equal(task.specialist,'opportunity-analyst');
  assert.equal((await post(`/api/opportunities/${queue[0].id}/approve`,{})).status,409);
  assert.equal(launches,0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
