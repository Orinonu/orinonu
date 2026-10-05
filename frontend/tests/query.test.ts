import test from "node:test";
import assert from "node:assert/strict";
import { queryFailure, singleFlight } from "../src/lib/query.ts";
import { api, performReportedAction } from "../src/lib/api.ts";

test("overlapping refreshes share one valid slow result and allow a later retry", async () => {
  let calls = 0;
  let resolve: (value: string) => void = () => {};
  const refresh = singleFlight(() => { calls++; return new Promise<string>(done => { resolve = done; }); });
  const first = refresh(), second = refresh();
  assert.equal(calls, 1);
  resolve("valid result");
  assert.equal(await first, "valid result");
  assert.equal(await second, "valid result");
  const third = refresh();
  assert.equal(calls, 2);
  resolve("new result");
  assert.equal(await third, "new result");
});

test("failed queries release their flight and distinguish initial error from stale data", async () => {
  let calls = 0;
  const retry = singleFlight(async () => { if (++calls === 1) throw Error("offline"); return "recovered"; });
  await assert.rejects(retry(), /offline/);
  assert.equal(await retry(), "recovered");
  assert.deepEqual(queryFailure({ status: "loading" }, "unavailable"), { status: "error", error: "unavailable" });
  assert.deepEqual(queryFailure({ status: "ready", updatedAt: "2026-10-05" }, "unavailable"), { status: "stale", updatedAt: "2026-10-05", error: "unavailable" });
});

test("outcome-sensitive save callbacks report and propagate failure instead of resolving as success", async () => {
  const failure = Error("Synthetic model rejected");
  const errors: unknown[] = [], notices: string[] = [];
  const recordFailure = (error: unknown) => { errors.push(error); };
  let refreshes = 0;
  const refresh = async () => { refreshes++; };
  const viewSave = async () => {
    await performReportedAction(async () => { throw failure; }, refresh, recordFailure, true);
    notices.push("success");
  };
  await assert.rejects(viewSave(), error => error === failure);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(notices, []);
  assert.equal(refreshes, 0);
  await performReportedAction(async () => {}, refresh, recordFailure, true);
  assert.equal(refreshes, 1);
  assert.deepEqual(errors, [failure]);
});

test("fire-and-forget shell actions still report handled failures without unhandled rejection", async () => {
  const errors: unknown[] = [];
  let refreshes = 0;
  await performReportedAction(async () => { throw Error("Synthetic unavailable"); }, async () => { refreshes++; }, error => errors.push(error));
  assert.equal(errors.length, 1);
  assert.equal(refreshes, 0);
});

test("API requests time out or abort without exposing non-JSON response bodies", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_path, options) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("{}")), 1000);
      const signal = options?.signal;
      const cancel = () => { clearTimeout(timer); reject(signal?.reason); };
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    });
    await assert.rejects(api("/synthetic", "GET", undefined, { timeoutMs: 20 }), error => error instanceof Error && error.name === "TimeoutError");
    const controller = new AbortController();
    const pending = api("/synthetic", "GET", undefined, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error instanceof Error && error.name === "AbortError");
    globalThis.fetch = async () => new Response("<html>PRIVATE_BODY_SHOULD_NOT_APPEAR</html>");
    await assert.rejects(api("/synthetic"), error => error instanceof Error && error.message.includes("incompatível") && !error.message.includes("PRIVATE_BODY"));
  } finally {
    globalThis.fetch = original;
  }
});
