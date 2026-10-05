import test from "node:test";
import assert from "node:assert/strict";
import { Agent, MaxTurnsExceededError, RunState, tool } from "@openai/agents";
import { z } from "zod";
import { ScriptedModel, assistantMessage, functionCall, modelResponse, modelResponder } from "@openai/agents/testing";
import { createAdmittedDelegation, createBoundAgent, createBoundRunner } from "../src/runtime.ts";

test("each SDK agent uses its explicitly bound model without a global override or external request", async () => {
  const frontendModel = new ScriptedModel([modelResponse([assistantMessage("frontend evidence")])]);
  const backendModel = new ScriptedModel([modelResponse([assistantMessage("backend evidence")])]);
  const frontend = createBoundAgent({ id: "frontend-lead", instructions: "Coordinate frontend only.", model: frontendModel });
  const backend = createBoundAgent({ id: "backend-lead", instructions: "Coordinate backend only.", model: backendModel });
  const runner = createBoundRunner();
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("External requests are forbidden in the offline proof"); };
  try {
    assert.ok(frontend instanceof Agent);
    assert.ok(backend instanceof Agent);
    assert.equal((await runner.run(frontend, "Plan frontend work", { maxTurns: 2 })).finalOutput, "frontend evidence");
    assert.equal((await runner.run(backend, "Plan backend work", { maxTurns: 2 })).finalOutput, "backend evidence");
    assert.equal(frontendModel.calls.length, 1);
    assert.equal(backendModel.calls.length, 1);
    assert.equal(frontendModel.firstCall?.request.systemInstructions, "Coordinate frontend only.");
    assert.equal(backendModel.firstCall?.request.systemInstructions, "Coordinate backend only.");
    assert.equal(networkCalls, 0);
    frontendModel.assertComplete();
    backendModel.assertComplete();
  } finally { globalThis.fetch = originalFetch; }
});

test("a bound SDK tool executes validated arguments and returns evidence to its own model", async () => {
  const invocations: string[] = [];
  const inspectContract = tool({
    name: "inspect_contract",
    description: "Read the assigned synthetic frontend contract.",
    parameters: z.object({ area: z.literal("frontend") }),
    execute: async ({ area }) => { invocations.push(area); return "frontend-contract-v1"; },
  });
  const model = new ScriptedModel([
    modelResponse([functionCall("inspect_contract", { area: "frontend" }, { callId: "contract-call" })]),
    modelResponder(call => {
      assert.match(JSON.stringify(call.request.input), /frontend-contract-v1/);
      return [assistantMessage("Contract inspected")];
    }),
  ]);
  const agent = createBoundAgent({ id: "nextjs", instructions: "Inspect only the assigned contract.", model, tools: [inspectContract] });
  assert.equal((await createBoundRunner().run(agent, "Inspect the contract", { maxTurns: 3 })).finalOutput, "Contract inspected");
  assert.deepEqual(invocations, ["frontend"]);
  assert.equal(model.calls.length, 2);
  model.assertComplete();
});

test("structured SDK output preserves a partial result rather than inventing completion", async () => {
  const schema = z.object({ status: z.enum(["partial", "completed"]), evidence: z.array(z.string()) });
  const model = new ScriptedModel([modelResponse([assistantMessage('{"status":"partial","evidence":[]}')])]);
  const agent = createBoundAgent({ id: "qa-engineer", instructions: "Return only observed evidence.", model, outputType: schema });
  const result = await createBoundRunner().run(agent, "Review the incomplete work", { maxTurns: 2 });
  assert.deepEqual(result.finalOutput, { status: "partial", evidence: [] });
  model.assertComplete();
});

test("SDK streaming reaches a terminal response and exposes the same final output", async () => {
  const model = new ScriptedModel([modelResponse([assistantMessage("Observed stream evidence")])]);
  const agent = createBoundAgent({ id: "research-analyst", instructions: "Report observations.", model });
  const result = await createBoundRunner().run(agent, "Investigate", { stream: true, maxTurns: 2 });
  let text = "";
  for await (const event of result) {
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") text += event.data.delta;
  }
  await result.completed;
  assert.equal(text, "Observed stream evidence");
  assert.equal(result.finalOutput, "Observed stream evidence");
  assert.equal(model.firstCall?.streamed, true);
  model.assertComplete();
});

