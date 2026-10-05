import test from "node:test";
import assert from "node:assert/strict";
import { admit, finishAdmission } from "../src/lib/api.ts";

test("an ambiguous transport failure retains its request ID; a definite rejection permits a fresh revision", async () => {
  const original = globalThis.fetch,
    bodies: Record<string, unknown>[] = [];
  const path = "/api/tasks/test/prepare",
    body = { auto_implement: true };
  try {
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return new Response("{truncated", { status: 200 });
    };
    await assert.rejects(admit(path, body, 3));
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({ error: "Servidor indisponível" }, { status: 502 });
    };
    await assert.rejects(admit(path, body, 4), /Servidor indisponível/);
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({ error: "revision conflict" }, { status: 409 });
    };
    await assert.rejects(admit(path, body, 4), /revision conflict/);
    assert.equal(bodies[0].request_id, bodies[1].request_id);
    assert.equal(bodies[1].request_id, bodies[2].request_id);
    assert.equal(bodies[2].expected_revision, 3);
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({ ok: true });
    };
    await admit(path, body, 5);
    assert.notEqual(bodies[2].request_id, bodies[3].request_id);
    assert.equal(bodies[3].expected_revision, 5);
  } finally {
    finishAdmission(path, body);
    globalThis.fetch = original;
  }
});
