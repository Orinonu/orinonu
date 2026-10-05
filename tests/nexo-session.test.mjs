import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applySessionWork} from '../src/session-work.mjs';
import {createNexoSession} from '../bundles/nexo-session/core.mjs';

const WS='C:/work/project';
const plan=(pending=[],ready=pending.length===0)=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:ready,pending_decisions:pending,steps:['Edit file.txt'],verification:['Run the tests']})+'\n```';
const mission=(id,extra={})=>({id,title:'Mission '+id,workspace:WS,goal:'Fix the defect in '+id,acceptance:'Tests pass for '+id,status:'review',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},plan_report:plan([],true),planning:{status:'prepared'},attempt:{id:'a-'+id,state:'terminal'},...extra});
const direction={workspace:WS,objective:'Improve this project',success_criteria:'Real changes tested',mission:'Ship reliable autonomy',vision:'Nothing stalls',values:'Evidence first',principles:'Code validates, JEV recommends',repositories:[]};

async function fixture(t,{tasks,mode='autonomous',rank,decide,engineDown=false,hostConflict=[]}={}){
 const state={tasks,project_directions:[direction],autonomy_policies:[{workspace:WS,mode}]};
 const calls={rank:[],decide:[],claims:[]};
 const server=http.createServer(async(req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(req.method==='GET'&&req.url==='/api/state')return send(200,state);
  const match=/^\/api\/tasks\/([^/]+)\/session-work$/.exec(req.url);
  if(req.method==='POST'&&match){
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw),index=state.tasks.findIndex(task=>task.id===match[1]);
   if(body.action==='claim')calls.claims.push(match[1]);
   if(hostConflict.includes(match[1])&&body.action==='claim')return send(409,{error:'Outra sessão já reservou esta missão.'});
   try{const next=applySessionWork(state.tasks[index],body);state.tasks[index]=next;return send(200,next);}
   catch(error){return send(error.status??500,{error:error.message});}
  }
  send(404,{error:'not found'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const engine={call:async(name,input,signal,policy)=>{
  if(engineDown)return {ok:false,error:'jev_http_500'};
  if(name==='rank_missions'){calls.rank.push(input);return rank?rank(input):{ok:true,priority:input.candidates.map(c=>({id:c.id,score:1.5,confidence:0.8}))};}
  calls.decide.push({input,policy});
  return decide?decide(input):{ok:true,action:'recommend',selected_id:input.options[0].id,confidence:0.9,reason:'reversible_option_recommended'};
 }};
 const session=createNexoSession({baseUrl:'http://127.0.0.1:'+server.address().port,engine,identity:{session_id:'devin-test',owner:'devin'}});
 return {state,calls,session,baseUrl:'http://127.0.0.1:'+server.address().port};
}

test('the best-ranked mission is chosen by JEV, reserved for this session, and returned as a work order with injected context',async t=>{
 const f=await fixture(t,{tasks:[mission('low'),mission('top')],rank:input=>({ok:true,priority:input.candidates.map(c=>({id:c.id,score:c.id==='top'?1.9:0.7,confidence:0.8}))})});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.equal(order.mission.id,'top');
 assert.equal(order.phase,'implementation');
 assert.equal(order.decision.source,'jev');
 assert.equal(order.decision.step,'implement');
 assert.equal(order.decision.priority.score,1.9);
 assert.equal(order.specialist.id,'generalist');
 assert.match(order.specialist.prompt,/Especialista/);
 assert.equal(order.charter.objective,'Improve this project');
 assert.match(order.plan.report,/nexo-plan/);
 assert.ok(order.checklist.length>=3&&order.checklist.every(item=>item.done===false));
 assert.match(order.instructions,/untrusted/i);
 assert.equal(f.state.tasks.find(task=>task.id==='top').external_work.status,'active');
 assert.equal(f.state.tasks.find(task=>task.id==='top').external_work.session_id,'devin-test');
 assert.equal(f.state.tasks.find(task=>task.id==='low').external_work,undefined);
 assert.deepEqual(f.calls.decide.every(call=>call.policy?.stakes==='reversible'),true);
});

test('global MCP priority includes newer critical missions beyond the first ranking batch',async t=>{
 const tasks=Array.from({length:33},(_,index)=>mission('priority-'+index,{created_at:new Date(Date.UTC(2026,0,index+1)).toISOString(),title:index===32?'Critical security fix':'Ordinary improvement'}));
 const f=await fixture(t,{tasks,rank:input=>({ok:true,priority:input.candidates.map(candidate=>({id:candidate.id,score:candidate.id==='priority-32'?1.9:0.5,confidence:0.9}))})});
 const order=await f.session.nextWork({workspace:WS,dry_run:true});
 assert.equal(order.mission.id,'priority-32');
 assert.equal(order.decision.priority.score,1.9);
 assert.equal(new Set(f.calls.rank.flatMap(call=>call.candidates.map(candidate=>candidate.id))).size,33);
 assert.ok(f.calls.rank.every(call=>call.candidates.length<=16));
 assert.deepEqual(f.calls.claims,[]);
});

test('a JEV hold skips that mission; when every candidate is held nothing is reserved',async t=>{
 const f=await fixture(t,{tasks:[mission('a'),mission('b')],decide:input=>({ok:true,action:'recommend',selected_id:input.options.some(o=>o.id==='hold')?'hold':input.options[0].id})});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,false);
 assert.equal(order.reason,'no_work');
 assert.equal(order.skipped.length,2);
 assert.ok(order.skipped.every(row=>row.reason==='held_by_jev'));
 assert.deepEqual(f.calls.claims,[]);
 assert.ok(f.state.tasks.every(task=>task.external_work===undefined));
});

test('a JEV outage falls back to deterministic host defaults and says so; the work is still explicit and reserved',async t=>{
 const f=await fixture(t,{tasks:[mission('later',{created_at:'2026-10-04T12:00:00Z'}),mission('earlier',{created_at:'2026-10-04T09:00:00Z'})],engineDown:true});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.equal(order.mission.id,'earlier');
 assert.equal(order.decision.source,'host_default');
 assert.equal(order.decision.step,'implement');
});

test('a mission without a validated plan is planned first inside the session, under the same reservation',async t=>{
 const f=await fixture(t,{tasks:[mission('raw',{status:'backlog',plan_report:undefined,planning:undefined,attempt:undefined})],decide:input=>({ok:true,action:'recommend',selected_id:'plan_first'})});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.equal(order.decision.step,'plan_first');
 assert.equal(order.plan.report,null);
 assert.match(order.instructions,/plan first/i);
 assert.equal(f.state.tasks[0].external_work.status,'active');
});

test('a supervised project is never worked unless the user names the mission explicitly',async t=>{
 const f=await fixture(t,{tasks:[mission('m1')],mode:'supervised'});
 const refused=await f.session.nextWork({workspace:WS});
 assert.deepEqual([refused.ok,refused.reason],[false,'supervised']);
 assert.equal(f.state.tasks[0].external_work,undefined);
 const explicit=await f.session.nextWork({workspace:WS,mission_id:'m1'});
 assert.equal(explicit.ok,true);
 assert.equal(explicit.mission.id,'m1');
});

test('a project without a saved objective is refused, and an explicit request cannot bypass a cancelled mission',async t=>{
 const f=await fixture(t,{tasks:[mission('stopped',{pipeline:{auto_implement:true,cancelled:true}})]});
 const stopped=await f.session.nextWork({workspace:WS,mission_id:'stopped'});
 assert.equal(stopped.ok,false);
 assert.equal(stopped.reason,'mission_not_eligible');
 f.state.project_directions=[{...direction,objective:''}];
 const none=await f.session.nextWork({workspace:WS});
 assert.deepEqual([none.ok,none.reason],[false,'project_objective_required']);
});

test('automatic diagnostics, audits, reserved missions and finished work are not offered; quota-held work is',async t=>{
 const f=await fixture(t,{tasks:[
  mission('diag',{title:'Investigar falha: algo'}),
  mission('audit',{opportunity_audit:true}),
  mission('mine-elsewhere',{external_work:{session_id:'other',owner:'codex',phase:'implementation',status:'active',checklist:[]}}),
  mission('done',{status:'done'}),
  mission('held',{status:'blocked',error:'Executor terminou com código 1.',usage_limit_hold:{phase:'implementation',time:'2026-10-05T03:00:00Z',resume_at_ms:null}})
 ]});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.equal(order.mission.id,'held');
 assert.equal(order.decision.step,'implement');
});

test('a reservation conflict on the first candidate moves on to the next one',async t=>{
 const f=await fixture(t,{tasks:[mission('first'),mission('second')],hostConflict:['first'],rank:input=>({ok:true,priority:input.candidates.map(c=>({id:c.id,score:c.id==='first'?1.9:1.1,confidence:0.8}))})});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.equal(order.mission.id,'second');
 assert.deepEqual(f.calls.claims,['first','second']);
});

test('MCP work orders preserve the complete authorized goal and acceptance at API-supported lengths',async t=>{
 const goal='G'.repeat(5980)+' Final goal marker',acceptanceText='A'.repeat(2970)+'; Final acceptance marker';
 const f=await fixture(t,{tasks:[mission('complete',{goal,acceptance:acceptanceText})]});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.equal(order.mission.goal,goal);
 assert.equal(order.mission.acceptance,acceptanceText);
 const resumed=await f.session.nextWork({workspace:WS});
 assert.equal(resumed.mission.goal,goal);
 assert.equal(resumed.mission.acceptance,acceptanceText);
});

test('secrets in mission text never reach the work order',async t=>{
 const f=await fixture(t,{tasks:[mission('leaky',{goal:'Use api_key=sk-SENTINEL-abcdefghijklmnopqrstuvwxyz0123456789 to call the service'})]});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 assert.doesNotMatch(JSON.stringify(order),/sk-SENTINEL-abcdefghijklmnopqrstuvwxyz0123456789/);
});

test('progress marks only known checklist items and finishing needs every item done; completion lands in the review lane, never done',async t=>{
 const f=await fixture(t,{tasks:[mission('work')]});
 const order=await f.session.nextWork({workspace:WS});
 const ids=order.checklist.map(item=>item.id);
 const partial=await f.session.reportProgress({mission_id:'work',done_items:ids.slice(0,1)});
 assert.equal(partial.ok,true);
 assert.equal(partial.progress.completed,1);
 const unknown=await f.session.reportProgress({mission_id:'work',done_items:['nope']});
 assert.equal(unknown.ok,false);
 const early=await f.session.finish({mission_id:'work',outcome:'completed'});
 assert.equal(early.ok,false);
 assert.match(early.error,/Checklist incompleto/);
 await f.session.reportProgress({mission_id:'work',done_items:ids});
 const done=await f.session.finish({mission_id:'work',outcome:'completed',summary:'Implemented and tested'});
 assert.equal(done.ok,true);
 assert.equal(done.status,'review');
 assert.equal(done.external_work_status,'ready_for_integration');
 assert.match(done.next,/nexo_next_work/);
 assert.equal(f.state.tasks.find(task=>task.id==='work').status,'review');
});

test('cancelling hands the mission back untouched',async t=>{
 const f=await fixture(t,{tasks:[mission('give-back')]});
 await f.session.nextWork({workspace:WS});
 const released=await f.session.finish({mission_id:'give-back',outcome:'cancelled'});
 assert.equal(released.ok,true);
 assert.equal(released.external_work_status,'released');
});

test('status summarises the project: mode, offered work and reservations',async t=>{
 const f=await fixture(t,{tasks:[mission('x'),mission('y')]});
 await f.session.nextWork({workspace:WS});
 const status=await f.session.status({workspace:WS});
 assert.equal(status.mode,'autonomous');
 assert.equal(status.reserved_by_this_session.length,1);
 assert.ok(status.available>=1);
});

import {createMcpHandler,TOOLS} from '../bundles/nexo-session/server.mjs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {acceptance,mission as receiptMission} from './acceptance/harness.mjs';

const rpc=(id,method,params)=>({jsonrpc:'2.0',id,method,params});

test('the MCP handler negotiates, lists the seven tools and runs the whole loop through tools/call',async t=>{
 const f=await fixture(t,{tasks:[mission('loop')]});
 const handle=createMcpHandler({session:f.session,defaultWorkspace:WS});
 assert.equal((await handle(rpc(1,'tools/list'))).error.code,-32000);
 const init=await handle(rpc(2,'initialize',{protocolVersion:'2025-11-25'}));
 assert.equal(init.result.protocolVersion,'2025-11-25');
 assert.equal(init.result.serverInfo.name,'nexo-mission-control');
 assert.equal(await handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
 const listed=await handle(rpc(3,'tools/list'));
 assert.deepEqual(listed.result.tools.map(tool=>tool.name),['nexo_next_work','nexo_report_progress','nexo_finish','nexo_status','nexo_next_review','nexo_submit_review','nexo_cancel_review']);
 assert.equal(TOOLS.find(tool=>tool.name==='nexo_status').annotations.readOnlyHint,true);
 const call=async(id,name,args)=>JSON.parse((await handle(rpc(id,'tools/call',{name,arguments:args}))).result.content[0].text);
 const order=await call(4,'nexo_next_work',{});
 assert.equal(order.ok,true);
 await call(5,'nexo_report_progress',{mission_id:order.mission.id,done_items:order.checklist.map(item=>item.id)});
 const done=await call(6,'nexo_finish',{mission_id:order.mission.id,outcome:'completed'});
 assert.equal(done.external_work_status,'ready_for_integration');
 const empty=await call(7,'nexo_next_work',{});
 assert.deepEqual([empty.ok,empty.reason],[false,'no_work']);
});

test('the MCP handler rejects unknown tools and unexpected arguments without touching the host',async t=>{
 const f=await fixture(t,{tasks:[mission('safe')]});
 const handle=createMcpHandler({session:f.session,defaultWorkspace:WS});
 await handle(rpc(1,'initialize',{}));
 assert.equal((await handle(rpc(2,'tools/call',{name:'rm_rf',arguments:{}}))).error.code,-32602);
 const bad=await handle(rpc(3,'tools/call',{name:'nexo_next_work',arguments:{workspace:WS,permission:'allow'}}));
 assert.equal(bad.result.isError,true);
 assert.deepEqual(f.calls.claims,[]);
 assert.equal((await handle(rpc(4,'whatever'))).error.code,-32601);
});

test('the real stdio process speaks MCP and reserves a mission on the host (no JEV key: deterministic host defaults)',async t=>{
 const f=await fixture(t,{tasks:[mission('stdio')]});
 const dataDir=mkdtempSync(join(tmpdir(),'nexo-mcp-'));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../bundles/nexo-session/server.mjs',import.meta.url))],{stdio:['pipe','pipe','ignore'],env:{...process.env,NEXO_URL:f.baseUrl,NEXO_WORKSPACE:WS,NEXO_SESSION:'stdio-test',TYPESAFE_API_KEY:'',JEV_MISSION_DATA_DIR:dataDir}});
 t.after(()=>{child.kill();rmSync(dataDir,{recursive:true,force:true});});
 const waiting=new Map();
 createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line);waiting.get(message.id)?.(message);});
 const ask=(id,method,params)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout '+method)),15000);waiting.set(id,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify(rpc(id,method,params))+'\n');});
 assert.equal((await ask(1,'initialize',{protocolVersion:'2025-11-25'})).result.serverInfo.name,'nexo-mission-control');
 assert.equal((await ask(2,'tools/list')).result.tools.length,7);
 const reply=await ask(3,'tools/call',{name:'nexo_next_work',arguments:{}});
 const order=JSON.parse(reply.result.content[0].text);
 assert.equal(order.ok,true);
 assert.equal(order.mission.id,'stdio');
 assert.equal(order.decision.source,'host_default');
 assert.equal(order.session.session_id,'stdio-test');
 assert.equal(f.state.tasks[0].external_work.session_id,'stdio-test');
});

