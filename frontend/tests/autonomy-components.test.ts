import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutonomyHealthPanel } from "../src/components/autonomy-health.tsx";
import { DecisionInbox, DecisionInboxCard } from "../src/components/decision-inbox.tsx";
import type { DecisionItem, FlowReport } from "../src/lib/mission.ts";

const decision = (extra: Partial<DecisionItem> = {}): DecisionItem => ({
  id: "abc123abc123abc1",
  kind: "plan_pending",
  label: "Pendências do plano",
  workspace: "C:\\Nexo",
  task_id: "t1",
  opportunity_id: null,
  title: "Definir faixas de preço",
  question: "Escolher a faixa de preço inicial.",
  questions: ["Escolher a faixa de preço inicial."],
  reason: "human_scope_required",
  resume_condition: null,
  options: [
    { id: "proceed_by_charter", label: "Seguir a carta", effect: "Libera a implementação.", reversible: true },
    { id: "answer", label: "Responder", effect: "Registra sua resposta.", reversible: true, requires_note: true },
    { id: "archive", label: "Arquivar", effect: "Retira a missão.", reversible: false },
  ],
  recommendation: { state: "leaning", option_id: "proceed_by_charter", confidence: 0.75 },
  since: "2026-10-05T00:00:00Z",
  owner: "human",
  ...extra,
});
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

test("the inbox shows the question, every option, the lean and a way to answer", () => {
  const out = html(createElement(DecisionInbox, { items: [decision()], busy: null, onAnswer: () => {} }));
  assert.match(out, /Definir faixas de preço/);
  assert.match(out, /Escolher a faixa de preço inicial\./);
  assert.match(out, /inclina para: Seguir a carta · 75% \(abaixo do limiar de autonomia\)/);
  assert.match(out, /sugestão do Jev/);
  assert.match(out, /Não pode ser desfeito\./);
  assert.match(out, /Aceitar sugestão do Jev/);
  assert.equal((out.match(/type="radio"/g) ?? []).length, 3);
  assert.match(out, /<legend class="sr-only">Opções para Definir faixas de preço<\/legend>/);
});

test("without a usable lean there is no shortcut: the person must choose", () => {
  const out = html(createElement(DecisionInbox, { items: [decision({ recommendation: { state: "abstained" } })], busy: null, onAnswer: () => {} }));
  assert.match(out, /Jev se absteve/);
  assert.doesNotMatch(out, /Aceitar sugestão do Jev/);
  assert.match(out, /disabled=""[^>]*>[\s\S]*Responder/);
});

test("an empty inbox says nothing waits for the person; the card says the same", () => {
  assert.match(html(createElement(DecisionInbox, { items: [], busy: null, onAnswer: () => {} })), /Nada espera por você/);
  const card = html(createElement(DecisionInboxCard, { items: [], onOpen: () => {} }));
  assert.match(card, /Nada espera por você/);
  assert.doesNotMatch(card, /Responder agora/);
  const full = html(createElement(DecisionInboxCard, { items: [decision(), decision({ id: "b" }), decision({ id: "c" }), decision({ id: "d" })], onOpen: () => {} }));
  assert.equal((full.match(/<li>/g) ?? []).length, 3);
  assert.match(full, /Responder agora/);
});

test("health shows stalled work, reserved slots and an open breaker instead of a calm queue length", () => {
  const flow = {
    workspace: "C:\\Nexo",
    mode: "autonomous",
    convergence: "stuck",
    active: 0,
    gates: [],
    waiting: [],
    health: {
      state: "stalled",
      counts: { running: 0, queued_admissible: 1 },
      stalled: [{ task_id: "t9", reason: "executor_silent", since: null, quiet_ms: 5400000 }],
      capacity: { planning: { limit: 7, live: 3, phantom: 4, queued: 36 } },
      noop_suppressed: 2,
      wip: { count: 6, max: 6, full: true },
      breaker: { state: "open", reason: "no_verified_advance", opened_at: null },
    },
  } as FlowReport;
  const out = html(createElement(AutonomyHealthPanel, { flow, awaitingYou: 2, titles: { t9: "Missão calada" }, onOpenDecisions: () => {} }));
  assert.match(out, /Parado/);
  assert.match(out, /Missão calada/);
  assert.match(out, /Executor sem atividade · sem mudança há 1 h 30 min/);
  assert.match(out, /4 presa\(s\)/);
  assert.match(out, /36 na fila/);
  assert.match(out, /Disjuntor aberto/);
  assert.match(out, /6\/6/);
  assert.match(out, /Abrir caixa de decisões/);
  assert.match(out, /2 candidato\(s\) sem fase lançável/);
  assert.equal(html(createElement(AutonomyHealthPanel, { flow: null, awaitingYou: 0, titles: {}, onOpenDecisions: () => {} })), "");
});
