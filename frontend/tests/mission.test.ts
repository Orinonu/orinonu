import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionCard, TaskDetail } from "../src/components/mission-control.tsx";
import { ReportContent } from "../src/components/report-content.tsx";
import {
  laneOf,
  projectTasks,
  filteredTasks,
  referenceSave,
  directionSave,
  checklistProgress,
  taskProgress,
  taskPriority,
  taskHistory,
  autonomyMode,
  missionAction,
  resolveWorkspace,
  sameWorkspace,
  type Task,
} from "../src/lib/mission.ts";
test("compact Kanban cards retain title, state and actions without the long description", () => {
  const html = renderToStaticMarkup(createElement(MissionCard, {
    task: { id: "compact", title: "Sanitizar relatórios", goal: "Resumo detalhado para os detalhes da missão.", workspace: "C:/Projeto", status: "planning" },
    compact: true,
    onOpen: () => {}, onStart: () => {}, onStop: () => {}, busy: false,
  }));
  assert.match(html, /Sanitizar relatórios/);
  assert.match(html, /Planejamento/);
  assert.match(html, /Parar/);
  assert.doesNotMatch(html, /Resumo detalhado/);
  assert.doesNotMatch(html, /Sem data registrada/);
});

test("mission details focus on work and evidence rather than budget forms", () => {
  const html = renderToStaticMarkup(createElement(TaskDetail, {
    task: { id: "detail", title: "Sanitizar relatórios", goal: "Preservar as evidências.", acceptance: "Testes aprovados.", workspace: "C:/Projeto", status: "backlog", progress: { events: [{ label: "Relatório recebido" }] } },
    workspace: "C:/Projeto", onStart: () => {}, onStop: () => {}, busy: true,
  }));
  assert.doesNotMatch(html, /Orcamento expl|Orçamento explícito|Tokens de entrada|Habilitar esta politica/);
  assert.match(html, /role="tablist"/);
  for (const label of ["Andamento", "Relatórios", "Decisões", "Escopo"])
    assert.match(html, new RegExp(label));
  assert.match(html, /Relatório recebido/);
  assert.match(html, /Na fila/);
});

test("mission reports present headings, evidence lists and code without executing untrusted content", () => {
  const html = renderToStaticMarkup(createElement(ReportContent, {
    content: '# Plano\n\n**Evidências**\n\n- Teste aprovado\n- Revisão independente\n\n```js\nconst valid = true;\n```\n\n<script>alert(1)</script>\n\n![Imagem de teste](https://example.invalid/image.png)\n\n[Link não confiável](javascript:alert(1))',
  }));
  assert.match(html, /<h4>Plano<\/h4>/);
  assert.match(html, /<strong>Evidências<\/strong>/);
  assert.match(html, /<li>Teste aprovado<\/li>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const valid = true;/);
  assert.match(html, /Imagem citada: Imagem de teste/);
  assert.doesNotMatch(html, /<script|<img|href=|src=|onerror=/i);
});

const tasks = [
  {
    id: "active",
    workspace: "a",
    status: "blocked",
    title: "Revisão da execução",
    specialist: "frontend",
    external_work: { status: "active", phase: "implementation" },
  },
  {
    id: "queued",
    workspace: "a",
    status: "queued",
    title: "Configurar direção",
    goal: "Missão e visão",
    specialist: "backend",
  },
  {
    id: "review",
    workspace: "a",
    status: "reviewing",
    title: "Verificar critérios",
    specialist: "frontend",
  },
  { id: "other", workspace: "b", status: "running", title: "Outro projeto" },
  {
    id: "audit",
    workspace: "a",
    status: "planning",
    title: "Investigação",
    opportunity_audit: true,
  },
  {
    id: "assist",
    workspace: "a",
    status: "planning",
    title: "Rascunho",
    direction_assist: true,
  },
];
test("board belongs to the selected project and a live Codex session takes priority", () => {
  assert.deepEqual(
    projectTasks(tasks, "a").map((t) => t.id),
    ["active", "queued", "review"],
  );
  assert.equal(laneOf(tasks[0]), "running");
  assert.equal(laneOf(tasks[2]), "review");
  assert.equal(laneOf({ ...tasks[1], status: "ready" }), "backlog");
});

test("project aliases preserve Windows identity without merging sibling paths or archived work", () => {
  const rows = [
    { id: "live", workspace: "C:\\Projects\\Alpha", title: "Live", status: "backlog" },
    { id: "archived", workspace: "C:/Projects/Alpha", title: "Archived", status: "blocked", archived_at: "2026-10-05" },
    { id: "sibling", workspace: "C:/Projects/Alpha-next", title: "Sibling", status: "backlog" },
  ];
  assert.deepEqual(projectTasks(rows, "c:/projects/alpha/").map(row => row.id), ["live"]);
  assert.deepEqual(projectTasks(rows, ""), []);
  assert.equal(autonomyMode({ autonomy_policies: [{ workspace: "C:/Projects/Alpha", mode: "autonomous" }] }, "c:/projects/alpha/"), "autonomous");
  const archived = ["backlog", "blocked", "review", "queued"].map((status, index) => Object.freeze({ ...rows[0], id: `old-${index}`, status, archived_at: "2026-10-05", queue: { status: "queued" } }));
  const before = JSON.stringify(archived);
  assert.deepEqual(projectTasks(archived, "C:/Projects/Alpha"), []);
  assert.equal(JSON.stringify(archived), before);
});

