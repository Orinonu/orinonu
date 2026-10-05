import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PILOT_CASES,localMemoryBackend,honchoBackend,runPilot } from '../src/memory-pilot.mjs';

const dir=()=>mkdtempSync(join(tmpdir(),'nexo-memory-pilot-'));

test('local baseline recalls required facts with provenance and keeps project isolation',async()=>{
  const d=dir();
  const backend=localMemoryBackend(d);
  const pilot=await runPilot({backends:{local:backend}});
  const local=pilot.arms.local.measurements;
  assert.equal(pilot.arms.local.available,true);
  assert.equal(local.recall.correct,local.recall.total);
  assert.equal(local.isolation.violations,0);
  assert(local.recall.rows.every(row=>row.provenance));
  // a fact from project alpha must never appear in beta's scope
  const leaks=local.isolation.rows.flatMap(r=>r.returned_ids);
  for(const leak of leaks)assert(!leak.includes('alpha'));
  rmSync(d,{recursive:true,force:true});
});

test('fact IDs and supersessions are scoped to their project even after reopening',async t=>{
  const d=dir();t.after(()=>rmSync(d,{recursive:true,force:true}));
  const backend=localMemoryBackend(d);
  await backend.write({project:'alpha',fact:{id:'shared-id',text:'sqlite storage',source:'alpha-policy'}});
  await backend.write({project:'beta',fact:{id:'shared-id',text:'jsonl storage',source:'beta-policy'}});
  assert.deepEqual((await backend.query({project:'alpha',text:'sqlite'})).facts.map(f=>f.id),['shared-id']);
  await backend.write({project:'alpha',fact:{id:'new-id',text:'postgres storage',source:'alpha-policy-v2',supersedes:'shared-id'}});
  const reopened=localMemoryBackend(d);
  assert.deepEqual((await reopened.query({project:'alpha',text:'sqlite'})).facts,[]);
  assert.deepEqual((await reopened.query({project:'alpha',text:'postgres'})).facts.map(f=>f.id),['new-id']);
  const beta=await reopened.query({project:'beta',text:'jsonl'});
  assert.deepEqual(beta.facts.map(f=>f.id),['shared-id']);
  assert.equal(beta.facts[0].provenance.source,'beta-policy');
  assert.equal(beta.facts[0].provenance.project,'beta');
});

test('corrections supersede older facts and retention survives a new backend instance',async()=>{
  const d=dir();
  const backend=localMemoryBackend(d);
  const first=await runPilot({backends:{local:backend}});
  assert.equal(first.arms.local.measurements.corrections.correct,first.arms.local.measurements.corrections.total);
  // reopening the store proves retention is durable, not in-memory luck
  const reopened=localMemoryBackend(d);
  const again=await runPilot({backends:{local:reopened}});
  assert.equal(again.arms.local.measurements.retention.retained,again.arms.local.measurements.retention.total);
  assert.equal(again.arms.local.measurements.recall.correct,again.arms.local.measurements.recall.total);
  rmSync(d,{recursive:true,force:true});
});

test('Honcho arm fails closed without credentials and never fabricates a measurement',async()=>{
  const d=dir();
  let called=false;
  const honcho=honchoBackend({fetchImpl:async()=>{called=true;return new Response('{}',{status:200});}});
  const pilot=await runPilot({backends:{local:localMemoryBackend(d),honcho}});
  assert.equal(called,false,'no network call without credentials');
  assert.equal(pilot.arms.honcho.available,false);
  assert.match(pilot.arms.honcho.reason,/credenciais|api.?key|endpoint/i);
  assert.equal(pilot.arms.honcho.measurements,null);
  assert.equal(pilot.comparison.recall_delta,null);
  assert.equal(pilot.comparison.cost_delta_usd,null);
  rmSync(d,{recursive:true,force:true});
});

test('configured Honcho credentials cannot enable an unverified transport or network calls',async()=>{
  let requests=0;
  const backend=honchoBackend({endpoint:'https://honcho.test',apiKey:'test-only',fetchImpl:async()=>{
    requests++;return new Response('{}',{status:200});
  }});
  assert.equal((await backend.verify()).available,false);
  await assert.rejects(backend.write({project:'alpha',fact:PILOT_CASES.writes[0]}),/contrato|verificado/i);
  await assert.rejects(backend.query({project:'alpha',text:'sqlite'}),/contrato|verificado/i);
  const report=await runPilot({backends:{honcho:backend},budget_usd:0});
  assert.equal(report.arms.honcho.available,false);
  assert.equal(report.arms.honcho.measurements,null);
  assert.equal(report.credential_gate.honcho,'configured_unverified');
  assert.equal(requests,0);
});

