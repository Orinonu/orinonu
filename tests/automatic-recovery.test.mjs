import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
const wait=async predicate=>{for(let n=0;n<200;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timeout');};
async function fixture(t,{selection='replan'}={}){
 const root=mkdtempSync(join(tmpdir(),'nexo-recovery-')),workspace=join(root,'project');mkdirSync(workspace);writeFileSync(join(workspace,'app.js'),'baseline');
 const children=[],calls=[];let app;
 const engine={call:async(_,input)=>{calls.push(input);if(typeof selection==='function'&&input.goal.startsWith('Recuperação limitada'))return selection(input);return selection==='abstain'&&input.goal.startsWith('Recuperação limitada')?{ok:true,action:'abstain',reason:'Insufficient evidence'}:{ok:true,action:'recommend',selected_id:input.goal.startsWith('Recuperação limitada')?selection:input.options[0].id};}};
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
 const options={dataDir:join(root,'state'),isolationRoot:join(root,'isolated'),runner,decisionEngine:engine,codexPath:process.execPath};
 app=createMissionServer(options);await app.listen(0);
 const request=(path,body={},method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 const make=async()=>{const task=await(await request('/api/tasks',{title:'Defined task',goal:'Fix known defect',acceptance:'Existing verification passes',workspace,agent:'codex',profile:'design',max_minutes:1})).json();await request(`/api/tasks/${task.id}/prepare`,{auto_implement:true});await wait(()=>children.length>0);return task;};
 t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 return {children,calls,request,state,make,workspace,restart:async()=>{await app.close();app=createMissionServer(options);await app.listen(0);}};
}
test('failed planner automatically consults JEV and replans read-only at most twice',async t=>{
 const f=await fixture(t),task=await f.make();
 for(let n=0;n<3;n++){
  f.children[n].child.emit('close',1);
  if(n<2)await wait(()=>f.children.length===n+2);
 }
 await wait(async()=>(await f.state()).tasks[0].recovery?.reason==='recovery_limit');
 const current=(await f.state()).tasks[0];assert.equal(current.id,task.id);assert.equal(current.goal,task.goal);assert.equal(current.acceptance,task.acceptance);assert.equal(current.workspace,f.workspace);
 assert.equal(current.recovery_history.length,2);assert.equal(f.calls.filter(row=>row.goal.startsWith('Recuperação limitada')).length,2);
 for(const child of f.children)assert.equal(child.args[child.args.indexOf('--sandbox')+1],'read-only');
 assert.ok(current.pipeline.spent_ms>0);assert.equal(current.pipeline.budget_minutes,1);assert.equal(current.status,'blocked');
});
test('explicit Stop never starts recovery',async t=>{
 const f=await fixture(t),task=await f.make();await f.request(`/api/tasks/${task.id}/stop`);await wait(async()=>(await f.state()).tasks[0].status==='blocked');
 assert.equal(f.calls.filter(row=>row.goal.startsWith('Recuperação limitada')).length,0);assert.equal(f.children.length,1);
});

test('recovery process timer uses the remaining budget',async t=>{
 const delays=[],originalTimeout=globalThis.setTimeout,originalNow=Date.now;let advance=0;
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay>1000)delays.push(delay);return originalTimeout(callback,delay,...args);});
 t.mock.method(Date,'now',()=>originalNow()+advance);
 const f=await fixture(t);await f.make();advance=30000;f.children[0].child.emit('close',1);
 await wait(()=>f.children.length===2);
 assert.ok(delays.includes(60000));assert.ok(delays.some(delay=>delay>25000&&delay<=30000),`Recovery timers: ${delays}`);
});

