import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
const proposal={title:'Durable task ownership',goal:'Investigate durable leases in the current code.',acceptance:'Design validated lease and restart tests.',recommendation:'Add ownership before parallel writers.',risk:'Requires transactional state.',evidence:['src/server.mjs: active Map is process-local.']};
test('read-only investigation creates reviewable evidence-based recommendations, never implementation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-recommendation-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const response=await post('/api/opportunities/investigate',{workspace:dir});assert.equal(response.status,202);
  const task=await response.json();assert.equal(task.status,'planning');
  const final='Evidence and plan.\n```nexo-opportunities\n'+JSON.stringify([{...proposal,workspace:'/other-project',status:'done',agent:'hermes'}])+'\n```';
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:final}})+'\n');
  await fetch(app.url+'/api/state');child.emit('close',0);
  const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].status,'review');
  assert.equal(state.opportunities.length,1);assert.equal(state.opportunities[0].workspace,dir);assert.equal(state.opportunities[0].status,'pending');assert.equal(state.opportunities[0].source_task_id,task.id);
  assert.equal(state.opportunities[0].source,'codex_read_only_analysis');assert.deepEqual(state.opportunities[0].evidence,proposal.evidence);
  const second=await post('/api/opportunities/propose',{workspace:dir,proposals:[proposal]});assert.equal(second.status,200);assert.equal((await(await fetch(app.url+'/api/state')).json()).opportunities.length,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('invalid specialist proposals cannot create tasks or partial recommendations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-invalid-proposal-'));const app=createMissionServer({dataDir:dir,apiKey:''});await app.listen(0);
 const post=body=>fetch(app.url+'/api/opportunities/propose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post({workspace:dir,proposals:[proposal,{...proposal,evidence:[]}]})).status,400);
  const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.opportunities.length,0);assert.equal(state.tasks.length,0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a report with several opportunity blocks is ambiguous in any order and admits nothing, while one block keeps working',async()=>{
 const {readRecommendations}=await import('../src/recommendations.mjs');
 const block=rows=>'```nexo-opportunities\n'+JSON.stringify(rows)+'\n```';
 const valid=block([proposal]),empty=block([]),broken='```nexo-opportunities\nnot json\n```';
 assert.equal(readRecommendations('Analysis\n'+valid,'/p','t').length,1);
 assert.deepEqual(readRecommendations('Analysis\n'+empty,'/p','t'),[]);
 assert.deepEqual(readRecommendations('No contract at all','/p','t'),[]);
 for(const report of [valid+'\n'+valid,valid+'\n'+empty,empty+'\n'+valid,broken+'\n'+valid,valid+'\n'+broken,empty+'\n'+empty])assert.throws(()=>readRecommendations(report,'/p','t'),/múltiplos blocos/);
 const dir=mkdtempSync(join(tmpdir(),'nexo-two-blocks-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 try{
  const response=await fetch(app.url+'/api/opportunities/investigate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:dir})});assert.equal(response.status,202);
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Evidence.\n'+valid+'\nMore.\n'+valid}})+'\n');
  await fetch(app.url+'/api/state');child.emit('close',0);
  let state;for(let n=0;n<200;n++){state=await(await fetch(app.url+'/api/state')).json();if(state.tasks[0]?.status==='review')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.opportunities.length,0);
  assert.equal(state.tasks[0].discovery_result.status,'invalid');
  assert.equal(state.tasks[0].recommendation_processed,false);
  assert.ok(state.tasks[0].recommendation_error);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
