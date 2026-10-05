import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeCatalog} from './pricing.mjs';
export const modelsUrl='https://openrouter.ai/api/v1/models';
const jevUrl='https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints';
export function pricingCache(dataDir,{fetcher=fetch}={}){
 const path=join(dataDir,'pricing.json');
 let catalog=null,inflight=null,error=null;
 try{const saved=JSON.parse(readFileSync(path,'utf8'));catalog=normalizeCatalog(saved.payload,saved.fetched_at);}catch{}
 return {
  get(){return catalog?{...catalog,status:Date.now()-Date.parse(catalog.fetched_at)>86400000?'stale':catalog.status}:null;},
  status(){return {refreshing:!!inflight,error};},
  refresh(){
   if(inflight)return inflight;
   inflight=(async()=>{
    try{
     const responses=await Promise.all([modelsUrl,jevUrl].map(url=>fetcher(url,{signal:AbortSignal.timeout(10000)})));
     if(responses.some(r=>!r.ok))throw new Error('Catálogo público indisponível.');
     const [base,jev]=await Promise.all(responses.map(r=>r.json()));
     if(!Array.isArray(base.data)||!base.data.length)throw new Error('Catálogo inválido.');
     // This endpoint identifies a pinned JEV version; the router has dynamic prices.
     const endpoint=jev.data?.endpoints?.find(e=>e.provider_name==='TypeSafe');
     const data=base.data.filter(m=>m.id.startsWith('openai/')||m.id.startsWith('typesafe/'));
     if(jev.data?.id==='typesafe/jev-1.13'&&endpoint?.pricing)data.push({id:jev.data.id,pricing:endpoint.pricing,price_source:'pinned_endpoint',price_provider:endpoint.provider_name});
     const payload={data},fetched_at=new Date().toISOString();
     const next=normalizeCatalog(payload,fetched_at);
     writeFileSync(path+'.tmp',JSON.stringify({payload,fetched_at}));renameSync(path+'.tmp',path);
     catalog=next;error=null;return catalog;
    }catch{error='Atualização de preços indisponível; última referência preservada.';return catalog;}
    finally{inflight=null;}
   })();
   return inflight;
  }
 };
}
