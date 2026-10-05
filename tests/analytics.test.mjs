import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
test('analytics retain historical consumption outside UI event window and exclude cache replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-history-'));
 const actual={provider:'typesafe',kind:'jev_decision',ok:true,model:'jev-1.13.0',cached:false,usage:{input_tokens:17964,output_tokens:58}};
 writeFileSync(join(dir,'events.ndjson'),[actual,...Array.from({length:1001},()=>({kind:'tool_observed'})),{...actual,cached:true}].map(row=>JSON.stringify(row)).join('\n')+'\n');
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/endpoints')?{data:{id:'typesafe/jev-1.13',endpoints:[{provider_name:'TypeSafe',pricing:{prompt:'0.000000042',completion:'0'}}]}}:{data:[{id:'openai/test',pricing:{prompt:'1',completion:'1'}}]}});
 const app=createMissionServer({dataDir:dir,pricingFetcher:fetcher});await app.listen(0);
 try{
  const refreshed=await fetch(app.url+'/api/pricing/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(refreshed.status,200);
  const state=await(await fetch(app.url+'/api/state')).json();
  assert.equal(state.metrics.jev_input_tokens,17964);assert.equal(state.analytics.jev.output_tokens,58);
  assert.equal(state.analytics.jev.cached_calls,1);assert.equal(state.analytics.jev.estimated_usd,0.000754488);
  assert.equal(state.metrics.saved_usd,null);assert.equal(state.metrics.quota_saved,null);assert.ok(state.events.length<=100);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