test('a session that already holds a mission is handed that same mission back, with its progress, instead of a false no_work',async t=>{
 const f=await fixture(t,{tasks:[mission('first'),mission('second')]});
 const order=await f.session.nextWork({workspace:WS});
 assert.equal(order.ok,true);
 await f.session.reportProgress({mission_id:order.mission.id,done_items:[order.checklist[0].id]});
 const again=await f.session.nextWork({workspace:WS});
 assert.equal(again.ok,true);
 assert.equal(again.resumed,true);
 assert.equal(again.mission.id,order.mission.id);
 assert.equal(again.checklist.filter(item=>item.done).length,1);
 assert.equal(again.decision.source,'resume');
 assert.deepEqual(f.calls.claims,[order.mission.id]);
 assert.equal(f.state.tasks.filter(task=>task.external_work).length,1);
});

test('naming a different mission while holding one is refused with the id of the held mission',async t=>{
 const f=await fixture(t,{tasks:[mission('mine'),mission('other')]});
 const first=await f.session.nextWork({workspace:WS,mission_id:'mine'});
 const refused=await f.session.nextWork({workspace:WS,mission_id:'other'});
 assert.deepEqual([refused.ok,refused.reason,refused.held_mission_id],[false,'session_holds_another_mission',first.mission.id]);
});

