import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../src/store.mjs';
import {createSwarmStore} from '../src/swarm/store.mjs';
import {agentDefinitions} from '../src/swarm/definitions.mjs';

const fixture=(t)=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-swarm-store-'));
 const store=createStore(dir,{tasks:[]});
 t.after(()=>{try{store.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 return {dir,store,swarm:createSwarmStore(store)};
};

test('swarm migration is additive and idempotent: schema=1 stays, entities untouched, integrity holds',t=>{
 const {store,swarm}=fixture(t);
 swarm.migrate();
 assert.equal(store.sql.prepare("SELECT value FROM metadata WHERE key='swarm_schema'").get().value,'1');
 assert.equal(store.sql.prepare("SELECT value FROM metadata WHERE key='schema'").get().value,'1');
 assert.equal(store.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(store.sql.prepare('PRAGMA foreign_key_check').all().length,0);
 swarm.migrate();
 const state=store.load();
 assert.deepEqual(state.tasks,[]);
 store.close();
});

test('reopening a migrated database keeps legacy readers working',t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-swarm-reopen-'));
 let second;
 t.after(()=>{try{second?.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const first=createStore(dir,{tasks:[{id:'t1',workspace:dir,status:'backlog'}]});
 const swarm=createSwarmStore(first);
 swarm.migrate();
 const state=first.load();state.tasks[0].title='kept';first.save(state);
 first.close();
 second=createStore(dir,{tasks:[]});
 const loaded=second.load();
 assert.equal(loaded.tasks[0].id,'t1');
 assert.equal(loaded.tasks[0].title,'kept');
 assert.equal(second.sql.prepare("SELECT value FROM metadata WHERE key='swarm_schema'").get().value,'1');
});

test('definitions are seeded once as immutable version rows',t=>{
 const {swarm}=fixture(t);
 swarm.migrate();
 swarm.seedDefinitions(agentDefinitions);
 swarm.seedDefinitions(agentDefinitions);
 const rows=swarm.listDefinitions();
 assert.equal(rows.length,agentDefinitions.length);
 assert.equal(new Set(rows.map(row=>row.id)).size,agentDefinitions.length);
 const nextjs=swarm.getDefinition('nextjs');
 assert.equal(nextjs.kind,'specialist');
 assert.equal(nextjs.version,1);
 assert.equal(nextjs.team_id,'frontend-lead');
});

test('bindings are versioned per workspace/agent/phase with compare-and-swap updates',t=>{
 const {swarm}=fixture(t);
 swarm.migrate();
 const binding={
  workspace:'c:/proj',agent_id:'nextjs',phase:'implementation',revision:1,
  model_connection_ref:'conn-1',model_id:'gpt-6.1-sol',settings:{effort:'medium'},
  execution_strategy:'codex_harness',harness_connection_ref:'conn-codex',harness_model_id:'gpt-6.1-sol',
  limits:{max_turns:20},capability_requirements:['fs'],fallback_policy:{allowed:false},
 };
 swarm.upsertBinding(binding);
 assert.equal(swarm.getBinding('c:/proj','nextjs','implementation').model_id,'gpt-6.1-sol');
 assert.throws(()=>swarm.upsertBinding({...binding,revision:1,model_id:'other'}),/binding_revision_conflict/);
 swarm.upsertBinding({...binding,revision:2,model_id:'other'});
 assert.equal(swarm.getBinding('c:/proj','nextjs','implementation').model_id,'other');
 assert.equal(swarm.getBinding('c:/proj','nextjs','review'),null);
 assert.throws(()=>swarm.upsertBinding({...binding,revision:3,phase:'deploy'}),/invalid_agent_binding/);
});

test('catalog packs track registered/active status per workspace without granting dispatch',t=>{
 const {swarm}=fixture(t);
 swarm.migrate();
 swarm.registerPack({pack_id:'data-ai',wave:2,version:1,hash:'a'.repeat(64),status:'registered'});
 assert.equal(swarm.packStatus('data-ai').status,'registered');
 swarm.setPackStatus('data-ai','active');
 assert.equal(swarm.packStatus('data-ai').status,'active');
 assert.equal(swarm.packStatus('data-ai').wave,2);
 assert.throws(()=>swarm.setPackStatus('data-ai','dispatched'),/invalid_pack_status/);
});

test('variants and project policies persist per workspace with status discipline',t=>{
 const {swarm}=fixture(t);
 swarm.migrate();
 const variant={
  id:'nextjs--v1',base_id:'nextjs',workspace:'c:/proj',version:1,
  params:{scope_overlay:'x'},provenance:{proposed_by:'orchestrator',proposed_at:'2026-10-05'},status:'proposed',
 };
 swarm.upsertVariant(variant);
 assert.equal(swarm.listVariants('c:/proj').length,1);
 assert.equal(swarm.listVariants('c:/other').length,0);
 assert.throws(()=>swarm.setVariantStatus('nextjs--v1','active'),/variant_activation_requires_approval/);
 swarm.upsertVariant({...variant,version:2,status:'active',provenance:{...variant.provenance,approved_by:'user',decision_ref:'d-1'}});
 swarm.setVariantStatus('nextjs--v1','suspended');
 assert.equal(swarm.listVariants('c:/proj')[0].status,'suspended');
 const policy={workspace:'c:/proj',revision:1,requested:'swarm',enabled:false,readiness:{state:'blocked',reasons:['no connection']}};
 swarm.upsertPolicy(policy);
 assert.equal(swarm.getPolicy('c:/proj').requested,'swarm');
 assert.throws(()=>swarm.upsertPolicy({...policy,revision:1,requested:'legacy'}),/policy_revision_conflict/);
});
