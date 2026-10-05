import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
test('competitor research validates references, uses source workspace and reports a verified empty result',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-competitors-'));let child,args;
 writeFileSync(join(dir,'runtime.json'),JSON.stringify({mission_workspace:dir}));
 const runner=(_cmd,argv)=>{args=argv;child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);return child;};
 const app=createMissionServer({dataDir:dir,runner,codexPath:process.execPath,apiKey:''});await app.listen(0);
 const post=body=>fetch(app.url+'/api/opportunities/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json());
 try{
  assert.equal((await post({repositories:['http://github.com/a/b']})).status,400);
  assert.equal((await state()).tasks.length,0);
  const response=await post({repositories:['https://github.com/PaperclipAI/Paperclip'],focus:'Orquestração'});assert.equal(response.status,202);const task=await response.json();
  for(let i=0;i<40&&!child;i++)await new Promise(r=>setTimeout(r,10));assert(child);
  assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.match(child.stdinText,/Não execute planejamento/);assert.equal(task.discovery_kind,'competitor_research');
  for(const domain of ['UI/UX','backend e banco de dados','IA/JEV/System 1','automação','memória e contexto','orquestração de agentes','testes e qualidade','segurança','performance','custo e consumo de tokens'])assert(child.stdinText.includes(domain),domain);
  assert.match(child.stdinText,/Preserve a worktree e todas as alterações existentes/);assert.match(child.stdinText,/não fabrique propostas para preencher categorias/);assert.match(child.stdinText,/não foi examinado ou permanece sem evidência/);assert.match(child.stdinText,/até três propostas/);
  assert.equal((await post({repositories:['https://github.com/stablyai/orca']})).status,409);
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Nenhuma lacuna comprovada.\n```nexo-opportunities\n[]\n```'}})+'\n');await state();child.emit('close',0);
  const observed=(await state()).tasks[0];assert.equal(observed.recommendation_count,0);assert.equal(observed.recommendation_processed,true);assert.equal(observed.discovery_result.status,'completed_empty');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