test('a reservation held by another session is never taken over',async t=>{
 const f=await fixture(t,{tasks:[mission('theirs',{external_work:{session_id:'someone-else',owner:'codex',phase:'implementation',status:'active',checklist:[{id:'a-1',label:'A',done:false}]}})]});
 const order=await f.session.nextWork({workspace:WS});
 assert.deepEqual([order.ok,order.reason],[false,'no_work']);
});

test('dry_run shows what JEV would pick and the order it would issue, and reserves nothing',async t=>{
 const f=await fixture(t,{tasks:[mission('peek-a'),mission('peek-b')]});
 const peek=await f.session.nextWork({workspace:WS,dry_run:true});
 assert.equal(peek.ok,true);
 assert.equal(peek.dry_run,true);
 assert.ok(peek.mission.id.startsWith('peek-'));
 assert.equal(peek.decision.source,'jev');
 assert.deepEqual(f.calls.claims,[]);
 assert.ok(f.state.tasks.every(task=>task.external_work===undefined));
 const real=await f.session.nextWork({workspace:WS});
 assert.equal(real.mission.id,peek.mission.id);
 assert.equal(real.dry_run,undefined);
});

test('Desktop review MCP tools reserve, report and cancel through the real host without exposing capability tokens',async t=>{
 const first=randomUUID(),second=randomUUID();
 const build=id=>workspace=>receiptMission(workspace,{id,status:'review',external_work:{session_id:'implementer',owner:'devin',phase:'implementation',status:'ready_for_integration',recorded_at:'2026-10-05T12:00:00Z',checklist:[{id:'code',label:'Implement guarded code',done:true}]}});
 const f=await acceptance(t,{mode:'supervised',tasks:[build(first),build(second)]});
 const session=createNexoSession({baseUrl:f.app.url,identity:{session_id:'independent-desktop',owner:'devin'}});
 const handle=createMcpHandler({session,defaultWorkspace:f.workspace});
 await handle(rpc(1,'initialize',{}));
 const listed=(await handle(rpc(2,'tools/list'))).result.tools.map(tool=>tool.name);
 for(const name of ['nexo_next_review','nexo_submit_review','nexo_cancel_review'])assert(listed.includes(name));
 let sequence=2;
 const call=async(name,args)=>JSON.parse((await handle(rpc(++sequence,'tools/call',{name,arguments:args}))).result.content[0].text);
 const preview=await call('nexo_next_review',{mission_id:first,dry_run:true});
 assert.equal(preview.ok,true);assert.equal(preview.dry_run,true);
 assert.equal((await f.state()).tasks.find(task=>task.id===first).desktop_review,undefined);
 const order=await call('nexo_next_review',{mission_id:first});
 assert.equal(order.ok,true);assert.equal(order.phase,'review');assert.equal(order.review_token,undefined);
 assert.deepEqual(order.criteria.items.map(item=>item.text),['Tests pass','Implement guarded code']);
 const report='```nexo-review\n'+JSON.stringify({version:1,snapshot_digest:order.snapshot_digest,criteria_hash:order.criteria.hash,decision:'approved',reason:'Verified the fixture.',checks:order.criteria.items.map(item=>({criterion_id:item.id,criterion:item.text,status:'passed',evidence:['file.txt:1']}))})+'\n```';
 const finished=await call('nexo_submit_review',{mission_id:first,review_id:order.review_id,report});
 assert.equal(finished.ok,true);assert.equal(finished.completion.kind,'session_receipt_verified');
 assert.deepEqual(await call('nexo_submit_review',{mission_id:first,review_id:order.review_id,report}),finished);
 const another=await call('nexo_next_review',{mission_id:second});
 assert.equal((await call('nexo_cancel_review',{mission_id:second,review_id:another.review_id})).ok,true);
 assert.equal((await f.state()).tasks.find(task=>task.id===second).status,'review');
 assert.equal(f.children.length,0);
});