test("a paused approval can be serialized and resumed without executing the tool before approval", async () => {
  let effects = 0;
  const approvedTool = tool({
    name: "record_synthetic_evidence",
    description: "Record one synthetic verification after approval.",
    parameters: z.object({ criterion: z.literal("c1") }),
    needsApproval: true,
    execute: async () => { effects++; return "verified-c1"; },
  });
  const model = new ScriptedModel([
    modelResponse([functionCall("record_synthetic_evidence", { criterion: "c1" }, { callId: "approval-call" })]),
    modelResponse([assistantMessage("Verification recorded")]),
  ]);
  const agent = createBoundAgent({ id: "qa-engineer", instructions: "Respect explicit approval.", model, tools: [approvedTool] });
  const runner = createBoundRunner();
  const paused = await runner.run(agent, "Record verification", { maxTurns: 3 });
  assert.equal(effects, 0);
  assert.equal(paused.interruptions.length, 1);
  assert.equal(paused.rawResponses.length, 1);
  const restored = await RunState.fromString(agent, paused.state.toString());
  restored.approve(restored.getInterruptions()[0]);
  const completed = await runner.run(agent, restored);
  assert.equal(completed.finalOutput, "Verification recorded");
  assert.equal(effects, 1);
  assert.equal(model.calls.length, 2);
  model.assertComplete();
});

test("delegation denied by the host never starts the child SDK model", async () => {
  const childModel = new ScriptedModel([modelResponse([assistantMessage("This child must not run")])]);
  const child = createBoundAgent({ id: "frontend-lead", instructions: "Coordinate frontend.", model: childModel });
  const admissions: string[] = [];
  const delegate = createAdmittedDelegation({
    parentId: "orchestrator",
    child,
    admit: async order => { admissions.push(order.childId); throw new Error("delegation_denied"); },
  });
  const parentModel = new ScriptedModel([modelResponse([functionCall("delegate_frontend_lead", { input: "Plan frontend" }, { callId: "denied-delegation" })])]);
  const parent = createBoundAgent({ id: "orchestrator", instructions: "Delegate only admitted work.", model: parentModel, tools: [delegate] });
  await assert.rejects(createBoundRunner().run(parent, "Delegate", { maxTurns: 2 }), /delegation_denied/);
  assert.deepEqual(admissions, ["frontend-lead"]);
  assert.equal(childModel.calls.length, 0);
  assert.equal(parentModel.calls.length, 1);
});

test("an admitted child returns to the parent for synthesis rather than taking conversation ownership", async () => {
  const childModel = new ScriptedModel([modelResponse([assistantMessage("frontend-result-v1")])]);
  const child = createBoundAgent({ id: "frontend-lead", instructions: "Coordinate frontend.", model: childModel });
  const orders: { parentId: string; childId: string; input: string }[] = [];
  const delegate = createAdmittedDelegation({ parentId: "orchestrator", child, admit: async order => { orders.push(order); return true; } });
  const parentModel = new ScriptedModel([
    modelResponse([functionCall("delegate_frontend_lead", { input: "Bounded frontend order" }, { callId: "admitted-delegation" })]),
    modelResponder(call => {
      assert.match(JSON.stringify(call.request.input), /frontend-result-v1/);
      return [assistantMessage("Central synthesis")];
    }),
  ]);
  const parent = createBoundAgent({ id: "orchestrator", instructions: "Consolidate team results.", model: parentModel, tools: [delegate] });
  const result = await createBoundRunner().run(parent, "Delegate", { maxTurns: 3 });
  assert.equal(result.finalOutput, "Central synthesis");
  assert.equal(result.lastAgent, parent);
  assert.deepEqual(orders, [{ parentId: "orchestrator", childId: "frontend-lead", input: "Bounded frontend order" }]);
  assert.equal(childModel.calls.length, 1);
  assert.equal(parentModel.calls.length, 2);
  childModel.assertComplete();
  parentModel.assertComplete();
});

test("exhausting the SDK turn limit raises an interruption instead of completing the work", async () => {
  let calls = 0;
  const repeat = tool({ name: "repeat_work", description: "Observe one synthetic work step.", parameters: z.object({}), execute: async () => { calls++; return "still incomplete"; } });
  const model = new ScriptedModel([modelResponse([functionCall("repeat_work", {}, { callId: "limit-call" })])]);
  const agent = createBoundAgent({ id: "nextjs", instructions: "Finish only with verified evidence.", model, tools: [repeat] });
  await assert.rejects(createBoundRunner().run(agent, "Work", { maxTurns: 1 }), MaxTurnsExceededError);
  assert.equal(calls, 1);
  assert.equal(model.calls.length, 1);
});

test("a missing or string model binding is rejected before the SDK can select a default provider", () => {
  for (const model of [undefined, null, "unconfigured-model", {}]) {
    assert.throws(() => Reflect.apply(createBoundAgent, undefined, [{ id: "nextjs", instructions: "Plan work.", model }]), /explicit_model_binding_required/);
  }
});
