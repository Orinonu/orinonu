import test from "node:test";
import assert from "node:assert/strict";
import { describeRuntime } from "../src/main.ts";

test("the SDK entrypoint discloses its pinned framework without claiming host or account integration", () => {
  const status = describeRuntime();
  assert.equal(status.framework, "openai_agents_sdk");
  assert.equal(status.sdk_version, "0.18.0");
  assert.equal(status.protocol_version, 1);
  assert.equal(status.dispatch, "not_connected");
  assert.equal(status.authentication, "not_verified");
  assert.equal(status.activation, "opt_in_required");
  assert.equal(status.tracing, "disabled");
  assert.doesNotMatch(JSON.stringify(status), /api_key|access_token|refresh_token|authorization/i);
});