test('fresh MCP sessions have distinct default identities so one session cannot resume another session reservation',async t=>{
 const f=await fixture(t,{tasks:[]});
 const a=await createNexoSession({baseUrl:f.baseUrl}).status({workspace:WS});
 const b=await createNexoSession({baseUrl:f.baseUrl}).status({workspace:WS});
 assert.notEqual(a.session.session_id,b.session.session_id);
});

test('MCP review arguments cannot bypass supervised scope with arrays, null or missing required fields',async t=>{
 const id=randomUUID(),f=await acceptance(t,{mode:'supervised',tasks:[workspace=>receiptMission(workspace,{id,status:'review',external_work:{session_id:'implementer',owner:'devin',status:'ready_for_integration',checklist:[{id:'a',label:'Verify fixture',done:true}]}})]});
 const session=createNexoSession({baseUrl:f.app.url,identity:{session_id:'reviewer',owner:'devin'}}),handle=createMcpHandler({session,defaultWorkspace:f.workspace});
 await handle(rpc(1,'initialize',{}));
 const invalid=[['nexo_next_review',{mission_id:[]}],['nexo_next_review',null],['nexo_next_review',{mission_id:id,dry_run:'false'}],['nexo_submit_review',{mission_id:id,review_id:'not-held'}],['nexo_cancel_review',{mission_id:id}],['nexo_next_review',{mission_id:id,toString:true}]];
 for(const [name,args] of invalid){
  const response=await handle(rpc(2,'tools/call',{name,arguments:args}));
  assert.equal(response.result.isError,true);
  assert.equal((await f.state()).tasks.find(task=>task.id===id).desktop_review,undefined);
 }
});

