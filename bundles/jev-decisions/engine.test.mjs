import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, MODEL } from './engine.mjs';

const args = { goal: 'Corrigir parser que perde zero.', candidates: [
  { id: 'parser', text: 'return value || defaultValue;' }, { id: 'style', text: '.button { color: blue; }' },
] };
const batch = { state: 'Os testes terminaram com erro de dependência ausente.', conditions: [{ id: 'install', question: 'Falta uma dependência?' }] };
function answer(body, overrides = {}) {
  const request = JSON.parse(body);
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question], i) => [id,
    question.type === 'noul' ? { type: 'noul', noul: 0.92 } : { type: 'score', score: i === 0 ? 2 : 0,
      confidence: 1, probabilities: i === 0 ? { 0: 0, 1: 0, 2: 1 } : { 0: 1, 1: 0, 2: 0 } }]));
  return new Response(JSON.stringify({ model: MODEL, answers, usage: { input_tokens: 120, output_tokens: 20 }, ...overrides }));
}
test('official latest alias records resolved concrete version and rejects alias or mismatched pinned responses',async()=>{
  let requested;
  const engine=createEngine({model:'jev-latest',apiKey:'fake-key',fetcher:async(_,{body})=>{requested=JSON.parse(body).model;return answer(body,{model:'jev-1.14.0'});}});
  const result=await engine.call('evaluate_conditions',batch);
  assert.equal(requested,'jev-latest');assert.equal(result.model,'jev-1.14.0');assert.equal(result.requested_model,'jev-latest');
  const bad=createEngine({model:'jev-preview',apiKey:'fake-key',fetcher:async(_,{body})=>answer(body,{model:'jev-preview'})});
  assert.equal((await bad.call('evaluate_conditions',batch)).error,'invalid_response');
  const pinned=createEngine({model:MODEL,apiKey:'fake-key',fetcher:async(_,{body})=>answer(body,{model:'jev-1.14.0'})});
  assert.equal((await pinned.call('evaluate_conditions',batch)).error,'invalid_response');
});
test('ranking returns existing IDs only and retains candidates outside priority', async () => {
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async (_, { body }) => answer(body) });
  const result = await engine.call('rank_evidence', { ...args, max_results: 1 });
  assert.equal(result.ok, true); assert.deepEqual(result.priority.map(row => row.id), ['parser']);
  assert.deepEqual(result.remaining_ids, ['style']); assert.equal(result.evidence_deleted, false);
});
test('identical calls use a local cache without another charged request', async () => {
  let calls = 0;
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async (_, { body }) => { calls++; return answer(body); } });
  await engine.call('evaluate_conditions', batch);
  const result = await engine.call('evaluate_conditions', batch);
  assert.equal(calls, 1); assert.equal(result.cached, true); assert.equal(result.usage.input_tokens, 0);
});
test('content changes and TTL expiry invalidate the cache', async () => {
  let calls = 0, now = 0;
  const engine = createEngine({ apiKey: 'fake-key', clock: () => now,
    fetcher: async (_, { body }) => { calls++; return answer(body); } });
  await engine.call('evaluate_conditions', batch); now = 300001;
  await engine.call('evaluate_conditions', batch);
  await engine.call('evaluate_conditions', { ...batch, state: 'A dependência está presente.' });
  assert.equal(calls, 3);
});
test('partial answers do not create false negative decisions', async () => {
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async (_, { body }) => answer(body, { answers: {} }) });
  const result = await engine.call('rank_evidence', args);
  assert.equal(result.ok, false); assert.equal(result.error, 'invalid_answer');
  assert.deepEqual(result.fallback_ids, ['parser', 'style']);
});
test('malformed score distributions preserve all IDs', async () => {
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async (_, { body }) => answer(body, { answers: {
    q0: { type: 'score', score: 2, confidence: 1, probabilities: { 0: 1, 1: 1, 2: 1 } },
  } }) });
  assert.equal((await engine.call('rank_evidence', args)).error, 'invalid_answer');
});
test('missing credential requires no network and returns explicit fallback', async () => {
  const engine = createEngine({ fetcher: async () => { assert.fail('unexpected network'); } });
  assert.equal((await engine.call('rank_evidence', args)).error, 'missing_TYPESAFE_API_KEY');
});
test('transport errors cannot echo secrets or server text', async () => {
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async () => { throw new Error('fake-key: arbitrary server text'); } });
  const result = await engine.call('evaluate_conditions', batch);
  assert.equal(result.error, 'jev_unavailable_or_cancelled'); assert.ok(!JSON.stringify(result).includes('fake-key'));
});
test('HTTP errors remain explicit and are not retried', async () => {
  let calls = 0;
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async () => { calls++; return new Response('server text', { status: 500 }); } });
  assert.equal((await engine.call('rank_evidence', args)).error, 'jev_http_500'); assert.equal(calls, 1);
});
test('duplicate IDs, unknown arguments and oversized input are rejected', async () => {
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async () => { assert.fail('unexpected network'); } });
  await assert.rejects(engine.call('rank_evidence', { ...args, candidates: [args.candidates[0], args.candidates[0]] }), /invalid_tool_arguments/);
  await assert.rejects(engine.call('rank_evidence', { ...args, permission: 'allow' }), /unknown_argument/);
  const large = { ...args, candidates: Array.from({ length: 16 }, (_, i) => ({ id: String(i), text: '漢'.repeat(4000) })) };
  assert.equal((await engine.call('rank_evidence', large)).error, 'request_too_large_reduce_candidates');
});
test('credentials are redacted from evaluation content', async () => {
  const engine = createEngine({ apiKey: 'fake-sensitive-key', fetcher: async (_, { body }) => {
    assert.ok(!body.includes('fake-sensitive-key')); assert.ok(!body.includes('hunter42')); return answer(body);
  } });
  assert.equal((await engine.call('evaluate_conditions', { ...batch, state: 'api_key=fake-sensitive-key password=hunter42' })).ok, true);
});
test('cancellation returns fallback rather than a fabricated judgment', async () => {
  const controller = new AbortController(); controller.abort();
  const engine = createEngine({ apiKey: 'fake-key', fetcher: async (_, { signal }) => {
    signal.throwIfAborted(); assert.fail('unexpected active request');
  } });
  assert.equal((await engine.call('rank_evidence', args, controller.signal)).error, 'jev_unavailable_or_cancelled');
});
test('parallel calls are bounded', async () => {
  let release;
  const pending = new Promise(done => { release = done; });
  const engine = createEngine({ apiKey: 'fake-key', maxParallel: 2, maxQueue: 0, fetcher: async (_, { body }) => { await pending; return answer(body); } });
  const first = engine.call('evaluate_conditions', batch), second = engine.call('rank_evidence', args);
  assert.equal((await engine.call('evaluate_conditions', { ...batch, state: 'outro estado' })).error, 'busy_retry_later');
  release(); await Promise.all([first, second]);
});


test('mission priority is an independent ordinal Score with explicit mission facts, not a competing Choice',async()=>{
 let payload;
 const engine=createEngine({apiKey:'fake-key',fetcher:async(_,{body})=>{payload=JSON.parse(body);return answer(body);}});
 const result=await engine.call('rank_missions',{goal:'Unblock real delivery',candidates:[{id:'dispatch',text:JSON.stringify({title:'Durable dispatch',goal:'Fix implementation not launching'})},{id:'metrics',text:JSON.stringify({title:'Cost metrics',goal:'Display measured savings'})}]});
 assert.equal(result.ok,true);assert.equal(result.priority[0].id,'dispatch');
 assert.equal(Object.keys(payload.questions).length,2);assert.ok(Object.values(payload.questions).every(q=>q.type==='score'));
 assert.match(payload.questions.q0.instructions,/independently/);assert.match(payload.questions.q0.criteria[2],/blocker/);
});
