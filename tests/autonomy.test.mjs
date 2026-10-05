import {readRecommendations} from '../src/recommendations.mjs';
import {coverage} from './helpers/review-coverage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';
import {autonomyProposal,technicalCompletion} from '../src/autonomy.mjs';
test('preserved implementation with optional reviewer narrowing hold is reconsidered once without rerunning implementation',()=>{
 const row={...task('/project'),status:'blocked',integration:{status:'awaiting_review'},implementation_run:{attempt_id:'impl'},implementation_workspace:{workspace:'/isolated'},implementation_evidence:{implementation_attempt_id:'impl',changes:[{path:'file.txt'}]},planning:{decision:{action:'abstain',selection_trace:[{parent:null,decision:{ok:true,action:'recommend',selected_id:'reviewer'}},{parent:'reviewer',decision:{action:'abstain'}}]}}};
 row.autonomy_history=[{fingerprint:'old-hold'},{fingerprint:'old-replan'},{fingerprint:'old-implement'}];
 const proposal=autonomyProposal(row,{objective:'Improve'});
 assert.equal(autonomyProposal({...row,autonomy_history:[...row.autonomy_history,{fingerprint:proposal.fingerprint}]},{objective:'Improve'}).eligible,false);
 assert.equal(proposal.eligible,true);
 assert.ok(proposal.options.some(o=>o.id==='review'));
 assert.equal(proposal.options.some(o=>o.id==='implement'),false);
 assert.equal(autonomyProposal({...row,specialist_selection_history:[{question_version:'review-coordinator-v1'}]},{objective:'Improve'}).eligible,false);
 assert.equal(autonomyProposal({...row,implementation_evidence:null},{objective:'Improve'}).eligible,false);
});
const wait=async fn=>{for(let n=0;n<300;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout');};
const task=workspace=>({id:randomUUID(),workspace,title:'Fix existing project',goal:'Edit existing defect',acceptance:'Tests pass',status:'review',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,pipeline:{auto_implement:true,budget_minutes:10,spent_ms:1000},attempt:{id:randomUUID(),state:'terminal'}});
async function fixture(t,{decide,opportunity=false,postReview=false,count=1,admission=false,discovery=false,coordinatorHold=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'nexo-autonomy-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
 const row=task(workspace),store=createStore(dataDir,{tasks:[],profiles:{design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}}}),db=store.load();db.tasks=[row,...Array.from({length:count-1},()=>task(workspace))];db.project_directions=[{workspace,objective:'Improve this project',success_criteria:'Real changes tested'}];db.opportunities=opportunity?[{id:randomUUID(),title:'Investigate defect',workspace,status:'pending',goal:'Inspect existing defect',acceptance:'Evidence',max_minutes:1}]:[];
 if(admission){row.opportunity_audit=true;row.recommendation_processed=true;row.discovery_result={status:'completed'};row.pipeline.auto_implement=false;const proposal={title:'Fix verified defect',goal:'Correct defect in file.txt',acceptance:'Test defect behavior',recommendation:'Correct reproduced issue',risk:'Bounded local change',evidence:['file.txt contains reproduced defect']};row.plan_report='```nexo-opportunities\n'+JSON.stringify([proposal])+'\n```';db.opportunities=readRecommendations(row.plan_report,workspace,row.id).map(o=>({...o,id:randomUUID(),max_minutes:5}));}
 if(coordinatorHold){row.plan_report='```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Fix file.txt'],verification:['Tests pass']})+'\n```';row.planning={decision:{action:'abstain',selection_trace:[{parent:null,decision:{ok:true,action:'recommend',selected_id:'backend-lead'}},{parent:'backend-lead',decision:{action:'abstain'}}]}};row.autonomy_history=[{status:'hold',fingerprint:'old-specialty-drill',decision:row.planning.decision}];}
 if(opportunity||postReview||discovery){row.pipeline.auto_implement=false;row.pipeline.cancelled=true;}db.autonomy_policies=[{workspace,mode:postReview?'autonomous':'supervised',discovery_enabled:discovery}];store.save(db);store.close();
 const calls=[],children=[];
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
 const engine={call:async(name,input)=>{if(name==='rank_missions')return {ok:true,priority:input.candidates.map(c=>({id:c.id,score:2,confidence:1}))};calls.push(input);return decide?decide(input):{ok:true,action:'recommend',selected_id:input.options[0].id};}};
 const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,isolationRoot:join(dir,'isolated')});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const request=(path,body,method='POST')=>fetch(app.url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 return {app,row,workspace,dataDir,dir,calls,children,request,state};
}
test('autonomy holds uncertain, cancelled, conflicting and exhausted executions',()=>{
 const row=task('/project'),direction={objective:'Improve'};
 assert.equal(autonomyProposal(row,direction).eligible,true);
 for(const changed of [{attempt:{state:'outcome_unknown'}},{pipeline:{auto_implement:true,cancelled:true}},{integration:{status:'blocked'}},{pipeline:{auto_implement:true,budget_minutes:1,spent_ms:60000}},{autonomy_history:[{},{},{}]}])assert.equal(autonomyProposal({...row,...changed},direction).eligible,false);
 assert.equal(technicalCompletion(row),false);
});
test('supervision never starts legacy review cards; explicit autonomous selects priority and replans readonly',async t=>{
 const f=await fixture(t);assert.equal(f.children.length,0);assert.equal((await f.state()).autonomy_policies[0].mode,'supervised');
 assert.equal((await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'})).status,200);
 await wait(()=>f.children.length===1);
 assert.equal(f.children[0].args[f.children[0].args.indexOf('--sandbox')+1],'read-only');
 const current=(await f.state()).tasks[0];assert.equal(current.autonomy_history[0].status,'replan');assert.equal(current.autonomy_history[0].snapshot.status,'review');assert.equal(current.pipeline.budget_minutes,10);assert.ok(current.pipeline.spent_ms>=1000);
 assert.match(f.calls[0].goal,/next phase/);assert.equal(current.implementation_run,undefined);
});
test('abstention is preserved and no repeated paid calls happen on polling',async t=>{
 const f=await fixture(t,{decide:()=>({ok:true,action:'abstain'})});await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});
 await wait(async()=>(await f.state()).tasks[0].autonomy?.status==='hold');
 await new Promise(r=>setTimeout(r,2100));assert.equal(f.calls.length,1);assert.equal(f.children.length,0);
});
test('switching to supervised invalidates pending JEV response',async t=>{
 let resolveDecision;const pending=new Promise(r=>{resolveDecision=r;});const f=await fixture(t,{decide:()=>pending});
 await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});await wait(()=>f.calls.length===1);
 await f.request('/api/autonomy',{workspace:f.workspace,mode:'supervised'});resolveDecision({ok:true,action:'recommend',selected_id:f.calls[0].options[0].id});
 await wait(async()=>(await f.state()).tasks[0].autonomy?.status==='hold');assert.equal(f.children.length,0);
});
test('PATCH cannot forge technical completion',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/tasks/'+f.row.id,{status:'done'},'PATCH')).status,409);assert.equal((await f.state()).tasks[0].status,'review');
});
test('autonomous opportunities launch only readonly investigation, not implementation',async t=>{
 const f=await fixture(t,{opportunity:true});await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});await wait(()=>f.children.length===1);
 const current=(await f.state()).tasks.find(t=>t.opportunity_audit);assert.ok(current);assert.equal(current.pipeline.auto_implement,false);assert.equal(f.children[0].args[f.children[0].args.indexOf('--sandbox')+1],'read-only');
});

