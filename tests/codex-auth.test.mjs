import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCodexAuth, codexAuthEnvironment, parseDeviceChallenge, parseCodexAuthStatus } from '../src/codex-auth.mjs';

function processMock() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.killed = false;
  p.kill = () => { p.killed = true; };
  return p;
}
function factory(status = 'Not logged in', exit = 1) {
  const calls = [];
  const spawnImpl = (path, args, options) => {
    const p = processMock(); calls.push({ path, args, options, p });
    if (args.at(-1) === 'status') queueMicrotask(() => { p.stderr.emit('data', status); p.emit('close', exit); });
    return p;
  };
  return { calls, spawnImpl };
}

test('status parser never exposes keys, arbitrary errors, or unknown success', () => {
  assert.equal(parseCodexAuthStatus('Logged in using ChatGPT', 0), 'chatgpt');
  assert.equal(parseCodexAuthStatus('Logged in using an API key - sk-secret', 0), 'api_key');
  assert.equal(parseCodexAuthStatus('Not logged in', 1), 'unauthenticated');
  assert.equal(parseCodexAuthStatus('secret error', 1), 'unavailable');
  assert.equal(parseCodexAuthStatus('success', 0), 'unavailable');
});

test('challenge allowlist blocks lookalike domains, query token URLs and arbitrary output', () => {
  assert.deepEqual(parseDeviceChallenge('https://auth.openai.com/codex/device\nABCD-12345\nsk-secret'), { verification_url: 'https://auth.openai.com/codex/device', user_code: 'ABCD-12345' });
  assert.deepEqual(parseDeviceChallenge('https://auth.openai.com.evil/codex/device\nsecret'), {});
  assert.deepEqual(parseDeviceChallenge('https://auth.openai.com/codex/device?token=secret'), {});
  assert.deepEqual(parseDeviceChallenge('\x1b[32mhttps://auth.openai.com/codex/device\x1b[0m\nABCD-EFGH'), { verification_url: 'https://auth.openai.com/codex/device', user_code: 'ABCD-EFGH' });
});

test('existing ChatGPT or API key authentication is preserved without starting login', async () => {
  for (const [text, expected, loginStatus] of [['Logged in using ChatGPT', 'chatgpt', 'authenticated'], ['Logged in using an API key - sk-secret', 'api_key', 'approval_required']]) {
    const f = factory(text, 0);
    const auth = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: f.spawnImpl });
    const value = await auth.start();
    assert.equal(value.status, expected); assert.equal(value.login.status, loginStatus);
    assert.equal(f.calls.length, 1); assert.ok(!JSON.stringify(value).includes('sk-secret'));
    assert.equal(f.calls[0].options.shell, false); assert.equal(f.calls[0].options.windowsHide, true);
  }
});

test('device login single flight, sanitized challenge and cancellation fence late output', async () => {
  const f = factory(); const auth = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: f.spawnImpl });
  await Promise.all([auth.start(), auth.start()]);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].args, ['login', '--device-auth']);
  const p = f.calls[1].p;
  p.stdout.emit('data', 'https://auth.openai.com/codex/device\nAB');
  p.stdout.emit('data', 'CD-12345\nprivate-token');
  assert.equal(auth.state().login.status, 'awaiting_user'); assert.ok(!JSON.stringify(auth.state()).includes('private-token'));
  await auth.start(); assert.equal(f.calls.length, 2);
  auth.cancel(); assert.equal(p.killed, true);
  p.stdout.emit('data', 'https://auth.openai.com/codex/device\nABCD-12345'); p.emit('close', 0);
  assert.deepEqual(auth.state().login, { status: 'cancelled' }); assert.equal(f.calls.length, 2);
});

test('timeouts and spawn errors are bounded and sanitized', async () => {
  const p = processMock();
  const auth = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: () => p, probeTimeoutMs: 5 });
  const result = auth.probe(); await delay(15);
  assert.equal((await result).status, 'unavailable'); assert.equal(p.killed, true);
  const bad = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: () => { throw new Error('sk-private'); } });
  assert.equal((await bad.start()).login.status, 'unavailable'); assert.ok(!JSON.stringify(bad.state()).includes('sk-private'));
  const f = factory(); const expire = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: f.spawnImpl, loginTimeoutMs: 5 });
  await expire.start(); await delay(15); assert.equal(expire.state().login.status, 'expired'); assert.equal(f.calls[1].p.killed, true);
});

test('cancel during status probe prevents late login and stops probe process', async () => {
  const p = processMock(); let calls = 0;
  const auth = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: () => { calls++; return p; } });
  const start = auth.start(); auth.cancel(); await start;
  assert.equal(calls, 1); assert.equal(p.killed, true); assert.equal(auth.state().login.status, 'cancelled');
  p.stderr.emit('data', 'Not logged in'); p.emit('close', 1);
  assert.equal(auth.state().login.status, 'cancelled');
});

test('status and login use subscription environment without key or access token overrides', async () => {
  const env = { OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', codex_access_token: 'secret', PATH: 'tools', CODEX_HOME: 'home' };
  assert.deepEqual(codexAuthEnvironment(env), { PATH: 'tools', CODEX_HOME: 'home' });
  const f = factory(); const auth = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: f.spawnImpl, env });
  await auth.start();
  for (const call of f.calls) assert.deepEqual(call.options.env, { PATH: 'tools', CODEX_HOME: 'home' });
  auth.cancel(); assert.equal(env.OPENAI_API_KEY, 'secret');
});

test('device completion reprobes CLI status instead of trusting output as authentication', async () => {
  let count = 0; const processes = [];
  const auth = createCodexAuth({ codexPath: 'codex.exe', spawnImpl: (_path, args) => {
    const p = processMock(); processes.push(p);
    if (args.at(-1) === 'status') { count++; queueMicrotask(() => { p.stderr.emit('data', count === 1 ? 'Not logged in' : 'Logged in using ChatGPT'); p.emit('close', count === 1 ? 1 : 0); }); }
    return p;
  } });
  await auth.start(); processes[1].emit('close', 0); await delay(0);
  assert.equal(auth.state().status, 'chatgpt'); assert.equal(auth.state().login.status, 'completed');
  assert.equal(processes.length, 3);
});
