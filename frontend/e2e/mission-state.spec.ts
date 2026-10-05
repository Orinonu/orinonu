import { test, expect } from "@playwright/test";
import { OTHER_WORKSPACE, WORKSPACE, setupApi, snapshotFixture } from "./fixtures";
import type { DecisionItem } from "../src/lib/mission";

const decision = (workspace = WORKSPACE): DecisionItem => ({
  id: "synthetic-human-gate", kind: "plan_decision", label: "Escopo", workspace,
  task_id: "test-0-0", opportunity_id: null, title: "Escolha humana sintética",
  question: "Qual limite deve ser preservado?", questions: ["Qual limite deve ser preservado?"],
  reason: "human_scope_required", resume_condition: null, since: null, owner: "human",
  recommendation: { state: "none" }, options: [{ id: "limit", label: "Preservar limite", effect: "Registrar resposta", reversible: true }],
});

async function switchProject(page: import("@playwright/test").Page, path: string) {
  await page.getByRole("button", { name: "Trocar projeto", exact: true }).click();
  await page.getByLabel("Outro projeto local").fill(path);
  await page.getByRole("button", { name: "Usar este projeto" }).click();
}

test("a valid 6.2 second snapshot is displayed without overlapping the five second poll", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/state", { body: snapshotFixture(), delay: 6200 });
  let calls = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/state") calls++; });
  await page.goto("/#board");
  await expect(page.getByRole("main")).toContainText("Carregando…");
  await page.waitForTimeout(5400);
  expect(calls).toBe(1);
  await expect(page.locator(".mission-card")).toHaveCount(30);
  await expect(page.locator(".connection-status")).toContainText("Conectado localmente");
  expect(calls).toBe(1);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("secondary error is not an empty inbox or transport outage and retries only that resource", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/decisions", { status: 503, body: { error: "Synthetic unavailable" } });
  const counts = new Map<string, number>();
  page.on("request", request => { const path = new URL(request.url()).pathname; counts.set(path, (counts.get(path) ?? 0) + 1); });
  await page.goto("/#overview");
  const resource = page.locator(".resource-state").filter({ hasText: "Caixa de decisões" });
  await expect(resource).toContainText("Consulta indisponível");
  await expect(page.getByRole("main")).not.toContainText("Nada espera por você");
  await expect(page.locator(".connection-status")).toContainText("Conectado localmente");
  const previous = counts.get("/api/state");
  api.responses.set("/api/decisions", { body: { items: [] } });
  await resource.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("main")).toContainText("Nada espera por você");
  expect(counts.get("/api/state")).toBe(previous);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("stale decisions are labeled and blocked, never reused under a different project's header", async ({ page }) => {
  const api = await setupApi(page);
  await page.clock.install();
  api.responses.set("/api/decisions", { body: { items: [decision()] } });
  await page.goto("/#decisions");
  await expect(page.getByRole("main")).toContainText("Qual limite deve ser preservado?");
  api.responses.set("/api/decisions", { status: 503, body: { error: "Unavailable" } });
  await page.clock.runFor(5000);
  const resource = page.locator(".resource-state").filter({ hasText: "Caixa de decisões" });
  await expect(resource).toContainText("Dados desatualizados");
  await expect(resource).toContainText("Última resposta válida:");
  await expect(page.getByRole("main")).toContainText("Qual limite deve ser preservado?");
  await expect(page.getByRole("button", { name: "Responder", exact: true })).toBeDisabled();
  await switchProject(page, OTHER_WORKSPACE);
  await expect(page.getByRole("main")).not.toContainText("Qual limite deve ser preservado?");
  await expect(page.getByRole("main")).not.toContainText("Nada espera por você");
  api.responses.set("/api/decisions", { body: { items: [{ ...decision(OTHER_WORKSPACE), id: "beta-gate", title: "Pergunta Beta", question: "Decisão Beta", questions: ["Decisão Beta"], task_id: null }] } });
  await resource.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("main")).toContainText("Decisão Beta");
  await expect(page.getByRole("main")).not.toContainText("Qual limite deve ser preservado?");
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("incompatible initial data preserves navigation and recovery rather than erasing the shell", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/state", { body: { tasks: null } });
  await page.goto("/#board");
  await expect(page.getByRole("main")).toContainText("incompatível");
  await expect(page.getByRole("heading", { name: "Missões", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trocar projeto", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova missão", exact: true })).toBeDisabled();
  api.responses.set("/api/state", { body: snapshotFixture() });
  await page.getByRole("main").getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.locator(".mission-card")).toHaveCount(30);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("missing optional project data stays unknown and cannot be saved as defaults", async ({ page }) => {
  const api = await setupApi(page);
  await page.clock.install();
  const { project_directions, opportunities, ...partial } = snapshotFixture();
  api.responses.set("/api/state", { body: partial });
  await page.goto("/#direction");
  await page.getByLabel("Objetivo atual", { exact: true }).fill("Rascunho antes da consulta completa");
  await expect(page.getByRole("button", { name: "Salvar direção", exact: true })).toBeDisabled();
  await expect(page.getByRole("main")).toContainText("Direção salva não informada");
  await page.evaluate(() => { location.hash = "research"; });
  await expect(page.getByRole("main")).toContainText("Propostas e capacidade não informadas");
  await expect(page.getByRole("main")).not.toContainText("3 vagas disponíveis");
  await expect(page.getByRole("button", { name: "Salvar referências", exact: true })).toBeDisabled();
  api.responses.set("/api/state", { body: { ...partial, project_directions, opportunities } });
  await page.clock.runFor(5000);
  await page.evaluate(() => { location.hash = "direction"; });
  await expect(page.getByLabel("Objetivo atual", { exact: true })).toHaveValue("Rascunho antes da consulta completa");
  await expect(page.getByRole("button", { name: "Salvar direção", exact: true })).toBeEnabled();
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("bad polling data preserves cards, both board scroll axes and project direction drafts", async ({ page }) => {
  const api = await setupApi(page);
  await page.clock.install();
  await page.goto("/#board");
  await expect(page.locator(".mission-card")).toHaveCount(30);
  const board = page.getByRole("region", { name: "Quadro de missões", exact: true });
  const lane = page.getByRole("region", { name: "Concluídas · missões", exact: true });
  await board.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await lane.evaluate(element => { element.scrollTop = 80; });
  const position = { left: await board.evaluate(element => element.scrollLeft), top: await lane.evaluate(element => element.scrollTop) };
  api.responses.set("/api/state", { body: {} });
  await page.clock.runFor(5000);
  await expect(page.locator(".resource-state").filter({ hasText: "Missões e projeto" })).toContainText("Dados desatualizados");
  await expect(page.locator(".mission-card")).toHaveCount(30);
  expect(await board.evaluate(element => element.scrollLeft)).toBe(position.left);
  expect(await lane.evaluate(element => element.scrollTop)).toBe(position.top);
  await page.evaluate(() => { location.hash = "direction"; });
  await page.getByLabel("Objetivo atual", { exact: true }).fill("Rascunho preservado Alpha");
  await switchProject(page, OTHER_WORKSPACE);
  await page.getByLabel("Objetivo atual", { exact: true }).fill("Rascunho preservado Beta");
  api.responses.set("/api/state", { body: snapshotFixture() });
  await page.locator(".resource-state").getByRole("button", { name: "Tentar novamente" }).click();
  await switchProject(page, WORKSPACE.toLowerCase().replaceAll("/", "\\") + "\\");
  await expect(page.getByLabel("Objetivo atual", { exact: true })).toHaveValue("Rascunho preservado Alpha");
  await switchProject(page, OTHER_WORKSPACE);
  await expect(page.getByLabel("Objetivo atual", { exact: true })).toHaveValue("Rascunho preservado Beta");
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("Windows aliases retain cards; archived work and foreign cost actions never leak into the selected project", async ({ page }) => {
  const api = await setupApi(page);
  const data = snapshotFixture();
  data.tasks.push({ ...data.tasks[0], id: "archived", title: "Archived should not be active", archived_at: "2026-10-05", queue: { status: "queued" } });
  data.analytics = { totals: { estimated_brl: 12, estimated_usd: 2 }, tasks: [{ task_id: "test-0-0", title: "Alpha cost evidence", estimated_brl: 12, estimated_usd: 2 }] };
  api.responses.set("/api/state", { body: data });
  await page.goto("/#board");
  await expect(page.locator(".mission-card")).toHaveCount(30);
  await switchProject(page, WORKSPACE.toLowerCase().replaceAll("/", "\\") + "\\");
  await expect(page.locator(".mission-card")).toHaveCount(30);
  await switchProject(page, OTHER_WORKSPACE);
  await expect(page.locator(".mission-card")).toHaveCount(0);
  await page.evaluate(() => { location.hash = "overview"; });
  await page.getByText("Custos e evidências financeiras · projeto e instalação", { exact: true }).click();
  await expect(page.locator(".economy-panel")).toContainText("instalação global");
  await expect(page.locator(".economy-row")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("Alpha cost evidence");
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("overview prioritizes work and decisions, lazily reveals financial evidence, and completed shortcut reveals its lane", async ({ page }) => {
  const api = await setupApi(page);
  const data = snapshotFixture();
  data.analytics = { tasks: [{ task_id: "test-0-0", title: "Financial evidence", estimated_brl: 5 }] };
  api.responses.set("/api/state", { body: data });
  api.responses.set("/api/decisions", { body: { items: [decision()] } });
  await page.goto("/#overview");
  await expect(page.getByRole("main")).toContainText("Escolha humana sintética");
  await expect(page.locator(".economy-row")).toHaveCount(0);
  const before = await page.getByRole("main").evaluate(element => element.querySelectorAll("*").length);
  await page.getByText("Custos e evidências financeiras · projeto e instalação", { exact: true }).click();
  await expect(page.locator(".economy-row")).toHaveCount(1);
  expect(await page.getByRole("main").evaluate(element => element.querySelectorAll("*").length)).toBeGreaterThan(before);
  expect(await page.locator(".work-panel").evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(await page.locator(".economy-panel").evaluate(element => element.getBoundingClientRect().top));
  await page.getByRole("button", { name: /Concluídas/ }).click();
  await expect(page.locator(".kanban-column")).toHaveCount(6);
  await expect.poll(() => page.locator('[data-lane="done"]').evaluate(element => {
    const bounds = element.getBoundingClientRect(), board = element.closest(".kanban")!.getBoundingClientRect();
    return bounds.left >= board.left - 1 && bounds.right <= board.right + 1;
  })).toBe(true);
  await expect(page.locator(".board-toolbar, .board-summary, .kanban-chips, .filter-result, .list-mode")).toHaveCount(0);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("human gates open decisions, external sessions follow, reports are lazy, and scope edits survive report tab switches", async ({ page }) => {
  const api = await setupApi(page);
  const data = snapshotFixture();
  data.tasks[0].decision_recovery = { owner: "human", reason: "human_scope_required" };
  data.tasks[1].external_work = { status: "active", phase: "implementation", owner: "devin" };
  data.tasks[2].opportunity_audit = true;
  api.responses.set("/api/state", { body: data });
  api.responses.set("/api/decisions", { body: { items: [decision()] } });
  await page.goto("/#board");
  const gate = page.locator(".mission-card").filter({ hasText: "Aguardando você" });
  await expect(gate.getByRole("button", { name: "Planejar e implementar" })).toHaveCount(0);
  await gate.getByRole("button", { name: "Abrir decisão" }).click();
  await expect(page.getByRole("main")).toContainText("Qual limite deve ser preservado?");
  await page.evaluate(() => { location.hash = "board"; });
  const external = page.locator(".mission-card").filter({ hasText: "Sessão · devin" });
  await external.getByRole("button", { name: "Acompanhar" }).click();
  await expect(page.getByRole("dialog")).toContainText("Sessão · devin");
  await expect(page.locator(".mission-report")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator('[data-lane="backlog"] .mission-card').last().getByRole("button").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Escopo", exact: true }).click();
  await dialog.getByText("Editar objetivo e critérios", { exact: true }).click();
  await dialog.getByLabel("Título", { exact: true }).fill("Rascunho do escopo permanece");
  await dialog.getByRole("tab", { name: /Relatórios/ }).click();
  await expect(dialog.locator(".mission-report")).toHaveCount(2);
  await dialog.getByRole("tab", { name: "Escopo", exact: true }).click();
  await expect(dialog.getByLabel("Título", { exact: true })).toHaveValue("Rascunho do escopo permanece");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { location.hash = "research"; });
  await page.locator(".research-history .investigation-row").click();
  await expect(page.getByRole("dialog")).toContainText("Somente leitura");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Planejar e implementar" })).toHaveCount(0);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("a rejected phase save reaches the operational view's error path, preserves its draft and never shows local success", async ({ page }) => {
  const api = await setupApi(page);
  const data = snapshotFixture();
  api.responses.set("/api/state", { body: data });
  api.allow("PATCH", "/api/profiles", { status: 400, body: { error: "Synthetic phase model rejected." } });
  await page.goto("/#agents");
  const model = page.getByLabel("Modelo da fase implementation", { exact: true });
  const profile = page.locator('[data-slot="card"]').filter({ has: model });
  await expect(model.locator('option[value="gpt-6.1-sol"]')).toHaveCount(1);
  await model.selectOption("gpt-6.1-sol");
  await page.getByRole("button", { name: "Salvar perfil da fase implementation", exact: true }).click();
  await expect(profile.getByRole("alert")).toContainText("Synthetic phase model rejected.");
  await expect(profile).not.toContainText("Perfil enviado");
  await expect(page.getByRole("main")).not.toContainText("Perfil de etapa atualizado.");
  await expect(model).toHaveValue("gpt-6.1-sol");
  await expect(page.getByRole("button", { name: "Salvar perfil da fase implementation", exact: true })).toBeEnabled();
  api.responses.set("/api/state", { body: { ...data, profiles: { ...data.profiles, implementation: { ...data.profiles!.implementation, model: "gpt-6.1-sol" } } } });
  api.allow("PATCH", "/api/profiles", { body: { saved: true } });
  await page.getByRole("button", { name: "Salvar perfil da fase implementation", exact: true }).click();
  await expect(profile.getByRole("status")).toContainText("Perfil enviado");
  await expect(profile.getByRole("alert")).toHaveCount(0);
  expect(api.mutations).toHaveLength(2);
  expect(api.mutations.every(row => row.method === "PATCH" && row.path === "/api/profiles")).toBe(true);
  expect(api.unexpected).toEqual([]);
});

test("archiving an open mission removes its current actions and counts on the next snapshot", async ({ page }) => {
  const api = await setupApi(page);
  await page.clock.install();
  const data = snapshotFixture();
  api.responses.set("/api/state", { body: data });
  await page.goto("/#board");
  await expect(page.locator(".mission-card")).toHaveCount(30);
  await page.locator('[data-lane="backlog"] .mission-card').first().getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  api.responses.set("/api/state", { body: { ...data, tasks: data.tasks.map(task => task.id === "test-0-0" ? { ...task, archived_at: "2026-10-05", queue: { status: "queued" } } : task) } });
  await page.clock.runFor(5000);
  await expect(page.locator(".mission-card")).toHaveCount(29);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});
