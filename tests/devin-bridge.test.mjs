import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run,authPreflight,devinArguments,permissionConfig,parseBridgeArguments,READ_ONLY_PERMISSIONS,WRITE_PERMISSIONS} from '../scripts/devin-bridge.mjs';
import {buildProviderExecution,defaultDevinCli} from '../src/providers.mjs';

const base=['--devin','C:/fake/devin.exe','--cwd','C:/fake/work','--prompt-file','C:/fake/prompt.txt'];
const loggedIn=()=>({status:0,stdout:'Logged in as someone',stderr:''});
function fakeChild(script){
 const calls=[];
 const spawnImpl=(command,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);
  calls.push({command,args,options,config:existsSync(args[args.indexOf('--config')+1])?JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8')):null});
  queueMicrotask(()=>script(child));
  return child;
 };
 return {spawnImpl,calls};
}
async function exercise(mode,{auth=loggedIn,script,extra=[]}={}){
 const lines=[],fake=fakeChild(script??(child=>{child.stdout.end('Plano final\n');child.emit('close',0);}));
 const code=await run([...base,'--mode',mode,...extra],{spawnImpl:fake.spawnImpl,spawnSyncImpl:auth,write:text=>lines.push(JSON.parse(text))});
 return {code,events:lines,calls:fake.calls};
}

test('write-mode bridge requests cannot start a process or authenticate without a verified isolation boundary',async()=>{
 let authCalls=0;
 const result=await exercise('write',{auth:()=>{authCalls++;return loggedIn();}});
 assert.equal(result.code,2);
 assert.equal(result.calls.length,0);
 assert.equal(authCalls,0);
 assert.equal(result.events.at(-1).type,'turn.failed');
 assert.match(result.events.at(-1).error.message,/isolamento|sandbox/i);
});

test('a successful run is reported as the NDJSON events the supervisor reads, without invented usage',async()=>{
 const {code,events,calls}=await exercise('read-only');
 assert.equal(code,0);
 assert.deepEqual(events.map(event=>event.type),['thread.started','turn.started','item.completed','turn.completed']);
 assert.equal(events[2].item.type,'agent_message');assert.equal(events[2].item.text,'Plano final');
 assert.equal(events[3].usage,undefined);
 assert.match(events[0].thread_id,/^devin-/);
 assert.equal(calls.length,1);
});

test('read-only phases deny edits and commands and preserve workspace trust; write configuration grants no commands',async()=>{
 const readOnly=await exercise('read-only',{extra:['--model','opus']});
 assert.deepEqual(readOnly.calls[0].config,{permissions:READ_ONLY_PERMISSIONS});
 assert.ok(readOnly.calls[0].config.permissions.deny.includes('edit')&&readOnly.calls[0].config.permissions.deny.includes('exec'));
 assert.deepEqual(readOnly.calls[0].args.slice(0,1),['-p']);
 assert.equal(readOnly.calls[0].args[readOnly.calls[0].args.indexOf('--permission-mode')+1],'auto');
 assert.equal(readOnly.calls[0].args[readOnly.calls[0].args.indexOf('--model')+1],'opus');
 assert.equal(readOnly.calls[0].args[readOnly.calls[0].args.indexOf('--respect-workspace-trust')+1],'true');
 for(const command of ['edit','exec','Write(**)','Exec(rm)','Exec(sudo)','Exec(git push)','Exec(curl)','Write(.env*)'])assert.ok(WRITE_PERMISSIONS.deny.includes(command),command);
 assert.deepEqual(WRITE_PERMISSIONS.allow,[]);
 assert.equal(readOnly.calls[0].options.cwd,'C:/fake/work');
 assert.deepEqual(permissionConfig('write'),{permissions:WRITE_PERMISSIONS});
 assert.deepEqual(devinArguments({promptFile:'p',mode:'read-only',configPath:'c'}).includes('--model'),false);
});

test('an unauthenticated or unverifiable CLI is refused before anything is launched',async()=>{
 for(const auth of [()=>({status:1,stdout:'Not logged in.',stderr:''}),()=>({status:0,stdout:'Not logged in.',stderr:''}),()=>({status:1,stdout:'',stderr:'boom'})]){
  const {code,events,calls}=await exercise('read-only',{auth});
  assert.equal(code,1);assert.equal(calls.length,0,'the agent must not start');
  assert.equal(events.at(-1).type,'turn.failed');assert.match(events.at(-1).error.message,/devin auth login/);
 }
 const unverifiable=await exercise('read-only',{auth:()=>({status:null,error:new Error('timed out'),stdout:'',stderr:''})});
 assert.equal(unverifiable.calls.length,0);assert.match(unverifiable.events.at(-1).error.message,/Não foi possível verificar/);
 assert.equal(authPreflight('x',{spawnSyncImpl:loggedIn}).ok,true);
});

test('failures stay explicit: non-zero exit, empty answer, login prompt in output and spawn errors',async()=>{
 const failed=await exercise('read-only',{script:child=>{child.stderr.end('tool crashed');child.stdout.end('');child.emit('close',3);}});
 assert.equal(failed.code,3);assert.match(failed.events.at(-1).error.message,/código 3: tool crashed/);
 const empty=await exercise('read-only',{script:child=>{child.stdout.end('  ');child.emit('close',0);}});
 assert.equal(empty.code,1);assert.match(empty.events.at(-1).error.message,/sem resposta/);
 const login=await exercise('read-only',{script:child=>{child.stderr.end('Please run devin auth login');child.stdout.end('');child.emit('close',1);}});
 assert.match(login.events.at(-1).error.message,/devin auth login/);
 const lines=[];
 const code=await run([...base,'--mode','read-only'],{spawnSyncImpl:loggedIn,spawnImpl:()=>{throw new Error('ENOENT');},write:text=>lines.push(JSON.parse(text))});
 assert.equal(code,1);assert.match(lines.at(-1).error.message,/não pôde ser iniciado/);
 const asyncError=[];
 const asyncCode=await run([...base,'--mode','read-only'],{spawnSyncImpl:loggedIn,spawnImpl:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};queueMicrotask(()=>child.emit('error',new Error('EACCES')));return child;},write:text=>asyncError.push(JSON.parse(text))});
 assert.equal(asyncCode,1);assert.match(asyncError.at(-1).error.message,/EACCES/);
});