test('malformed successful planner replans read-only with a bounded recovery instead of a stale implementation progress',async t=>{
 const f=await fixture(t);await f.make();
 for(let n=0;n<3;n++){
  f.children[n].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Invalid prose plan'}})+'\n');await f.state();f.children[n].child.emit('close',0);
  if(n<2)await wait(()=>f.children.length===n+2);
  if(n<2){const prompt=f.children[n+1].child.stdinText;assert.match(prompt,/Contexto limitado de recuperação/);assert.match(prompt,/Invalid prose plan/);assert.match(prompt,/missing_report/);}
 }
 await wait(async()=>(await f.state()).tasks[0].recovery?.reason==='recovery_limit');
 const current=(await f.state()).tasks[0];assert.equal(current.pipeline.auto_implement,true);assert.equal(current.pipeline.status,'needs_review');assert.equal(current.progress.stage,'needs_review');assert.equal(current.progress.phase,'review');
 assert.equal(f.calls.filter(row=>row.goal.startsWith('Recuperação limitada')).length,2);assert.equal(current.recovery_history.length,2);
 for(const child of f.children)assert.equal(child.args[child.args.indexOf('--sandbox')+1],'read-only');
});
test('JEV abstention is visible and does not relaunch or repeat on GET or restart',async t=>{
 const f=await fixture(t,{selection:'abstain'});await f.make();f.children[0].child.emit('close',1);
 await wait(async()=>(await f.state()).tasks[0].recovery?.status==='hold');
 assert.equal(f.children.length,1);for(let n=0;n<3;n++)await f.state();await f.restart();await f.state();
 assert.equal(f.calls.filter(row=>row.goal.startsWith('Recuperação limitada')).length,1);
 assert.equal((await f.state()).tasks[0].recovery_history[0].decision.action,'abstain');
});
test('authentication diagnostics are held without a paid recovery decision',async t=>{
 const f=await fixture(t);await f.make();f.children[0].child.stderr.write('Unauthorized: login required');f.children[0].child.emit('close',1);
 await wait(async()=>(await f.state()).tasks[0].recovery?.status==='hold');assert.equal(f.calls.filter(row=>row.goal.startsWith('Recuperação limitada')).length,0);
});
test('project direction validates and persists without launching work',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/project-direction',{workspace:f.workspace,objective:'Better orchestration',repositories:['http://github.com/owner/repo']},'PATCH')).status,400);
 const response=await f.request('/api/project-direction',{workspace:f.workspace,objective:'Better orchestration',success_criteria:'Measurable evidence',repositories:['https://github.com/owner/repo'],mission:'Autonomous evidence',vision:'Shared context',values:'Honesty',principles:'No invented results'},'PATCH');assert.equal(response.status,200);
 assert.equal((await f.request('/api/project-direction',{workspace:f.workspace,objective:'Better orchestration'},'PATCH')).status,200);
 await f.restart();assert.equal((await f.state()).project_directions[0].objective,'Better orchestration');assert.equal(f.children.length,0);assert.equal(f.calls.length,0);
 assert.equal((await f.state()).project_directions[0].charter_version,1);assert.equal((await f.state()).project_charter_history.length,1);assert.equal((await f.state()).project_charter_history[0].current.values,'Honesty');
 assert.equal((await f.state()).project_directions[0].mission,'Autonomous evidence');assert.equal((await f.state()).project_directions[0].principles,'No invented results');
});

test('Stop during the paid recovery selection invalidates its pending response',async t=>{
 let finishDecision;const pending=new Promise(resolve=>{finishDecision=resolve;});
 const f=await fixture(t,{selection:()=>pending}),task=await f.make();f.children[0].child.emit('close',1);
 await wait(async()=>(await f.state()).tasks[0].recovery?.status==='selecting');
 assert.equal((await f.request(`/api/tasks/${task.id}/stop`)).status,200);
 finishDecision({ok:true,action:'recommend',selected_id:'replan'});
 await wait(async()=>(await f.state()).tasks[0].recovery?.status==='hold');
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.children.length,1);assert.equal((await f.state()).tasks[0].pipeline.cancelled,true);
});

test('a revision change while JEV selects holds the stale recommendation',async t=>{
 let finishDecision;const pending=new Promise(resolve=>{finishDecision=resolve;});
 const f=await fixture(t,{selection:()=>pending}),task=await f.make();f.children[0].child.emit('close',1);
 await wait(async()=>(await f.state()).tasks[0].recovery?.status==='selecting');
 assert.equal((await f.request(`/api/tasks/${task.id}`,{goal:'Changed requirement'},'PATCH')).status,200);
 finishDecision({ok:true,action:'recommend',selected_id:'replan'});
 await wait(async()=>(await f.state()).tasks[0].recovery?.reason==='stale_revision');assert.equal(f.children.length,1);
});
