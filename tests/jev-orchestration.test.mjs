import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';

const wait=async(fn,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await new Promise(r=>setTimeout(r,15));}return false;};
const profiles={design:{model:'gpt-6.1-sol',effort:'medium',skill:'grill-with-docs'},discovery:{model:'gpt-6.1-sol',effort:'medium',skill:'wayfinder'},implementation:{model:'gpt-6.1-sol',effort:'medium',skill:'tdd'},review:{model:'gpt-6-luna',effort:'medium',skill:'code-review'}};
const promptOf=entry=>entry.args.at(-1)==='-'?entry.child.stdinText:entry.args.at(-1);

async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'nexo-orchestration-')),workspace=join(dir,'project'),dataDir=join(dir,'state');mkdirSync(workspace);writeFileSync(join(workspace,'file.txt'),'baseline');
 const store=createStore(dataDir,{tasks:[],profiles}),db=store.load();
 db.tasks=[{id:'mission-a',workspace,title:'Fix defect',goal:'Edit the existing defect in file.txt',acceptance:'Tests pass',status:'backlog',agent:'codex',profile:'design',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z'}];
 db.project_directions=[{workspace,objective:'Improve this project',success_criteria:'Real changes tested',mission:'Ship reliable autonomy',vision:'Nothing stalls',values:'Evidence first',principles:'Code validates, JEV recommends',repositories:[]}];
 db.autonomy_policies=[{workspace,mode:'autonomous',discovery_enabled:false}];
 store.save(db);store.close();
 const decisions=[],children=[];
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,options});return child;};
 const engine={call:async(name,input,signal,policy)=>{
  if(name==='rank_missions')return {ok:true,priority:input.candidates.map(c=>({id:c.id,score:2,confidence:0.9}))};
  if(name==='evaluate_conditions')return {ok:true,conditions:input.conditions.map(c=>({id:c.id,p_yes:0.5}))};
  decisions.push({input,policy});
  return {ok:true,action:'recommend',selected_id:input.options[0].id};
 }};
 const app=createMissionServer({dataDir,runner,decisionEngine:engine,codexPath:process.execPath,isolationRoot:join(dir,'isolated')});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 return {decisions,children};
}
const ask=(f,pattern)=>f.decisions.find(entry=>pattern.test(entry.input.goal));

test('read-only planning offers only the planning profiles and every reversible host decision declares its stakes',async t=>{
 const f=await fixture(t);
 assert.ok(await wait(()=>f.children.length>=1&&ask(f,/Escolha especialista/)),'The mission must reach planning with a selected specialist.');

 const phase=ask(f,/Choose only the next phase/);
 assert.deepEqual(phase.policy,{stakes:'reversible'});

 const stage=ask(f,/Escolha etapa/);
 assert.deepEqual(stage.input.options.map(option=>option.id),['design','discovery']);
 assert.deepEqual(stage.policy,{stakes:'reversible',defaultId:'design'});

 const specialist=ask(f,/Escolha especialista/);
 assert.equal(specialist.policy.stakes,'reversible');
 assert.equal(specialist.policy.defaultId,'generalist');
 assert.ok(specialist.input.options.some(option=>option.id==='generalist'));
});

test('the planner is told that a Jev abstention on a reversible technical choice is not a pending decision',async t=>{
 const f=await fixture(t);
 assert.ok(await wait(()=>f.children.length>=1));
 const prompt=promptOf(f.children[0]);
 assert.match(prompt,/reversible-v1/);
 assert.match(prompt,/abstenção do JEV em escolha técnica reversível não é pendência/);
 assert.match(prompt,/opção reversível mais conservadora/);
});
