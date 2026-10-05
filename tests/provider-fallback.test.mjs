import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMissionServer} from '../src/server.mjs';
import {PassThrough} from 'node:stream';

test('server exposes provider settings and quotas via HTTP and handles PATCH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-prov-http-'));
  const app = createMissionServer({
    dataDir: dir,
    authController: { state: () => ({ status: 'chatgpt' }), cancel() {}, probe: async () => ({ status: 'chatgpt' }) },
  });
  await app.listen(0);

  try {
    // GET /api/settings includes provider_settings and quotas
    let res = await fetch(app.url + '/api/settings');
    let state = await res.json();
    assert(state.provider_settings);
    assert(state.quotas);
    assert.equal(state.provider_settings.auto_fallback, true);
    assert.equal(state.provider_settings.providers.length, 5);

    // GET /api/quotas
    res = await fetch(app.url + '/api/quotas');
    const quotas = await res.json();
    assert(Array.isArray(quotas.providers));
    assert(quotas.providers.some(p => p.id === 'devin'));
    assert(quotas.providers.some(p => p.id === 'antigravity'));

    // PATCH /api/settings updates fallback chain and provider credentials safely
    res = await fetch(app.url + '/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fallback_chain: ['antigravity', 'devin', 'codex'],
        providers: {
          antigravity: { model: 'gemini-3.8-flash' },
        },
      }),
    });
    assert.equal(res.status, 200);
    const patched = await res.json();
    assert.deepEqual(patched.provider_settings.fallback_chain, ['antigravity', 'devin', 'codex']);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unverified execution providers are refused by the HTTP API without dispatch',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-unverified-executors-'));
 let launches=0;
 const app=createMissionServer({dataDir:dir,runner:()=>{launches++;throw Error('Unexpected executor');},codexPath:process.execPath,antigravityPath:process.execPath});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});await app.listen(0);
 for(const agent of ['antigravity','openrouter','anthropic','devin']){
  const response=await fetch(app.url+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Unverified executor',workspace:dir,goal:'No dispatch',acceptance:'No unverified execution',agent,profile:'implementation',max_minutes:1})});
  assert.equal(response.status,400,agent);
 }
 assert.equal(launches,0);
 assert.equal((await(await fetch(app.url+'/api/state')).json()).tasks.length,0);
});

test('persisted unverified providers cannot trigger paid planning or executor dispatch',async t=>{
 const {acceptance,queuedPlanning,wait}=await import('./acceptance/harness.mjs');
 const f=await acceptance(t,{mode:'supervised',tasks:[workspace=>queuedPlanning(workspace,{agent:'antigravity'})]});
 await wait(async()=>(await f.state()).tasks[0].status==='blocked');
 assert.equal(f.children.length,0);
 assert.equal(f.calls.decide.length,0);
});

test('quota failures cannot select an authenticated provider with an unverified execution boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-prov-fallback-'));

  // Custom runner simulating a quota failure on codex
  let invocationCount = 0;
  const mockRunner = (cmd, args) => {
    invocationCount++;
    const handlers = {};
    const stderrHandlers = {};
    const stdoutHandlers = {};
    const emitter = {
      pid: 12345,
      stdin: new PassThrough(),
      stdout: {
        on(event, cb) { stdoutHandlers[event] = cb; },
        resume() {},
      },
      stderr: {
        on(event, cb) {
          stderrHandlers[event] = cb;
        },
        resume() {},
      },
      on(event, cb) {
        handlers[event] = cb;
        if (event === 'close') {
          setTimeout(() => {
            stderrHandlers['data']?.(Buffer.from('Rate limit exceeded: 429 Too Many Requests. Usage cap reached for OpenAI subscription.'));
            cb(1);
          }, 30);
        }
      },
      kill() {},
    };
    return emitter;
  };

  const app = createMissionServer({
    dataDir: dir,
    runner: mockRunner,
    codexPath: process.execPath,
    antigravityPath: process.execPath,
    devinPath: process.execPath,
    devinAuthController: { state: () => ({ cli_authenticated: true }) },
    authController: { state: () => ({ status: 'chatgpt' }), cancel() {}, probe: async () => ({ status: 'chatgpt' }) },
  });
  await app.listen(0);

  try {
    // Configure fallback chain to antigravity
    await fetch(app.url + '/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fallback_chain: ['codex', 'antigravity', 'devin'],
        auto_fallback: true,
        providers: { antigravity: { enabled: true } },
      }),
    });

    // Create a mission starting with codex
    const createRes = await fetch(app.url + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Tarefa com fallback de cota',
        workspace: process.cwd(),
        goal: 'Testar migração de cota para antigravity',
        acceptance: 'Migração registrada com evidência',
        agent: 'codex',
        profile: 'implementation',
        max_minutes: 10,
      }),
    });
    assert.equal(createRes.status, 201);
    const task = await createRes.json();

    // Trigger run on task
    await fetch(`${app.url}/api/tasks/${task.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

    // Wait for process finish and fallback trigger
    await new Promise(r => setTimeout(r, 350));

    // Inspect server state
    const stateRes = await fetch(app.url + '/api/state');
    const state = await stateRes.json();
    const updatedTask = state.tasks.find(t => t.id === task.id);

    // Codex quota should be marked depleted
    const codexQuota = state.quotas.providers.find(p => p.id === 'codex');
    assert.equal(codexQuota.status, 'quota_depleted');

    // The configured alternatives lack verified execution boundaries even when the mocked CLI reports authentication, so the
    // exhausted Codex mission stays blocked instead of granting an unsafe fallback.
    assert.equal(updatedTask.agent, 'codex');
    assert.equal(updatedTask.status, 'blocked');
    assert.equal(invocationCount, 1);
    assert.ok(!state.events.some(e => e.kind === 'provider_fallback_triggered'));
    assert.ok(!state.events.some(e => e.kind === 'task_started' && e.agent === 'antigravity'));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
