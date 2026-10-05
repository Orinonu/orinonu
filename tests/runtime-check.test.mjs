import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {checkRuntime,formatRuntime,atLeast,MIN_SQLITE,MIN_NODE_MAJOR,VERIFIED_RUNTIMES} from '../src/runtime-check.mjs';

const fakeSqlite=version=>async()=>({DatabaseSync:class{prepare(){return {get:()=>({version})};}close(){}}});

test('SQLite versions compare numerically and the required floor is explicit',()=>{
 assert.equal(MIN_SQLITE,'3.51.3');
 assert.equal(atLeast('3.51.3','3.51.3'),true);
 assert.equal(atLeast('3.51.2','3.51.3'),false);
 assert.equal(atLeast('3.9.9','3.51.3'),false);
 assert.equal(atLeast('3.100.0','3.51.3'),true);
 assert.equal(atLeast('4.0.0','3.51.3'),true);
});

test('a compatible runtime passes and reports its SQLite',async()=>{
 const result=await checkRuntime({nodeVersion:'24.21.0',loadSqlite:fakeSqlite('3.53.4')});
 assert.deepEqual([result.ok,result.sqlite,result.problems.length,result.warnings.length],[true,'3.53.4',0,0]);
 assert.equal(formatRuntime(result),'Runtime ready: Node 24.21.0, SQLite 3.53.4');
});

test('a Node without node:sqlite, an old SQLite and an unusable SQLite each get an actionable diagnosis',async()=>{
 const missing=await checkRuntime({nodeVersion:'20.11.0',loadSqlite:async()=>{throw Object.assign(new Error('No such built-in module: node:sqlite'),{code:'ERR_UNKNOWN_BUILTIN_MODULE'});}});
 assert.equal(missing.ok,false);
 assert.equal(missing.problems[0].code,'sqlite_module_missing');
 assert.match(missing.problems[0].action,new RegExp('Node '+MIN_NODE_MAJOR));
 assert.equal(missing.warnings[0].code,'node_not_verified');
 assert.match(formatRuntime(missing),/Runtime incompatível/);
 assert.match(formatRuntime(missing),/Ação:/);

 const old=await checkRuntime({nodeVersion:'22.12.0',loadSqlite:fakeSqlite('3.45.1')});
 assert.equal(old.ok,false);
 assert.equal(old.problems[0].code,'sqlite_too_old');
 assert.match(old.problems[0].message,/3\.45\.1/);
 assert.match(old.problems[0].message,/3\.51\.3/);
 assert.match(old.problems[0].action,/24\.21\.0/);

 const broken=await checkRuntime({nodeVersion:'24.21.0',loadSqlite:async()=>({DatabaseSync:class{constructor(){throw new Error('unable to open database');}}})});
 assert.equal(broken.ok,false);
 assert.equal(broken.problems[0].code,'sqlite_unusable');
 assert.match(broken.problems[0].message,/unable to open database/);
});

test('an unverified Node line is only a warning when its bundled SQLite passes',async()=>{
 const result=await checkRuntime({nodeVersion:'22.20.0',loadSqlite:fakeSqlite('3.51.3')});
 assert.equal(result.ok,true);
 assert.equal(result.warnings[0].code,'node_not_verified');
 assert.match(formatRuntime(result),/Aviso: Node 22\.20\.0 não foi verificado/);
});

test('package metadata and README describe exactly the verified runtimes',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')),readme=readFileSync('README.md','utf8');
 assert.equal(pkg.engines.node,'>='+MIN_NODE_MAJOR);
 assert.match(pkg.scripts.start,/check-runtime/);
 assert.ok(pkg.scripts['check:runtime']);
 for(const row of VERIFIED_RUNTIMES){assert.ok(readme.includes('Node '+row.node),row.node);assert.ok(readme.includes('SQLite '+row.sqlite));}
 assert.ok(readme.includes('SQLite >= '+MIN_SQLITE));
 assert.doesNotMatch(readme,/Requer Node\.js 22\+/);
});

test('the command line check passes on the running runtime and on every other declared-compatible runtime found here',()=>{
 const out=execFileSync(process.execPath,['scripts/check-runtime.mjs'],{encoding:'utf8'});
 assert.match(out,/Runtime ready: Node \d+\.\d+\.\d+, SQLite 3\.\d+\.\d+/);
 const root=join(process.env.LOCALAPPDATA??'','OpenAI','Codex','runtimes','cua_node');
 const others=existsSync(root)?readdirSync(root).map(name=>join(root,name,'bin','node.exe')).filter(existsSync):[];
 for(const node of others){
  const run=spawnSync(node,['scripts/check-runtime.mjs'],{encoding:'utf8'});
  assert.equal(run.status,0,node+'\n'+run.stderr);
  assert.match(run.stdout,/Runtime ready/);
 }
});
