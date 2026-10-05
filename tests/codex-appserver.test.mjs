import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {run,parseBridgeArguments} from '../scripts/codex-appserver-bridge.mjs';
import {buildProviderExecution} from '../src/providers.mjs';

const fixture=fileURLToPath(new URL('./fixtures/fake-appserver.mjs',import.meta.url));
const base=['--codex','C:/fake/codex.exe','--cwd','C:/fake/work','--prompt-file','C:/fake/prompt.txt','--mode','read-only'];

// In-process JSON-RPC peer: parses the lines the bridge writes to stdin and answers through stdout.
function fakeServer(handler){
 const calls=[];
 const spawnImpl=(command,args)=>{
  const child=new EventEmitter();
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{queueMicrotask(()=>child.emit('close',null));};
  child.pid=4321;
  let buf='';
  child.stdin.on('data',chunk=>{buf+=chunk;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;const msg=JSON.parse(line);calls.push(msg);handler(msg,child);}});
  return child;
 };
 return {spawnImpl,calls};
}
const respond=(child,id,result)=>child.stdout.write(JSON.stringify({id,result})+'\n');
const notify=(child,method,params)=>child.stdout.write(JSON.stringify({method,params})+'\n');
const okTurn=(child,msg)=>{
 respond(child,msg.id,{turn:{id:'tu-1',status:'inProgress'}});
 notify(child,'turn/started',{threadId:'th-1',turn:{id:'tu-1',status:'inProgress'}});
 notify(child,'item/completed',{item:{id:'m1',type:'agentMessage',text:'Plano pronto'},threadId:'th-1',turnId:'tu-1'});
 notify(child,'thread/tokenUsage/updated',{threadId:'th-1',turnId:'tu-1',tokenUsage:{last:{inputTokens:120,outputTokens:34,cachedInputTokens:56,reasoningOutputTokens:7,totalTokens:154}}});
 notify(child,'turn/completed',{threadId:'th-1',turn:{id:'tu-1',status:'completed'}});
};
function exercise(handler,{argv=base,readImpl=()=>'Tarefa autorizada de teste.',interrupt}={}){
 const events=[],server=fakeServer(handler);
 let interruptFn;const registerInterrupt=fn=>{interruptFn=fn;};
 const codeP=run(argv,{spawnImpl:server.spawnImpl,write:text=>events.push(JSON.parse(text)),readFileImpl:readImpl,registerInterrupt});
 return {events,calls:server.calls,done:codeP,interrupt:()=>interruptFn?.()};
}

test('a read-only thread produces the same NDJSON dialect as codex exec, with real usage measurement',async()=>{
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{codexHome:'C:/fake/.codex',platformOs:'windows',userAgent:'fake/1'});
  if(msg.method==='thread/start'){respond(child,msg.id,{thread:{id:'th-1'},model:'gpt-x',sandbox:'read-only'});notify(child,'thread/started',{thread:{id:'th-1'}});}
  if(msg.method==='turn/start')okTurn(child,msg);
 });
 const code=await ex.done;
 assert.equal(code,0);
 const init=ex.calls.find(m=>m.method==='initialize'),start=ex.calls.find(m=>m.method==='thread/start'),turn=ex.calls.find(m=>m.method==='turn/start');
 assert.ok(init.params.clientInfo.name,'client identity is declared');
 assert.equal(start.params.cwd,'C:/fake/work');assert.equal(start.params.sandbox,'read-only');assert.equal(start.params.approvalPolicy,'never');
 assert.equal(turn.params.threadId,'th-1');assert.deepEqual(turn.params.input.items,[{type:'text',text:'Tarefa autorizada de teste.'}]);
 const types=ex.events.map(e=>e.type);
 assert.deepEqual(types,['thread.started','turn.started','item.completed','turn.completed']);
 assert.equal(ex.events[0].thread_id,'th-1');
 assert.equal(ex.events[2].item.type,'agent_message');assert.equal(ex.events[2].item.text,'Plano pronto');
 assert.deepEqual(ex.events[3].usage,{input_tokens:120,output_tokens:34,cached_input_tokens:56});
 assert.equal(ex.events[3].turn_id,'tu-1');
 assert.ok(ex.events.every(e=>typeof e.event_id==='string'),'every forwarded event carries a dedup id');
});

