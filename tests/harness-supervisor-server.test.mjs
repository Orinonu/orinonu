import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
const tick=()=>new Promise(r=>setTimeout(r,10));
test('terminal completion persists campaign, proposes research and polling/restart never repeats JEV',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-harness-'));let child,calls=0;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const decisionEngine={call:async(_tool,input)=>{if(input.options.some(o=>o.id==='measurement'))calls++;return {ok:true,action:'recommend',selected_id:input.options[0].id};}};
 let app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,decisionEngine});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 try{
  const task=await(await post('/api/tasks',{title:'Observe',workspace:dir,goal:'Inspect project',acceptance:'Evidence collected',agent:'codex',profile:'discovery',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/prepare`,{});for(let i=0;i<40&&!child;i++)await tick();assert(child);
  child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:17,output_tokens:3}})+'\n');
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Plan with evidence.'}})+'\n');
  await state();child.emit('close',0);child.emit('close',0);await tick();
  let result=await state();assert.equal(result.harness_research.campaigns.length,1);assert.equal(result.harness_research.campaigns[0].status,'proposed');assert.equal(result.harness_research.campaigns[0].observation.total_tokens,20);assert.equal(calls,1);
  assert.equal(result.opportunities.filter(o=>o.source==='harness_supervisor').length,1);
  for(let i=0;i<3;i++)await state();assert.equal(calls,1);
  await app.close();app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,decisionEngine});await app.listen(0);
  result=await state();assert.equal(result.harness_research.campaigns.length,1);assert.equal(result.harness_research.campaigns[0].status,'proposed');assert.equal(calls,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