test('Desktop review priority uses JEV within project scope and never offers this session own receipt',async t=>{
 const own=randomUUID(),low=randomUUID(),top=randomUUID(),calls=[];
 const build=(id,owner)=>workspace=>receiptMission(workspace,{id,status:'review',external_work:{session_id:owner,owner:'devin',status:'ready_for_integration',checklist:[{id:'a',label:'Verify fixture',done:true}]}});
 const f=await acceptance(t,{tasks:[build(own,'reviewer'),build(low,'writer'),build(top,'writer')],seed:raw=>raw.prepare('INSERT INTO entities VALUES(?,?,0)').run('meta/executor_pause',JSON.stringify({status:'paused',reason:'usage_limit',probe_at_ms:Date.now()+600000,resume_at_ms:Date.now()+600000}))});
 const engine={call:async(name,input)=>{calls.push(input);assert.equal(name,'rank_missions');return {ok:true,priority:[{id:top,score:1.9,confidence:0.9},{id:low,score:0.5,confidence:0.9}]};}};
 const session=createNexoSession({baseUrl:f.app.url,identity:{session_id:'reviewer',owner:'devin'},engine});
 const preview=await session.nextReview({workspace:f.workspace,dry_run:true});
 assert.equal(preview.mission.id,top);assert.equal(preview.decision.source,'jev');
 assert.equal(calls.length,1);assert.deepEqual(new Set(calls[0].candidates.map(candidate=>candidate.id)),new Set([low,top]));
 assert.equal((await session.status({workspace:f.workspace})).reviews_available,2);
 assert.equal((await f.state()).tasks.find(task=>task.id===top).desktop_review,undefined);
 const order=await session.nextReview({workspace:f.workspace});
 assert.equal(order.mission.id,top);assert.equal(order.specialist.id,'reviewer');assert.equal(order.charter.objective,'Improve this project');
 assert.equal((await session.status({workspace:f.workspace})).reserved_reviews_by_this_session.length,1);
});