test('fragmented UTF-8 reports remain exact across every byte boundary',async()=>{
 const text='ação 日本語 "quotes" \\ paths\nsecond line';
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start')respond(child,msg.id,{thread:{id:'th-1'}});
  if(msg.method==='turn/start'){
   respond(child,msg.id,{turn:{id:'tu-1'}});
   const frame=Buffer.from(JSON.stringify({method:'item/completed',params:{item:{id:'m1',type:'agentMessage',text},threadId:'th-1',turnId:'tu-1'}})+'\n');
   for(const byte of frame)child.stdout.write(Buffer.from([byte]));
   notify(child,'turn/completed',{threadId:'th-1',turn:{id:'tu-1',status:'completed'}});
  }
 });
 assert.equal(await ex.done,0);
 assert.equal(ex.events.find(event=>event.type==='item.completed').item.text,text);
});

test('host cancellation sends turn/interrupt and reports the interrupted turn instead of a success',async()=>{
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start')respond(child,msg.id,{thread:{id:'th-1'}});
  if(msg.method==='turn/start'){respond(child,msg.id,{turn:{id:'tu-1'}});notify(child,'turn/started',{threadId:'th-1',turn:{id:'tu-1'}});}
  if(msg.method==='turn/interrupt'){respond(child,msg.id,{});notify(child,'turn/completed',{threadId:'th-1',turn:{id:'tu-1',status:'interrupted'}});}
 },{argv:[...base,'--interrupt-grace-ms','50']});
 await new Promise(resolve=>setTimeout(resolve,50));
 ex.interrupt();
 const code=await ex.done;
 const interrupt=ex.calls.find(m=>m.method==='turn/interrupt');
 assert.ok(interrupt,'turn/interrupt must reach the server');
 assert.deepEqual(interrupt.params,{threadId:'th-1',turnId:'tu-1'});
 assert.notEqual(code,0);
 const types=ex.events.map(e=>e.type);
 assert.ok(types.includes('turn.failed'),'an interrupted turn is never reported as completed work');
 assert.ok(!types.includes('item.completed')||!ex.events.some(e=>e.type==='item.completed'&&e.item?.type==='agent_message'),'no fabricated report');
});

test('a hard-killed server without interrupt answer still terminates instead of hanging',async()=>{
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start')respond(child,msg.id,{thread:{id:'th-1'}});
  if(msg.method==='turn/start')respond(child,msg.id,{turn:{id:'tu-1'}});
  // turn/interrupt is ignored entirely: the grace window must kill the child.
 },{argv:[...base,'--interrupt-grace-ms','60']});
 await new Promise(resolve=>setTimeout(resolve,50));
 ex.interrupt();
 const code=await ex.done;
 assert.notEqual(code,0);
 assert.equal(ex.events.at(-1).type,'turn.failed');
});

test('--thread-id resumes the persisted thread instead of opening a new one',async()=>{
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/resume'){respond(child,msg.id,{thread:{id:msg.params.threadId}});notify(child,'thread/started',{thread:{id:msg.params.threadId}});}
  if(msg.method==='turn/start')okTurn(child,msg);
 },{argv:[...base,'--thread-id','th-old']});
 const code=await ex.done;
 assert.equal(code,0);
 const resume=ex.calls.find(m=>m.method==='thread/resume');
 assert.equal(resume.params.threadId,'th-old');
 assert.equal(ex.calls.some(m=>m.method==='thread/start'),false);
 assert.equal(ex.events[0].thread_id,'th-old');
});

test('server errors and stderr never leak secrets into emitted events',async()=>{
 const secret='sk-proj-FAKEKEY0123456789abcdef';
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start')respond(child,msg.id,{thread:{id:'th-1'}});
  if(msg.method==='turn/start'){
   respond(child,msg.id,{turn:{id:'tu-1'}});
   child.stderr.write('auth failed with '+secret+'\n');
   notify(child,'error',{error:{message:'upstream rejected token '+secret},threadId:'th-1',turnId:'tu-1',willRetry:false});
   notify(child,'turn/completed',{threadId:'th-1',turn:{id:'tu-1',status:'failed',error:{message:'backend denied '+secret}}});
   setTimeout(()=>child.emit('close',1),5);
  }
 });
 const code=await ex.done;
 assert.equal(code,1);
 const serialized=JSON.stringify(ex.events);
 assert.ok(!serialized.includes(secret),'no event may contain the secret');
 assert.equal(ex.events.at(-1).type,'turn.failed');
 assert.match(ex.events.at(-1).error.message,/\[|redacted|REDACT/i);
});

