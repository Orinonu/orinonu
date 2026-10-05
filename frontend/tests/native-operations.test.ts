import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentsView, CurationView, DecisionHistory, QueueControls, profileOptions, catalogFromSettings } from "../src/components/native-operations.tsx";
import type { Snapshot, Specialist } from "../src/lib/mission.ts";
import { filterSpecialists, specialistLineage, SpecialistPortrait, SpecialistRuntime } from "../src/components/specialist-catalog.tsx";
import { specialists, specialistPolicy } from "../../src/specialists.mjs";

const snapshot: Snapshot = {
  tasks: [],
  profiles: { implementation: { model: "gpt-6.1-sol", effort: "high", skill: "tdd" } },
  specialists: [{ id: "reviewer", name: "Revisor", scope: "Revisão independente", skills: ["code-review"] }],
  context: { consultations: 4, trust: "Confiança depende do runtime." },
  curator: { window_days: 7, consultations: 3, observed_tools: [{ id: "read", uses: 8 }], disabled_duplicates: [], policy: "Sem observação não significa sem uso.", limitations: ["Cobertura parcial."] },
  events: [{ kind: "jev_decision", provider: "typesafe", workspace: "C:/Projeto", time: "2026-10-05T00:00:00Z", decision: { action: "abstain" } }],
};
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

test("native agents keep editable phase models, accessible labels and specialist contracts", () => {
  const out = html(createElement(AgentsView, { snapshot, disabled: false, onSave: async () => {} }));
  assert.match(out, /Modelo da fase implementation/);
  assert.match(out, /Esforço da fase implementation/);
  assert.match(out, /Salvar perfil/);
  assert.match(out, /Revisão independente/);
  assert.match(out, /code-review/);
  assert.doesNotMatch(out, /iframe|classic/);
});

test("specialist profiles have original local portraits, readable leadership and accessible exploration", () => {
  const team: Snapshot = { tasks: [], specialists: [
    { id: "frontend-lead", name: "Líder de frontend", parent: null, scope: "Arquitetura de interface.", skills: ["codebase-design"] },
    { id: "react", name: "React", parent: "frontend-lead", scope: "Componentes, estado e interação React.", skills: ["tdd"] },
    { id: "generalist", name: "Engenharia geral", parent: null, scope: "Tarefas transversais.", skills: [] },
  ] };
  const out = html(createElement(AgentsView, { snapshot: team, disabled: false, onSave: async () => {} }));
  assert.equal((out.match(/class="specialist-portrait"/g) ?? []).length, 3);
  assert.equal((out.match(/class="specialist-card"/g) ?? []).length, 3);
  assert.match(out, /aria-label="Buscar especialistas"/);
  assert.match(out, /aria-label="Filtrar por liderança"/);
  assert.match(out, /aria-label="Ver perfil de React"/);
  assert.match(out, /Liderança: Líder de frontend/);
  assert.match(out, /Função transversal/);
  assert.match(out, /Avatares ilustrados/);
  assert.doesNotMatch(out, /<img[^>]+https?:|<iframe|Seguidores|Swarm ativo/);
});

test("catalog filters compose, ignore accents and include leaders and descendants without mutating contracts", () => {
  const original = JSON.stringify(specialists);
  assert.deepEqual(filterSpecialists(specialists, "componentes estado", "frontend-lead").map(role => role.id), ["react"]);
  assert.ok(filterSpecialists(specialists, "lider frontend").some(role => role.id === "react"));
  assert.deepEqual(filterSpecialists(specialists, "vercel:nextjs").map(role => role.id), ["nextjs"]);
  assert.ok(filterSpecialists(specialists, "", "frontend-lead").some(role => role.id === "frontend-lead"));
  assert.deepEqual(filterSpecialists(specialists, "", "transversal").map(role => role.id), ["generalist", "release-engineer"]);
  assert.deepEqual(filterSpecialists(specialists, "", "unknown"), []);
  const nested: Specialist[] = [{ id: "lead", name: "Líder" }, { id: "middle", name: "Coordenação", parent: "lead" }, { id: "leaf", name: "Folha", parent: "middle" }];
  assert.equal(filterSpecialists(nested, "", "lead").length, 3);
  assert.deepEqual(specialistLineage(nested[2], nested).map(role => role.id), ["leaf", "middle", "lead"]);
  assert.equal(JSON.stringify(specialists), original);
});

