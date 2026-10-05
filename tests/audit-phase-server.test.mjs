import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';

const delay=()=>new Promise(resolve=>setTimeout(resolve,10));
test('opportunity audit cannot be run as implementation or erase completed evidence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-audit-phase-'));
 const isolationRoot=join(dir,'isolated'),children=[];
 const runner=(executable,args)=>{
  const child=new EventEmitter();child.args=args;
  child.stdin=new PassThrough();child.stdin.resume();
  child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{child.emit('close',0);return true;};children.push(child);return child;
 };
 const decisionEngine={call:async(tool,input)=>({ok:true,action:'recommend',selected_id:input.options?.[0]?.id})};
 const app=createMissionServer({dataDir:dir,isolationRoot,runner,codexPath:process.execPath,decisionEngine});
 await app.listen(0);
 const request=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=> (await fetch(app.url+'/api/state')).json();
 try{
  const created=await request('/api/opportunities/investigate',{workspace:dir});
  assert.equal(created.status,202);const audit=await created.json();
  for(let n=0;n<100&&!children.length;n++)await delay();
  assert.equal(children.length,1);
  assert.equal(children[0].args[children[0].args.indexOf('--sandbox')+1],'read-only');
  const report='Inspected source without modifications.\n```nexo-opportunities\n[]\n```';
  children[0].stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:report}})+'\n');
  children[0].stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:10}})+'\n');
  children[0].emit('close',0);
  let before;for(let n=0;n<100;n++){before=(await state()).tasks.find(t=>t.id===audit.id);if(before.attempt?.state==='terminal')break;await delay();}
  assert.equal(before.attempt.state,'terminal');assert.equal(before.plan_report,report);
  assert.equal(before.discovery_result.status,'completed_empty');
  const blocked=await request(`/api/tasks/${audit.id}/run`,{});
  assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/somente leitura/);
  const after=(await state()).tasks.find(t=>t.id===audit.id);
  assert.equal(children.length,1);assert.equal(existsSync(isolationRoot),false);
  assert.equal(after.plan_report,before.plan_report);assert.deepEqual(after.discovery_result,before.discovery_result);
  assert.deepEqual(after.attempt,before.attempt);assert.equal(after.implementation_workspace,before.implementation_workspace);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