test('a JSON-RPC error response and a mid-turn server exit are explicit failures',async()=>{
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start')child.stdout.write(JSON.stringify({id:msg.id,error:{code:-32000,message:'no auth'}})+'\n');
 });
 const code=await ex.done;assert.equal(code,1);
 assert.match(ex.events.at(-1).error.message,/no auth/);
 const gone=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start'){respond(child,msg.id,{thread:{id:'th-1'}});notify(child,'thread/started',{thread:{id:'th-1'}});}
  if(msg.method==='turn/start'){respond(child,msg.id,{turn:{id:'tu-1'}});child.emit('close',2);}
 });
 const code2=await gone.done;assert.equal(code2,2);
 assert.equal(gone.events.at(-1).type,'turn.failed');
 assert.match(gone.events.at(-1).error.message,/encerrou|terminou|exit/i);
});

test('malformed server lines fail the protocol instead of being silently skipped',async()=>{
 const ex=exercise((msg,child)=>{
  if(msg.method==='initialize')respond(child,msg.id,{});
  if(msg.method==='thread/start'){respond(child,msg.id,{thread:{id:'th-1'}});notify(child,'thread/started',{thread:{id:'th-1'}});}
  if(msg.method==='turn/start'){respond(child,msg.id,{turn:{id:'tu-1'}});child.stdout.write('not json at all\n');}
 });
 const code=await ex.done;assert.equal(code,1);
 assert.equal(ex.events.at(-1).type,'turn.failed');
});

test('invalid UTF-8, truncated UTF-8 at EOF and non-object JSON-RPC envelopes fail closed',async()=>{
 for(const bytes of [Buffer.from([0xff]),Buffer.from([0xc3]),Buffer.from('null\n')]){
  const ex=exercise((msg,child)=>{
   if(msg.method==='initialize')respond(child,msg.id,{});
   if(msg.method==='thread/start')respond(child,msg.id,{thread:{id:'th-1'}});
   if(msg.method==='turn/start'){respond(child,msg.id,{turn:{id:'tu-1'}});child.stdout.write(bytes);child.emit('close',0);}
  });
  assert.notEqual(await ex.done,0);
  assert.equal(ex.events.at(-1).type,'turn.failed');
  assert.equal(ex.events.filter(event=>event.type==='turn.failed').length,1);
  assert.equal(ex.events.some(event=>event.type==='turn.completed'),false);
 }
});

test('bridge arguments are validated and unknown modes are refused',async()=>{
 assert.throws(()=>parseBridgeArguments(base.slice(0,-2)),/mode|--mode/);
 assert.throws(()=>parseBridgeArguments(['--codex','x','--cwd','y','--prompt-file','z','--mode','danger-full-access']),/read-only|workspace-write/);
 assert.throws(()=>parseBridgeArguments(['codex','x']),/inválido|--/);
 const events=[];
 const code=await run(['--codex','x'],{write:text=>events.push(JSON.parse(text)),readFileImpl:()=>''});
 assert.equal(code,2);assert.equal(events[0].type,'turn.failed');
});

