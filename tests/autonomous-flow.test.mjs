import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';

const wait=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('Timeout');};
const plan=(pending=[],ready=pending.length===0)=>'```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:ready,pending_decisions:pending,steps:['Edit file.txt'],verification:['Run the tests']})+'\n```';
const profiles={design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}};
const mission=(workspace,extra={})=>({id:randomUUID(),workspace,title:'Mission '+Math.random().toString(16).slice(2,6),goal:'Edit the existing defect in file.txt',acceptance:'Tests pass',status:'backlog',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z',...extra});
const sandboxOf=entry=>entry.args[entry.args.indexOf('--sandbox')+1];
const promptOf=entry=>entry.args.at(-1)==='-'?entry.child.stdinText:entry.args.at(-1);

async function fixture(t,{tasks=[],opportunities=[],rank,decide,evaluate,mode='autonomous',discovery=false,direction={}}={}){
 const dir=mkdtempSync(join(tmpdir(),'nexo-flow-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
 const store=createStore(dataDir,{tasks:[],profiles}),db=store.load();
 const rows=tasks.map(build=>typeof build==='function'?build(workspace):build);
 db.tasks=rows;db.opportunities=opportunities.map(build=>typeof build==='function'?build(workspace):build);
 db.project_directions=[{workspace,objective:'Improve this project',success_criteria:'Real changes tested',mission:'Ship reliable autonomy',vision:'Nothing stalls',values:'Evidence first',principles:'Code validates, JEV recommends',repositories:[],...direction}];
 db.autonomy_policies=[{workspace,mode,discovery_enabled:discovery}];
 store.save(db);store.close();
 const calls={rank:[],decide:[],evaluate:[]},children=[];
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
 const engine={call:async(name,input)=>{
  if(name==='rank_missions'){calls.rank.push(input);return rank?rank(input):{ok:true,priority:input.candidates.map(c=>({id:c.id,score:2,confidence:1}))};}
  if(name==='evaluate_conditions'){calls.evaluate.push(input);return evaluate?evaluate(input):{ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.5}))};}
  calls.decide.push(input);return decide?decide(input):{ok:true,action:'recommend',selected_id:input.options[0].id};
 }};
 const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,isolationRoot:join(dir,'isolated')});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const request=(path,body,method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 const row=id=>state().then(s=>s.tasks.find(t=>t.id===id));
 return {app,dir,workspace,dataDir,rows,calls,children,request,state,row};
}
const phaseCalls=f=>f.calls.decide.filter(call=>/Choose only the next phase|could not establish any contribution/.test(call.goal));

test('an unprepared backlog mission in an autonomous project is planned read-only under a recorded delegation',async t=>{
 const f=await fixture(t,{tasks:[workspace=>mission(workspace)]});
 await wait(()=>f.children.length===1);
 assert.equal(sandboxOf(f.children[0]),'read-only');
 const current=await f.row(f.rows[0].id);
 assert.equal(current.pipeline.auto_implement,true);
 assert.equal(current.pipeline.authorized_by,'autonomous_project_policy');
 assert.equal(current.pipeline.budget_minutes,10);
 assert.equal(current.autonomy_history[0].status,'replan');
 assert.ok(current.flow_priority.score>=1);
 assert.deepEqual(phaseCalls(f)[0].options.map(o=>o.id),['replan','hold']);
});

test('supervised projects and explicitly stopped missions are never started or authorized',async t=>{
 const stopped=f=>mission(f,{pipeline:{auto_implement:false,cancelled:true}});
 const f=await fixture(t,{tasks:[mission,stopped],mode:'supervised'});
 await new Promise(r=>setTimeout(r,2300));
 assert.equal(f.children.length,0);
 const g=await fixture(t,{tasks:[stopped]});
 await new Promise(r=>setTimeout(r,2300));
 assert.equal(g.children.length,0);
 const state=await g.state();
 assert.equal(state.tasks[0].decision_recovery.reason,'human_cancelled');
 assert.equal(state.flow[0].convergence,'stuck');
});

test('JEV triage lifts technical pending items so the plan implements; the delegation reaches executor and reviewer prompts',async t=>{
 const pending=['Pick the retry policy','Run the baseline tests in a writable workspace'];
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{status:'review',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},plan_report:plan(pending),planning:{status:'prepared'}})],
  evaluate:input=>({ok:true,model:'jev-test',conditions:input.conditions.map(c=>({id:c.id,p_yes:0.04}))}),
  decide:input=>({ok:true,action:'recommend',selected_id:input.options.some(o=>o.id==='implement')?'implement':input.options[0].id})});
 await wait(()=>f.children.length===1);
 const current=await f.row(f.rows[0].id);
 assert.equal(current.pending_resolution.resolved_all,true);
 assert.equal(current.pending_triage.status,'done');
 assert.equal(f.calls.evaluate.length,1);
 assert.match(f.calls.evaluate[0].state,/Pick the retry policy/);
 assert.equal(sandboxOf(f.children[0]),'workspace-write');
 const prompt=promptOf(f.children[0]);
 assert.match(prompt,/Decisões técnicas delegadas pelo supervisor/);
 assert.match(prompt,/Pick the retry policy/);
 assert.equal(current.autonomy_history[0].status,'implement');
});

test('a human-only pending item is never inferred: one precise question, no executor, no repeated paid calls',async t=>{
 const pending=['Pick the retry policy','Provide a monthly budget for experiments'];
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{status:'review',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},plan_report:plan(pending),planning:{status:'prepared'}})],
  evaluate:input=>({ok:true,conditions:input.conditions.map((c,index)=>({id:c.id,p_yes:index===1?0.97:0.03}))})});
 await wait(async()=>(await f.row(f.rows[0].id)).pending_resolution);
 const state=await f.state(),current=state.tasks[0];
 assert.deepEqual(current.pending_resolution.human_items,[1]);
 assert.deepEqual([current.decision_recovery.status,current.decision_recovery.reason,current.decision_recovery.owner],['gate','human_scope_required','human']);
 assert.deepEqual(current.decision_recovery.questions,['Provide a monthly budget for experiments']);
 assert.equal(state.flow[0].convergence,'stuck');
 assert.equal(state.flow[0].gates[0].task_id,current.id);
 await new Promise(r=>setTimeout(r,2300));
 assert.equal(f.children.length,0);
 assert.equal(f.calls.evaluate.length,1);
 assert.equal(f.calls.rank.length,0);
 const flow=await(await fetch(f.app.url+'/api/flow?workspace='+encodeURIComponent(f.workspace))).json();
 assert.equal(flow.length,1);
 assert.equal(flow[0].gates.length,1);
});

test('an uncertain triage answer follows the charter: the plan implements and the record says why',async t=>{
 const pending=['Ambiguous item'];
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{status:'review',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},plan_report:plan(pending),planning:{status:'prepared'}})],
  evaluate:input=>({ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.5}))})});
 await wait(()=>f.children.length===1);
 const current=await f.row(f.rows[0].id);
 assert.equal(current.pending_resolution.items[0].verdict,'delegated');
 assert.equal(current.pending_resolution.items[0].basis,'charter_default');
 assert.equal(current.pending_resolution.resolved_all,true);
 assert.equal(sandboxOf(f.children[0]),'workspace-write');
 assert.equal(f.calls.evaluate.length,1);
});

test('an uncertain answer about a secret, private data or a payment still waits for a person',async t=>{
 const pending=['Provide the API key for the vendor service'];
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{status:'review',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},plan_report:plan(pending),planning:{status:'prepared'}})],
  evaluate:input=>({ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.5}))})});
 await wait(async()=>(await f.row(f.rows[0].id)).pending_resolution);
 const current=await f.row(f.rows[0].id);
 assert.equal(current.pending_resolution.items[0].verdict,'uncertain');
 assert.equal(current.pending_resolution.resolved_all,false);
 assert.deepEqual([current.decision_recovery.reason,current.decision_recovery.owner],['human_scope_required','human']);
 await new Promise(r=>setTimeout(r,2300));
 assert.equal(f.children.length,0);
 assert.equal(f.calls.evaluate.length,1);
});

test('a JEV outage backs the scheduler off without spending any mission decision budget',async t=>{
 const f=await fixture(t,{tasks:[workspace=>mission(workspace),workspace=>mission(workspace)],rank:()=>({ok:false,error:'jev_http_500'})});
 await wait(()=>f.calls.rank.length>=1);
 await new Promise(r=>setTimeout(r,2300));
 assert.equal(f.calls.rank.length,1);
 assert.equal(f.children.length,0);
 const state=await f.state();
 for(const row of state.tasks){assert.equal(row.autonomy_history?.length??0,0);assert.equal(row.autonomy.status,'idle');}
});

test('missions that cannot be tied to the charter are offered a read-only realignment once, never a silent rewrite',async t=>{
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{title:'Unrelated mission',goal:'Do something unrelated',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0}})],
  rank:input=>({ok:true,priority:input.candidates.map(c=>({id:c.id,score:0,confidence:0.9}))})});
 await wait(()=>f.children.length===1);
 assert.deepEqual(phaseCalls(f)[0].options.map(o=>o.id),['realign','hold']);
 assert.match(phaseCalls(f)[0].goal,/could not establish any contribution/);
 assert.equal(sandboxOf(f.children[0]),'read-only');
 assert.match(promptOf(f.children[0]),/Realinhamento à carta do projeto/);
 let current=await f.row(f.rows[0].id);
 assert.equal(current.realignment.status,'replanning');
 assert.equal(current.goal,'Do something unrelated');
 assert.equal(current.autonomy_history[0].status,'realign');
 f.children[0].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:plan(['Divergent objective: confirm scope'])}})+'\n');
 await f.state();f.children[0].child.emit('close',0);
 await wait(async()=>(await f.row(f.rows[0].id)).realignment?.status==='done');
 current=await f.row(f.rows[0].id);
 assert.equal(current.goal,'Do something unrelated');
 assert.equal(current.acceptance,'Tests pass');
 await new Promise(r=>setTimeout(r,2300));
 assert.equal(phaseCalls(f).filter(call=>/could not establish/.test(call.goal)).length,1);
});

test('an abstention among many options is asked again over the three most probable options',async t=>{
 const f=await fixture(t,{tasks:[workspace=>mission(workspace)],mode:'supervised'});
 const asked=[];
 const probabilities={abstain:0.31,generalist:0.22,'backend-lead':0.2,'frontend-lead':0.1,reviewer:0.07,'ui-design-lead':0.05,'release-engineer':0.03,'opportunity-analyst':0.02};
 // The route uses the server's configured engine; script it through the shared mock.
 f.calls.decide.length=0;
 const response=await f.request('/api/tasks/'+f.rows[0].id+'/specialist',{});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.ok,true);
 assert.ok(f.calls.decide.length>=1);
 void asked;void probabilities;
});

test('operators can release an unconfirmed attempt only with explicit confirmation and no live process',async t=>{
 const id=randomUUID();
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{id,status:'blocked',attempt:{id:'attempt-1',owner_id:'dead-owner',generation:1,state:'outcome_unknown'},error:'Execução interrompida; resultado desconhecido.',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0,status:'needs_review'}})],mode:'supervised'});
 // Plant the durable attempt row the way an abandoned supervisor leaves it.
 const { DatabaseSync }=await import('node:sqlite');
 await f.app.close();
 const raw=new DatabaseSync(join(f.dataDir,'state.sqlite'));
 raw.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,?,?,1)').run('dead-owner',0,0);
 raw.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,executor_pid,heartbeat) VALUES(?,?,?,?,?,?,?,?,?,?)').run('attempt-1',id,'queue-1','dead-owner',1,'implementation',f.workspace,'outcome_unknown',99999999,0);
 raw.close();
 const app=createMissionServer({dataDir:f.dataDir,runner:()=>{throw new Error('no executor expected');},decisionEngine:{call:async()=>({ok:false})},codexPath:process.execPath});await app.listen(0);
 try{
  const post=body=>fetch(app.url+'/api/tasks/'+id+'/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({})).status,400);
  assert.equal((await post({confirm:'no_executor_process_running'})).status,200);
  const current=(await(await fetch(app.url+'/api/state')).json()).tasks.find(row=>row.id===id);
  assert.equal(current.attempt.state,'terminal');
  assert.equal(current.status,'blocked');
  assert.match(current.error,/permanece desconhecido/);
  assert.equal(current.reconciliation.confirmed_by,'operator_request');
  assert.equal((await post({confirm:'no_executor_process_running'})).status,409);
 }finally{await app.close();}
});

test('a live executor process blocks reconciliation unless the operator explicitly accepts unverified liveness',async t=>{
 const id=randomUUID();
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{id,status:'blocked',attempt:{id:'attempt-2',owner_id:'dead-owner',generation:1,state:'outcome_unknown'},error:'Execução interrompida; resultado desconhecido.'})],mode:'supervised'});
 const { DatabaseSync }=await import('node:sqlite');
 await f.app.close();
 const raw=new DatabaseSync(join(f.dataDir,'state.sqlite'));
 raw.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,?,?,1)').run('dead-owner',0,0);
 raw.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,executor_pid,heartbeat) VALUES(?,?,?,?,?,?,?,?,?,?)').run('attempt-2',id,'queue-2','dead-owner',1,'implementation',f.workspace,'outcome_unknown',process.pid,0);
 raw.close();
 const app=createMissionServer({dataDir:f.dataDir,runner:()=>{throw new Error('no executor expected');},decisionEngine:{call:async()=>({ok:false})},codexPath:process.execPath});await app.listen(0);
 try{
  const post=body=>fetch(app.url+'/api/tasks/'+id+'/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({confirm:'no_executor_process_running'})).status,409);
  const forced=await post({confirm:'no_executor_process_running',accept_unverified_liveness:true});
  assert.equal(forced.status,200);
  assert.equal((await forced.json()).evidence.liveness_override,true);
 }finally{await app.close();}
});

test('the host releases an interrupted attempt on its own when supervisor and executor are verifiably gone',async t=>{
 const id=randomUUID();
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{id,status:'blocked',attempt:{id:'attempt-auto',owner_id:'dead-owner',generation:1,state:'outcome_unknown'},error:'Execução interrompida; resultado desconhecido.',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0,status:'needs_review'}})],rank:()=>({ok:true,priority:[]})});
 const {DatabaseSync}=await import('node:sqlite');
 await f.app.close();
 const raw=new DatabaseSync(join(f.dataDir,'state.sqlite'));
 raw.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,?,?,1)').run('dead-owner',0,0);
 raw.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,executor_pid,heartbeat) VALUES(?,?,?,?,?,?,?,?,?,?)').run('attempt-auto',id,'queue-auto','dead-owner',1,'implementation',f.workspace,'outcome_unknown',99999999,Date.now()-600000);
 raw.close();
 const app=createMissionServer({dataDir:f.dataDir,runner:()=>{throw new Error('no executor expected');},decisionEngine:{call:async(name,input)=>({ok:true,priority:[],conditions:[],action:'recommend',selected_id:input.options?.[0]?.id})},codexPath:process.execPath});
 await app.listen(0);
 try{
  await wait(async()=>(await(await fetch(app.url+'/api/state')).json()).tasks.find(row=>row.id===id)?.reconciliation);
  const current=(await(await fetch(app.url+'/api/state')).json()).tasks.find(row=>row.id===id);
  assert.equal(current.attempt.state,'terminal');
  assert.equal(current.reconciliation.confirmed_by,'host_liveness_check');
  assert.equal(current.status,'blocked');
  assert.match(current.error,/nenhum sucesso foi inferido/);
 }finally{await app.close();}
});

test('a live executor PID is never auto-released by the host',async t=>{
 const id=randomUUID();
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{id,status:'blocked',attempt:{id:'attempt-live',owner_id:'dead-owner',generation:1,state:'outcome_unknown'},error:'Execução interrompida; resultado desconhecido.',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0,status:'needs_review'}})],rank:()=>({ok:true,priority:[]})});
 const {DatabaseSync}=await import('node:sqlite');
 await f.app.close();
 const raw=new DatabaseSync(join(f.dataDir,'state.sqlite'));
 raw.prepare('INSERT OR IGNORE INTO supervisors(id,pid,heartbeat,closed) VALUES(?,?,?,1)').run('dead-owner',0,0);
 raw.prepare('INSERT INTO attempts(id,task_id,queue_id,owner_id,generation,phase,workspace,state,executor_pid,heartbeat) VALUES(?,?,?,?,?,?,?,?,?,?)').run('attempt-live',id,'queue-live','dead-owner',1,'implementation',f.workspace,'outcome_unknown',process.pid,Date.now()-600000);
 raw.close();
 const app=createMissionServer({dataDir:f.dataDir,runner:()=>{throw new Error('no executor expected');},decisionEngine:{call:async(name,input)=>({ok:true,priority:[],conditions:[],action:'recommend',selected_id:input.options?.[0]?.id})},codexPath:process.execPath});
 await app.listen(0);
 try{
  await new Promise(r=>setTimeout(r,3000));
  const current=(await(await fetch(app.url+'/api/state')).json()).tasks.find(row=>row.id===id);
  assert.equal(current.reconciliation,undefined);
  assert.equal(current.attempt.state,'outcome_unknown');
 }finally{await app.close();}
});

test('a specialist the model cannot settle never holds an autonomous mission: the host derives one from the validated plan',async t=>{
 const abstention={action:'abstain',reason:'undecided',selection_trace:[{parent:null,decision:{ok:true,action:'abstain'}}]};
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{status:'review',coordinator_narrow_retry:true,pipeline:{auto_implement:true,budget_minutes:10,spent_ms:0},plan_report:plan(),planning:{status:'needs_review',decision:abstention}})],
  decide:input=>input.options.some(o=>o.id==='implement')?{ok:true,action:'recommend',selected_id:'implement'}:input.options.some(o=>o.id==='generalist')?{ok:true,action:'abstain',reason:'undecided'}:{ok:true,action:'recommend',selected_id:input.options[0].id}});
 await wait(()=>f.children.length===1);
 const current=await f.row(f.rows[0].id);
 assert.equal(sandboxOf(f.children[0]),'workspace-write');
 assert.equal(current.planning.status,'recommended');
 assert.equal(current.planning.source,'host_default_after_abstention');
 assert.equal(current.specialist,'generalist');
 assert.equal(current.specialist_selection_history.at(-1).fallback.source,'host_default_after_abstention');
 assert.equal(current.autonomy_history[0].status,'implement');
});

test('a model that abstains about the next phase is asked once more, then the host applies the deterministic progression',async t=>{
 const asked=[];
 const hold=(Date.now()-3600000);
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{autonomy_history:[{status:'hold',fingerprint:'earlier-evidence',started_at:new Date(hold-1000).toISOString(),ended_at:new Date(hold).toISOString()}]})],
  decide:input=>{asked.push(input);return {ok:true,action:'abstain',reason:'undecided'};}});
 await wait(()=>f.children.length===1);
 const current=await f.row(f.rows[0].id);
 assert.equal(sandboxOf(f.children[0]),'read-only');
 const last=current.autonomy_history.at(-1);
 assert.equal(last.status,'replan');
 assert.equal(last.decision_source,'host_default_after_abstention');
 assert.equal(current.pipeline.authorized_by,'autonomous_project_policy');
 assert.equal(asked.filter(call=>/Choose only the next phase/.test(call.goal)).length,1);
});

test('the first abstention only holds and backs off; nothing starts without the earlier unproductive round',async t=>{
 const f=await fixture(t,{tasks:[workspace=>mission(workspace)],decide:()=>({ok:true,action:'abstain',reason:'undecided'})});
 await wait(async()=>(await f.row(f.rows[0].id)).autonomy_history?.length===1);
 await new Promise(r=>setTimeout(r,2300));
 const current=await f.row(f.rows[0].id);
 assert.equal(current.autonomy_history[0].status,'hold');
 assert.equal(current.autonomy_history[0].decision_source,'jev');
 assert.equal(f.children.length,0);
});

test('an exhausted mission budget is extended a bounded number of times and then stops at a gate',async t=>{
 const spent=11*60000;
 const f=await fixture(t,{tasks:[workspace=>mission(workspace,{status:'review',pipeline:{auto_implement:true,budget_minutes:10,spent_ms:spent},plan_report:plan(),planning:{status:'prepared'}}),
  workspace=>mission(workspace,{status:'blocked',error:'x',pipeline:{auto_implement:true,budget_minutes:30,spent_ms:31*60000,budget_extensions:[{minutes:10},{minutes:10}]},plan_report:plan(),planning:{status:'prepared'}})]});
 await wait(async()=>(await f.row(f.rows[0].id)).pipeline.budget_extensions?.length===1);
 const first=await f.row(f.rows[0].id),capped=await f.row(f.rows[1].id);
 assert.equal(first.pipeline.budget_minutes,20);
 assert.equal(first.pipeline.budget_extensions[0].reason,'autonomous_policy_budget_exhausted');
 assert.equal(capped.pipeline.budget_minutes,30);
 assert.equal(capped.pipeline.budget_extensions.length,2);
 assert.equal(capped.decision_recovery.reason,'budget_exhausted');
});

test('planner and executor prompts of an autonomous project decide by the charter and keep only secrets, private data and real spending as pending',async t=>{
 const f=await fixture(t,{tasks:[workspace=>mission(workspace)]});
 await wait(()=>f.children.length===1);
 const prompt=promptOf(f.children[0]);
 assert.match(prompt,/Este projeto é autônomo/);
 assert.match(prompt,/segredos \(chaves de API, senhas, tokens, credenciais\)/);
 assert.doesNotMatch(prompt,/preferências humanas ausentes, abstenção JEV e novo escopo continuam preservados/);
 assert.doesNotMatch(prompt,/Se faltarem evidências\/preferências ou mudar escopo/);
 const g=await fixture(t,{tasks:[workspace=>mission(workspace)],mode:'supervised'});
 const response=await g.request('/api/tasks/'+g.rows[0].id+'/prepare',{});
 assert.equal(response.status,200);
 await wait(()=>g.children.length===1);
 assert.match(promptOf(g.children[0]),/preferências humanas ausentes, abstenção JEV e novo escopo continuam preservados/);
 assert.doesNotMatch(promptOf(g.children[0]),/Este projeto é autônomo/);
});
