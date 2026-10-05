import test from "node:test";
import assert from "node:assert/strict";
import { readSnapshot, readFlow, readDecisions } from "../src/lib/contracts.ts";
import { snapshotFixture } from "../e2e/fixtures.ts";

test("snapshot responses require a valid task collection and reject malformed optional collections", () => {
  const value = snapshotFixture();
  assert.equal(readSnapshot(value).tasks.length, 30);
  for (const invalid of [null, {}, { tasks: null }, { tasks: [{ id: "wrong" }] }, { ...value, project_directions: "wrong" }, { ...value, analytics: { tasks: "wrong" } }])
    assert.throws(() => readSnapshot(invalid), /incompatível/);
});

test("secondary resource responses cannot turn an incompatible payload into an empty decision inbox", () => {
  assert.deepEqual(readFlow([]), []);
  assert.deepEqual(readDecisions({ items: [] }), []);
  assert.throws(() => readDecisions({}), /incompatível/);
  assert.throws(() => readFlow({ rows: [] }), /incompatível/);
});

test("nested fields rendered by the shell are validated without synthesizing absent metrics", () => {
  assert.equal(readSnapshot({ tasks: [] }).analytics, undefined);
  const value = snapshotFixture();
  for (const invalid of [
    { ...value, tasks: [{ ...value.tasks[0], progress: { items: "wrong" } }] },
    { ...value, tasks: [{ ...value.tasks[0], autonomy_history: {} }] },
    { ...value, project_directions: [{ workspace: "a", repositories: "wrong" }] },
    { ...value, analytics: { tasks: [null] } },
  ]) assert.throws(() => readSnapshot(invalid), /incompatível/);
  assert.throws(() => readDecisions({ items: [{ id: "a", title: "a", options: [] }] }), /incompatível/);
  assert.throws(() => readFlow([{ workspace: "a", mode: "supervised", convergence: "active", active: 1, gates: [], waiting: [], health: { state: "progressing" } }]), /incompatível/);
});
