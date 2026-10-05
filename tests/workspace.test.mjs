import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
test('an abstained mission can enter read-only planning; the resulting plan is visible before explicit implementation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-planner-'));let child,args;
 const runner=(_file,argv)=>{args=argv;child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,apiKey:'',codexPath:process.execPath,runner});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'SDK',workspace:dir,goal:'Investigate Codex SDK',acceptance:'Official citations',agent:'codex',profile:'discovery',max_minutes:10,plan:true})).json();
  const planning=await post(`/api/tasks/${task.id}/prepare`,{});assert.equal(planning.status,200);assert.equal((await planning.json()).status,'planning');assert(args.includes('read-only'));assert(args.includes('--skip-git-repo-check'));
  assert.equal((await post(`/api/tasks/${task.id}/run`,{})).status,409);
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Plan: inspect SDK auth, implement adapter, verify cancellation.'}})+'\n');child.emit('close',0);
  const planned=(await(await fetch(app.url+'/api/state')).json()).tasks[0];assert.equal(planned.status,'review');assert.equal(planned.planning.status,'prepared');assert.match(planned.plan_report,/inspect SDK/);
  assert.equal((await post(`/api/tasks/${task.id}/run`,{})).status,200);assert(args.includes('workspace-write'));assert.match(child.stdinText,/Plan: inspect SDK/);child.emit('close',0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('configured source workspace is exposed; editing requirements invalidates an abstained plan without execution',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-workspace-'));
 writeFileSync(join(dir,'runtime.json'),JSON.stringify({mission_workspace:dir}));
 const app=createMissionServer({dataDir:dir,apiKey:''});await app.listen(0);
 const request=(path,method,body)=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await(await fetch(app.url+'/api/state')).json()).workspace.default,dir);
  const task=await(await request('/api/tasks','POST',{title:'Research',workspace:dir,goal:'Compare SDKs',acceptance:'Official sources',agent:'codex',profile:'discovery',max_minutes:10,plan:true})).json();
  assert.equal(task.planning.status,'needs_review');
  assert.equal((await request(`/api/tasks/${task.id}/run`,'POST',{})).status,409);
  const edited=await request(`/api/tasks/${task.id}`,'PATCH',{title:'Codex SDK',goal:'Investigate the Codex SDK with ChatGPT login',acceptance:'Document auth and billing; no implementation'});
  assert.equal(edited.status,200);const updated=await edited.json();
  assert.equal(updated.goal,'Investigate the Codex SDK with ChatGPT login');assert.equal(updated.planning,null);assert.equal(updated.status,'backlog');
  assert.equal((await request(`/api/tasks/${task.id}`,'PATCH',{goal:''})).status,400);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
