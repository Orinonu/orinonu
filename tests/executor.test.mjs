import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionServer } from '../src/server.mjs';
import { spawn } from 'node:child_process';
test('long Codex context is delivered intact over stdin instead of Windows command arguments',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-long-context-'));let child,args,options,input='';
 const report='Contexto técnico "preservado": ação, 日本語, 🐍. '.repeat(1800)+'\n```nexo-plan\n'+JSON.stringify({ready_for_implementation:true,pending_decisions:[],steps:['Implement within goal'],verification:['Run tests']})+'\n```';
 writeFileSync(join(dir,'state.json'),JSON.stringify({profiles:{implementation:{skill:'tdd',model:'gpt-6.1-sol',effort:'medium'}},tasks:[{id:'3118f48b-7267-45e1-87d8-de50a1226795',title:'Long context',workspace:dir,goal:'Implement locally',acceptance:'Verify changes',agent:'codex',profile:'implementation',specialist:'typescript',max_minutes:1,status:'backlog',plan_report:report}]}));
 const runner=(_,argv,opts)=>{args=argv;options=opts;child=new EventEmitter();child.stdin=new PassThrough();child.stdin.on('data',data=>{input+=data;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
 try{
  const response=await fetch(app.url+'/api/tasks/3118f48b-7267-45e1-87d8-de50a1226795/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);
  for(let i=0;i<100&&!args;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(args.at(-1),'-');assert.equal(options.stdio[0],'pipe');assert(args.join(' ').length<2000);
  assert(report.length>40000);assert(input.includes(report));assert.match(input,/Especialista: TypeScript/);assert.equal(child.stdin.writableEnded,true);
  assert(args.includes('workspace-write'));assert(args.includes('approval_policy="never"'));assert.equal(options.shell,false);
  child.emit('close',0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('short Codex prompts use stdin without exposing mission text in argv',async t=>{
 const {acceptance,mission,wait}=await import('./acceptance/harness.mjs');
 const f=await acceptance(t,{mode:'supervised',tasks:[workspace=>mission(workspace,{profile:'implementation',goal:'Preserve ação, 日本語, "quotes" and line\nbreaks'})]});
 const task=(await f.state()).tasks[0];
 assert.equal((await f.request(`/api/tasks/${task.id}/run`,{})).status,200);
 await wait(()=>f.children.length===1);
 const {child,args,options}=f.children[0];
 assert.equal(args.at(-1),'-');
 assert.equal(options.stdio[0],'pipe');
 assert.ok(!args.some(arg=>arg.includes(task.goal)));
 assert.ok(child.stdinText.includes(task.goal));
 assert.equal(child.stdin.writableEnded,true);
 assert.ok(args.includes('workspace-write'));
 assert.ok(args.includes('approval_policy="never"'));
 assert.equal(options.shell,false);
 child.emit('close',0);
});

test('a real OS stdin pipe preserves the complete long Unicode context and EOF',async t=>{
 const {acceptance,mission,wait}=await import('./acceptance/harness.mjs');
 const report='ação 日本語 "quotes" \\ paths\n'.repeat(3000);
 let invocation,received;
 const receiver="let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})+'\\n'));";
 const runner=(_,args,options)=>{
  invocation={args,options};
  const child=spawn(process.execPath,['-e',receiver],options),chunks=[];
  child.stdout.on('data',chunk=>chunks.push(chunk));
  child.stdout.on('end',()=>{received=JSON.parse(Buffer.concat(chunks).toString('utf8')).item.text;});
  return child;
 };
 const f=await acceptance(t,{mode:'supervised',tasks:[workspace=>mission(workspace,{profile:'implementation',plan_report:report})],serverOptions:{runner}});
 const task=(await f.state()).tasks[0];
 await f.request(`/api/tasks/${task.id}/run`,{});
 await wait(()=>received!==undefined);
 assert.equal(invocation.args.at(-1),'-');assert.equal(invocation.options.stdio[0],'pipe');
 assert.ok(report.length>40000);assert.ok(received.endsWith(report));
 assert.ok(!invocation.args.some(arg=>arg.includes(report)));
 await wait(async()=>(await f.state()).tasks[0].attempt.state==='terminal');
});

test('stdin failure and cancellation cannot approve an incomplete Codex execution',async()=>{
 for(const failure of ['stdin_async','stdin_sync','cancel','spawn_async','spawn_sync']){
  const dir=mkdtempSync(join(tmpdir(),'nexo-stdin-failure-'));let child,kills=0,invocation;
  const id='3118f48b-7267-45e1-87d8-de50a1226795';
  writeFileSync(join(dir,'state.json'),JSON.stringify({profiles:{implementation:{skill:'tdd',model:'gpt-6.1-sol',effort:'medium'}},tasks:[{id,title:failure,workspace:dir,goal:'Implement locally',acceptance:'Verify changes',agent:'codex',profile:'implementation',specialist:'typescript',max_minutes:1,status:'backlog',plan_report:'Contexto preservado. '.repeat(3000)}]}));
  const runner=(_,args,options)=>{
   invocation={args,options};if(failure==='spawn_sync')throw new Error('test spawn unavailable');
   child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{kills++;child.emit('close',1);return true;};
   if(failure==='stdin_sync')child.stdin.end=()=>{throw new Error('test stdin unavailable');};
   if(failure==='stdin_async')queueMicrotask(()=>child.stdin.emit('error',new Error('test EPIPE')));
   if(failure==='spawn_async')queueMicrotask(()=>child.emit('error',new Error('test spawn unavailable')));
   return child;
  };
  const authController={state:()=>({status:'chatgpt'}),probe:async()=>({status:'chatgpt'}),cancel:()=>{}};
  const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,subscriptionOnly:true,authController});await app.listen(0);
  const state=async()=>await(await fetch(app.url+'/api/state')).json();
  try{
   assert.equal((await fetch(app.url+`/api/tasks/${id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200);
   for(let i=0;i<100&&!invocation;i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert(invocation);assert.equal(invocation.args.at(-1),'-');assert.equal(invocation.options.shell,false);assert(invocation.options.env);
   if(failure==='cancel')assert.equal((await fetch(app.url+`/api/tasks/${id}/stop`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200);
   let snapshot;for(let i=0;i<100;i++){snapshot=await state();if(snapshot.tasks[0].status==='blocked')break;await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(snapshot.tasks[0].status,'blocked',failure);assert.equal(snapshot.tasks[0].integration?.status,undefined);
   assert.equal(snapshot.scheduler.running.implementation,failure==='spawn_sync'?1:0,failure);assert.equal(snapshot.scheduler.queued.implementation,0,failure);
   if(failure==='spawn_sync')assert.equal(snapshot.tasks[0].attempt.state,'outcome_unknown');
   if(failure.startsWith('stdin')){assert.equal(kills,1);assert.match(snapshot.tasks[0].error,/stdin/);}
   if(failure==='cancel')assert.equal(kills,1);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
 }
});
test('subscription-only dispatch does not require Codex CLI login for a verified independent Hermes executor',async t=>{
 const {acceptance,mission,wait}=await import('./acceptance/harness.mjs');
 const authController={state:()=>({status:'unauthenticated'}),probe:async()=>({status:'unauthenticated'}),cancel(){}};
 const f=await acceptance(t,{mode:'supervised',tasks:[workspace=>mission(workspace,{agent:'hermes',profile:'implementation'})],serverOptions:{subscriptionOnly:true,authController,hermesPath:process.execPath,hermesVerify:()=>({ok:true,verified_at:'2026-10-05T00:00:00Z',version:'0.21.4',provider:'openai-codex',logged_in:true,missing_flags:[]})}});
 const task=(await f.state()).tasks[0];
 assert.equal((await f.request(`/api/tasks/${task.id}/run`,{})).status,200);
 await wait(async()=>f.children.length===1||(await f.state()).tasks[0].status==='blocked');
 assert.equal(f.children.length,1);
 assert.ok(f.children[0].args.includes('--query-file'));
 f.children[0].child.emit('close',0);
});

test('planning preserves the selected independent executor instead of switching to unauthenticated Codex',async t=>{
 const {acceptance,mission,wait}=await import('./acceptance/harness.mjs');
 const authController={state:()=>({status:'unauthenticated'}),probe:async()=>({status:'unauthenticated'}),cancel(){}};
 const f=await acceptance(t,{mode:'supervised',tasks:[workspace=>mission(workspace,{agent:'hermes',profile:'design'})],serverOptions:{subscriptionOnly:true,authController,hermesPath:process.execPath,hermesVerify:()=>({ok:true,verified_at:'2026-10-05T00:00:00Z',version:'0.21.4',provider:'openai-codex',logged_in:true,missing_flags:[]})}});
 const task=(await f.state()).tasks[0];
 await f.request(`/api/tasks/${task.id}/prepare`,{});
 await wait(async()=>f.children.length===1||(await f.state()).tasks[0].status==='blocked');
 assert.equal(f.children.length,1);
 assert.ok(f.children[0].args.includes('--query-file'));
 assert.match(readFileSync(f.children[0].args[f.children[0].args.indexOf('--query-file')+1],'utf8'),/sem implementar ou editar arquivos/);
 assert.equal((await f.state()).tasks[0].agent,'hermes');
 f.children[0].child.emit('close',0);
});

test('a delayed JEV decision cannot alter a mission started during consultation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nexo-decision-race-'));
  const originalFetch=globalThis.fetch;let release,entered,child;
  const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
  globalThis.fetch=async()=>{entered();return await new Promise(resolve=>{release=()=>resolve(new Response('{}',{status:500}));});};
  const app=createMissionServer({dataDir:dir,runner,apiKey:'test-only',codexPath:process.execPath,hermesPath:process.execPath,allowLegacyExecutors:true,hermesVerify:()=>({ok:true,verified_at:'2026-10-05T00:00:00Z',version:'0.21.4',provider:'openai-codex',logged_in:true,missing_flags:[]})});
  globalThis.fetch=originalFetch;await app.listen(0);
  try{
    const post=(path,body)=>originalFetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    for(const action of ['route','specialist']){
      const task=await(await post('/api/tasks',{title:action,workspace:dir,goal:'Correct local API',acceptance:'Integration test passes',agent:'codex',profile:'implementation',specialist:'backend-lead',max_minutes:1})).json();
      const pending=new Promise(resolve=>{entered=resolve;});const decision=post(`/api/tasks/${task.id}/${action}`,{});
      await pending;assert.equal((await post(`/api/tasks/${task.id}/run`,{})).status,200);
      release();assert.equal((await decision).status,409);
      child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:7,output_tokens:1}})+'\n');child.emit('close',0);
      const state=await(await originalFetch(app.url+'/api/state')).json();
      assert.equal(state.tasks.find(t=>t.id===task.id).agent,'codex');
      assert.equal(state.tasks.find(t=>t.id===task.id).specialist,'backend-lead');
      assert(state.events.some(e=>e.kind==='codex_usage'&&e.task_id===task.id));
    }
  }finally{globalThis.fetch=originalFetch;await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('executor observes usage and sends successful exits to review; cross-origin writes fail',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jev-executor-'));let child,args;
  const runner=(file,argv)=>{args=argv;child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.emit('close',null);};return child;};
  const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
  try{
    const request=(path,body,headers={})=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const input={title:'Parser',workspace:dir,goal:'Preservar zero',acceptance:'Teste de regressão deve passar',agent:'codex',profile:'implementation',specialist:'typescript',max_minutes:1};
    assert.equal((await request('/api/tasks',input,{Origin:'https://attacker.example'})).status,403);
    const task=await (await request('/api/tasks',input)).json();
    assert.equal((await request(`/api/tasks/${task.id}/run`,{})).status,200);
    assert(args.includes('workspace-write'));assert(args.includes('approval_policy="never"'));
    assert.equal(args.at(-1),'-');assert.match(child.stdinText,/Especialista: TypeScript/);assert.match(child.stdinText,/tipos não substituem testes/i);
    child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:123,output_tokens:5}})+'\n');
    child.emit('close',0);
    let state=await (await fetch(app.url+'/api/state')).json();assert.equal(state.tasks[0].status,'review');
    assert.equal(state.events.find(e=>e.kind==='codex_usage').usage.input_tokens,123);
    await request(`/api/tasks/${task.id}/run`,{});
    await request(`/api/tasks/${task.id}/stop`,{});
    state=await (await fetch(app.url+'/api/state')).json();assert.equal(state.tasks[0].status,'blocked');
    assert.match(state.tasks[0].error,/parada pelo usuário/);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('workspace leases block competing writers; Hermes metadata cannot bypass review',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'jev-hermes-executor-'));const children=[],invocations=[];
  const runner=(file,args,options)=>{invocations.push({file,args,options});const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push(child);return child;};
  const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,hermesPath:process.execPath,allowLegacyExecutors:true,hermesVerify:()=>({ok:true,verified_at:'2026-10-05T00:00:00Z',version:'0.21.4',provider:'openai-codex',logged_in:true,missing_flags:[]})});await app.listen(0);
  try{
    const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const input={title:'Missão',workspace:dir,goal:'Alteração local',acceptance:'Teste passa',agent:'hermes',profile:'implementation',max_minutes:1};
    const a=await(await post('/api/tasks',input)).json();const b=await(await post('/api/tasks',{...input,agent:'codex'})).json();
    assert.equal((await post(`/api/tasks/${a.id}/run`,{})).status,200);
    const invocation=invocations[0];assert.equal(invocation.options.shell,false);
    const promptFile=invocation.args[invocation.args.indexOf('--query-file')+1];assert(existsSync(promptFile));
    assert.equal((await post(`/api/tasks/${b.id}/run`,{})).status,200);assert.equal(children.length,1);
    const nested=join(dir,'nested');mkdirSync(nested);
    const c=await(await post('/api/tasks',{...input,workspace:nested})).json();assert.equal((await post(`/api/tasks/${c.id}/run`,{})).status,200);await post(`/api/tasks/${c.id}/stop`,{});
    children[0].stdout.write(JSON.stringify({type:'tool_use',name:'terminal',input:{command:'private-secret'}})+'\n');
    children[0].stdout.write(JSON.stringify({type:'tool_result',name:'terminal',is_error:true,output:'private-secret'})+'\n');
    children[0].stdout.write(JSON.stringify({type:'result',exit_code:1,text:'private-secret',tokens:{input:12,output:3}})+'\n');
    children[0].emit('close',0);
    const state=await(await fetch(app.url+'/api/state')).json();assert.equal(state.tasks[0].status,'blocked');assert(!existsSync(promptFile));
    assert(!JSON.stringify(state.events).includes('private-secret'));assert.equal(state.events.find(e=>e.kind==='hermes_usage').usage.input_tokens,12);
    const activity=state.events.filter(e=>e.kind==='task_activity'&&e.task_id===a.id).map(e=>e.activity);
    assert(activity.some(e=>e.tool==='command_execution'&&e.state==='running'));
    assert(activity.some(e=>e.tool==='command_execution'&&e.state==='failed'));
    assert.equal(state.tasks[0].progress.tool_events,1);
    assert.equal(state.tasks[0].progress.failed_tools,1);
    assert(!JSON.stringify(state.tasks[0].progress).includes('private-secret'));
    assert.equal(children.length,2);children[1].emit('close',0);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('Hermes process exit zero without a terminal result cannot advance to review',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-result-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,hermesPath:process.execPath,allowLegacyExecutors:true,hermesVerify:()=>({ok:true,verified_at:'2026-10-05T00:00:00Z',version:'0.21.4',provider:'openai-codex',logged_in:true,missing_flags:[]})});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const task=await(await post('/api/tasks',{title:'Hermes terminal contract',workspace:dir,goal:'Implement locally',acceptance:'Verified change',agent:'hermes',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/run`,{});
  child.stdout.write(JSON.stringify({type:'system',session_id:'session-a',model:'model-a'})+'\n');
  await new Promise(resolve=>setTimeout(resolve,12));child.emit('close',0);
  const state=await(await fetch(app.url+'/api/state')).json();
  assert.equal(state.tasks.find(row=>row.id===task.id).status,'blocked');
  assert.match(state.tasks.find(row=>row.id===task.id).error,/resultado final/i);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('Hermes rejects ambiguous terminal envelopes and mismatched session identity',async()=>{
 for(const results of [
  [{type:'result',text:'private-secret'}],
  [{type:'result',exit_code:0,session_id:'other-session',text:'private-secret'}],
  [{type:'result',exit_code:0,session_id:'session-a'},{type:'result',exit_code:0,session_id:'session-a'}],
 ]){
  const dir=mkdtempSync(join(tmpdir(),'nexo-hermes-invalid-'));let child;
  const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
  const app=createMissionServer({dataDir:dir,runner,hermesPath:process.execPath,allowLegacyExecutors:true,hermesVerify:()=>({ok:true,verified_at:'2026-10-05T00:00:00Z',version:'0.21.4',provider:'openai-codex',logged_in:true,missing_flags:[]})});await app.listen(0);
  const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
   const task=await(await post('/api/tasks',{title:'Hermes invalid result',workspace:dir,goal:'Implement locally',acceptance:'Verified change',agent:'hermes',profile:'implementation',max_minutes:1})).json();
   await post(`/api/tasks/${task.id}/run`,{});
   child.stdout.write(JSON.stringify({type:'system',session_id:'session-a',model:'model-a'})+'\n');
   for(const result of results)child.stdout.write(JSON.stringify(result)+'\n');
   await new Promise(resolve=>setTimeout(resolve,12));child.emit('close',0);
   const state=await(await fetch(app.url+'/api/state')).json();
   assert.equal(state.tasks.find(row=>row.id===task.id).status,'blocked');
   assert(!JSON.stringify(state.events).includes('private-secret'));
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('real execution comparisons reject missing measurements and unreviewed executions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-comparison-'));let child;
 const runner=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath});await app.listen(0);
 const request=(path,body,method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const tasks=[];for(let i=0;i<2;i++)tasks.push(await(await request('/api/tasks',{title:'Benchmark '+i,workspace:dir,goal:'Preserve zero',acceptance:'Regression test passes',agent:'codex',profile:'implementation',max_minutes:1})).json());
  const pair={baseline_id:tasks[0].id,candidate_id:tasks[1].id,benchmark_id:'zero',controlled:true};
  assert.equal((await request('/api/comparisons/from-tasks',pair)).status,400);
  for(const task of tasks){await request(`/api/tasks/${task.id}/run`,{});child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}})+'\n');await new Promise(resolve=>setTimeout(resolve,12));child.emit('close',0);await request(`/api/tasks/${task.id}`,{status:'done'},'PATCH');}
  const response=await request('/api/comparisons/from-tasks',pair);assert.equal(response.status,400);
  assert.equal((await request('/api/comparisons/from-tasks',{...pair,candidate_cost_usd:1})).status,400);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
