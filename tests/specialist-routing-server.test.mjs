import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
for(const operation of ['plan','specialist'])for(const abstain of [false,true])test(`${operation} routes bounded hierarchy and preserves assignment on abstention=${abstain}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-specialists-')),calls=[];
 const decisionEngine={call:async(tool,input)=>{
  assert(input.options.length>=2&&input.options.length<=12);calls.push(input.options.map(o=>o.id));
  if(input.options.some(o=>o.id==='ui-design-lead')&&!input.options.some(o=>o.id==='ux-designer'))return {ok:true,action:'recommend',selected_id:'ui-design-lead'};
  if(input.options.some(o=>o.id==='ux-designer'))return abstain?{ok:true,action:'abstain',reason:'evidence missing'}:{ok:true,action:'recommend',selected_id:'ux-designer'};
  return {ok:true,action:'recommend',selected_id:input.options[0].id};
 }};
 const app=createMissionServer({dataDir:dir,apiKey:'',decisionEngine});await app.listen(0);
 const post=(path,body={})=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'UI layout',goal:'Improve authorized UI layout',acceptance:'Responsive UI passes checks',workspace:dir,agent:'codex',profile:'discovery',specialist:'generalist',max_minutes:1})).json();
  const response=await post(`/api/tasks/${task.id}/${operation}`);assert.equal(response.status,200);const result=await response.json();
  const stored=(await(await fetch(app.url+'/api/state')).json()).tasks[0];
  assert.equal(stored.specialist,abstain?'generalist':'ux-designer');
  assert.equal(calls.length,operation==='plan'?3:2);
  if(operation==='plan')assert.equal(result.planning.status,abstain?'needs_review':'recommended');
  else assert.equal(result.action,abstain?'abstain':'recommend');
  assert.equal(operation==='plan'?(result.planning.selection_trace??result.planning.decision.selection_trace).length:result.selection_trace.length,2);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
