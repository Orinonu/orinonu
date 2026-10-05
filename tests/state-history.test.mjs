import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,appendFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createMissionServer as candidate} from '../src/server.mjs';
import {createMissionServer as reference} from './reference/server.mjs';
import {historyFixture,writeHistoryFixture,normalizedState} from './fixtures/state-history.mjs';
import {createStore} from '../src/store.mjs';

for(const historyVerification of ['bytes','digest']){
 test(`HTTP ${historyVerification} preserves the complete reference response and notices external history and task updates`,async()=>{
  const dirs=[mkdtempSync(join(tmpdir(),'nexo-before-')),mkdtempSync(join(tmpdir(),'nexo-after-'))];
  const fixture=historyFixture(2005,8);dirs.forEach(d=>writeHistoryFixture(d,fixture));
  const apps=[reference({dataDir:dirs[0]}),candidate({dataDir:dirs[1],historyVerification})];
  await Promise.all(apps.map(a=>a.listen(0)));
  const read=async app=>{const r=await fetch(app.url+'/api/state');assert.equal(r.status,200);return normalizedState(await r.json());};
  try{
   assert.deepEqual(await read(apps[1]),await read(apps[0]));
   const before=apps[1].historyDiagnostics();
   const burst=await Promise.all(Array.from({length:16},()=>read(apps[1])));
   assert.ok(burst.every(s=>s.metrics.jev_calls===fixture.events.filter(e=>e.provider==='typesafe').length));
   assert.deepEqual(apps[1].historyDiagnostics(),before);
   const addition=JSON.stringify({provider:'typesafe',ok:true,task_id:'t0',model:'jev-1.13.0',usage:{input_tokens:999,output_tokens:2}})+'\n';
   for(const dir of dirs)execFileSync(process.execPath,['--input-type=module','-e',"import {appendFileSync} from 'node:fs';appendFileSync(process.argv[1],process.argv[2]);",join(dir,'events.ndjson'),addition],{windowsHide:true});
   assert.deepEqual(await read(apps[1]),await read(apps[0]));
   assert.equal(apps[1].historyDiagnostics().reader.parsedLines-before.reader.parsedLines,1);
   for(const dir of dirs){const store=createStore(dir,{tasks:[]});const db=store.load();db.tasks[0].title='Externally updated';db.tasks[0].measurement.usage.input_tokens=99;store.save(db);store.close();}
   assert.deepEqual(await read(apps[1]),await read(apps[0]));
   for(const dir of dirs)writeFileSync(join(dir,'events.ndjson'),JSON.stringify(fixture.events[0]));
   assert.deepEqual(await read(apps[1]),await read(apps[0]));
   for(const dir of dirs)appendFileSync(join(dir,'events.ndjson'),'\n'+addition);
   assert.deepEqual(await read(apps[1]),await read(apps[0]));
  }finally{await Promise.all(apps.map(a=>a.close()));dirs.forEach(d=>rmSync(d,{recursive:true,force:true}));}
 });
}
