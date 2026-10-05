import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, MODEL } from './engine.mjs';

const args = (extra = {}) => ({ goal: 'Escolher a abordagem local e reversível para o parser.', category: 'technical', delegated: true,
  options: [{ id: 'a', text: 'Opção A' }, { id: 'b', text: 'Opção B' }], ...extra });
const answer = probabilities => {
  const choice = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0][0];
  const sorted = Object.values(probabilities).sort((x, y) => y - x);
  const confidence = Math.max(0, Math.min(1, (sorted.length * sorted[0] - 1) / (sorted.length - 1)));
  return new Response(JSON.stringify({ model: MODEL, usage: { input_tokens: 10, output_tokens: 2 }, answers: { q0: { type: 'choice', choice, confidence, probabilities } } }));
};
const engineFor = (probabilities, extra = {}) => createEngine({ apiKey: 'test', fetcher: async () => answer(probabilities), ...extra });

test('consequential stakes keep the strict threshold and never relax by default', async () => {
  const output = await engineFor({ a: 0.55, b: 0.3, abstain: 0.15 }).call('resolve_decision', args());
  assert.equal(output.action, 'abstain');
  assert.equal(output.selected_id, null);
  assert.equal(output.policy, undefined);
});

test('reversible stakes act on a clear leader among the real options even when confidence is modest', async () => {
  const output = await engineFor({ a: 0.55, b: 0.3, abstain: 0.15 }).call('resolve_decision', args(), undefined, { stakes: 'reversible' });
  assert.equal(output.ok, true);
  assert.equal(output.action, 'recommend');
  assert.equal(output.selected_id, 'a');
  assert.equal(output.executes_action, false);
  assert.equal(output.policy, 'reversible-v1');
  assert.equal(output.reason, 'reversible_option_recommended');
  assert.ok(output.basis.margin >= 0.1 && output.basis.p_abstain < 0.5);
});

test('reversible stakes still abstain when the model mostly says no option fits', async () => {
  const output = await engineFor({ a: 0.25, b: 0.2, abstain: 0.55 }).call('resolve_decision', args(), undefined, { stakes: 'reversible' });
  assert.equal(output.action, 'abstain');
  assert.equal(output.selected_id, null);
  assert.equal(output.reason, 'abstain_mass_high');
});

test('a close call takes the host-declared conservative default, otherwise it abstains', async () => {
  const probabilities = { a: 0.4, b: 0.38, abstain: 0.22 };
  const open = await engineFor(probabilities).call('resolve_decision', args(), undefined, { stakes: 'reversible' });
  assert.equal(open.action, 'abstain');
  assert.equal(open.reason, 'close_call_no_default');
  const withDefault = await engineFor(probabilities).call('resolve_decision', args(), undefined, { stakes: 'reversible', defaultId: 'b' });
  assert.equal(withDefault.action, 'recommend');
  assert.equal(withDefault.selected_id, 'b');
  assert.equal(withDefault.reason, 'close_call_conservative_default');
  assert.equal(withDefault.executes_action, false);
});

test('a diffuse distribution over many options is a close call, not a pick', async () => {
  const options = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, text: 'Opção ' + id }));
  const output = await engineFor({ a: 0.24, b: 0.2, c: 0.2, d: 0.18, e: 0.14, abstain: 0.04 }).call('resolve_decision', args({ options }), undefined, { stakes: 'reversible' });
  assert.equal(output.action, 'abstain');
  assert.equal(output.reason, 'close_call_no_default');
});

test('invalid stakes or a default outside the supplied options are rejected before any request', async () => {
  const engine = createEngine({ apiKey: 'test', fetcher: () => assert.fail('network used') });
  for (const options of [{ stakes: 'whatever' }, { stakes: 'reversible', defaultId: 'zzz' }, { defaultId: 'a' }]) {
    await assert.rejects(engine.call('resolve_decision', args(), undefined, options), /invalid_tool_arguments/);
  }
});

