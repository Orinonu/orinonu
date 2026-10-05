// Test double for `codex app-server`: speaks the v2 JSON-RPC stdio protocol (newline-delimited JSON)
// and records what it received to --params-out. Modes: 'complete' (default) finishes the turn with a
// report and usage; 'hang' never completes until turn/interrupt arrives; 'secret' fails leaking a
// secret-shaped string. It implements only the methods the bridge drives.
import {writeFileSync} from 'node:fs';

const argv=process.argv.slice(2);
const mode=argv[0]??'complete';
const paramsOutIndex=argv.indexOf('--params-out');
const paramsOut=paramsOutIndex>=0?argv[paramsOutIndex+1]:null;
const seen={threadStart:null,threadResume:null,turnStart:null,turnInterrupt:null,interrupted:false,initialized:false};
const persist=()=>{if(paramsOut)try{writeFileSync(paramsOut,JSON.stringify(seen,null,1));}catch{}};

let buffer='';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const result=(id,payload)=>send({id,result:payload});
const notify=(method,params)=>send({method,params});

process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 buffer+=chunk;let i;
 while((i=buffer.indexOf('\n'))>=0){
  const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
  let msg;try{msg=JSON.parse(line);}catch{send({id:null,error:{code:-32700,message:'parse error'}});continue;}
  handle(msg);
 }
});

function handle(msg){
 if(msg.method==='initialize'){seen.initialized=true;result(msg.id,{codexHome:'/tmp/fake',platformOs:'windows',userAgent:'fake-appserver/0'});return persist();}
 if(msg.method==='thread/start'){seen.threadStart=msg.params;result(msg.id,{thread:{id:'thread-fixture-1'},cwd:msg.params.cwd,sandbox:msg.params.sandbox,approvalPolicy:msg.params.approvalPolicy,model:msg.params.model??'fake-model'});notify('thread/started',{thread:{id:'thread-fixture-1'}});return persist();}
 if(msg.method==='thread/resume'){seen.threadResume=msg.params;result(msg.id,{thread:{id:msg.params.threadId}});notify('thread/started',{thread:{id:msg.params.threadId}});return persist();}
 if(msg.method==='turn/start'){
  seen.turnStart=msg.params;persist();
  result(msg.id,{turn:{id:'tu-hang',status:'inProgress'}});
  notify('turn/started',{threadId:msg.params.threadId,turn:{id:'tu-hang',status:'inProgress'}});
  if(mode==='hang')return;
  if(mode==='secret'){
   notify('error',{error:{message:'upstream rejected key sk-proj-FAKEKEY0123456789abcdef'},threadId:msg.params.threadId,turnId:'tu-hang',willRetry:false});
   notify('turn/completed',{threadId:msg.params.threadId,turn:{id:'tu-hang',status:'failed',error:{message:'denied sk-proj-FAKEKEY0123456789abcdef'}}});
   return persist();
  }
  notify('item/completed',{item:{id:'m1',type:'agentMessage',text:'relatório do servidor falso'},threadId:msg.params.threadId,turnId:'tu-hang',completedAtMs:1});
  notify('thread/tokenUsage/updated',{threadId:msg.params.threadId,turnId:'tu-hang',tokenUsage:{last:{inputTokens:10,outputTokens:5,cachedInputTokens:2,reasoningOutputTokens:1,totalTokens:15},total:{inputTokens:10,outputTokens:5,cachedInputTokens:2,totalTokens:15}}});
  notify('turn/completed',{threadId:msg.params.threadId,turn:{id:'tu-hang',status:'completed'}});
  return persist();
 }
 if(msg.method==='turn/interrupt'){
  seen.turnInterrupt=msg.params;seen.interrupted=true;persist();
  result(msg.id,{});
  notify('turn/completed',{threadId:msg.params.threadId,turn:{id:msg.params.turnId,status:'interrupted'}});
  return;
 }
 if(msg.id!==undefined)send({id:msg.id,error:{code:-32601,message:'method not found: '+String(msg.method).slice(0,60)}});
}
process.stdin.on('end',()=>process.exit(0));
