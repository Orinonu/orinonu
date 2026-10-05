/** Errors contain protocol metadata only, never the private body/event contents. */
export class TransportError extends Error {
  constructor(code, message, { status = 400, ...metadata } = {}) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.status = status;
    Object.assign(this, metadata);
  }
}

function byteLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16 * 1024 * 1024) {
    throw new RangeError('Byte limit must be an integer from 1 to 16777216');
  }
  return value;
}

function bytes(chunk) {
  if (!(chunk instanceof Uint8Array)) throw new TypeError('Transport requires byte chunks');
  return chunk;
}

function decode(parts, length, metadata = {}) {
  try {
    // Preserve BOM instead of silently rewriting input. JSON parsing belongs to the caller.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(parts, length));
  } catch {
    throw new TransportError('invalid_utf8', 'Invalid UTF-8 byte sequence', metadata);
  }
}

/**
 * HTTP: count received bytes before copying/decoding. On overflow stop consuming;
 * caller must send HTTP 413 and decide whether to drain/destroy the request.
 * Stream failures propagate. Empty body returns ''. JSON syntax is caller-owned.
 */
export async function readUtf8Body(chunks, { maxBytes = 40000 } = {}) {
  byteLimit(maxBytes);
  const parts = [];
  let length = 0;
  for await (const chunk of chunks) {
    const chunkBytes = bytes(chunk);
    length += chunkBytes.byteLength;
    if (length > maxBytes) throw new TransportError('body_too_large', 'Request exceeds byte limit', { status: 413, limit: maxBytes, bytes: length });
    if (chunkBytes.byteLength) parts.push(Buffer.from(chunkBytes));
  }
  return decode(parts, length);
}

/**
 * Bounded NDJSON event transport. maxEventBytes counts bytes before LF, including
 * CR in CRLF. Unknown event types are accepted; blank/non-object/untyped events
 * are invalid. EOF flushes a final complete event without LF. The first failure
 * latches: later writes/end throw that same error without delivering more events.
 * Callback/storage errors propagate unchanged (not mislabeled protocol errors).
 * Caller owns process termination, draining, reservation and report invalidation.
 * The default 1 MiB is configurable up to 16 MiB; validate against real workloads.
 */
export function createNdjsonReader({ maxEventBytes = 1024 * 1024, onEvent } = {}) {
  byteLimit(maxEventBytes);
  if (typeof onEvent !== 'function') throw new TypeError('onEvent callback is required');
  let parts = [], length = 0, offset = 0, line = 1, ended = false, failure = null;

  function frame() {
    const metadata = { line, offset, limit: maxEventBytes };
    const text = decode(parts, length, metadata);
    let event;
    try { event = JSON.parse(text); }
    catch { throw new TransportError('invalid_json', 'Invalid NDJSON event JSON', metadata); }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || !event.type.trim()) {
      throw new TransportError('invalid_event', 'NDJSON event requires an object with a type', metadata);
    }
    parts = []; length = 0; line++;
    onEvent(event);
  }

  function append(chunk) {
    if (length + chunk.byteLength > maxEventBytes) {
      throw new TransportError('event_too_large', 'NDJSON event exceeds byte limit', { line, offset: offset + maxEventBytes - length + 1, limit: maxEventBytes });
    }
    if (chunk.byteLength) parts.push(Buffer.from(chunk));
    length += chunk.byteLength;
    offset += chunk.byteLength;
  }

  function run(operation) {
    if (failure) throw failure;
    try { return operation(); }
    catch (error) { failure = error; parts = []; length = 0; throw error; }
  }

  return {
    write(chunk) {
      return run(() => {
        if (ended) throw new TransportError('reader_closed', 'NDJSON reader is closed');
        const input = bytes(chunk);
        let start = 0;
        for (let cursor = 0; cursor < input.byteLength; cursor++) {
          if (input[cursor] !== 10) continue;
          append(input.subarray(start, cursor));
          frame(); offset++; start = cursor + 1;
        }
        append(input.subarray(start));
      });
    },
    end() {
      return run(() => {
        if (ended) return;
        ended = true;
        if (length) frame();
      });
    },
  };
}