test('the provider invocation uses the bridge with a prompt file, the shared codex binary and the phase sandbox',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-appserver-provider-'));
 try{
  const cli=join(dir,'codex.exe');writeFileSync(cli,'');mkdirSync(join(dir,'data'));
  const read=buildProviderExecution({providerId:'codex-appserver',task:{id:'t'},fullPrompt:'Plan this',cwd:dir,profile:{model:'m1',effort:'high'},codexPath:cli,dataDir:join(dir,'data'),planningOnly:true});
  assert.equal(read.type,'process');assert.equal(read.command,process.execPath);
  assert.match(read.args[0],/codex-appserver-bridge\.mjs$/);
  assert.equal(read.args[read.args.indexOf('--codex')+1],cli);
  assert.equal(read.args[read.args.indexOf('--mode')+1],'read-only');
  assert.equal(read.args[read.args.indexOf('--model')+1],'m1');
  assert.equal(read.args[read.args.indexOf('--effort')+1],'high');
  assert.equal(readFileSync(read.promptFile,'utf8'),'Plan this');
  const write=buildProviderExecution({providerId:'codex-appserver',task:{id:'t'},fullPrompt:'Do it',cwd:dir,profile:{model:'m1'},codexPath:cli,dataDir:join(dir,'data')});
  assert.equal(write.args[write.args.indexOf('--mode')+1],'workspace-write');
  assert.throws(()=>buildProviderExecution({providerId:'codex-appserver',task:{id:'t'},fullPrompt:'x',cwd:dir,profile:{},codexPath:join(dir,'absent.exe'),dataDir:join(dir,'data')}),/codex/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('subscription-only Codex transports remove API overrides without modifying the source environment',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-subscription-env-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const env={PATH:'synthetic-path',OPENAI_API_KEY:'SENTINEL_FAKE_KEY',codex_api_key:'SENTINEL_FAKE_KEY',CODEX_ACCESS_TOKEN:'SENTINEL_FAKE_KEY'};
 for(const providerId of ['codex','codex-appserver']){
  const invocation=buildProviderExecution({providerId,codexPath:process.execPath,fullPrompt:'Synthetic prompt',cwd:dir,dataDir:dir,profile:{model:'synthetic-model',effort:'medium'},subscriptionOnly:true,env});
  assert.equal(invocation.options.env.PATH,'synthetic-path');
  assert.ok(!Object.keys(invocation.options.env).some(key=>['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN'].includes(key.toUpperCase())));
 }
 assert.equal(env.OPENAI_API_KEY,'SENTINEL_FAKE_KEY');
});

test('integrated: the bridge drives a real codex app-server JSON-RPC process over stdio',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-appserver-it-'));
 const paramsOut=join(dir,'params.json'),promptFile=join(dir,'prompt.txt');
 writeFileSync(promptFile,'Missão de teste integrado.');
 const bridge=fileURLToPath(new URL('../scripts/codex-appserver-bridge.mjs',import.meta.url));
 const child=spawn(process.execPath,[bridge,'--codex',process.execPath,'--codex-arg',fixture,'--codex-arg','--params-out','--codex-arg',paramsOut,'--cwd',dir,'--prompt-file',promptFile,'--mode','read-only'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 try{
  const out=[];let stderr='';
  child.stdout.on('data',c=>{for(const line of String(c).split('\n'))if(line.trim()){try{out.push(JSON.parse(line));}catch{}}});
  child.stderr.on('data',c=>{stderr+=c;});
  const code=await new Promise(r=>child.on('close',r));
  assert.equal(code,0,stderr);
  assert.deepEqual(out.map(e=>e.type),['thread.started','turn.started','item.completed','turn.completed']);
  assert.equal(out[0].thread_id,'thread-fixture-1');
  assert.equal(out[2].item.text,'relatório do servidor falso');
  assert.deepEqual(out[3].usage,{input_tokens:10,output_tokens:5,cached_input_tokens:2});
  const params=JSON.parse(readFileSync(paramsOut,'utf8'));
  assert.equal(params.threadStart.sandbox,'read-only');
  assert.equal(params.threadStart.approvalPolicy,'never');
  assert.equal(params.turnStart.input.items[0].text,'Missão de teste integrado.');
 }finally{child.kill();rmSync(dir,{recursive:true,force:true});}
});

test('integrated: cancellation reaches turn/interrupt on a real process and nothing is fabricated',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-appserver-cancel-'));
 const paramsOut=join(dir,'params.json'),promptFile=join(dir,'prompt.txt');
 writeFileSync(promptFile,'Missão que será cancelada.');
 const bridge=fileURLToPath(new URL('../scripts/codex-appserver-bridge.mjs',import.meta.url));
 // --self-interrupt-after exercises the real turn/interrupt write path; OS signals are covered by the
 // in-process tests (SIGTERM on Windows terminates the process without running handlers).
 const child=spawn(process.execPath,[bridge,'--codex',process.execPath,'--codex-arg',fixture,'--codex-arg','hang','--codex-arg','--params-out','--codex-arg',paramsOut,'--cwd',dir,'--prompt-file',promptFile,'--mode','read-only','--interrupt-grace-ms','1500','--self-interrupt-after','700'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const out=[];
 child.stdout.on('data',c=>{for(const line of String(c).split('\n'))if(line.trim()){try{out.push(JSON.parse(line));}catch{}}});
 try{
  const code=await new Promise(r=>child.on('close',r));
  assert.notEqual(code,0);
  const params=JSON.parse(readFileSync(paramsOut,'utf8'));
  assert.equal(params.interrupted,true,'the interrupt request reached the server');
  assert.equal(params.turnInterrupt.turnId,'tu-hang');
  assert.ok(!out.some(e=>e.type==='item.completed'),'no fabricated agent message after cancel');
  assert.ok(out.some(e=>e.type==='turn.failed'),'interrupted turn reported as failed, never as done');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
