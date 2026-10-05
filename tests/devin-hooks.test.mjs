import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const script=name=>join(process.cwd(),'scripts',name);
const run=(name,input,env)=>spawnSync(process.execPath,[script(name)],{input,encoding:'utf8',env:{...process.env,...env},timeout:20000});

test('the prompt hook injects the project snapshot as additional context and never blocks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-devin-hook-')),project=join(dir,'repo');mkdirSync(project);
 try{
  writeFileSync(join(dir,'state.json'),JSON.stringify({tasks:[{id:'t1',workspace:project,title:'Minha missão',status:'backlog',agent:'codex'},{id:'t2',workspace:join(dir,'other'),title:'Outro projeto',status:'backlog',agent:'codex'}]}));
  const out=run('devin-hook-context.mjs',JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'s'}),{JEV_MISSION_DATA_DIR:dir,DEVIN_PROJECT_DIR:project});
  assert.equal(out.status,0);
  const payload=JSON.parse(out.stdout).hookSpecificOutput;
  assert.equal(payload.hookEventName,'UserPromptSubmit');
  assert.match(payload.additionalContext,/Minha missão/);
  assert.doesNotMatch(payload.additionalContext,/Outro projeto/);
  const start=JSON.parse(run('devin-hook-context.mjs',JSON.stringify({hook_event_name:'SessionStart'}),{JEV_MISSION_DATA_DIR:dir,DEVIN_PROJECT_DIR:project}).stdout);
  assert.equal(start.hookSpecificOutput.hookEventName,'SessionStart');
  for(const bad of ['','not json','{']){const result=run('devin-hook-context.mjs',bad,{JEV_MISSION_DATA_DIR:dir,DEVIN_PROJECT_DIR:project});assert.equal(result.status,0);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the observation hook records tool metadata only and tolerates garbage',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-devin-observe-'));
 try{
  const secret='SEGREDO-NAO-GRAVAR';
  const out=run('devin-hook-observe.mjs',JSON.stringify({hook_event_name:'PostToolUse',session_id:'s9',tool_name:'exec',tool_input:{command:'echo '+secret},tool_response:{output:secret}}),{JEV_MISSION_DATA_DIR:dir,DEVIN_PROJECT_DIR:'C:/proj'});
  assert.equal(out.status,0);assert.equal(out.stdout,'');
  const files=['events.ndjson','events.jsonl'].map(name=>join(dir,name)).filter(existsSync);
  assert.ok(files.length,'an events journal was written');
  const journal=readFileSync(files[0],'utf8');
  assert.match(journal,/"tool_observed"/);assert.match(journal,/"tool":"exec"/);assert.match(journal,/s9/);
  assert.ok(!journal.includes(secret));
  assert.equal(run('devin-hook-observe.mjs','not json',{JEV_MISSION_DATA_DIR:dir}).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the start hook is silent and exits at once even when the panel cannot be started',()=>{
 const result=run('devin-hook-start.mjs','{}',{NEXO_HOOK_DRY_RUN:'1'});
 assert.equal(result.status,0);assert.equal(result.stdout,'');
});
