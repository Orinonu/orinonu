import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowOverview } from "../src/components/workflow-overview.tsx";
import { AutonomyModeSwitch } from "../src/components/autonomy-mode-switch.tsx";
import { flowFor, flowSummary, waitOwner, type FlowReport } from "../src/lib/mission";

test("the overview explains the Wayfinder workflow without claiming automatic approval", () => {
  const html = renderToStaticMarkup(createElement(WorkflowOverview));
  assert.match(html, /Fluxo de trabalho inteligente/);
  assert.deepEqual([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((match) => match[1]),
    ["Explorar", "Definir", "Construir", "Verificar"]);
  assert.match(html, /Wayfinder/);
  assert.match(html, /Grill with docs/);
  assert.match(html, /TDD/);
  assert.match(html, /Code review/);
  assert.match(html, /JEV recomenda/);
  assert.match(html, /código valida/);
  assert.match(html, /revisão independente/);
  assert.match(html, /conforme a missão/);
});

test("the workflow reflects an observed skill instead of inventing the default configuration", () => {
  const html = renderToStaticMarkup(createElement(WorkflowOverview, {
    profiles: { discovery: { skill: "project-explorer", model: "local", effort: "medium" } },
  }));
  assert.match(html, /project-explorer/);
  assert.doesNotMatch(html, /Wayfinder/);
  assert.match(html, /Grill with docs/);
});

const report = (extra: Partial<FlowReport> = {}): FlowReport => ({
  workspace: "C:/p",
  mode: "autonomous",
  convergence: "active",
  active: 7,
  gates: [],
  waiting: [],
  ...extra,
});

test("no flow report means nothing is claimed", () => {
  assert.equal(flowSummary(null), null);
  assert.equal(flowSummary(undefined), null);
});

test("an autonomous flow with no gates says nobody is awaited", () => {
  const summary = flowSummary(report());
  assert.equal(summary?.awaitingYou, 0);
  assert.equal(summary?.active, 7);
  assert.equal(summary?.external, 0);
  assert.equal(summary?.text, "0 aguardando você · 7 ativas");
});

test("human gates and external dependencies are counted separately", () => {
  const summary = flowSummary(
    report({
      gates: [{ reason: "human_cancelled" }],
      external: [{ reason: "authorization_required" }, { reason: "x" }],
    }),
  );
  assert.equal(summary?.awaitingYou, 1);
  assert.equal(summary?.external, 2);
  assert.equal(
    summary?.text,
    "1 aguardando você · 7 ativas · 2 dependências externas",
  );
});

test("singular wording for one external dependency", () => {
  assert.equal(
    flowSummary(report({ external: [{ reason: "authorization_required" }] }))
      ?.text,
    "0 aguardando você · 7 ativas · 1 dependência externa",
  );
});

test("waitOwner names the owner only from persisted recovery facts", () => {
  assert.equal(waitOwner({}), null);
  assert.equal(waitOwner({ decision_recovery: { reason: "x" } }), null);
  assert.deepEqual(waitOwner({ decision_recovery: { owner: "human" } }), {
    tone: "human",
    label: "Aguardando você",
  });
  assert.deepEqual(waitOwner({ decision_recovery: { owner: "environment" } }), {
    tone: "external",
    label: "Dependência externa",
  });
  assert.deepEqual(
    waitOwner({ decision_recovery: { owner: "host-scheduler" } }),
    { tone: "system", label: "Sistema reavalia" },
  );
});
test("flowFor matches the project regardless of slash style or case", () => {
  const rows = [
    report({ workspace: "C:\\Users\\example\\Other", active: 1 }),
    report({ workspace: "C:\\Users\\example\\Documents\\Codex\\jev-mission-control", active: 9 }),
  ];
  assert.equal(
    flowFor(rows, "c:/users/example/documents/codex/jev-mission-control/")?.active,
    9,
  );
  assert.equal(flowFor(rows, "C:/nowhere"), null);
  assert.equal(flowFor(rows, ""), null);
  assert.equal(flowFor(null, "C:/p"), null);
});

test("autonomy radios use toolbar navigation and one tab stop without requesting work during render", () => {
  const changes: string[] = [];
  for (const mode of ["supervised", "autonomous"] as const) {
    const html = renderToStaticMarkup(createElement(AutonomyModeSwitch, {
      mode, busy: false, onChange: next => changes.push(next),
    }));
    assert.match(html, /role="toolbar"/);
    assert.match(html, /role="radiogroup" aria-label="Modo do projeto"/);
    const buttons = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map(match => match[0]);
    assert.equal(buttons.length, 2);
    assert.equal(buttons.filter(button => button.includes('tabindex="0"')).length, 1);
    assert.match(buttons[mode === "supervised" ? 0 : 1], /aria-checked="true"[^>]*tabindex="0"/);
    assert.match(buttons[mode === "supervised" ? 1 : 0], /aria-checked="false"[^>]*tabindex="-1"/);
    assert.match(html, /setas.*Enter.*Espaço/s);
  }
  assert.deepEqual(changes, []);
});

test("autonomy keeps both radios unavailable while busy or without project authorization", () => {
  for (const props of [{ busy: true }, { busy: false, disabledReason: "Salve um objetivo." }]) {
    const html = renderToStaticMarkup(createElement(AutonomyModeSwitch, {
      mode: "supervised", onChange: () => assert.fail("render must not request a mode change"), ...props,
    }));
    assert.equal([...html.matchAll(/<button[^>]*disabled=""/g)].length, 2);
    if ("disabledReason" in props) assert.match(html, /Salve um objetivo\./);
  }
});