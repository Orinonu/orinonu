import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pricingCache} from '../src/pricing-cache.mjs';
test('public prices persist, pinned JEV endpoint augments catalog and failure preserves reference',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-prices-'));let failing=false,calls=0;
 const fetcher=async url=>{calls++;if(failing)throw new Error('offline');return {ok:true,json:async()=>url.endsWith('/endpoints')?{data:{id:'typesafe/jev-1.13',endpoints:[{provider_name:'TypeSafe',pricing:{prompt:'0.000000042',completion:'0'}}]}}:{data:[{id:'openai/example',pricing:{prompt:'0.000002',completion:'0.00001'}}]}};};
 try{
  const cache=pricingCache(dir,{fetcher});assert.equal(cache.get(),null);
  const [a,b]=await Promise.all([cache.refresh(),cache.refresh()]);assert.equal(a,b);assert.equal(calls,2);
  assert.ok(a.models.some(m=>m.id==='typesafe/jev-1.13'));
  const restored=pricingCache(dir,{fetcher});assert.deepEqual(restored.get(),a);
  failing=true;assert.equal(await cache.refresh(),a);assert.ok(cache.status().error);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('duplicate JEV price records resolve by an explicit precedence that does not depend on their order',async()=>{
 const {normalizeCatalog,estimateUsage,PRICE_RANK}=await import('../src/pricing.mjs');
 const generic={id:'typesafe/jev-1.13',pricing:{prompt:'0.000001',completion:'0.000004'}};
 const pinned={id:'typesafe/jev-1.13',pricing:{prompt:'0.000000042',completion:'0.0000002'},price_source:'pinned_endpoint',price_provider:'TypeSafe'};
 const now=new Date().toISOString();
 const a=normalizeCatalog({data:[generic,pinned]},now),b=normalizeCatalog({data:[pinned,generic]},now);
 assert.deepEqual(a.models,b.models,'order must not matter');
 assert.equal(a.models.length,1);
 const model=a.models[0];
 assert.deepEqual([model.price_source,model.price_provider],['pinned_endpoint','TypeSafe']);
 assert.ok(Math.abs(model.input_per_million-0.042)<1e-9);assert.ok(Math.abs(model.output_per_million-0.2)<1e-9);
 assert.equal(model.superseded.length,1);assert.equal(model.superseded[0].price_source,'catalog');assert.equal(model.superseded[0].input_per_million,1);
 assert.ok(PRICE_RANK.pinned_endpoint>PRICE_RANK.catalog);
 const usage={input_tokens:1000000,output_tokens:1000000};
 assert.ok(Math.abs(estimateUsage(usage,model)-0.242)<1e-9);
 // Same-rank records that disagree cannot be ordered: prices become unknown and the disagreement is recorded.
 const rival={id:'typesafe/jev-1.13',pricing:{prompt:'0.000002',completion:'0.000008'}};
 const tie=normalizeCatalog({data:[generic,rival]},now),tieReversed=normalizeCatalog({data:[rival,generic]},now);
 assert.deepEqual(tie.models,tieReversed.models);
 assert.equal(tie.models[0].input_per_million,null);assert.equal(tie.models[0].price_conflict.length,2);
 assert.equal(estimateUsage(usage,tie.models[0]),null);
 // Equal duplicates collapse; unrelated models are untouched; payload without duplicates keeps its prices.
 assert.equal(normalizeCatalog({data:[generic,{...generic}]},now).models.length,1);
 assert.equal(normalizeCatalog({data:[generic,{id:'openai/gpt-6-sol',pricing:{prompt:'0.000003',completion:'0.000012'}}]},now).models.length,2);
 // Absent or invalid payloads keep the previous contract.
 assert.equal(normalizeCatalog({},now).status,'unavailable');
 assert.equal(normalizeCatalog(null,now).models.length,0);
});

test('the refreshed cache marks the pinned endpoint with its provider and the stored reference stays identical after a restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-prices-prov-'));
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/endpoints')?{data:{id:'typesafe/jev-1.13',endpoints:[{provider_name:'TypeSafe',pricing:{prompt:'0.000000042',completion:'0.0000002'}}]}}:{data:[{id:'typesafe/jev-1.13',pricing:{prompt:'0.000001',completion:'0.000004'}},{id:'openai/gpt-6-sol',pricing:{prompt:'0.000003',completion:'0.000012'}}]}});
 try{
  const cache=pricingCache(dir,{fetcher});const fresh=await cache.refresh();
  const jev=fresh.models.find(m=>m.id==='typesafe/jev-1.13');
  assert.deepEqual([jev.price_source,jev.price_provider],['pinned_endpoint','TypeSafe']);assert.ok(Math.abs(jev.input_per_million-0.042)<1e-9);
  assert.equal(fresh.models.filter(m=>m.id==='typesafe/jev-1.13').length,1);
  assert.deepEqual(pricingCache(dir,{fetcher}).get(),fresh);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
