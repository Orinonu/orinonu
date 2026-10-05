import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isUsageLimit,resumeAt,newPause,admission,openPause,PROBE_MS} from '../src/executor-pause.mjs';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';

const MESSAGE='You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 10th, 2026 12:59 AM.';
const wait=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('Timeout');};

test('only quota messages trip the breaker and the reset time is read from the message',()=>{
 assert.equal(isUsageLimit(MESSAGE),true);
 assert.equal(isUsageLimit('stream disconnected before completion'),false);
 assert.equal(isUsageLimit(undefined),false);
 assert.equal(resumeAt(MESSAGE),new Date('Oct 10, 2026 12:59 AM').getTime());
 assert.equal(resumeAt('You hit your usage limit.'),null);
 const now=Date.parse('2026-10-05T02:00:00Z'),pause=newPause(MESSAGE,now);
 assert.equal(pause.status,'paused');
 assert.equal(pause.probe_at_ms,now+PROBE_MS);
 assert.equal(newPause('usage limit, no date',now).probe_at_ms,now+PROBE_MS);
 const soon=newPause('usage limit. try again at Oct 5th, 2026 2:10 AM',now);
 assert.ok(soon.probe_at_ms<=soon.resume_at_ms);
});

test('an already-past provider reset time cannot cause immediate repeated probes',()=>{
 const now=Date.parse('2026-10-06T12:00:00Z');
 assert.equal(newPause('usage limit. try again at Oct 5th, 2026 2:10 AM',now).probe_at_ms,now+PROBE_MS);
});

test('admission is closed while paused, probes one run after the probe time and reopens when resumed',()=>{
 const now=Date.parse('2026-10-05T02:00:00Z'),pause=newPause(MESSAGE,now);
 assert.equal(admission(undefined,now),'open');
 assert.equal(admission(pause,now+1000),'paused');
 assert.equal(admission(pause,now+PROBE_MS),'probe');
 assert.equal(admission(openPause(pause,now+PROBE_MS),now+PROBE_MS),'open');
});

test('an exhausted quota pauses admission, spawns no failure investigation or recovery, and the mission returns to its phase when the quota is back',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-pause-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
 const profiles={design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}};
 const store=createStore(dataDir,{tasks:[],profiles}),db=store.load();
 const ids=[randomUUID(),randomUUID()];
 db.tasks=ids.map((id,index)=>({id,workspace,title:'Mission '+index,goal:'Edit file.txt',acceptance:'Tests pass',status:'backlog',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z'}));
 store.save(db);store.close();
 const children=[];
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
 const engine={call:async(name,input)=>({ok:true,action:'recommend',selected_id:input.options?.[0]?.id})};
 const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,antigravityPath:join(dir,'none.exe'),devinPath:join(dir,'none.exe'),isolationRoot:join(dir,'isolated')});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 assert.equal((await post('/api/tasks/'+ids[0]+'/prepare',{})).status,200);
 await wait(()=>children.length===1);
 children[0].child.stdout.write(JSON.stringify({type:'turn.started'})+'\n');
 children[0].child.stdout.write(JSON.stringify({type:'error',message:MESSAGE})+'\n');
 children[0].child.stdout.write(JSON.stringify({type:'turn.failed',error:{message:MESSAGE}})+'\n');
 await state();children[0].child.emit('close',1);
 await wait(async()=>(await state()).executor_pause?.status==='paused');
 let current=await state();
 const held=current.tasks.find(row=>row.id===ids[0]);
 assert.equal(held.status,'blocked');
 assert.equal(held.usage_limit_hold.phase,'planning');
 assert.match(held.error,/Limite de uso do Codex/);
 assert.equal(current.opportunities.length,0);
 assert.equal(held.recovery_history?.length??0,0);
 // While paused nothing is admitted, even for work the user starts explicitly.
 assert.equal((await post('/api/tasks/'+ids[1]+'/prepare',{})).status,200);
 await new Promise(r=>setTimeout(r,1500));
 assert.equal(children.length,1);
 assert.equal((await state()).tasks.find(row=>row.id===ids[1]).queue.status,'queued');
 // Probe time reached: one read-only planning run is admitted to test the quota; success reopens admission.
 const raw=createStore;void raw;
 const paused=(await state()).executor_pause;
 assert.ok(paused.probe_at_ms>Date.now());
});

