import http from 'node:http';
import {uiAsset} from './static-ui.mjs';

export function createUiGateway({publicDir,upstream='http://127.0.0.1:18792'}){
 const target=new URL(upstream);
 if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('UI upstream must be an HTTP loopback origin.');
 const server=http.createServer((req,res)=>{
  const fail=(status,error)=>{if(res.headersSent){res.destroy();return;}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}));};
  const port=server.address().port,origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  if(!origins.map(origin=>new URL(origin).host).includes(req.headers.host))return fail(403,'Host inválido.');
  if(req.method!=='GET'&&req.headers.origin&&!origins.includes(req.headers.origin))return fail(403,'Origem inválida.');
  if(!req.url.startsWith('/')||req.url.startsWith('//'))return fail(400,'Caminho inválido.');
  let url;try{url=new URL(req.url,origins[0]);}catch{return fail(400,'Caminho inválido.');}
  const path=url.pathname;
  if(path.startsWith('/api/')){
   const headers={...req.headers,host:target.host};if(headers.origin)headers.origin=target.origin;
   delete headers.connection;
   const relay=http.request(new URL(path+url.search,target),{method:req.method,headers},response=>{
    response.on('aborted',()=>res.destroy());
    response.on('error',()=>res.destroy());
    response.on('close',()=>{if(!response.complete)res.destroy();});
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
   });
   relay.setTimeout(120000,()=>relay.destroy(new Error('timeout')));
   relay.on('error',()=>fail(502,'Servidor de missões indisponível.'));
   req.on('aborted',()=>relay.destroy());res.on('close',()=>{if(!res.writableEnded)relay.destroy();});req.pipe(relay);return;
  }
  if(req.method==='GET'){const asset=uiAsset(publicDir,path);if(asset){res.writeHead(200,asset.headers);res.end(asset.body);return;}}
  fail(404,'Não encontrado.');
 });
 return server;
}