test('pending preferences and unknown failures remain held; valid existing plan may implement',()=>{
 const row=task('/project'),direction={objective:'Improve'};
 assert.equal(autonomyProposal({...row,structured_plan:{pending_decisions:['Choose product preference']}},direction).reason,'semantic_pending');
 assert.equal(autonomyProposal({...row,planning:{decision:{action:'abstain'}}},direction).reason,'semantic_pending');
 assert.equal(autonomyProposal({...row,status:'blocked',error:'Unclassified issue'},direction).reason,'unknown_failure');
 const plan='```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Edit defect'],verification:['Test behavior']})+'\n```';
 assert.ok(autonomyProposal({...row,plan_report:plan},direction).options.some(o=>o.id==='implement'));
});
test('a second supervisor preserves a live autonomous selection without duplicate paid calls',async t=>{
 let resolveDecision;const pending=new Promise(r=>{resolveDecision=r;});const f=await fixture(t,{decide:()=>pending});
 await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});await wait(()=>f.calls.length===1);
 let duplicates=0;const second=createMissionServer({dataDir:f.dataDir,codexPath:process.execPath,decisionEngine:{call:async()=>{duplicates++;return {ok:true,action:'abstain'};}}});await second.listen(0);
 try{assert.equal((await f.state()).tasks[0].autonomy.status,'selecting');await new Promise(r=>setTimeout(r,2100));assert.equal(duplicates,0);}
 finally{await second.close();resolveDecision({ok:true,action:'abstain'});}
 await wait(async()=>(await f.state()).tasks[0].autonomy.status==='hold');
});
test('implementation exit zero without a file change cannot start review or complete',async t=>{
 const f=await fixture(t);
 const row=await(await f.request('/api/tasks',{title:'No changes',workspace:f.workspace,goal:'Edit defect',acceptance:'Tests pass',agent:'codex',profile:'implementation',max_minutes:1})).json();
 assert.equal((await f.request('/api/tasks/'+row.id+'/run',{})).status,200);await wait(()=>f.children.length===1);await wait(async()=>(await f.state()).tasks.find(t=>t.id===row.id)?.status==='running');
 f.children[0].child.emit('close',0);await wait(async()=>(await f.state()).tasks.find(t=>t.id===row.id)?.status==='blocked');
 const current=(await f.state()).tasks.find(t=>t.id===row.id);assert.ok(current.implementation_run,JSON.stringify(current));assert.ok(current.implementation_run.attempt_id);assert.deepEqual(current.implementation_evidence.changes,[]);assert.equal(f.children.length,1);assert.match(current.error,/sem editar/);
});

