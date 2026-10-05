import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';
import {checklistFrom,parseArguments} from '../scripts/mission-control-cli.mjs';

const cli=join(process.cwd(),'scripts','mission-control-cli.mjs');
const run=(url,args,env={})=>new Promise(resolve=>execFile(process.execPath,[cli,...args],{env:{...process.env,NEXO_URL:url,...env},timeout:20000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));

test('checklist and option parsing are strict and produce stable identifiers',()=>{
 const items=checklistFrom('Ler a missão | Implementar o ajuste | Rodar os testes');
 assert.deepEqual(items.map(item=>item.id),['ler-a-missao-1','implementar-o-ajuste-2','rodar-os-testes-3']);
 assert.ok(items.every(item=>item.done===false));
 assert.throws(()=>checklistFrom(''),/1 a 100/);
 assert.throws(()=>checklistFrom(Array.from({length:101},(_,index)=>'x'+index).join('|')),/1 a 100/);
 assert.deepEqual(parseArguments(['claim','abc','--items','a|b','--phase','implementation']),{positional:['claim','abc'],options:{items:'a|b',phase:'implementation'}});
});

test('a session lists, reserves, reports progress and releases a mission through the local API',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-cli-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);
 const store=createStore(dataDir,{tasks:[],profiles:{}}),db=store.load();
 const id=randomUUID(),other=randomUUID();
 db.tasks=[{id,workspace,title:'Fix the defect',goal:'Edit file.txt',acceptance:'Tests pass',status:'backlog',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z'},
  {id:other,workspace,title:'Second mission',goal:'Other',acceptance:'Other',status:'blocked',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:01Z'}];
 store.save(db);store.close();
 const app=createMissionServer({dataDir,codexPath:process.execPath});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json()).tasks.find(row=>row.id===id);

 const listed=await run(app.url,['list','--workspace',workspace,'--status','backlog,blocked']);
 assert.equal(listed.code,0);assert.match(listed.stdout,/2\/2 missões/);assert.match(listed.stdout,/Fix the defect/);

 const shown=await run(app.url,['show',id.slice(0,8)]);
 assert.equal(shown.code,0);assert.match(shown.stdout,/Edit file\.txt/);

 const claimed=await run(app.url,['claim',id.slice(0,8),'--items','Ler|Implementar|Testar','--session','devin-1','--owner','devin']);
 assert.equal(claimed.code,0,claimed.stderr);
 assert.equal((await state()).external_work.status,'active');
 // A second session cannot take the same mission.
 const rival=await run(app.url,['claim',id.slice(0,8),'--items','x','--session','other-session','--owner','codex']);
 assert.notEqual(rival.code,0);assert.match(rival.stderr,/reservou/);

 const unfinished=await run(app.url,['finish',id.slice(0,8),'--session','devin-1','--owner','devin']);
 assert.notEqual(unfinished.code,0);assert.match(unfinished.stderr,/Checklist incompleto/);

 const checked=await run(app.url,['check',id.slice(0,8),'ler-1','implementar-2','testar-3','--session','devin-1','--owner','devin']);
 assert.equal(checked.code,0,checked.stderr);
 const unknown=await run(app.url,['check',id.slice(0,8),'nao-existe','--session','devin-1','--owner','devin']);
 assert.notEqual(unknown.code,0);

 const finished=await run(app.url,['finish',id.slice(0,8),'--session','devin-1','--owner','devin']);
 assert.equal(finished.code,0,finished.stderr);
 const after=await state();
 assert.equal(after.external_work.status,'ready_for_integration');
 assert.equal(after.status,'review');
 assert.notEqual(after.status,'done');

 const receipt=await run(app.url,['receipt',other.slice(0,8),'--items','Verificado nos testes existentes','--session','devin-1','--owner','devin']);
 assert.equal(receipt.code,0,receipt.stderr);
 const second=(await(await fetch(app.url+'/api/state')).json()).tasks.find(row=>row.id===other);
 assert.equal(second.external_work.status,'ready_for_integration');
 assert.notEqual(second.status,'done');
 const missing=await run(app.url,['show','ffffffff']);
 assert.notEqual(missing.code,0);assert.match(missing.stderr,/não encontrada/);
});
