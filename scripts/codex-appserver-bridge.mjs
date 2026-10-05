#!/usr/bin/env node
// Runs one Mission Control phase through the official `codex app-server` JSON-RPC transport (v2) instead
// of `codex exec --json`. The app-server keeps durable threads, accepts turn/interrupt for cancellation
// and reports token usage per turn; this bridge drives exactly one turn and translates notifications
// into the NDJSON dialect the supervisor already consumes (thread.started / item.started / item.completed
// / turn.completed with usage / turn.failed). Authentication, models, quota and billing stay whatever the
// installed Codex login provides — the bridge adds no API key path and reports no numbers it did not see.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {redact} from '../src/redact.mjs';
import {codexAuthEnvironment} from '../src/codex-auth.mjs';

export const MODES=['read-only','workspace-write'];
export const ITEM_TYPE_MAP={
 agentMessage:'agent_message',commandExecution:'command_execution',fileChange:'file_change',mcpToolCall:'mcp_tool_call',
 webSearch:'web_search',collabAgentToolCall:'collab_tool_call',reasoning:'reasoning',plan:'plan',userMessage:'user_message',
 dynamicToolCall:'dynamic_tool_call',subAgentActivity:'sub_agent_activity',imageView:'image_view',enteredReviewMode:'entered_review_mode',
 exitedReviewMode:'exited_review_mode',contextCompaction:'context_compaction',hookPrompt:'hook_prompt',functionCallOutput:'function_call_output',
};
export const mapItemType=type=>ITEM_TYPE_MAP[type]??String(type).replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();
const asUsage=tokenUsage=>{
 const last=tokenUsage?.last;
 if(!last||!Number.isSafeInteger(last.inputTokens)||!Number.isSafeInteger(last.outputTokens))return null;
 const usage={input_tokens:last.inputTokens,output_tokens:last.outputTokens};
 if(Number.isSafeInteger(last.cachedInputTokens))usage.cached_input_tokens=last.cachedInputTokens;
 return usage;
};

export function parseBridgeArguments(argv){
 const options={codexArg:[]};
 for(let index=0;index<argv.length;index+=1){
  const key=argv[index];if(!key.startsWith('--'))throw new Error('Argumento inválido: '+key);
  const value=argv[index+1];if(value===undefined)throw new Error('Argumento sem valor: '+key);
  index+=1;if(key==='--codex-arg')options.codexArg.push(value);else options[key.slice(2)]=value;
 }
 for(const key of ['codex','cwd','prompt-file','mode'])if(!options[key])throw new Error('Argumento obrigatório ausente: --'+key);
 if(!MODES.includes(options.mode))throw new Error('--mode deve ser read-only ou workspace-write.');
 const grace=options['interrupt-grace-ms']===undefined?5000:Number(options['interrupt-grace-ms']);
 if(!Number.isFinite(grace)||grace<0||grace>60000)throw new Error('--interrupt-grace-ms deve ser 0..60000.');
 options.graceMs=grace;
 return options;
}

