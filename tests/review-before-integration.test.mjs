import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMissionServer} from '../src/server.mjs';
import {readReviewContract} from '../src/review-contract.mjs';
import {coverage} from './helpers/review-coverage.mjs';
const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out');};
for(const scenario of ['approved','rejected','abstained','missing','wrong-digest','snapshot-changed','canonical-conflict','cancelled','jev-abstention','review-coordinator'])test(`review before integration: ${scenario}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'nexo-review-gate-')),source=join(root,'project'),children=[];mkdirSync(source);writeFileSync(join(source,'file.txt'),'original');
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.resume();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,cwd:options.cwd});return child;};
 const decisionEngine={call:async(_,input)=>scenario==='review-coordinator'?(input.options.some(o=>o.id==='security-reviewer')?{ok:true,action:'abstain',reason:'Unnecessary narrowing'}:{ok:true,action:'recommend',selected_id:'reviewer'}):scenario==='jev-abstention'?{ok:true,action:'abstain',reason:'No reviewer'}:{ok:true,action:'recommend',selected_id:input.options[0].id}};
 const app=createMissionServer({dataDir:join(root,'state'),isolationRoot:join(root,'isolated'),runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json()).tasks[0];
 try{
  const task=await(await post('/api/tasks',{title:'Gate',workspace:source,goal:'Defined change',acceptance:'Preserve compatibility and verify tests',agent:'codex',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/run`,{});await wait(()=>children.length===1);const isolated=children[0].cwd;writeFileSync(join(isolated,'file.txt'),'implementation');children[0].child.emit('close',0);
  if(scenario==='jev-abstention'){await wait(async()=>(await state()).status==='blocked');assert.equal(children.length,1);assert.equal(readFileSync(join(source,'file.txt'),'utf8'),'original');return;}
  await wait(()=>children.length===2);const reviewer=children[1];assert.equal(readFileSync(join(source,'file.txt'),'utf8'),'original');assert.equal(reviewer.cwd,isolated);assert.equal(reviewer.args[reviewer.args.indexOf('--sandbox')+1],'read-only');
  let current=await state();assert.equal(current.integration.status,'awaiting_review');assert(current.implementation_run.measurement);assert.equal(current.implementation_run.attempt_id,current.review_snapshot.implementation_attempt_id);
  if(scenario==='cancelled'){await post(`/api/tasks/${task.id}/stop`,{});await wait(async()=>(await state()).status==='blocked');assert.equal(readFileSync(join(source,'file.txt'),'utf8'),'original');return;}
  const contract={version:1,snapshot_digest:scenario==='wrong-digest'?'0'.repeat(64):current.review_snapshot.snapshot_digest,decision:['rejected','abstained'].includes(scenario)?scenario:'approved',...coverage(current.review_snapshot,scenario==='rejected'?'failed':'passed',['file.txt:1; synthetic test fixture']),reason:'Fixture evidence'};
  const text=scenario==='missing'?'Looks good, accepted':'```nexo-review\n'+JSON.stringify(contract)+'\n```';reviewer.child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})+'\n');await state();
  if(scenario==='snapshot-changed')writeFileSync(join(isolated,'file.txt'),'tampered after review');
  if(scenario==='canonical-conflict')writeFileSync(join(source,'file.txt'),'concurrent edit');
  reviewer.child.emit('close',0);await wait(async()=>['merged','blocked','revision_required'].includes((await state()).integration?.status));current=await state();
  if(['approved','review-coordinator'].includes(scenario)){assert.equal(current.integration.status,'merged');assert.equal(current.status,'done');assert.equal(current.pipeline.status,'done');assert.equal(readFileSync(join(source,'file.txt'),'utf8'),'implementation');assert(current.integration.review_attempt_id);assert.equal(children.length,2);}
  else{assert.equal(current.integration.status,['rejected','abstained'].includes(scenario)?'revision_required':'blocked');assert.equal(readFileSync(join(source,'file.txt'),'utf8'),scenario==='canonical-conflict'?'concurrent edit':'original');assert.equal(readFileSync(join(isolated,'file.txt'),'utf8'),scenario==='snapshot-changed'?'tampered after review':'implementation');assert(current.implementation_run);}
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
test('review approval requires nonempty passed checks with evidence, not a prose assertion',()=>{
 const digest='1'.repeat(64),wrap=value=>'```nexo-review\n'+JSON.stringify(value)+'\n```';
 for(const checks of [[],[{criterion:'Test',status:'unknown',evidence:['ref']}],[{criterion:'Test',status:'passed',evidence:[]}]])assert.throws(()=>readReviewContract(wrap({version:1,snapshot_digest:digest,decision:'approved',checks,reason:''}),digest));
 assert.throws(()=>readReviewContract('Approved',digest));
});