test('a zero pilot budget blocks a chargeable operation before it is invoked',async()=>{
  let operations=0;
  const backend={
    verify:async()=>({available:true,max_operation_cost_usd:0.01}),
    write:async()=>{operations++;return {ok:true,cost_usd:0.01};},
    query:async()=>{operations++;return {facts:[],cost_usd:0.01};},
  };
  const report=await runPilot({backends:{candidate:backend},budget_usd:0});
  assert.equal(operations,0);
  assert.equal(report.arms.candidate.budget_exceeded,true);
  assert.equal(report.arms.candidate.completed,false);
  assert.equal(report.arms.candidate.measurements.cost_usd,null);
});

test('pilot retention queries obey the same budget and incomplete arms cannot be compared',async t=>{
  const d=dir();t.after(()=>rmSync(d,{recursive:true,force:true}));
  let operations=0;
  const backend={
    verify:async()=>({available:true,max_operation_cost_usd:0.125}),
    write:async()=>{operations++;return {ok:true,cost_usd:0.125};},
    query:async()=>{operations++;return {facts:[],cost_usd:0.125};},
  };
  const report=await runPilot({backends:{local:localMemoryBackend(d),candidate:backend},budget_usd:1.75});
  assert.equal(operations,14);
  assert.equal(report.arms.candidate.completed,false);
  assert.equal(report.arms.candidate.budget_exceeded,true);
  assert.equal(report.arms.candidate.measurements.retention.total,2);
  assert.equal(report.arms.candidate.measurements.measured_cost_usd,1.75);
  assert.equal(report.arms.candidate.measurements.cost_usd,null);
  assert.equal(report.comparison.recall_delta,null);
  assert.equal(report.comparison.latency_delta_ms,null);
});

test('a bounded pilot refuses operations whose maximum charge cannot be verified',async()=>{
  let operations=0;
  const backend={
    verify:async()=>({available:true}),
    write:async()=>{operations++;return {ok:true,cost_usd:null};},
    query:async()=>{operations++;return {facts:[],cost_usd:null};},
  };
  const report=await runPilot({backends:{candidate:backend},budget_usd:1});
  assert.equal(operations,0);
  assert.equal(report.arms.candidate.budget_unverifiable,true);
  assert.equal(report.arms.candidate.completed,false);
  assert.equal(report.arms.candidate.measurements.cost_usd,null);
});

test('a candidate backend cannot rewrite the shared pilot corpus or its expected facts',async()=>{
  const cases=structuredClone(PILOT_CASES),original=structuredClone(cases);
  const candidate={
    verify:async()=>({available:true}),
    write:async({fact})=>{fact.id='changed-by-candidate';fact.text='changed input';return {ok:true,cost_usd:0};},
    query:async()=>({facts:[],cost_usd:0}),
  };
  await runPilot({backends:{candidate},cases});
  assert.deepEqual(cases,original);
});

test('unknown or partially measured pilot costs never become zero or a comparable total',async()=>{
  const backend=cost=>({
    verify:async()=>({available:true}),
    write:async()=>({ok:true,cost_usd:cost}),
    query:async()=>({facts:[],cost_usd:null}),
  });
  const report=await runPilot({backends:{local:backend(0),candidate:backend(0.01)}});
  assert.equal(report.arms.local.measurements.cost_usd,null);
  assert.equal(report.arms.candidate.measurements.cost_usd,null);
  assert.equal(report.arms.candidate.measurements.cost_complete,false);
  assert.equal(report.arms.candidate.measurements.measured_cost_usd,0.05);
  assert.equal(report.comparison.cost_delta_usd,null);
  assert.equal(report.promoted,false);
});

