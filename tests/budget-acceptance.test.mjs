import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore} from '../src/store.mjs';
import {createBudgetLedger} from '../src/budget-ledger.mjs';
import {normalizeBudgetUsage} from '../src/budget-usage.mjs';
const phases=['planning','implementation','review','recovery','jev'];
const policy=(limit=10,unknown_policy='retain_reservation')=>({version:1,enabled:true,activation:'from_configuration',unknown_policy,limits:{total_tokens:limit},envelopes:Object.fromEntries(phases.map(p=>[p,{total_tokens:6}]))});
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'budget-accept-')),store=createStore(dir,{tasks:[],opportunities:[]});return {dir,store,b:createBudgetLedger(store),close(){store.close();rmSync(dir,{recursive:true,force:true});}};};
const op=(dir,id='a',phase='implementation')=>({id,workspace:dir,task_id:'mission',phase,provider:'synthetic'});
const event=(event_id,revision,total_tokens,mode='delta')=>({event_id,revision,mode,usage:{total_tokens},source:'independent-fixture',observed_at:'2026-10-04T00:00:00Z'});
test('two OS writers sharing SQLite admit exactly one incompatible envelope',{timeout:10000},async()=>{
 const x=setup();let children=[];
 try{
  x.b.configure({workspace:x.dir},policy(),{expected_revision:0,request_id:'config'});
  children=await Promise.all(['a','b'].map(async id=>{const c=fork(fileURLToPath(new URL('./fixtures/budget-worker.mjs',import.meta.url)),[x.dir,id],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});await once(c,'message');return c;}));
  const responses=children.map(c=>once(c,'message'));const exits=children.map(c=>once(c,'exit'));children.forEach(c=>c.send('reserve'));
  const rows=(await Promise.all(responses)).map(([r])=>r);await Promise.all(exits);
  assert.equal(rows.filter(r=>r.admitted).length,1);assert.equal(rows.find(r=>!r.admitted).reason,'budget_exhausted');assert.equal(x.b.summary({workspace:x.dir}).reserved.total_tokens,6);
 }finally{children.forEach(c=>{if(c.exitCode===null)c.kill();});x.close();}
});
test('mission insufficiency rolls back the project exposure; all phases obey the same ceiling',()=>{
 const x=setup();try{
  x.b.configure({workspace:x.dir},policy(100),{expected_revision:0,request_id:'project'});
  x.b.configure({workspace:x.dir,task_id:'mission'},policy(0),{expected_revision:0,request_id:'mission'});
  for(const phase of phases)assert.throws(()=>x.b.reserve(op(x.dir,phase,phase)),/budget_exhausted/);
  assert.equal(x.b.summary({workspace:x.dir}).reserved.total_tokens,0);
 }finally{x.close();}
});
test('restart retains unknown exposure; late correction and replay update only accounting',()=>{
 const x=setup();let restarted;
 try{
  x.b.configure({workspace:x.dir},policy(12,'block'),{expected_revision:0,request_id:'config'});x.b.reserve(op(x.dir));x.b.authorizeStart('a');x.b.settle('a');
  restarted=createStore(x.dir,{tasks:[],opportunities:[]});const b=createBudgetLedger(restarted);
  assert.equal(b.summary({workspace:x.dir}).observed.total_tokens,null);assert.throws(()=>b.reserve(op(x.dir,'b')),/budget_unknown/);
  b.reconcile('a',event('turn',1,4),{complete:['total_tokens']});b.reconcile('a',event('turn',1,4),{complete:['total_tokens']});
  assert.equal(b.summary({workspace:x.dir}).known.total_tokens,4);
  assert.throws(()=>b.observe('a',event('turn',1,7)),/budget_receipt_conflict/);
  b.reconcile('a',event('turn',2,8),{complete:['total_tokens']});assert.equal(b.summary({workspace:x.dir}).known.total_tokens,8);
  assert.throws(()=>b.reserve(op(x.dir,'b')),/budget_exhausted/);
  b.reconcile('a',event('turn',3,3),{complete:['total_tokens']});b.reserve(op(x.dir,'b'));assert.equal(b.summary({workspace:x.dir}).reserved.total_tokens,6);
 }finally{restarted?.close();x.close();}
});
test('out of order cumulative snapshots do not add together; unknown is never zero',()=>{
 const x=setup();try{
  x.b.configure({workspace:x.dir},policy(100),{expected_revision:0,request_id:'config'});x.b.reserve(op(x.dir));x.b.authorizeStart('a');
  x.b.observe('a',event('later',2,11,'snapshot'));x.b.observe('a',event('earlier',1,5,'snapshot'));
  assert.equal(x.b.summary({workspace:x.dir}).known.total_tokens,11);assert.equal(x.b.summary({workspace:x.dir}).reserved.total_tokens,0);
  assert.throws(()=>x.b.release('a'),/budget_release_unproven/);
  assert.equal(normalizeBudgetUsage({input_tokens:10,output_tokens:5,cached_input_tokens:9,reasoning_tokens:4}).usage.total_tokens,15);
  assert.equal(normalizeBudgetUsage({}).usage.billed_usd_micro,null);
 }finally{x.close();}
});
test('billed, estimated and quota stay independent; ongoing call may exceed the ceiling',()=>{
 const x=setup();try{
  const p=policy();p.limits={billed_usd_micro:100,estimated_usd_micro:200};p.envelopes=Object.fromEntries(phases.map(k=>[k,{billed_usd_micro:50,estimated_usd_micro:70}]));
  x.b.configure({workspace:x.dir},p,{expected_revision:0,request_id:'config'});x.b.reserve(op(x.dir));x.b.authorizeStart('a');
  const normalized=normalizeBudgetUsage({billed_usd_micro:120,billing_evidence:'synthetic-invoice:1',estimated_usd_micro:60,estimate_provenance:{model:'fixture',source:'fixed-test-rate',date:'2026-10-04',currency:'USD'},quota:{unit:'requests',remaining:8}});
  x.b.reconcile('a',{...normalized,event_id:'invoice',revision:1,mode:'snapshot'},{complete:['billed_usd_micro','estimated_usd_micro']});
  const summary=x.b.summary({workspace:x.dir});assert.equal(summary.observed.billed_usd_micro,120);assert.equal(summary.observed.estimated_usd_micro,60);assert.equal(summary.quota,null);assert.throws(()=>x.b.reserve(op(x.dir,'b')),/budget_exhausted/);
 }finally{x.close();}
});

test('partial delta retains known subtotal while completeness stays unknown',()=>{
 const x=setup();try{x.b.configure({workspace:x.dir},policy(20),{expected_revision:0,request_id:'config'});x.b.reserve(op(x.dir));x.b.authorizeStart('a');x.b.observe('a',event('known',1,4));x.b.observe('a',{...event('partial',1,null),usage:{input_tokens:2,total_tokens:null}});const summary=x.b.summary({workspace:x.dir});assert.equal(summary.known.total_tokens,4);assert.equal(summary.observed.total_tokens,null);assert.equal(summary.reserved.total_tokens,2);}finally{x.close();}
});
