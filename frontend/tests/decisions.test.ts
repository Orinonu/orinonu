import test from "node:test";
import assert from "node:assert/strict";
import {
  ageLabel,
  capacityRows,
  decisionsFor,
  quietLabel,
  recommendationLabel,
  recommendedOption,
  type DecisionItem,
  type FlowHealth,
} from "../src/lib/mission.ts";

const item = (
  recommendation: DecisionItem["recommendation"],
  extra: Partial<DecisionItem> = {},
): DecisionItem => ({
  id: "a1",
  kind: "plan_pending",
  label: "Pendências do plano",
  workspace: "C:\\Projetos\\Nexo",
  task_id: "t1",
  opportunity_id: null,
  title: "Missão",
  question: "Qual faixa de preço?",
  questions: ["Qual faixa de preço?"],
  reason: "human_scope_required",
  resume_condition: null,
  options: [
    { id: "proceed_by_charter", label: "Seguir a carta", effect: "Libera a implementação.", reversible: true },
    { id: "answer", label: "Responder", effect: "Registra sua resposta.", reversible: true, requires_note: true },
  ],
  recommendation,
  since: "2026-10-05T00:00:00Z",
  owner: "human",
  ...extra,
});

test("a lean below the autonomy threshold is worded as a lean, never as a recommendation", () => {
  const ready = recommendationLabel(item({ state: "ready", option_id: "proceed_by_charter", confidence: 0.91 }));
  assert.equal(ready.tone, "ready");
  assert.match(ready.text, /recomenda: Seguir a carta · 91%/);
  const lean = recommendationLabel(item({ state: "leaning", option_id: "proceed_by_charter", confidence: 0.75 }));
  assert.equal(lean.tone, "leaning");
  assert.match(lean.text, /inclina para: Seguir a carta · 75% \(abaixo do limiar de autonomia\)/);
  assert.doesNotMatch(lean.text, /recomenda/);
});

test("abstention, failure and absence each say so honestly", () => {
  assert.match(recommendationLabel(item({ state: "abstained" })).text, /se absteve/);
  assert.match(recommendationLabel(item({ state: "failed" })).text, /indisponível/);
  assert.equal(recommendationLabel(item({ state: "none" })).tone, "pending");
  assert.equal(recommendedOption(item({ state: "abstained", option_id: "answer" })), null);
  assert.equal(recommendedOption(item({ state: "leaning", option_id: "ghost" })), null);
  assert.equal(recommendedOption(item({ state: "ready", option_id: "answer" }))?.id, "answer");
});

test("the inbox is scoped to the selected project regardless of path spelling", () => {
  const rows = [
    item({ state: "none" }),
    item({ state: "none" }, { id: "b2", workspace: "C:/outro/projeto" }),
    item({ state: "none" }, { id: "c3", workspace: null }),
  ];
  assert.deepEqual(decisionsFor(rows, "c:/projetos/nexo/").map((row) => row.id), ["a1", "c3"]);
  assert.equal(decisionsFor(rows, "").length, 3);
  assert.deepEqual(decisionsFor(null, "x"), []);
});

test("capacity shows phantom reservations apart from live executions", () => {
  const health = {
    state: "stalled",
    stalled: [],
    wip: null,
    breaker: null,
    capacity: {
      planning: { limit: 7, live: 3, phantom: 4, queued: 36 },
      review: { limit: 7, live: 0, phantom: 0, queued: 0 },
    },
  } as FlowHealth;
  const rows = capacityRows(health);
  assert.deepEqual(
    rows.map((row) => [row.label, row.used, row.full]),
    [
      ["Planejamento", 7, true],
      ["Revisão", 0, false],
    ],
  );
  assert.deepEqual(capacityRows(null), []);
});

test("ages and quiet times read in minutes and hours", () => {
  const now = Date.parse("2026-10-05T03:00:00Z");
  assert.equal(ageLabel("2026-10-05T02:59:40Z", now), "agora");
  assert.equal(ageLabel("2026-10-05T02:30:00Z", now), "há 30 min");
  assert.equal(ageLabel("2026-10-05T00:00:00Z", now), "há 3 h");
  assert.equal(ageLabel(null, now), "sem data");
  assert.equal(quietLabel(45 * 60000), "45 min");
  assert.equal(quietLabel(95 * 60000), "1 h 35 min");
});