test('bridge arguments are validated and configuration is removed after the run',async()=>{
 assert.throws(()=>parseBridgeArguments(['--devin','x']),/ausente/);
 assert.throws(()=>parseBridgeArguments([...base,'--mode','danger']),/read-only ou write/);
 assert.throws(()=>parseBridgeArguments(['devin','x']),/inválido/);
 const {calls}=await exercise('read-only');
 assert.equal(existsSync(calls[0].args[calls[0].args.indexOf('--config')+1]),false);
 const lines=[];
 assert.equal(await run(['--devin','x'],{write:text=>lines.push(JSON.parse(text))}),2);
 assert.equal(lines[0].type,'turn.failed');
});

test('an installed Devin CLI cannot allocate a prompt or execute any phase while its isolation contract is unverified',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-devin-provider-'));
 try{
  const cli=join(dir,'devin.exe');writeFileSync(cli,'');mkdirSync(join(dir,'data'));
  const task={id:'t',title:'x',workspace:dir};
  for(const flags of [{planningOnly:true},{reviewOnly:true},{}])assert.throws(()=>buildProviderExecution({providerId:'devin',credentials:{model:'opus'},task,fullPrompt:'Do it',cwd:dir,profile:{},devinPath:cli,dataDir:join(dir,'data'),...flags}),/contrato de execução verificado/);
  assert.equal(existsSync(join(dir,'data','prompts')),false);
  assert.match(defaultDevinCli({LOCALAPPDATA:'C:/Users/x/AppData/Local'}).replaceAll('\\','/'),/Programs\/Devin\/resources\/app\/extensions\/windsurf\/devin\/bin\/devin\.exe$/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