test('an independently rejected receipt can be reserved for MCP rework with feedback and a new delivery identity',async t=>{
 const id=randomUUID(),f=await acceptance(t,{mode:'supervised',tasks:[workspace=>receiptMission(workspace,{id,status:'review',external_work:{session_id:'implementer',owner:'devin',status:'ready_for_integration',released_at:'2026-10-05T12:00:00Z',checklist:[{id:'fix',label:'Implement guarded code',done:true}]}})]});
 const reviewer=createNexoSession({baseUrl:f.app.url,identity:{session_id:'independent-reviewer',owner:'devin'}});
 const review=await reviewer.nextReview({workspace:f.workspace,mission_id:id});
 assert.equal(review.ok,true);
 const report='```nexo-review\n'+JSON.stringify({version:1,snapshot_digest:review.snapshot_digest,criteria_hash:review.criteria.hash,decision:'rejected',reason:'The regression test still fails',checks:[{criterion_id:'c1',criterion:'Tests pass',status:'failed',evidence:['file.txt:1']} ]})+'\n```';
 assert.equal((await reviewer.submitReview({mission_id:id,review_id:review.review_id,report})).ok,true);
 const writer=createNexoSession({baseUrl:f.app.url,identity:{session_id:'rework-writer',owner:'devin'}});
 const work=await writer.nextWork({workspace:f.workspace,mission_id:id});
 assert.equal(work.ok,true);
 assert.equal(work.review_feedback.reason,'The regression test still fails');
 assert.equal(work.review_feedback.checks[0].status,'failed');
 const resumed=await writer.nextWork({workspace:f.workspace,mission_id:id});
 assert.equal(resumed.resumed,true);
 assert.deepEqual(resumed.review_feedback,work.review_feedback);
 await writer.reportProgress({mission_id:id,done_items:work.checklist.map(item=>item.id)});
 assert.equal((await writer.finish({mission_id:id,outcome:'completed'})).ok,true);
 const current=(await f.state()).tasks.find(task=>task.id===id);
 assert.equal(current.status,'review');
 assert.equal(current.receipt_review??null,null);
 assert.equal(current.review_contract??null,null);
 assert.equal(current.completion??null,null);
 const next=await reviewer.nextReview({workspace:f.workspace,mission_id:id});
 assert.equal(next.ok,true);
 assert.notEqual(next.receipt_digest,review.receipt_digest);
 assert.equal(f.children.length,0);
});
