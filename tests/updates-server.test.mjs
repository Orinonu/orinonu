import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMissionServer} from '../src/server.mjs';

test('update endpoints expose cached metadata and explicit checks without missions, models or cross-origin access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-updates-http-'));let checks=0;
 const metadata={installed:{version:'0.0.5',commit:null,branch:'main'},status:'not_checked',behind:null};
 const app=createMissionServer({dataDir:dir,apiKey:'',updateChecker:{status:()=>metadata,check:async()=>{checks++;return {...metadata,status:'unavailable'};}}});await app.listen(0);
 try{
  assert.equal((await(await fetch(app.url+'/api/updates')).json()).installed.version,'0.0.5');assert.equal(checks,0);
  const request=headers=>fetch(app.url+'/api/updates/check',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});
  assert.equal((await request({Origin:'https://external.invalid'})).status,403);assert.equal(checks,0);
  assert.equal((await request({Origin:app.url})).status,200);assert.equal(checks,1);
  assert.deepEqual((await(await fetch(app.url+'/api/state')).json()).tasks,[]);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