for(const action of ['integrate','hold'])test('autonomous review returns to JEV before integration: '+action,async t=>{
 const f=await fixture(t,{postReview:true,decide:input=>({ok:true,action:'recommend',selected_id:input.options.some(o=>o.id==='integrate')?action:input.options[0].id})});
 const row=await(await f.request('/api/tasks',{title:'Real change',workspace:f.workspace,goal:'Edit defect',acceptance:'Tests pass',agent:'codex',profile:'implementation',max_minutes:1})).json();
 await f.request('/api/tasks/'+row.id+'/run',{});await wait(()=>f.children.length===1);writeFileSync(join(f.children[0].options.cwd,'file.txt'),'edited');f.children[0].child.emit('close',0);await wait(()=>f.children.length===2);
 let current=(await f.state()).tasks.find(t=>t.id===row.id);
 const contract={version:1,snapshot_digest:current.review_snapshot.snapshot_digest,decision:'approved',...coverage(current.review_snapshot,'passed',['fixture file change']),reason:'Verified fixture'};
 f.children[1].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-review\n'+JSON.stringify(contract)+'\n```'}})+'\n');f.children[1].child.emit('close',0);
 await wait(async()=>['done','review'].includes((await f.state()).tasks.find(t=>t.id===row.id)?.status));current=(await f.state()).tasks.find(t=>t.id===row.id);
 assert.equal(current.post_review_history[0].status,action);assert.equal(current.status,action==='integrate'?'done':'review');assert.equal(readFileSync(join(f.workspace,'file.txt'),'utf8'),action==='integrate'?'edited':'baseline');assert.equal(f.children.length,2);
});

test('an approved review is not left waiting when the model only abstains about the next step',async t=>{
 const f=await fixture(t,{postReview:true,decide:input=>input.options.some(o=>o.id==='integrate')?{ok:true,action:'abstain',reason:'undecided'}:{ok:true,action:'recommend',selected_id:input.options[0].id}});
 const row=await(await f.request('/api/tasks',{title:'Real change',workspace:f.workspace,goal:'Edit defect',acceptance:'Tests pass',agent:'codex',profile:'implementation',max_minutes:1})).json();
 await f.request('/api/tasks/'+row.id+'/run',{});await wait(()=>f.children.length===1);writeFileSync(join(f.children[0].options.cwd,'file.txt'),'edited');f.children[0].child.emit('close',0);await wait(()=>f.children.length===2);
 let current=(await f.state()).tasks.find(t=>t.id===row.id);
 const contract={version:1,snapshot_digest:current.review_snapshot.snapshot_digest,decision:'approved',...coverage(current.review_snapshot,'passed',['fixture file change']),reason:'Verified fixture'};
 f.children[1].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-review\n'+JSON.stringify(contract)+'\n```'}})+'\n');f.children[1].child.emit('close',0);
 await wait(async()=>['done','review'].includes((await f.state()).tasks.find(t=>t.id===row.id)?.status));current=(await f.state()).tasks.find(t=>t.id===row.id);
 assert.equal(current.post_review_history[0].status,'integrate');assert.equal(current.post_review_history[0].decision_source,'host_default_after_abstention');
 assert.equal(current.status,'done');assert.equal(readFileSync(join(f.workspace,'file.txt'),'utf8'),'edited');
 const offered=f.calls.find(c=>c.options.some(o=>o.id==='integrate')).options.map(o=>o.id);assert.deepEqual(offered,['integrate','replan']);
});