test("broken or cyclic hierarchy data cannot hang the visual catalog or invent a leader", () => {
  const broken: Specialist[] = [{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" }, { id: "orphan", name: "Órfão", parent: "missing" }];
  assert.deepEqual(specialistLineage(broken[0], broken).map(role => role.id), ["a", "b"]);
  assert.equal(filterSpecialists(broken).length, 3);
  const out = html(createElement(AgentsView, { snapshot: { tasks: [], specialists: [broken[2]] }, disabled: false, onSave: async () => {} }));
  assert.match(out, /Liderança não encontrada no catálogo/);
});

test("every real specialist receives a distinct deterministic portrait without remote images or scripts", () => {
  const portraits = specialists.map(role => html(createElement(SpecialistPortrait, { role })));
  const withoutLabel = portraits.map(portrait => portrait.replace(/aria-label="[^"]*"/, ""));
  assert.equal(new Set(withoutLabel).size, specialists.length);
  for (const [index, portrait] of portraits.entries()) {
    assert.equal(portrait, html(createElement(SpecialistPortrait, { role: specialists[index] })));
    assert.doesNotMatch(portrait, /https?:|<image|<script|<foreignObject/);
  }
  const out = html(createElement(AgentsView, { snapshot: { tasks: [], specialists: [{ id: "untrusted", name: "<script>bad()</script>", scope: "<img src=x onerror=bad()>", skills: [] }] }, disabled: false, onSave: async () => {} }));
  assert.doesNotMatch(out, /<script>bad\(\)<\/script>|<img src=x/);
  assert.match(out, /&lt;script&gt;/);
});

test("an absent specialist catalog is unknown rather than an invented team", () => {
  const out = html(createElement(AgentsView, { snapshot: { tasks: [] }, disabled: false, onSave: async () => {} }));
  assert.match(out, /Catálogo ainda não observado/);
  assert.doesNotMatch(out, /class="specialist-card"/);
});

test("agents display current runtime declarations rather than universal SDK gaps", () => {
  const out = html(createElement(SpecialistRuntime, { policy: specialistPolicy }));
  assert.match(out, /OpenAI Agents SDK/);
  assert.match(out, /Estado declarado/);
  for (const value of [specialistPolicy.runtime.kind, specialistPolicy.runtime.openai_agents_sdk, specialistPolicy.runtime.handoffs, specialistPolicy.memory_status, specialistPolicy.tool_allowlist_status]) assert.ok(out.includes(value));
  assert.doesNotMatch(out, /SDK ativo|Swarm operacional|O que falta para operar/);
  const unknown = html(createElement(AgentsView, { snapshot, disabled: false, onSave: async () => {} }));
  assert.match(unknown, /Runtime não informado/);
  assert.doesNotMatch(unknown, /Não integrado|SDK ativo/);
  const integrated = html(createElement(SpecialistRuntime, { policy: { runtime: { kind: "agents_sdk", openai_agents_sdk: "integrated", handoffs: "connected" }, memory_status: "connected", tool_allowlist_status: "enforced" } }));
  assert.match(integrated, /agents_sdk|integrated|connected|enforced/);
  assert.doesNotMatch(integrated, /Não integrado|Não conectados|Não conectada|Não aplicada/);
});

test("phase profile choices retain unknown current values without inventing model support", () => {
  assert.deepEqual(profileOptions("private-model", ["reported-model", "reported-model"]), ["private-model", "reported-model"]);
  assert.deepEqual(profileOptions("private-model"), ["private-model"]);
  const out = html(createElement(AgentsView, { snapshot: { tasks: [], profiles: { implementation: { model: "private-model", effort: "custom-effort", skill: "tdd" } } }, modelCatalog: { models: ["reported-model"], source: "metadata fixture" }, disabled: false, onSave: async () => {} }));
  assert.match(out, /todos os projetos|Escopo global/);
  assert.match(out, /value="private-model" selected/);
  assert.match(out, /value="custom-effort" selected/);
  assert.match(out, /reported-model|metadata fixture|Modelo efetivo|Precedência/);
  assert.doesNotMatch(out, /gpt-6|Modelo suportado/);
});

test("catalog and effective-model reports come from observed metadata, not pricing or configured defaults", () => {
  assert.deepEqual(catalogFromSettings({}).models, []);
  assert.deepEqual(catalogFromSettings({ provider_settings: { providers: [{ id: "other", models: ["irrelevant"] }, { id: "codex", models: ["observed"] }] } }).models, ["observed"]);
  const out = html(createElement(AgentsView, { snapshot, modelCatalog: { models: [] }, modelReports: { implementation: { effective_model: "actually-reported", precedence: ["provider", "phase"], source: "telemetry fixture" } }, disabled: false, onSave: async () => {} }));
  assert.match(out, /Modelo efetivo: actually-reported/);
  assert.match(out, /provider → phase|telemetry fixture/);
  assert.doesNotMatch(out, /Carregando catálogo|irrelevant/);
});

test("native curation shows observed evidence and does not invent missing counts", () => {
  const out = html(createElement(CurationView, { snapshot }));
  assert.match(out, /4 consultas/);
  assert.match(out, /read/);
  assert.match(out, /8 usos/);
  assert.match(out, /Cobertura parcial/);
  assert.match(html(createElement(CurationView, { snapshot: { tasks: [] } })), /Não observado/);
});

test("decision history is project scoped and keeps abstention visible", () => {
  assert.match(html(createElement(DecisionHistory, { snapshot, workspace: "C:/Projeto" })), /abstain/);
  assert.doesNotMatch(html(createElement(DecisionHistory, { snapshot, workspace: "C:/Outro" })), /abstain/);
});

test("native queue controls use persisted limits and label global scheduler scope", () => {
  const out = html(createElement(QueueControls, { scheduler: { planning_limit: 3, implementation_limit: 4, review_limit: 2 }, disabled: false, onSave: async () => {} }));
  assert.match(out, /todos os projetos desta instalação/);
  assert.match(out, /value="3"/);
  assert.match(out, /value="4"/);
  assert.match(out, /value="2"/);
  assert.match(out, /min="1" max="10"/);
});
