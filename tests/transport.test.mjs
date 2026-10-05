import test from 'node:test';
import assert from 'node:assert/strict';
import { readUtf8Body, TransportError, createNdjsonReader } from '../src/transport.mjs';

test('HTTP preserves original Unicode at every byte boundary and one-byte chunks', async () => {
  const original = JSON.stringify({ 'ação': 'é € 🐍 e\u0301', emoji: '🌈' });
  const bytes = Buffer.from(original);
  for (let cut = 0; cut <= bytes.length; cut++) {
    assert.equal(await readUtf8Body([bytes.subarray(0, cut), bytes.subarray(cut)]), original);
  }
  assert.equal(await readUtf8Body(Array.from(bytes, byte => Buffer.from([byte]))), original);
});

test('HTTP counts original bytes at 39999, 40000, and 40001 including multibyte text', async () => {
  for (const length of [39999, 40000]) {
    const bytes = Buffer.from(JSON.stringify('🐍' + 'x'.repeat(length - 6)));
    assert.equal(bytes.length, length);
    assert.deepEqual(JSON.parse(await readUtf8Body([bytes])), '🐍' + 'x'.repeat(length - 6));
  }
  let read = 0;
  async function* stream() {
    read++; yield Buffer.alloc(40000, 0x78);
    read++; yield Buffer.from([0xff]);
    read++; yield Buffer.from('must not read');
  }
  await assert.rejects(readUtf8Body(stream()), error => error instanceof TransportError && error.code === 'body_too_large' && error.status === 413);
  assert.equal(read, 2);
});

test('HTTP rejects malformed UTF-8 without including private bytes in errors', async () => {
  for (const bytes of [[0xe2], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff]]) {
    await assert.rejects(readUtf8Body([Buffer.from(bytes)]), error => error.code === 'invalid_utf8' && error.status === 400 && !error.message.includes('secret'));
  }
  assert.equal(await readUtf8Body([]), '');
  const malformedJson = await readUtf8Body([Buffer.from('{"secret":')]);
  assert.throws(() => JSON.parse(malformedJson), SyntaxError);
});

test('NDJSON emits exact events across every split, fragmented CRLF and EOF', () => {
  const first = { type: 'item.completed', text: 'ação € 🐍' };
  const last = { type: 'future.event', text: '🌈' };
  const input = Buffer.from(JSON.stringify(first) + '\r\n' + JSON.stringify(last));
  for (let cut = 0; cut <= input.length; cut++) {
    const actual = [];
    const reader = createNdjsonReader({ onEvent: event => actual.push(event) });
    reader.write(input.subarray(0, cut));
    reader.write(input.subarray(cut));
    reader.end();
    assert.deepEqual(actual, [first, last]);
  }
  const actual = [];
  const reader = createNdjsonReader({ onEvent: event => actual.push(event) });
  for (const byte of input) reader.write(Buffer.from([byte]));
  reader.end();
  assert.deepEqual(actual, [first, last]);
});

test('NDJSON applies byte boundary before JSON parsing and counts CR', () => {
  const event = { type: 'future.event', text: '🐍' };
  const base = Buffer.from(JSON.stringify(event));
  const limit = base.length + 1;
  for (const padding of [0, 1]) {
    const actual = [];
    const reader = createNdjsonReader({ maxEventBytes: limit, onEvent: event => actual.push(event) });
    reader.write(Buffer.concat([base, Buffer.alloc(padding, 32), Buffer.from('\n')]));
    reader.end();
    assert.deepEqual(actual, [event]);
  }
  for (const suffix of ['  \n', ' \r\n', '  ']) {
    const reader = createNdjsonReader({ maxEventBytes: limit, onEvent: () => assert.fail('oversized frame accepted') });
    assert.throws(() => reader.write(Buffer.concat([base, Buffer.from(suffix)])), error => error.code === 'event_too_large' && error.offset === limit + 1 && error.line === 1);
  }
  const actual = [];
  const reader = createNdjsonReader({ maxEventBytes: limit, onEvent: event => actual.push(event) });
  reader.write(Buffer.concat([base, Buffer.from('\r')]));
  reader.write(Buffer.from('\n'));
  assert.deepEqual(actual, [event]);
});

test('NDJSON fails explicitly on incomplete, invalid UTF-8, JSON and event envelopes', () => {
  for (const [input, expected] of [
    [Buffer.from([0xe2, 0x82]), 'invalid_utf8'],
    [Buffer.from([0xc0, 0xaf, 10]), 'invalid_utf8'],
    [Buffer.from('{"type":"done"'), 'invalid_json'],
    [Buffer.from('\n'), 'invalid_json'],
    [Buffer.from('{}\n'), 'invalid_event'],
    [Buffer.from('[]\n'), 'invalid_event'],
    [Buffer.from('null\n'), 'invalid_event'],
    [Buffer.from('{"type":" "}\n'), 'invalid_event'],
  ]) {
    const reader = createNdjsonReader({ onEvent: () => assert.fail('invalid frame delivered') });
    assert.throws(() => { reader.write(input); reader.end(); }, error => error instanceof TransportError && error.code === expected && error.line === 1);
  }
});

test('NDJSON latches the first failure, ignores subsequent valid contracts and preserves callback errors', () => {
  const actual = [];
  const reader = createNdjsonReader({ maxEventBytes: 30, onEvent: event => actual.push(event) });
  let first;
  try { reader.write(Buffer.from('{"type":"ok"}\n' + 'x'.repeat(31) + '\n{"type":"done"}\n')); }
  catch (error) { first = error; }
  assert.equal(first.code, 'event_too_large');
  assert.equal(first.line, 2);
  assert.deepEqual(actual, [{ type: 'ok' }]);
  assert.throws(() => reader.write(Buffer.from('{"type":"done"}\n')), error => error === first);
  assert.throws(() => reader.end(), error => error === first);
  const storageError = new Error('fixture storage unavailable');
  const failingConsumer = createNdjsonReader({ onEvent: () => { throw storageError; } });
  assert.throws(() => failingConsumer.write(Buffer.from('{"type":"ok"}\n')), error => error === storageError);
});

test('NDJSON EOF is idempotent, empty streams succeed and whole streams are not size limited', () => {
  const actual = [];
  const reader = createNdjsonReader({ maxEventBytes: 13, onEvent: event => actual.push(event) });
  reader.write(Buffer.from('{"type":"ok"}\n'.repeat(100)));
  reader.end(); reader.end();
  assert.equal(actual.length, 100);
  assert.throws(() => reader.write(Buffer.alloc(0)), error => error.code === 'reader_closed');
  createNdjsonReader({ onEvent: () => assert.fail('empty stream emitted event') }).end();
});

test('transport validates limits/chunk types and propagates interrupted HTTP streams', async () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, '40000', 16777217]) {
    await assert.rejects(readUtf8Body([], { maxBytes: limit }), RangeError);
    assert.throws(() => createNdjsonReader({ maxEventBytes: limit, onEvent() {} }), RangeError);
  }
  assert.throws(() => createNdjsonReader(), TypeError);
  await assert.rejects(readUtf8Body(['already decoded']), TypeError);
  const interrupted = new Error('stream interrupted');
  async function* stream() { yield Buffer.from('{'); throw interrupted; }
  await assert.rejects(readUtf8Body(stream()), error => error === interrupted);
  assert.equal(await readUtf8Body([Buffer.from([0xef, 0xbb, 0xbf])]), '\ufeff');
});