test("canonical selection resolves to the saved spelling without losing draft keys or POSIX case", () => {
  assert.equal(resolveWorkspace(" c:\\projects\\alpha\\ ", ["C:/Projects/Alpha"]), "C:/Projects/Alpha");
  assert.equal(sameWorkspace("/Projects/Alpha", "/projects/alpha"), false);
  assert.equal(resolveWorkspace("C:/Projects/Alpha-next", ["C:/Projects/Alpha"]), "C:/Projects/Alpha-next");
});

test("mission actions are deterministic and never promote human gates or read-only work to writing", () => {
  const base: Task = { id: "action", title: "Mission", workspace: "a", status: "backlog" };
  for (const [changes, kind, label] of [
    [{}, "start", "Planejar e implementar"],
    [{ status: "queued" }, "stop", "Retirar da fila"],
    [{ status: "running" }, "stop", "Parar"],
    [{ status: "reviewing" }, "stop", "Parar"],
    [{ status: "review" }, "evidence", "Ver evidências"],
    [{ status: "blocked" }, "evidence", "Ver evidências"],
    [{ opportunity_audit: true }, "follow", "Ver investigação"],
    [{ direction_assist: true }, "follow", "Ver investigação"],
    [{ external_work: { status: "active", phase: "implementation", owner: "devin" } }, "follow", "Acompanhar"],
    [{ decision_recovery: { owner: "human" } }, "decision", "Abrir decisão"],
    [{ status: "done", queue: { status: "queued" } }, "evidence", "Ver evidências"],
    [{ archived_at: "2026-10-05", status: "running" }, "evidence", "Ver evidências"],
  ] as [Partial<Task>, string, string][]) {
    const action = missionAction({ ...base, ...changes });
    assert.equal(action.kind, kind);
    assert.equal(action.label, label);
  }
  assert.equal(missionAction(base, true).kind, "decision");
});

test("rendered cards offer decisions and read-only evidence instead of a generic write CTA", () => {
  const props = { onOpen: () => {}, onStart: () => {}, onStop: () => {}, busy: false };
  const task = { id: "gate", title: "Mission", workspace: "a", status: "backlog" };
  const gate = renderToStaticMarkup(createElement(MissionCard, { ...props, task, pendingDecision: true, onDecision: () => {} }));
  assert.match(gate, /Abrir decisão/);
  assert.doesNotMatch(gate, /Planejar e implementar/);
  const audit = renderToStaticMarkup(createElement(MissionCard, { ...props, task: { ...task, opportunity_audit: true } }));
  assert.match(audit, /Ver investigação/);
  assert.doesNotMatch(audit, /Planejar e implementar/);
  const external = renderToStaticMarkup(createElement(MissionCard, { ...props, task: { ...task, external_work: { status: "active", phase: "implementation", owner: "devin" } } }));
  assert.match(external, /Sessão · devin/);
  assert.doesNotMatch(external, /Sessão Codex/);
});

test("lazy report rendering measurably reduces initial detail DOM while evidence remains reachable", t => {
  const props = {
    task: { id: "measured", title: "Mission", workspace: "a", status: "backlog", plan_report: Array.from({ length: 120 }, (_, index) => `## Evidence ${index}\n\nSynthetic paragraph ${index}.`).join("\n\n") },
    workspace: "a", onStart: () => {}, onStop: () => {}, busy: false,
  };
  const initial = renderToStaticMarkup(createElement(TaskDetail, props));
  const reports = renderToStaticMarkup(createElement(TaskDetail, { ...props, initialTab: "reports" }));
  const count = (html: string) => (html.match(/<[a-z][^>]*>/g) ?? []).length;
  assert.ok(count(reports) > count(initial) + 240);
  assert.doesNotMatch(initial, /Synthetic paragraph 119/);
  assert.match(reports, /Synthetic paragraph 119/);
  t.diagnostic(`Same synthetic detail: ${count(initial)} elements initially, ${count(reports)} with report tab active; payload unchanged.`);
});

test("opening mission details does not eagerly render report DOM or remove the scope tab", () => {
  const html = renderToStaticMarkup(createElement(TaskDetail, {
    task: { id: "lazy", title: "Mission", workspace: "a", status: "backlog", plan_report: "UNIQUE_LAZY_REPORT" },
    workspace: "a", onStart: () => {}, onStop: () => {}, busy: false,
  }));
  assert.doesNotMatch(html, /UNIQUE_LAZY_REPORT/);
  assert.match(html, /Escopo/);
});