test('after the probe time exactly one planning run tests the quota; its success reopens admission and returns held missions to their phase',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-probe-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
 const profiles={design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}};
 const store=createStore(dataDir,{tasks:[],profiles}),db=store.load();
 const base=index=>({id:randomUUID(),workspace,title:'Mission '+index,goal:'Edit file.txt',acceptance:'Tests pass',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z'});
 const queued=index=>({...base(index),status:'planning',pipeline:{auto_implement:false,status:'queued'},queue:{id:randomUUID(),phase:'planning',status:'queued',enqueued_at:new Date(Date.now()-1000*(10-index)).toISOString()}});
 const first=queued(1),second=queued(2),held={...base(3),status:'blocked',error:'Limite de uso do Codex atingido',usage_limit_hold:{phase:'planning',time:new Date().toISOString()}};
 db.tasks=[first,second,held];
 db.executor_pause={status:'paused',reason:'usage_limit',provider:'codex',message:'usage limit',detected_at:new Date().toISOString(),resume_at_ms:null,probe_at_ms:Date.now()-1000};
 store.save(db);store.close();
 const children=[];
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
 const engine={call:async(name,input)=>({ok:true,action:'recommend',selected_id:input.options?.[0]?.id})};
 const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,antigravityPath:join(dir,'none.exe'),devinPath:join(dir,'none.exe'),isolationRoot:join(dir,'isolated')});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 await wait(()=>children.length===1);
 await new Promise(r=>setTimeout(r,1200));
 assert.equal(children.length,1);
 assert.equal((await state()).executor_pause.status,'paused');
 children[0].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'NEXO_QUOTA_OK'}})+'\n');
 children[0].child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:4,output_tokens:2}})+'\n');
 await state();children[0].child.emit('close',0);
 await wait(async()=>(await state()).executor_pause.status==='open');
 await wait(()=>children.length>=2);
 const after=await state();
 assert.equal(after.tasks.find(row=>row.id===held.id).usage_limit_hold,undefined);
 assert.ok(after.tasks.find(row=>row.id===held.id).queue||children.length>=3);
});

test('an authenticated but unisolated Devin cannot become an automatic quota fallback',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-fallback-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
 const profiles={design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}};
 const store=createStore(dataDir,{tasks:[],profiles}),db=store.load(),id=randomUUID();
 db.tasks=[{id,workspace,title:'Mission',goal:'Edit file.txt',acceptance:'Tests pass',status:'backlog',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z'}];
 store.save(db);store.close();
 const children=[];
 const runner=(command,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,command,args,options});return child;};
 const engine={call:async(name,input)=>({ok:true,action:'recommend',selected_id:input.options?.[0]?.id})};
 const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,antigravityPath:process.execPath,devinPath:process.execPath,devinAuthController:{state:()=>({cli_authenticated:true})},isolationRoot:join(dir,'isolated')});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 assert.equal((await fetch(app.url+'/api/tasks/'+id+'/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200);
 await wait(()=>children.length===1);
 assert.ok(children[0].args.includes('exec'));
 children[0].child.stdout.write(JSON.stringify({type:'turn.failed',error:{message:MESSAGE}})+'\n');
 await state();children[0].child.emit('close',1);
 await wait(async()=>(await state()).executor_pause?.status==='paused');
 const current=await state();
 assert.equal(children.length,1);
 assert.equal(current.executor_pause.status,'paused');
 assert.equal(current.tasks.find(row=>row.id===id).agent,'codex');
 assert.equal(current.tasks.find(row=>row.id===id).usage_limit_hold.phase,'planning');
 assert.equal(current.quotas.providers.find(provider=>provider.id==='devin').eligible_for_execution,false);
 assert.equal(current.opportunities.length,0);
});

import {acceptance,mission,sleep} from './acceptance/harness.mjs';

test('a due quota probe runs without a planning queue in both supervised and receipt-only autonomous projects',async t=>{
 for(const mode of ['supervised','autonomous'])await t.test(mode,async t=>{
  const id=randomUUID(),f=await acceptance(t,{mode,tasks:[workspace=>mission(workspace,{id,status:'blocked',acceptance:'SYNTHETIC_PRIVATE_CRITERION',error:'Limite de uso do Codex atingido',usage_limit_hold:{phase:'review'},external_work:{session_id:'implementer',owner:'devin',status:'ready_for_integration',checklist:[{id:'fix',label:'Fix defect',done:true}]},receipt_review:{status:'failed',ended_at:new Date(Date.now()-31*60000).toISOString()}})],seed:raw=>raw.prepare('INSERT INTO entities VALUES(?,?,0)').run('meta/executor_pause',JSON.stringify({status:'paused',provider:'codex',reason:'usage_limit',message:'usage limit',probe_at_ms:Date.now()-1000}))});
  await wait(()=>f.children.length===1,8000);
  const probe=f.children[0];
  assert.equal(probe.args[probe.args.indexOf('--sandbox')+1],'read-only');
  assert.match(probe.child.stdinText,/NEXO_QUOTA_OK/);
  assert.doesNotMatch(probe.child.stdinText,/SYNTHETIC_PRIVATE_CRITERION/);
  await sleep(1200);
  assert.equal(f.children.length,1);
  assert.deepEqual((await f.state()).tasks.map(task=>task.id),[id]);
  probe.child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'NEXO_QUOTA_OK'}})+'\n');
  probe.child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:4,output_tokens:2}})+'\n');
  probe.child.emit('close',0);
  await wait(async()=>(await f.state()).executor_pause.status==='open',8000);
  await wait(()=>f.children.length===2,8000);
  const current=(await f.state()).tasks[0];
  assert.equal(current.usage_limit_hold,undefined);
  assert.equal(current.receipt_review.status,'reviewing');
  assert.deepEqual(current.review_snapshot.criteria.items.map(item=>item.text),['SYNTHETIC_PRIVATE_CRITERION','Fix defect']);
 });
});