test('a reviewer that could not verify every criterion sends the mission back for rework instead of blocking it',async t=>{
 const f=await fixture(t,{postReview:true});
 const row=await(await f.request('/api/tasks',{title:'Real change',workspace:f.workspace,goal:'Edit defect',acceptance:'Tests pass',agent:'codex',profile:'implementation',max_minutes:1})).json();
 await f.request('/api/tasks/'+row.id+'/run',{});await wait(()=>f.children.length===1);writeFileSync(join(f.children[0].options.cwd,'file.txt'),'edited');f.children[0].child.emit('close',0);await wait(()=>f.children.length===2);
 const current=(await f.state()).tasks.find(t=>t.id===row.id);
 const contract={version:1,snapshot_digest:current.review_snapshot.snapshot_digest,decision:'abstained',checks:[{criterion:'Acceptance',status:'unknown',evidence:['could not run tests read-only']}],reason:'No test evidence'};
 f.children[1].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-review\n'+JSON.stringify(contract)+'\n```'}})+'\n');f.children[1].child.emit('close',0);
 await wait(async()=>(await f.state()).tasks.find(t=>t.id===row.id)?.integration?.status==='revision_required');
 assert.equal(readFileSync(join(f.workspace,'file.txt'),'utf8'),'baseline');
});


test('narrow phase abstention holds only selected mission; tied priority does not mark the whole batch held',async t=>{
 const f=await fixture(t,{count:3,decide:()=>({ok:true,action:'abstain',reason:'model_abstained'})});
 await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});
 await wait(async()=>(await f.state()).tasks.some(t=>t.autonomy?.status==='hold'));
 const rows=(await f.state()).tasks;
 assert.equal(rows.filter(t=>t.autonomy?.status==='hold').length,1);
 assert.equal(rows.filter(t=>t.autonomy?.status==='idle').length,2);
 assert.equal(rows.filter(t=>t.autonomy_history?.length).length,1);
 assert.equal(f.calls[0].options.some(o=>o.id.includes('_replan')),false);
 assert.deepEqual(f.calls[0].options.map(o=>o.id),['replan','hold']);
});


test('rejected real review is sent to JEV for bounded readonly correction, never integrated',async t=>{
 const f=await fixture(t,{postReview:true,decide:input=>({ok:true,action:'recommend',selected_id:input.options.some(o=>o.id==='replan')?'replan':input.options[0].id})});
 const row=await(await f.request('/api/tasks',{title:'Rejected change',workspace:f.workspace,goal:'Edit defect',acceptance:'Tests pass',agent:'codex',profile:'implementation',max_minutes:1})).json();
 await f.request('/api/tasks/'+row.id+'/prepare',{auto_implement:true});
 await wait(()=>f.children.length===1);
 // This first child is planning, provide a valid plan before real implementation.
 const plan={version:1,ready_for_implementation:true,pending_decisions:[],steps:['Edit defect'],verification:['Test behavior']};
 f.children[0].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-plan\n'+JSON.stringify(plan)+'\n```'}})+'\n');f.children[0].child.emit('close',0);
 await wait(()=>f.children.length===2);writeFileSync(join(f.children[1].options.cwd,'file.txt'),'bad edit');f.children[1].child.emit('close',0);await wait(()=>f.children.length===3);
 let current=(await f.state()).tasks.find(t=>t.id===row.id);
 const contract={version:1,snapshot_digest:current.review_snapshot.snapshot_digest,decision:'rejected',checks:[{criterion:'Acceptance',status:'failed',evidence:['fixture verification fails']}],reason:'Defect remains'};
 f.children[2].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-review\n'+JSON.stringify(contract)+'\n```'}})+'\n');f.children[2].child.emit('close',0);
 await wait(()=>f.children.length===4);current=(await f.state()).tasks.find(t=>t.id===row.id);
 assert.equal(readFileSync(join(f.workspace,'file.txt'),'utf8'),'baseline');assert.equal(current.integration.status,'revision_required');
 assert.equal(current.recovery_history.at(-1).failure.code,'verification_failed');assert.equal(current.recovery_history.at(-1).status,'replan');
 assert.equal(f.children[3].args[f.children[3].args.indexOf('--sandbox')+1],'read-only');assert.ok(current.review_snapshot.snapshot_digest);
});

test('completed audit proposal is admitted once into automatic implementation pipeline',async t=>{
 const f=await fixture(t,{admission:true});await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});await wait(()=>f.children.length===1);
 const state=await f.state(),mission=state.tasks.find(t=>t.admission),children=f.children,calls=f.calls;
 assert.equal(mission.pipeline.auto_implement,true);assert.equal(mission.pipeline.budget_minutes,5);assert.equal(mission.goal,'Correct defect in file.txt');assert.equal(state.opportunities[0].task_id,mission.id);
 assert.equal(children[0].args[children[0].args.indexOf('--sandbox')+1],'read-only');assert.deepEqual(calls[0].options.map(o=>o.id),['admit_implementation','reject','hold']);
});

test('autonomous discovery refills below three pending proposals and stops after bounded empty audits',async t=>{
 const f=await fixture(t,{discovery:true});
 // Hold legacy execution so only scoped discovery is considered.
 await f.request('/api/tasks/'+f.row.id,{status:'backlog'},'PATCH');
 await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});
 for(let index=0;index<3;index++){
  await wait(()=>f.children.length===index+1);const child=f.children[index];
  assert.equal(child.args[child.args.indexOf('--sandbox')+1],'read-only');
  child.child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-opportunities\n[]\n```'}})+'\n');child.child.emit('close',0);
  await wait(async()=>(await f.state()).tasks.filter(t=>t.opportunity_audit&&t.discovery_result?.status==='completed_empty').length===index+1);
 }
 await new Promise(r=>setTimeout(r,2100));assert.equal(f.children.length,3);
 const policy=(await f.state()).autonomy_policies[0];assert.equal(policy.research_epoch.investigations,3);assert.equal(policy.research_epoch.reserved_minutes,30);
});

