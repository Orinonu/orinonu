import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUiGateway} from '../src/ui-gateway.mjs';

test('UI gateway shares the existing API without accepting foreign origins or controlling its supervisor',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-gateway-'));mkdirSync(join(dir,'ui'));writeFileSync(join(dir,'ui','index.html'),'interface');writeFileSync(join(dir,'ui','csp.json'),JSON.stringify({scriptHashes:[]}));
 const requests=[],upstream=http.createServer((req,res)=>{requests.push({path:req.url,host:req.headers.host,origin:req.headers.origin});res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const target=`http://127.0.0.1:${upstream.address().port}`;
 const gateway=createUiGateway({publicDir:dir,upstream:target});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${gateway.address().port}`;
 try {
  assert.equal(await (await fetch(origin)).text(),'interface');
  assert.equal((await fetch(origin+'/api/state')).status,200);
  assert.equal((await fetch(origin+'/api/project-direction',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,200);
  assert.equal(requests[1].origin,target);
  assert.equal(requests[1].host,new URL(target).host);
  const rawStatus=(path,headers={})=>new Promise((resolve,reject)=>{const request=http.get(origin,{path,headers},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(await rawStatus('/api/state',{Host:'evil.example'}),403);
  assert.equal(await rawStatus('http://evil.example/api/state'),400);
  assert.equal(await rawStatus('//evil.example/api/state'),400);
  assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers:{Origin:'null','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal(requests.length,2);
  assert.throws(()=>createUiGateway({publicDir:dir,upstream:'https://remote.example'}),/loopback/);
 }finally{await Promise.all([new Promise(resolve=>gateway.close(resolve)),new Promise(resolve=>upstream.close(resolve))]);rmSync(dir,{recursive:true,force:true});}
});

test('UI gateway serves the exported favicon without exposing arbitrary public files',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-icon-'));mkdirSync(join(dir,'ui'));
 const icon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>';
 writeFileSync(join(dir,'ui','index.html'),'interface');writeFileSync(join(dir,'ui','csp.json'),JSON.stringify({scriptHashes:[]}));
 writeFileSync(join(dir,'ui','icon.svg'),icon);writeFileSync(join(dir,'ui','private.svg'),'not public');
 const gateway=createUiGateway({publicDir:dir});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${gateway.address().port}`;
 try{
  const response=await fetch(origin+'/icon.svg');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/svg\+xml/);
  assert.equal(await response.text(),icon);assert.equal((await fetch(origin+'/private.svg')).status,404);
 }finally{await new Promise(resolve=>gateway.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('UI gateway ends an incomplete upstream response so the client can retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-gateway-abort-'));
 const upstream=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json','Content-Length':1000});
  res.write('{"tasks":');setTimeout(()=>res.destroy(),20);
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const gateway=createUiGateway({publicDir:dir,upstream:`http://127.0.0.1:${upstream.address().port}`});
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${gateway.address().port}/api/state`,{signal:AbortSignal.timeout(1500)});
  assert.equal(response.status,200);
  await assert.rejects(()=>response.text(),{name:'TypeError'});
 }finally{
  await Promise.all([new Promise(resolve=>gateway.close(resolve)),new Promise(resolve=>upstream.close(resolve))]);
  rmSync(dir,{recursive:true,force:true});
 }
});
