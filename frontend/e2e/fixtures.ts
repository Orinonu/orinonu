import type { Page, Route } from "@playwright/test";
import type { Snapshot } from "../src/lib/mission";

export const WORKSPACE = "C:/Projetos/Orinonu-Auditoria";
export const OTHER_WORKSPACE = "C:/Projetos/Outro-Projeto";
export const FIXED_TIME = "2026-10-05T12:00:00Z";

export function snapshotFixture(): Snapshot {
  return {
    workspace: { default: WORKSPACE },
    tasks: ["backlog", "planning", "running", "reviewing", "done", "blocked"].flatMap((status, phase) =>
      Array.from({ length: 5 }, (_, index) => ({
        id: `test-${phase}-${index}`, workspace: WORKSPACE, status,
        title: index ? `Verificar componente ${phase + 1}.${index + 1}` : "Preservar a clareza e as evidências da missão",
        goal: "Objetivo sintético sem execução real.", acceptance: "Interface legível e verificação independente.",
        agent: "codex", executor: "codex", specialist: "generalist", revision: 1, max_minutes: 30,
        created_at: FIXED_TIME, profile: phase === 1 ? "design" : phase === 3 ? "review" : "implementation",
        progress: { measurement_kind: "task_checklist", checklist_phase: "implementation", items: [
          { id: "one", title: "Evidência registrada", state: "completed", evidence_count: 1 },
          { id: "two", title: "Verificação pendente", state: "pending", evidence_count: 0 },
        ], events: [{ time: FIXED_TIME, label: "Relatório sintético recebido", activity_phase: "planning" }] },
        plan_report: "# Plano\n\n- Preservar evidências\n- Validar teclado\n\n```ts\nconst checked = true;\n```",
        review_report: "# Revisão\n\nResultado sintético, não uma aprovação real.",
      }))),
    project_directions: [
      { workspace: WORKSPACE, objective: "Auditar interface Alpha.", success_criteria: "Clareza e acessibilidade.", mission: "Objetivos claros.", vision: "Evolução contínua.", values: "Fidelidade.", principles: "Evidências.", updated_at: FIXED_TIME },
      { workspace: OTHER_WORKSPACE, objective: "Objetivo Beta.", success_criteria: "Isolamento.", updated_at: FIXED_TIME },
    ],
    projects: [{ workspace: WORKSPACE }, { workspace: OTHER_WORKSPACE }],
    specialists: [{ id: "generalist", name: "Engenharia geral", skills: ["tdd"] }, { id: "reviewer", name: "Revisão independente", skills: ["code-review"] }],
    profiles: { discovery: { model: "gpt-6.1-sol", effort: "medium", skill: "wayfinder" }, design: { model: "gpt-6.1-sol", effort: "high", skill: "grill-with-docs" }, implementation: { model: "gpt-6-luna", effort: "medium", skill: "tdd" }, review: { model: "gpt-6-luna", effort: "high", skill: "code-review" } },
    scheduler: { planning_limit: 7, implementation_limit: 7, review_limit: 7, running: { planning: 0, implementation: 0, review: 0 }, queued: { planning: 0, implementation: 0, review: 0 } },
    autonomy_policies: [{ workspace: WORKSPACE, mode: "supervised" }],
    opportunities: [], events: [],
    context: { consultations: 0, trust: "Confiança não verificada nesta simulação." },
  };
}

export function settingsFixture() {
  return {
    typesafe: { configured: false, model: "jev-latest", models: [{ id: "jev-latest", label: "JEV latest" }], storage: "Windows DPAPI" },
    codex_auth: { status: "unauthenticated", login: { status: "idle" } },
    antigravity_auth: { status: "unauthenticated", installed: false, model: "gemini-2.5-pro", models: ["gemini-2.5-pro"], detail: "Autenticação não verificada." },
    devin_auth: { status: "unauthenticated", installed: false, model: "devin-2.0", models: ["devin-2.0"], detail: "Validade não observada." },
    provider_settings: {
      auto_fallback: false, fallback_chain: ["codex", "openrouter", "anthropic", "devin", "antigravity"],
      providers: [
        { id: "codex", name: "Codex", enabled: false, model: "gpt-6-luna", models: ["gpt-6-luna", "gpt-6.1-sol"], configured: false, key_source: "none" },
        { id: "openrouter", name: "OpenRouter", enabled: false, model: "openai/gpt-4o", models: ["openai/gpt-4o"], configured: false, key_source: "none" },
        { id: "anthropic", name: "Anthropic", enabled: false, model: "claude-3-5-haiku-20241022", models: ["claude-3-5-haiku-20241022"], configured: false, key_source: "none" },
        { id: "devin", name: "Devin", enabled: false, model: "devin-2.0", models: ["devin-2.0"], configured: false, key_source: "none" },
        { id: "antigravity", name: "Google", enabled: false, model: "gemini-2.5-pro", models: ["gemini-2.5-pro"], configured: false, key_source: "none" },
      ],
    },
    quotas: { providers: [{ id: "openrouter", status: "ready", eligible_for_execution: false, limit_detail: { remaining_usd: 0.5, remaining_brl: 2.5 } }], current_time: FIXED_TIME },
  };
}

export type ResponseFixture = { body: unknown; status?: number; delay?: number };
export async function setupApi(page: Page) {
  const responses = new Map<string, ResponseFixture>([
    ["/api/state", { body: snapshotFixture() }],
    ["/api/settings", { body: settingsFixture() }],
    ["/api/flow", { body: [] }],
    ["/api/decisions", { body: { items: [] } }],
    ["/api/evolution", { body: { metrics: { acceptance_rate: null, total_reviews: 0, approved_reviews: 0, rework_count: 0, human_interventions: 0, jev_abstentions: 0 }, campaigns: [], epochs: [] } }],
    ["/api/updates", { body: { repository: "Orinonu/orinonu", channel: "main", installed: { version: "0.0.5", commit: null, branch: "main", dirty: false }, latest: null, status: "untracked", behind: null, ahead: null, checked_at: null, error: null } }],
  ]);
  const mutations: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  const allowed = new Map<string, ResponseFixture>();
  const origin = `http://127.0.0.1:${process.env.ORINONU_E2E_PORT ?? 19794}`;
  await page.addInitScript(workspace => localStorage.setItem("nexo-selected-workspace", workspace), WORKSPACE);
  await page.route("**/*", async (route: Route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push("external:" + url.origin); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    let fixture: ResponseFixture | undefined;
    if (request.method() === "GET") fixture = responses.get(url.pathname);
    else {
      const key = request.method() + " " + url.pathname;
      mutations.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() ?? {} });
      fixture = allowed.get(key);
      if (!fixture) { unexpected.push(key); await route.fulfill({ status: 409, json: { error: "Operação bloqueada pela API simulada." } }); return; }
    }
    if (!fixture) { unexpected.push("GET " + url.pathname); await route.fulfill({ status: 404, json: { error: "Consulta não coberta pela fixture." } }); return; }
    if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
    await route.fulfill({ status: fixture.status ?? 200, json: fixture.body });
  });
  return { responses, mutations, unexpected, allow: (method: string, path: string, fixture: ResponseFixture) => allowed.set(method + " " + path, fixture) };
}
