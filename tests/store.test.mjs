import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../src/store.mjs';

test('review integration lease rejects a new canonical reader until merge finishes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-integration-lease-'));
 const store=createStore(dir,{scheduler:{planning_limit:10,implementation_limit:10,review_limit:10},tasks:[
  {id:'review',workspace:dir,execution_workspace:join(dir,'isolated'),queue:{id:'q-review',phase:'review',status:'queued'}},
  {id:'reader',workspace:dir,queue:{id:'q-reader',phase:'planning',status:'queued'}}
 ]});
 try{
  const state=store.load();assert.equal(store.claim(state,'review'),true);const task=state.tasks.find(t=>t.id==='review');
  store.transition(task,'starting');store.transition(task,'running');store.save(state);assert.equal(store.acquireIntegration(task),true);
  assert.equal(store.sql.prepare('SELECT phase FROM attempts WHERE id=?').get(task.attempt.id).phase,'implementation');
  assert.equal(store.claim(state,'reader'),false);
  store.transition(task,'terminal');store.save(state);assert.equal(store.claim(state,'reader'),true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed transaction rolls back mission and receipt together and a stale revision cannot overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-rollback-')),a=createStore(dir,{tasks:[{id:'one',title:'Original'}]}),b=createStore(dir,{});
 try{
  const first=a.load(),stale=b.load();
  assert.throws(()=>a.transaction(()=>{first.tasks[0].title='Rolled back';a.save(first);a.sql.prepare('INSERT INTO receipts VALUES(?,?,?)').run('failed','hash','{}');throw Error('commit interrupted');}));
  assert.equal(a.load().tasks[0].title,'Original');assert.equal(a.sql.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,0);
  const current=a.load();current.tasks[0].title='Committed';a.save(current);
  stale.tasks[0].title='Stale';assert.throws(()=>b.save(stale),error=>error.status===409);
  assert.equal(a.load().tasks[0].title,'Committed');
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test('writer contention cannot create a receipt or call admission effects',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-busy-')),a=createStore(dir,{tasks:[{id:'one'}]}),b=createStore(dir,{});
 try{
  const state=b.load();let effects=0;b.sql.exec('PRAGMA busy_timeout=0');a.sql.exec('BEGIN IMMEDIATE');
  assert.throws(()=>b.admit(state,'one','run',{request_id:'busy'},()=>{effects++;return {};}),/locked/);
  a.sql.exec('ROLLBACK');assert.equal(effects,0);assert.equal(a.sql.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,0);
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test('refresh skips unchanged remote state, merges real remote changes and conflicts on drift',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-refresh-')),a=createStore(dir,{tasks:[{id:'one',title:'A'}]}),b=createStore(dir,{});
 try{
  const state=a.load();
  // Remote unchanged: local pending mutation stays on the same object, no re-read needed.
  const before=state.tasks[0];before.note='pending';
  assert.equal(a.refresh(state),state);assert.equal(state.tasks[0],before);assert.equal(before.note,'pending');
  a.save(state);
  // Remote change by another supervisor still merges into the same local object.
  const other=b.load();other.tasks[0].title='Remote';b.save(other);
  a.refresh(state);assert.equal(state.tasks[0],before);assert.equal(state.tasks[0].title,'Remote');assert.equal(state.tasks[0].note,'pending');
  // Local drift plus any remote change still conflicts instead of being silently dropped.
  const remote=b.load();remote.tasks[0].title='Again';b.save(remote);
  state.tasks[0].note='dirty';assert.throws(()=>a.refresh(state),error=>error.status===409);
  // discard restores local objects to remote content even when the entity set did not move.
  a.refresh(state,true);assert.equal(state.tasks[0].note,'pending');assert.equal(state.tasks[0].title,'Again');
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test('migration rejects duplicate mission IDs atomically and can retry after source repair',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-bad-import-')),file=join(dir,'state.json');
 try{
  writeFileSync(file,JSON.stringify({tasks:[{id:'same',goal:'A'},{id:'same',goal:'B'}]}));
  assert.throws(()=>createStore(dir,{}),/duplicad/i);
  const check=new DatabaseSync(join(dir,'state.sqlite'));assert.equal(check.prepare('SELECT COUNT(*) AS n FROM entities').get().n,0);assert.equal(check.prepare('SELECT COUNT(*) AS n FROM metadata').get().n,0);check.close();
  writeFileSync(file,JSON.stringify({tasks:[{id:'same',goal:'A'}]}));const store=createStore(dir,{});assert.equal(store.load().tasks[0].goal,'A');store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
