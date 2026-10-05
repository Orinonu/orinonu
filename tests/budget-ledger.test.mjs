import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {createBudgetLedger} from '../src/budget-ledger.mjs';
export const policy=(limit=10,unknown_policy='retain_reservation')=>({version:1,enabled:true,activation:'from_configuration',unknown_policy,limits:{total_tokens:limit},envelopes:Object.fromEntries(['planning','implementation','review','recovery','jev'].map(p=>[p,{total_tokens:6}]))});
test('atomic reservations enforce both scopes and replay never spends twice',()=>{
 const dir=mkdtempSync(join(tmpdir(),'budget-'));const s=createStore(dir,{tasks:[],opportunities:[]}),b=createBudgetLedger(s),scope={workspace:dir};
 try{
  b.configure(scope,policy(),{expected_revision:0,request_id:'config'});
  const op={id:'one',workspace:dir,task_id:'mission',phase:'implementation',provider:'synthetic'};
  b.reserve(op);b.reserve(op);assert.equal(b.summary(scope).reserved.total_tokens,6);
  assert.throws(()=>b.reserve({...op,id:'two'}),/budget_exhausted/);
  b.authorizeStart('one');
  b.observe('one',{event_id:'turn',revision:1,mode:'delta',usage:{total_tokens:4},source:'synthetic',observed_at:'2026-10-04'});
  b.observe('one',{event_id:'turn',revision:1,mode:'delta',usage:{total_tokens:4},source:'synthetic',observed_at:'2026-10-04'});
  b.settle('one',{complete:['total_tokens']});
  assert.equal(b.summary(scope).known.total_tokens,4);assert.equal(b.summary(scope).reserved.total_tokens,0);
  b.reserve({...op,id:'two'});assert.equal(b.summary(scope).reserved.total_tokens,6);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
