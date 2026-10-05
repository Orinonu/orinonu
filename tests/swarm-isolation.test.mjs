import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMissionServer} from '../src/server.mjs';
const wait=async predicate=>{for(let i=0;i<150;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out');};
const decisionEngine={call:async(_,input)=>({ok:true,action:'recommend',selected_id:input.options[0].id})};
function reviewFixture(prompt,child){
 const digest=prompt.match(/Snapshot preparado pelo host para revisão: ([a-f0-9]{64})/)?.[1];
 if(!digest)return false;
 // A conforming reviewer reads the confirmed criteria from its prompt and answers once per criterion.
 const confirmed=prompt.match(/Conjunto confirmado de critérios \(hash ([a-f0-9]{64})\): (\[.*?\])\. O contrato/s);
 const checks=JSON.parse(confirmed[2]).map(item=>({criterion_id:item.id,criterion:item.text,status:'passed',evidence:['Synthetic test fixture']}));
 setTimeout(()=>{child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-review\n'+JSON.stringify({version:1,snapshot_digest:digest,decision:'approved',criteria_hash:confirmed[1],checks,reason:'Fixture'})+'\n```'}})+'\n');setTimeout(()=>child.emit('close',0),10);},10);return true;
}
test('a queued implementation starts automatically when capacity is released',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nexo-resume-')),source=join(root,'project'),children=[];mkdirSync(source);writeFileSync(join(source,'file.txt'),'base');
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');let prompt='';child.stdin.on('data',chunk=>{prompt+=chunk;});child.stdin.on('finish',()=>{if(!reviewFixture(prompt,child))children.push({child,cwd:options.cwd});});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:join(root,'state'),isolationRoot:join(root,'isolated'),runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 try{
  await fetch(app.url+'/api/scheduler',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({implementation_limit:1})});
  for(let i=0;i<2;i++){const task=await(await post('/api/tasks',{title:'Task '+i,workspace:source,goal:'Defined change',acceptance:'Evidence',agent:'codex',profile:'implementation',max_minutes:1})).json();await post(`/api/tasks/${task.id}/run`,{});}
  await wait(()=>children.length===1);assert.equal((await state()).tasks[1].queue_wait.code,'phase_capacity');
  writeFileSync(join(children[0].cwd,'first.txt'),'done');children[0].child.emit('close',0);
  await wait(()=>children.length===2);assert.equal((await state()).tasks[1].status,'running');
  writeFileSync(join(children[1].cwd,'second.txt'),'done');children[1].child.emit('close',0);
  await wait(async()=>(await state()).tasks[1].integration?.status==='merged');
  assert.equal(readFileSync(join(source,'second.txt'),'utf8'),'done');
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
for(const conflict of [false,true])test(`parallel implementations use separate writable workspaces and ${conflict?'preserve conflicting edits':'merge independent edits'}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'nexo-swarm-')),source=join(root,'project'),children=[];mkdirSync(source);writeFileSync(join(source,'shared.txt'),'base');
 const runner=(command,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');let prompt='';child.stdin.on('data',chunk=>{prompt+=chunk;});child.stdin.on('finish',()=>{if(!reviewFixture(prompt,child))children.push({child,cwd:options.cwd,args});});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:join(root,'state'),isolationRoot:join(root,'isolated'),runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 const request=(path,body,method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 try{
  await request('/api/scheduler',{implementation_limit:10},'PATCH');
  for(let i=0;i<2;i++){const task=await(await request('/api/tasks',{title:'Change '+i,workspace:source,goal:'Implement defined change',acceptance:'Test results',agent:'codex',profile:'implementation',max_minutes:1})).json();assert.equal((await request(`/api/tasks/${task.id}/run`,{})).status,200);}
  await wait(()=>children.length===2);assert.notEqual(children[0].cwd,children[1].cwd);assert.notEqual(children[0].cwd,source);assert.equal((await state()).scheduler.running.implementation,2);
  const started=await state();children.sort((a,b)=>started.tasks.findIndex(t=>t.execution_workspace===a.cwd)-started.tasks.findIndex(t=>t.execution_workspace===b.cwd));
  children.forEach(({cwd,args},i)=>{assert.equal(args[args.indexOf('--sandbox')+1],'workspace-write');writeFileSync(join(cwd,conflict?'shared.txt':`change-${i}.txt`),'result '+i);});
  assert.equal(readFileSync(join(source,'shared.txt'),'utf8'),'base');
  children[0].child.emit('close',0);await wait(async()=>(await state()).tasks[0].integration?.status==='merged');
  children[1].child.emit('close',0);await wait(async()=>['merged','blocked'].includes((await state()).tasks[1].integration?.status));
  const result=await state();assert.equal(result.scheduler.running.implementation,0);
  if(conflict){assert.equal(result.tasks[1].status,'blocked');assert.match(result.tasks[1].error,/Conflict/);assert.equal(readFileSync(join(source,'shared.txt'),'utf8'),'result 0');assert.equal(readFileSync(join(children[1].cwd,'shared.txt'),'utf8'),'result 1');}
  else {assert.equal(result.tasks[1].integration.status,'merged');assert.equal(readFileSync(join(source,'change-0.txt'),'utf8'),'result 0');assert.equal(readFileSync(join(source,'change-1.txt'),'utf8'),'result 1');}
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
test('a canonical reader permits isolated implementation and delays only the final merge',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nexo-reader-')),source=join(root,'project'),children=[];mkdirSync(source);writeFileSync(join(source,'file.txt'),'base');
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');let prompt='';child.stdin.on('data',chunk=>{prompt+=chunk;});child.stdin.on('finish',()=>{if(!reviewFixture(prompt,child))children.push({child,cwd:options.cwd});});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const decisionEngine={call:async(_,input)=>({ok:true,action:'recommend',selected_id:input.options[0].id})};
 const app=createMissionServer({dataDir:join(root,'state'),isolationRoot:join(root,'isolated'),runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 try{
  const make=async title=>(await(await post('/api/tasks',{title,workspace:source,goal:'Defined',acceptance:'Evidence',agent:'codex',profile:'implementation',max_minutes:1})).json());
  const reader=await make('Reader');await post(`/api/tasks/${reader.id}/prepare`,{});await wait(()=>children.length===1);
  const writer=await make('Writer');await post(`/api/tasks/${writer.id}/run`,{});await wait(()=>children.length===2);
  writeFileSync(join(children[1].cwd,'file.txt'),'changed');children[1].child.emit('close',0);
  await wait(async()=>(await state()).tasks[1].integration?.status==='waiting');assert.equal(readFileSync(join(source,'file.txt'),'utf8'),'base');
  children[0].child.emit('close',1);await wait(async()=>(await state()).tasks[1].integration?.status==='merged');assert.equal(readFileSync(join(source,'file.txt'),'utf8'),'changed');
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