export function run(argv=process.argv.slice(2),{spawnImpl=spawn,write=text=>process.stdout.write(text),readFileImpl=readFileSync,registerInterrupt=fn=>{process.once('SIGTERM',fn);process.once('SIGINT',fn);},killChild=child=>child.kill(),exitDelayMs=400}={}){
 return new Promise(resolve=>{
  const emit=event=>write(JSON.stringify(event)+'\n');
  let options;try{options=parseBridgeArguments(argv);}catch(error){emit({type:'turn.failed',error:{message:error.message}});return resolve(2);}
  let prompt;try{prompt=String(readFileImpl(options['prompt-file'],'utf8'));}catch(error){emit({type:'turn.failed',error:{message:'Prompt não pôde ser lido.'}});return resolve(2);}
  const args=options.codexArg.length?options.codexArg:['app-server'];
  let child;
  try{child=spawnImpl(options.codex,args,{cwd:options.cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:codexAuthEnvironment()});}
  catch(error){emit({type:'turn.failed',error:{message:'app-server não pôde ser iniciado: '+redact(error.message).slice(0,200)}});return resolve(1);}
  let seq=0,idSeq=0,settled=false,startedThread=false,currentTurn=null;
  const usageByTurn=new Map(),pending=new Map(),notifQueue=[];let stderrRaw='',lineBuffer='',drainQueued=false;
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const drainNotifications=()=>{drainQueued=false;while(notifQueue.length&&!settled){const n=notifQueue.shift();onNotification(n.method,n.params);}};
  const eventId=()=>'as-'+ ++seq;
  const finish=(code,lastEvent)=>{
   if(settled)return;settled=true;
   if(lastEvent)emit(lastEvent);
   try{child.stdin?.end();}catch{}
   const killer=setTimeout(()=>{try{killChild(child);}catch{}},exitDelayMs);killer.unref?.();
   resolve(code);
  };
  const fail=(message,code=1)=>{if(settled)return;emit({type:'turn.failed',event_id:eventId(),error:{message:redact(message).slice(0,800)}});finish(code);};
  const request=(method,params)=>{const id=++idSeq;return new Promise((resolveReq,rejectReq)=>{pending.set(id,{resolveReq,rejectReq});try{child.stdin.write(JSON.stringify({id,method,params})+'\n');}catch(error){pending.delete(id);rejectReq(error);}});};
  const denyServerRequest=msg=>{try{child.stdin.write(JSON.stringify({id:msg.id,error:{code:-32601,message:'Este host não atende solicitações do servidor (aprovações desabilitadas).'}})+'\n');}catch{}};
  const onNotification=(method,params)=>{
   if(method==='thread/tokenUsage/updated'){const usage=asUsage(params?.tokenUsage);if(usage&&params?.turnId)usageByTurn.set(params.turnId,usage);return;}
   if(method==='error'){emit({type:'error',event_id:eventId(),turn_id:params?.turnId,error:{message:redact(params?.error?.message??'Erro do servidor.').slice(0,800)}});return;}
   if(method==='item/started'||method==='item/completed'){
    const item=params?.item;if(!item||typeof item.type!=='string')return;
    const mapped={id:item.id,type:mapItemType(item.type)};
    if(typeof item.text==='string')mapped.text=item.text;
    if(typeof item.status==='string')mapped.status=item.status;
    if(Number.isFinite(item.exitCode))mapped.exit_code=item.exitCode;
    emit({type:method==='item/started'?'item.started':'item.completed',event_id:eventId(),turn_id:params?.turnId,item:mapped});
    return;
   }
   if(method==='turn/completed'){
    // One turn per bridge process, so a completion is always ours; currentTurn may still be null
    // if the notifications were queued behind the turn/start response microtask.
    const turn=params?.turn;if(!turn||(currentTurn!==null&&turn.id!==currentTurn))return;
    currentTurn=turn.id;
    const usage=usageByTurn.get(turn.id)??null;
    const base={type:'turn.completed',event_id:eventId(),turn_id:turn.id,...(usage?{usage}:{})};
    if(turn.status==='completed'){emit(base);finish(0);return;}
    emit(base);
    const reason=turn.status==='interrupted'?'Turno interrompido.':turn.error?.message??'Turno falhou.';
    emit({type:'turn.failed',event_id:eventId(),turn_id:turn.id,error:{message:redact(reason).slice(0,800)}});
    finish(1);return;
   }
  };
  const onLine=line=>{
   let msg;try{msg=JSON.parse(line);}catch{fail('Protocolo inválido do app-server.');return;}
   if(!msg||typeof msg!=='object'||Array.isArray(msg)){fail('Protocolo inválido do app-server.');return;}
   if(msg.id!==undefined&&(msg.result!==undefined||msg.error!==undefined)&&pending.has(msg.id)){
    const slot=pending.get(msg.id);pending.delete(msg.id);
    if(msg.error!==undefined)slot.rejectReq(new Error(typeof msg.error.message==='string'?msg.error.message:'Erro JSON-RPC.'));
    else slot.resolveReq(msg.result);return;
   }
   if(msg.id!==undefined&&typeof msg.method==='string')return denyServerRequest(msg);
   // Notifications ride in the same chunk as the request result they follow; deferring to a
   // microtask lets the awaited request resolution set thread/turn state before dispatch.
   if(typeof msg.method==='string'){notifQueue.push({method:msg.method,params:msg.params??{}});if(!drainQueued){drainQueued=true;setImmediate(drainNotifications);}}
  };
  const appendFrames=text=>{
   lineBuffer+=text;let i;
   while(!settled&&(i=lineBuffer.indexOf('\n'))>=0){const line=lineBuffer.slice(0,i);lineBuffer=lineBuffer.slice(i+1);if(Buffer.byteLength(line)>8*1024*1024){fail('Frame do app-server excede o limite de bytes.');return;}if(line.trim())onLine(line);}
   if(!settled&&Buffer.byteLength(lineBuffer)>8*1024*1024)fail('Frame do app-server excede o limite de bytes.');
  };
  child.stdout.on('data',chunk=>{if(settled)return;try{appendFrames(decoder.decode(chunk,{stream:true}));}catch{fail('UTF-8 inválido no protocolo do app-server.');}});
  child.stderr.on('data',chunk=>{stderrRaw=(stderrRaw+String(chunk)).slice(-8000);});
  child.on('error',error=>fail('app-server não pôde ser iniciado: '+error.message));
  child.on('close',code=>{if(settled)return;
    // stdio 'data' events are delivered before 'close' in a real child, but a trailing JSON-RPC
    // frame or queued notification can still sit in our buffers — drain both, one macrotask later,
    // before concluding the turn died. A terminal turn/completed then wins over the exit code.
    setImmediate(()=>{
      if(settled)return;
      try{appendFrames(decoder.decode());}catch{fail('UTF-8 incompleto ou inválido no protocolo do app-server.');return;}
      if(settled)return;
      if(lineBuffer.trim())onLine(lineBuffer);
      drainNotifications();
      if(!settled)fail(`app-server encerrou antes do turno terminar (saída ${code===null?'por sinal':code}).`,code??1);
    });
  });
  const onInterrupt=()=>{
   if(settled)return;
   if(currentTurn){request('turn/interrupt',{threadId:startedThread,turnId:currentTurn}).catch(()=>{});
    const timer=setTimeout(()=>{try{killChild(child);}catch{};fail('Turno interrompido pelo host; app-server não respondeu ao interrupt.')},options.graceMs);timer.unref?.();
   }else fail('Interrompido antes do turno iniciar.');
  };
  registerInterrupt(onInterrupt);
  // Test hook: fires the same interrupt path without depending on OS signal delivery (SIGTERM is a hard
  // TerminateProcess on Windows, where the graceful turn/interrupt handshake cannot be observed).
  if(options['self-interrupt-after']!==undefined){const n=Number(options['self-interrupt-after']);if(Number.isFinite(n)&&n>=0)setTimeout(onInterrupt,n);}
  (async()=>{
   try{
    await request('initialize',{clientInfo:{name:'nexo-mission-control',version:'0.5.0'}});
    const threadResult=options['thread-id']
     ?await request('thread/resume',{threadId:options['thread-id'],cwd:options.cwd,...(options.model?{model:options.model}:{})})
     :await request('thread/start',{cwd:options.cwd,sandbox:options.mode,approvalPolicy:'never',...(options.model?{model:options.model}:{})});
    const threadId=threadResult?.thread?.id;
    if(typeof threadId!=='string'||!threadId)throw new Error('app-server não retornou thread.');
    startedThread=threadId;emit({type:'thread.started',event_id:eventId(),thread_id:threadId});
    const turnResult=await request('turn/start',{threadId,input:{items:[{type:'text',text:prompt}]},cwd:options.cwd,...(options.model?{model:options.model}:{}),...(options.effort?{effort:options.effort}:{})});
    const turnId=turnResult?.turn?.id;
    if(typeof turnId!=='string'||!turnId)throw new Error('app-server não retornou turno.');
    currentTurn=turnId;emit({type:'turn.started',event_id:eventId(),turn_id:turnId});
   }catch(error){fail('Falha no protocolo app-server: '+error.message);}
  })();
 });
}
if(process.argv[1]&&import.meta.url===new URL(`file:///${process.argv[1].replace(/\\/g,'/')}`).href)run().then(code=>{process.exitCode=code;});
