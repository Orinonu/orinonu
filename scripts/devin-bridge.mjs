#!/usr/bin/env node
// Runs the real Devin agent CLI (`devin -p`) for one Mission Control phase and reports it in the NDJSON event shape the supervisor
// already understands (thread.started / turn.started / item.completed agent_message / turn.failed). The CLI has no JSON stream and no
// OS sandbox on Windows, so the bridge states plainly what it can and cannot enforce:
//   read-only phases (planning, review): edit and exec tools are denied by a generated permission config; reads stay allowed.
//   write phases (implementation): disabled until a verified isolation boundary is available; command prefixes cannot enforce
//   workspace isolation. Direct bridge calls also fail closed before authentication or process launch.
// No usage is reported (the CLI does not expose it), so cost and tokens stay unknown rather than invented.
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const READ_ONLY_PERMISSIONS={deny:['edit','exec','Write(**)'],allow:['read','grep','glob']};
export const WRITE_PERMISSIONS={
 allow:[],
 deny:['edit','exec','Write(**)','Exec(rm)','Exec(sudo)','Exec(git push)','Exec(git reset)','Exec(git clean)','Exec(git checkout)','Exec(curl)','Exec(wget)','Exec(powershell)','Exec(cmd)','Write(.env*)','Write(**/*.pem)','Write(**/*.key)'],
};
export const permissionConfig=mode=>({permissions:mode==='read-only'?READ_ONLY_PERMISSIONS:WRITE_PERMISSIONS});
export const devinArguments=({promptFile,mode,model,configPath})=>[
 '-p','--prompt-file',promptFile,'--config',configPath,
 '--permission-mode',mode==='read-only'?'auto':'accept-edits','--respect-workspace-trust','true',
 ...(model?['--model',model]:[]),
];
const NOT_LOGGED_IN=/not logged in|devin auth login|unauthenticated/i;
const LOGIN_MESSAGE='Devin CLI não autenticado: o usuário precisa executar "devin auth login" uma vez neste computador.';
// Print mode would otherwise wait on an interactive login. The status command answers immediately, so an unauthenticated or
// unverifiable CLI is refused before anything is launched.
export function authPreflight(devin,{timeoutMs=20000,spawnSyncImpl=spawnSync}={}){
 const check=spawnSyncImpl(devin,['auth','status'],{encoding:'utf8',timeout:timeoutMs,windowsHide:true});
 const text=`${check.stdout??''} ${check.stderr??''}`;
 if(check.error||check.status===null)return {ok:false,message:'Não foi possível verificar a autenticação do Devin CLI: '+String(check.error?.message??'tempo esgotado').slice(0,160)};
 if(NOT_LOGGED_IN.test(text)||check.status!==0)return {ok:false,message:LOGIN_MESSAGE};
 return {ok:true};
}

export function parseBridgeArguments(argv){
 const options={};
 for(let index=0;index<argv.length;index+=2){if(!argv[index].startsWith('--'))throw new Error('Argumento inválido: '+argv[index]);options[argv[index].slice(2)]=argv[index+1];}
 for(const key of ['devin','cwd','prompt-file','mode'])if(!options[key])throw new Error('Argumento obrigatório ausente: --'+key);
 if(!['read-only','write'].includes(options.mode))throw new Error('--mode deve ser read-only ou write.');
 return options;
}

export function run(argv=process.argv.slice(2),{spawnImpl=spawn,spawnSyncImpl=spawnSync,write=text=>process.stdout.write(text)}={}){
 return new Promise(resolve=>{
  const emit=event=>write(JSON.stringify(event)+String.fromCharCode(10));
  let options;try{options=parseBridgeArguments(argv);}catch(error){emit({type:'turn.failed',error:{message:error.message}});return resolve(2);}
  if(options.mode==='write'){emit({type:'turn.failed',error:{message:'Devin: implementação automática bloqueada sem sandbox ou isolamento verificado.'}});return resolve(2);}
  const gate=authPreflight(options.devin,{spawnSyncImpl});
  if(!gate.ok){emit({type:'thread.started',thread_id:'devin-unauthenticated'});emit({type:'turn.failed',error:{message:gate.message}});return resolve(1);}
  const scratch=mkdtempSync(join(tmpdir(),'nexo-devin-')),configPath=join(scratch,'config.json');
  writeFileSync(configPath,JSON.stringify(permissionConfig(options.mode)));
  emit({type:'thread.started',thread_id:'devin-'+randomUUID()});emit({type:'turn.started'});
  let stdout='',stderr='',child;
  try{child=spawnImpl(options.devin,devinArguments({promptFile:options['prompt-file'],mode:options.mode,model:options.model,configPath}),{cwd:options.cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:process.env});}
  catch(error){rmSync(scratch,{recursive:true,force:true});emit({type:'turn.failed',error:{message:'Devin CLI não pôde ser iniciado: '+String(error.message).slice(0,200)}});return resolve(1);}
  const stop=()=>{try{child.kill();}catch{/* already gone */}};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-1024*1024);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8000);});
  child.on('error',error=>{rmSync(scratch,{recursive:true,force:true});emit({type:'turn.failed',error:{message:'Devin CLI não pôde ser iniciado: '+String(error.message).slice(0,200)}});resolve(1);});
  child.on('close',code=>{
   rmSync(scratch,{recursive:true,force:true});
   const text=stdout.trim();
   if(code===0&&text){emit({type:'item.completed',item:{id:'devin-final',type:'agent_message',text}});emit({type:'turn.completed'});return resolve(0);}
   const combined=(stderr+' '+text).trim();
   const message=NOT_LOGGED_IN.test(combined)?LOGIN_MESSAGE:(code===0?'Devin CLI terminou sem resposta.':`Devin CLI terminou com código ${code}: ${combined.slice(-600)}`);
   emit({type:'turn.failed',error:{message}});resolve(code===0?1:code??1);
  });
 });
}
if(process.argv[1]&&import.meta.url===new URL(`file:///${process.argv[1].replace(/\\/g,'/')}`).href)run().then(code=>{process.exitCode=code;});
