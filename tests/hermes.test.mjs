import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hermesInvocation, parseHermesEvent } from '../src/hermes.mjs';

test('Hermes keeps arbitrary prompt literal in an exclusive file, with no shell or approval bypass', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'jev-hermes-'));
  try {
    const promptFile = join(workspace, 'prompt.txt');
    const prompt = 'Quotes " and $(Get-Secret) `commands`\nPortuguês literal';
    const request = { hermesPath: join(workspace, 'hermes.exe'), workspace, prompt, promptFile };
    const invocation = hermesInvocation(request);
    assert.equal(readFileSync(promptFile, 'utf8'), prompt);
    assert.deepEqual(invocation.args, ['chat', '--in', workspace, '--query-file', promptFile, '--oneshot', '--format', 'stream-json', '--max-turns', '20', '--source', 'tool']);
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.windowsHide, true);
    assert.ok(!JSON.stringify(invocation).includes(prompt));
    assert.throws(() => hermesInvocation(request), { code: 'EEXIST' });
    assert.throws(() => hermesInvocation({ ...request, maxTurns: 0 }), /maxTurns/);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('Hermes metadata parser drops sensitive content and malformed usage', () => {
  assert.deepEqual(parseHermesEvent('{"type":"system","model":"provider/model","session_id":"session-1","text":"secret"}'), { type: 'system', model: 'provider/model', sessionId: 'session-1' });
  assert.deepEqual(parseHermesEvent({ type: 'result', session_id: 'session-1', exit_code: 1, duration_ms: 1200, text: 'secret', error: 'secret', tokens: { input: 10, output: 2, total: 12, cache_read: 0, cache_write: -2, extra: 'secret' } }), { type: 'result', sessionId: 'session-1', exitCode: 1, durationMs: 1200, usage: { input: 10, output: 2, total: 12, cache_read: 0 } });
  assert.equal(parseHermesEvent('not json'), null);
  assert.equal(parseHermesEvent({ type: 'tool_use', input: 'secret' }), null);
  assert.deepEqual(parseHermesEvent({ type: 'result', tokens: { input: Infinity, output: '2' }, duration_ms: -1 }), { type: 'result' });
});

test('Hermes tool activity exposes only safe categories and explicit outcomes', () => {
  assert.deepEqual(parseHermesEvent({type:'tool_use',name:'terminal',input:{command:'private-secret'},tool_call_id:'private-secret'}),{type:'tool_use',tool:'command_execution'});
  assert.deepEqual(parseHermesEvent({type:'tool_result',name:'write_file',is_error:true,output:'private-secret',duration_ms:24}),{type:'tool_result',tool:'file_change',failed:true,durationMs:24});
  assert.deepEqual(parseHermesEvent({type:'tool_use',name:'private_secret_tool'}),{type:'tool_use',tool:'hermes_tool_call'});
  assert.equal(parseHermesEvent({type:'tool_result',name:'terminal',output:'success'}),null);
  assert.equal(parseHermesEvent({type:'tool_use',name:'invalid\nname'}),null);
});