test('a verified test transport measures the same cases with project scope and explicit partial costs',async()=>{
  const d=dir();
  const requests=[];
  const store=new Map();
  const transport={
    verify:async()=>({available:true,contract_verified:true,contract:'local-test-fixture-v1'}),
    write:async request=>{
      requests.push(request);
      const {scope,fact}=request;
      store.set(scope+':'+fact.id,{...fact,scope});
      if(fact.supersedes)store.delete(scope+':'+fact.supersedes);
      return {ok:true,cost_usd:0.001};
    },
    query:async request=>{
      requests.push(request);
      const {scope,text}=request;
      const hits=[...store.values()].filter(f=>f.scope===scope&&f.text.toLowerCase().includes(text.toLowerCase().split(/\s+/)[0]));
      return {facts:hits.map(f=>({id:f.id,text:f.text,provenance:{fact_id:f.id,source:f.source}}))};
    },
  };
  const honcho=honchoBackend({endpoint:'https://honcho.test',apiKey:'pilot-key',transport});
  const pilot=await runPilot({backends:{local:localMemoryBackend(d),honcho}});
  assert.equal(pilot.arms.honcho.available,true);
  assert.equal(pilot.credential_gate.honcho,'verified_transport');
  assert(requests.length>0);
  // every request is scoped — cross-project isolation is enforced by the adapter, not by the service
  assert(requests.every(r=>['project:alpha','project:beta'].includes(r.scope)));
  assert(requests.every(r=>r.apiKey==='pilot-key'),'credentials must reach only the injected transport');
  const h=pilot.arms.honcho.measurements;
  assert(h&&typeof h.recall==='object'&&typeof h.isolation==='object'&&typeof h.latency_ms==='number');
  assert.equal(h.cost_usd,null);
  assert.equal(h.cost_complete,false);
  assert(h.measured_cost_usd>0);
  assert.equal(pilot.comparison.cost_delta_usd,null);
  assert.equal(pilot.promoted,false);
  assert.match(pilot.rollback,/nada|nunca|sem/i);
  rmSync(d,{recursive:true,force:true});
});

test('the pilot endpoint runs the local baseline, keeps Honcho gated and stores the bounded report',async t=>{
  const d=dir(),dataDir=join(d,'state');
  const { createMissionServer }=await import('../src/server.mjs');
  const app=createMissionServer({dataDir,codexPath:process.execPath});await app.listen(0);
  t.after(async()=>{await app.close();rmSync(d,{recursive:true,force:true});});
  const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const report=await(await post('/api/memory-pilot',{})).json();
  assert.equal(report.arms.local.available,true);
  assert.equal(report.arms.local.measurements.recall.correct,report.arms.local.measurements.recall.total);
  assert.equal(report.credential_gate.honcho,'not_configured');
  assert.equal(report.promoted,false);
  const evolution=await(await fetch(app.url+'/api/evolution')).json();
  const stored=evolution.memory_pilots.find(row=>row.id===report.id);
  assert.equal(stored.arms.local.measurements.isolation.violations,0);
  assert.equal((await post('/api/memory-pilot',{budget_usd:-1})).status,400);
});

test('the HTTP pilot cannot make external calls merely because environment credentials exist',async t=>{
  const d=dir();
  const previousEndpoint=process.env.HONCHO_ENDPOINT,previousKey=process.env.HONCHO_API_KEY;
  const originalFetch=globalThis.fetch;let externalCalls=0;
  process.env.HONCHO_ENDPOINT='https://honcho.test';process.env.HONCHO_API_KEY='test-only';
  globalThis.fetch=async()=>{externalCalls++;throw new Error('External calls are not authorized by this test.');};
  const {createMissionServer}=await import('../src/server.mjs');
  const app=createMissionServer({dataDir:join(d,'state'),codexPath:process.execPath,apiKey:''});
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    if(previousEndpoint===undefined)delete process.env.HONCHO_ENDPOINT;else process.env.HONCHO_ENDPOINT=previousEndpoint;
    if(previousKey===undefined)delete process.env.HONCHO_API_KEY;else process.env.HONCHO_API_KEY=previousKey;
    await app.close();rmSync(d,{recursive:true,force:true});
  });
  await app.listen(0);
  const response=await originalFetch(app.url+'/api/memory-pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,200);
  const report=await response.json();
  assert.equal(report.arms.local.available,true);
  assert.equal(report.arms.honcho.available,false);
  assert.equal(report.arms.honcho.measurements,null);
  assert.equal(report.credential_gate.honcho,'configured_unverified');
  assert.equal(report.comparison.cost_delta_usd,null);
  assert.equal(externalCalls,0);
  assert(!JSON.stringify(report).includes('test-only'));
});

test('pilot report keeps unmeasured dimensions explicit and never promotes without evidence and credentials',async()=>{
  const d=dir();
  const pilot=await runPilot({backends:{local:localMemoryBackend(d)},budget_usd:0});
  assert.equal(pilot.promoted,false);
  assert(pilot.limitations.length>0);
  assert.equal(pilot.credential_gate.honcho,'not_configured');
  const store=JSON.stringify(pilot);
  assert(!store.includes('pilot-key'));
  rmSync(d,{recursive:true,force:true});
});
