import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProviderSettings, SUPPORTED_PROVIDERS, DEFAULT_FALLBACK_CHAIN} from '../src/provider-settings.mjs';

test('provider-settings initializes defaults and sanitizes metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-prov-settings-'));
  try {
    const ps = createProviderSettings({
      dataDir: dir,
      repositoryRoot: process.cwd(),
      env: {},
      protect: v => `enc:${v}`,
      unprotect: v => v.replace(/^enc:/, ''),
    });

    const meta = ps.metadata();
    assert.equal(meta.auto_fallback, true);
    assert.deepEqual(meta.fallback_chain, DEFAULT_FALLBACK_CHAIN);
    assert.equal(meta.providers.length, 5);

    const codex = meta.providers.find(p => p.id === 'codex');
    assert.equal(codex.name, 'OpenAI Codex');
    assert.equal(codex.enabled, true);

    const devin = meta.providers.find(p => p.id === 'devin');
    assert.equal(devin.name, 'Devin / Windsurf');
    assert.equal(devin.expires_at, null);
    for (const id of ['antigravity', 'openrouter', 'anthropic']) assert.equal(meta.providers.find(p => p.id === id).enabled, false);

    // Never leaks secrets in metadata
    assert(!JSON.stringify(meta).includes('enc:'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('provider updates accept the legacy credential alias atomically without exposing its value', () => {
 const dir=mkdtempSync(join(tmpdir(),'orinonu-provider-alias-'));
 try{
  const ps=createProviderSettings({dataDir:dir,repositoryRoot:process.cwd(),env:{},protect:value=>'encrypted:'+value,unprotect:value=>value.slice(10)});
  const sentinel='SENTINEL_FAKE_UI_CREDENTIAL';
  const meta=ps.update({providers:{openrouter:{api_key:sentinel,enabled:false,model:'openai/gpt-4o'}}});
  assert.equal(ps.credentials('openrouter').key,sentinel);
  assert.equal(meta.providers.find(row=>row.id==='openrouter').key_source,'private_store');
  assert.equal(meta.providers.find(row=>row.id==='openrouter').enabled,false);
  assert.doesNotMatch(JSON.stringify(meta),/SENTINEL_FAKE_UI_CREDENTIAL/);
  assert.throws(()=>ps.update({providers:{openrouter:{key:'other',api_key:sentinel,enabled:true}}}),/conflitantes/);
  assert.equal(ps.credentials('openrouter').key,sentinel);
  assert.equal(ps.metadata().providers.find(row=>row.id==='openrouter').enabled,false);
  assert.throws(()=>ps.update({providers:{openrouter:{api_key:42,model:'changed'}}}),/credencial/i);
  assert.equal(ps.credentials('openrouter').model,'openai/gpt-4o');
  ps.update({providers:{openrouter:{model:'openai/gpt-4o'}}});
  assert.equal(ps.credentials('openrouter').key,sentinel);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('provider expiry metadata identifies declarations without claiming an observed subscription', () => {
 const dir=mkdtempSync(join(tmpdir(),'orinonu-provider-expiry-'));
 try{
  const options={dataDir:dir,repositoryRoot:process.cwd(),env:{},protect:value=>'encrypted:'+value,unprotect:value=>value.slice(10)};
  const ps=createProviderSettings(options);
  const initial=ps.metadata().providers.find(row=>row.id==='devin');
  assert.equal(initial.expires_at,null);
  assert.equal(initial.expires_at_source,'unknown');
  const expiry='2999-01-01T00:00:00Z';
  const updated=ps.update({providers:{devin:{expires_at:expiry}}});
  const devin=updated.providers.find(row=>row.id==='devin');
  assert.equal(devin.expires_at,expiry);
  assert.equal(devin.expires_at_source,'local_declaration');
  assert.equal(ps.credentials('devin').expires_at,expiry);
  assert.equal(createProviderSettings(options).metadata().providers.find(row=>row.id==='devin').expires_at_source,'local_declaration');
  for(const row of updated.providers.filter(row=>row.id!=='devin'))assert.equal(row.expires_at_source,'unknown');
  assert.equal(devin.subscription_expires_at,undefined);
  assert.equal(devin.expires_at_observed_at,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('provider-settings saves encrypted credentials and updates fallback chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-prov-save-'));
  try {
    const ps = createProviderSettings({
      dataDir: dir,
      repositoryRoot: process.cwd(),
      env: {},
      protect: v => `mock_enc_${v}`,
      unprotect: v => v.replace(/^mock_enc_/, ''),
    });

    const updated = ps.update({
      fallback_chain: ['antigravity', 'devin', 'codex'],
      auto_fallback: true,
      providers: {
        antigravity: { key: 'google-secret-api-key', model: 'gemini-3.8-flash' },
        openrouter: { key: 'sk-or-test-key-123', enabled: true },
      },
    });

    assert.deepEqual(updated.fallback_chain, ['antigravity', 'devin', 'codex']);
    const agMeta = updated.providers.find(p => p.id === 'antigravity');
    assert.equal(agMeta.key_source, 'private_store');
    assert.equal(agMeta.model, 'gemini-3.8-flash');

    // Credentials retrieval for execution
    const agCreds = ps.credentials('antigravity');
    assert.equal(agCreds.key, 'google-secret-api-key');

    const orCreds = ps.credentials('openrouter');
    assert.equal(orCreds.key, 'sk-or-test-key-123');

    // Reload from stored file
    const reloaded = createProviderSettings({
      dataDir: dir,
      repositoryRoot: process.cwd(),
      env: {},
      protect: v => `mock_enc_${v}`,
      unprotect: v => v.replace(/^mock_enc_/, ''),
    });
    assert.deepEqual(reloaded.metadata().fallback_chain, ['antigravity', 'devin', 'codex']);
    assert.equal(reloaded.credentials('antigravity').key, 'google-secret-api-key');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