test('the default can never be the abstain slot and stays advisory', async () => {
  const engine = createEngine({ apiKey: 'test', fetcher: () => assert.fail('network used') });
  await assert.rejects(engine.call('resolve_decision', args(), undefined, { stakes: 'reversible', defaultId: 'abstain' }), /invalid_tool_arguments/);
});

test('bursts wait for a slot instead of failing as busy, and never exceed the parallel cap', async () => {
  let running = 0, peak = 0;
  const engine = createEngine({ apiKey: 'test', maxParallel: 2, fetcher: async () => {
    running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 15));
    running--;
    return answer({ a: 0.9, b: 0.05, abstain: 0.05 });
  } });
  const results = await Promise.all(Array.from({ length: 7 }, (_, i) => engine.call('resolve_decision', args({ goal: 'Escolha número ' + i }))));
  assert.ok(results.every(result => result.ok === true), JSON.stringify(results.map(result => result.error)));
  assert.equal(peak, 2);
});

test('a full wait queue still fails explicitly instead of growing without bound', async () => {
  const engine = createEngine({ apiKey: 'test', maxParallel: 1, maxQueue: 1, fetcher: async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return answer({ a: 0.9, b: 0.05, abstain: 0.05 });
  } });
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => engine.call('resolve_decision', args({ goal: 'Fila ' + i }))));
  assert.equal(results.filter(result => result.ok).length, 2);
  assert.ok(results.filter(result => !result.ok).every(result => result.error === 'busy_retry_later'));
});

test('one 429 or 529 is retried with backoff; a second failure is reported, not hidden', async () => {
  for (const status of [429, 529]) {
    let calls = 0;
    const engine = createEngine({ apiKey: 'test', retryDelayMs: 1, fetcher: async () => {
      calls++;
      return calls === 1 ? new Response('busy', { status }) : answer({ a: 0.9, b: 0.05, abstain: 0.05 });
    } });
    const output = await engine.call('resolve_decision', args({ goal: 'Retry ' + status }));
    assert.equal(output.ok, true);
    assert.equal(calls, 2);
  }
  let calls = 0;
  const failing = createEngine({ apiKey: 'test', retryDelayMs: 1, fetcher: async () => { calls++; return new Response('busy', { status: 429 }); } });
  const output = await failing.call('resolve_decision', args({ goal: 'Always busy' }));
  assert.equal(output.ok, false);
  assert.equal(output.error, 'jev_http_429');
  assert.equal(calls, 2);
});

test('other HTTP errors are not retried', async () => {
  let calls = 0;
  const engine = createEngine({ apiKey: 'test', retryDelayMs: 1, fetcher: async () => { calls++; return new Response('bad', { status: 422 }); } });
  const output = await engine.call('resolve_decision', args({ goal: 'No retry' }));
  assert.equal(output.error, 'jev_http_422');
  assert.equal(calls, 1);
});

test('agent-initiated calls are reversible only for technical and skill options, and agents cannot widen their own stakes', async () => {
  const { agentCallOptions } = await import('./engine.mjs');
  assert.deepEqual(agentCallOptions('resolve_decision', { category: 'technical' }), { stakes: 'reversible' });
  assert.deepEqual(agentCallOptions('resolve_decision', { category: 'skill' }), { stakes: 'reversible' });
  assert.deepEqual(agentCallOptions('resolve_decision', { category: 'tool' }), {});
  assert.deepEqual(agentCallOptions('resolve_decision', { category: 'plugin' }), {});
  assert.deepEqual(agentCallOptions('evaluate_conditions', { category: 'technical' }), {});
  const engine = createEngine({ apiKey: 'test', fetcher: async () => answer({ a: 0.55, b: 0.3, abstain: 0.15 }) });
  await assert.rejects(engine.call('resolve_decision', { ...args(), stakes: 'reversible' }), /unknown_argument/);
});