test("active processes precede selection and queued work regardless of stored status", () => {
  const base = { workspace: "a", title: "Mission" };
  const rows = [
    { ...base, id: "queued", status: "queued", queue: { status: "queued" } },
    {
      ...base,
      id: "external",
      status: "blocked",
      external_work: { status: "active", phase: "implementation" },
    },
    {
      ...base,
      id: "selecting",
      status: "planning",
      queue: { status: "selecting" },
    },
    { ...base, id: "running", status: "running" },
  ];
  assert.deepEqual(
    rows.sort((a, b) => taskPriority(a) - taskPriority(b)).map((row) => row.id),
    ["external", "running", "selecting", "queued"],
  );
});

test("history preserves attempts and labels snapshots with their original phase", () => {
  const event = { time: "2026-10-04T20:00:00Z", label: "Evidence recorded" };
  const events = taskHistory({
    id: "a",
    workspace: "a",
    title: "Mission",
    status: "review",
    progress: { checklist_phase: "review", attempt_id: "r1", events: [event] },
    review_run: {
      attempt_id: "r1",
      progress: { phase: "review", events: [event] },
    },
    implementation_run: {
      attempt_id: "i1",
      progress: { phase: "review", events: [event] },
    },
    planning_run: {
      attempt_id: "p1",
      progress: { phase: "queued", events: [event] },
    },
  });
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((row) => [row.activity_phase, row.activity_attempt]),
    [
      ["review", "r1"],
      ["planning", "p1"],
      ["implementation", "i1"],
    ],
  );
});
test("filters compose and search ignores accents without altering mission state", () => {
  assert.deepEqual(
    filteredTasks(tasks, {
      query: "REVISAO",
      stage: "running",
      specialist: "frontend",
    }).map((t) => t.id),
    ["active"],
  );
  assert.deepEqual(
    filteredTasks(tasks, { query: "missao e visao" }).map((t) => t.id),
    ["queued"],
  );
  assert.equal(tasks[0].status, "blocked");
});
test("overview shortcuts include every active phase and both kinds of pending attention", () => {
  const rows = [
    ...tasks,
    { id: "blocked", workspace: "a", title: "Blocked", status: "blocked" },
    { id: "pending-review", workspace: "a", title: "Review", status: "review" },
  ];
  assert.deepEqual(
    filteredTasks(projectTasks(rows, "a"), { stage: "active" }).map(
      (t) => t.id,
    ),
    ["active", "queued", "review"],
  );
  assert.deepEqual(
    filteredTasks(projectTasks(rows, "a"), { stage: "attention" }).map(
      (t) => t.id,
    ),
    ["blocked", "pending-review"],
  );
});
test("saving references preserves saved charter even when direction has an unsaved draft", () => {
  const saved = {
    workspace: "a",
    mission: "Saved mission",
    objective: "Saved goal",
    success_criteria: "Evidence",
    repositories: ["https://github.com/a/b"],
    research_focus: "Old",
  };
  const draft = {
    ...saved,
    mission: "Unsaved mission",
    objective: "Unsaved goal",
    repositories: ["https://github.com/c/d"],
    research_focus: "New",
  };
  const references = referenceSave(saved, draft);
  assert.equal(references.mission, "Saved mission");
  assert.equal(references.objective, "Saved goal");
  assert.deepEqual(references.repositories, draft.repositories);
  const direction = directionSave(saved, draft);
  assert.equal(direction.mission, "Unsaved mission");
  assert.deepEqual(direction.repositories, saved.repositories);
});
test("progress remains unknown without a valid checklist backed by evidence", () => {
  assert.equal(
    checklistProgress({
      measurement_kind: "task_checklist",
      items: [{ id: "a", state: "completed", evidence_count: 0 }],
    }),
    null,
  );
  assert.equal(
    checklistProgress({
      measurement_kind: "task_checklist",
      items: [
        { id: "a", state: "completed", evidence_count: 1 },
        { id: "b", state: "pending" },
      ],
    }),
    50,
  );
  assert.equal(
    checklistProgress({ measurement_kind: "estimate", items: [] }),
    null,
  );
});
test("returning a mission to backlog does not present an old checklist as current", () => {
  const progress = {
    measurement_kind: "task_checklist",
    checklist_phase: "planning",
    items: [{ id: "a", state: "completed", evidence_count: 1 }],
  };
  assert.equal(
    taskProgress({
      id: "a",
      workspace: "a",
      title: "Revised goal",
      status: "backlog",
      progress,
    }),
    null,
  );
  assert.equal(
    taskProgress({
      id: "a",
      workspace: "a",
      title: "Completed plan",
      status: "review",
      progress,
    }),
    100,
  );
});
test("autonomy mode is only autonomous when a saved policy says so", () => {
  const snapshot = {
    autonomy_policies: [{ workspace: "a", mode: "autonomous" }],
  };
  assert.equal(autonomyMode(snapshot, "a"), "autonomous");
  assert.equal(autonomyMode(snapshot, "b"), "supervised");
  assert.equal(autonomyMode({ autonomy_policies: [] }, "a"), "supervised");
  assert.equal(autonomyMode(null, "a"), "supervised");
  assert.equal(
    autonomyMode({ autonomy_policies: [{ workspace: "a", mode: "manual" }] }, "a"),
    "supervised",
  );
});
