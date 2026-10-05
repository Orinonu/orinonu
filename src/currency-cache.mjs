import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeRate,rateSource} from './currency.mjs';
export function currencyCache(dataDir,{fetcher=fetch}={}){
 const path=join(dataDir,'currency.json');
 let rate=null,inflight=null,error=null;
 try{const saved=JSON.parse(readFileSync(path,'utf8'));rate=normalizeRate(saved.payload,saved.fetched_at);}catch{}
 return {
  get(){return rate?{...rate,status:Date.now()-Date.parse(rate.fetched_at)>86400000?'stale':rate.status}:null;},
  status(){return {refreshing:!!inflight,error};},
  refresh(){
   if(inflight)return inflight;
   inflight=(async()=>{
    try{
     const response=await fetcher(rateSource,{signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw new Error('Cotação pública indisponível.');
     const payload=await response.json(),fetched_at=new Date().toISOString(),next=normalizeRate(payload,fetched_at);
     if(next.usd_brl===null)throw new Error('Cotação inválida.');
     writeFileSync(path+'.tmp',JSON.stringify({payload,fetched_at}));renameSync(path+'.tmp',path);
     rate=next;error=null;return rate;
    }catch{error='Atualização da cotação indisponível; última referência preservada.';return rate;}
    finally{inflight=null;}
   })();
   return inflight;
  }
 };
}