test('valid plan with optional specialty abstention gets one new coordinator question, preserving old hold',async t=>{
 const f=await fixture(t,{coordinatorHold:true,decide:input=>({ok:true,action:'recommend',selected_id:input.options.some(o=>o.id==='implement')?'implement':input.options.some(o=>o.id==='backend-lead')?'backend-lead':input.options[0].id})});
 await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'});await wait(()=>f.children.length===1);
 const row=(await f.state()).tasks[0];assert.equal(row.status,'running');assert.equal(row.specialist,'backend-lead');assert.equal(row.autonomy_history[0].status,'hold');
 assert.equal(row.specialist_selection_history.length,1);assert.equal(row.specialist_selection_history[0].previous_planning.decision.action,'abstain');
 const choices=f.calls.filter(c=>c.goal.includes('implementation-coordinator-v3'));assert.equal(choices.length,1);assert.ok(choices[0].options.length<=12);assert.equal(choices[0].options.some(o=>o.id==='react'),false);
 assert.equal(f.children[0].args[f.children[0].args.indexOf('--sandbox')+1],'workspace-write');
});

test('coordinator reconsideration excludes genuine abstentions, invalid traces and spent decision limits',()=>{
 const plan='```nexo-plan\n'+JSON.stringify({version:1,ready_for_implementation:true,pending_decisions:[],steps:['Fix file'],verification:['Test']})+'\n```';
 const trace=[{parent:null,decision:{ok:true,action:'recommend',selected_id:'backend-lead'}},{parent:'backend-lead',decision:{action:'abstain'}}];
 const row={...task('/project'),plan_report:plan,planning:{decision:{action:'abstain',selection_trace:trace}}},direction={objective:'Improve'};
 assert.equal(autonomyProposal(row,direction).eligible,true);
 for(const altered of [
 {...row,planning:{decision:{action:'abstain',selection_trace:[{parent:null,decision:{ok:true,action:'abstain'}},trace[1]]}}},
 {...row,planning:{decision:{action:'abstain',selection_trace:[trace[0],{parent:'backend-lead',decision:{action:'recommend'}}]}}},
 {...row,planning:{decision:{action:'abstain',selection_trace:[{parent:null,decision:{ok:false,action:'recommend',selected_id:'backend-lead'}},trace[1]]}}},
 {...row,planning:{decision:{action:'abstain',selection_trace:[trace[0],{parent:'frontend-lead',decision:{action:'abstain'}}]}}},
 {...row,specialist_selection_history:[{question_version:'implementation-coordinator-v3'}]},
 {...row,structured_plan:{pending_decisions:['Choose preference']}},
 {...row,autonomy_history:[{},{},{}]}
 ])assert.equal(autonomyProposal(altered,direction).eligible,false);
});
test('the flow-mode control round-trips and refuses autonomous without a saved objective',async t=>{
 const f=await fixture(t),other=join(f.dir,'no-objective');mkdirSync(other);
 assert.equal((await f.request('/api/autonomy',{workspace:f.workspace,mode:'nonsense'})).status,400);
 assert.equal((await f.request('/api/autonomy',{workspace:other,mode:'autonomous'})).status,409);
 assert.equal((await f.state()).autonomy_policies.some(p=>p.workspace===other),false);
 assert.equal((await f.request('/api/autonomy',{workspace:f.workspace,mode:'autonomous'})).status,200);
 assert.equal((await f.state()).autonomy_policies.find(p=>p.workspace===f.workspace).mode,'autonomous');
 assert.equal((await f.request('/api/autonomy',{workspace:f.workspace,mode:'supervised'})).status,200);
 assert.equal((await f.state()).autonomy_policies.find(p=>p.workspace===f.workspace).mode,'supervised');
});
