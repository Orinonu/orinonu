import { test, expect } from "@playwright/test";
import { setupApi, snapshotFixture } from "./fixtures";

const epoch = { id: "synthetic-epoch", time: "2026-10-05T12:00:00Z", mode: "shadow", gate: { status: "awaiting_paired_samples", current_pairs: 0, min_pairs: 10, reason: "Amostras sintéticas." }, simulated_result: { accuracy: 1 }, applied: false };

test("catalog search composes with leadership and named specialist dialogs restore keyboard focus", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/state", { body: { ...snapshotFixture(), specialists: [
    { id: "frontend-lead", name: "Líder de frontend", parent: null, scope: "Arquitetura de interface." },
    { id: "react", name: "React", parent: "frontend-lead", scope: "Componentes e estado React.", skills: ["tdd"] },
    { id: "reviewer", name: "Revisão independente", parent: null, scope: "Verificação independente." },
  ] } });
  await page.goto("/#agents");
  await page.getByLabel("Buscar especialistas").fill("componentes estado");
  await page.getByLabel("Filtrar por liderança").selectOption("frontend-lead");
  const trigger = page.getByRole("button", { name: "Ver perfil de React", exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver perfil de Revisão independente", exact: true })).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "React", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "React", exact: true })).toBeFocused();
  await expect(dialog).toContainText("Componentes e estado React.");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ver perfil de Revisão independente", exact: true })).toBeVisible();
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("unknown phase model selections survive a reported catalog and are not silently overwritten", async ({ page }) => {
  const api = await setupApi(page);
  const snapshot = { ...snapshotFixture(), profiles: { implementation: { model: "unknown-current-model", effort: "custom-effort", skill: "tdd" } } };
  api.responses.set("/api/state", { body: snapshot });
  api.allow("PATCH", "/api/profiles", { status: 400, body: { error: "Modelo rejeitado pela instalação." } });
  await page.goto("/#agents");
  const model = page.getByLabel("Modelo da fase implementation", { exact: true });
  const effort = page.getByLabel("Esforço da fase implementation", { exact: true });
  await expect(model).toHaveValue("unknown-current-model");
  await expect(effort).toHaveValue("custom-effort");
  await expect(page.getByText(/Modelo atual preservado fora do catálogo observado/)).toBeVisible();
  await model.selectOption("gpt-6-luna");
  await page.getByRole("button", { name: "Salvar perfil da fase implementation", exact: true }).click();
  await expect.poll(() => api.mutations.length).toBe(1);
  await expect(model).toHaveValue("gpt-6-luna");
  await expect(effort).toHaveValue("custom-effort");
  expect(api.mutations[0]).toEqual({ method: "PATCH", path: "/api/profiles", body: { phase: "implementation", model: "gpt-6-luna", effort: "custom-effort" } });
  expect(api.unexpected).toEqual([]);
});

test("global evolution loading and errors never invent zero observations or start epochs", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/evolution", { status: 503, delay: 500, body: { error: "Métricas indisponíveis." } });
  await page.goto("/#evaluations");
  const main = page.getByRole("main");
  await expect(main.getByText("Carregando métricas da instalação…", { exact: true })).toBeVisible();
  await expect(main.getByRole("alert")).toContainText("Métricas indisponíveis");
  await expect(main).not.toContainText("0 de 0");
  await expect(main).not.toContainText("0 registradas");
  await expect(main.getByRole("button", { name: "Executar época (modo sombra)", exact: true })).toBeDisabled();
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("only an explicit epoch click writes to the simulated API and failed refresh retains labeled prior data", async ({ page }) => {
  const api = await setupApi(page);
  const data = { metrics: { rework_count: 2 }, campaigns: [], epochs: [] };
  api.responses.set("/api/evolution", { body: data });
  api.allow("POST", "/api/evolution/epoch", { body: epoch });
  await page.goto("/#evaluations");
  const main = page.getByRole("main");
  await expect(main).toContainText("Escopo global da instalação");
  await expect(main).toContainText("todos os projetos");
  expect(api.mutations).toEqual([]);
  api.responses.set("/api/evolution", { body: { ...data, epochs: [epoch] } });
  await main.getByRole("button", { name: "Executar época (modo sombra)", exact: true }).click();
  await expect(main).toContainText("Resultado simulado");
  await expect(main).toContainText("Não aplicado");
  expect(api.mutations.map(row => row.path)).toEqual(["/api/evolution/epoch"]);
  api.responses.set("/api/evolution", { status: 503, body: { error: "Falha de atualização sintética." } });
  await main.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Falha de atualização sintética");
  await expect(main).toContainText("Dados anteriores");
  await expect(main).toContainText("Resultado simulado");
  expect(api.unexpected).toEqual([]);
});

test("missing version and remote metadata remain unknown while copy information cannot hide a persistent error", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/updates", { body: { installed: { version: null, commit: null }, latest: null, status: "not_checked", checked_at: null } });
  api.allow("POST", "/api/updates/check", { status: 503, body: { error: "Rede sintética indisponível." } });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  await page.goto("/#updates");
  const main = page.getByRole("main");
  await expect(main.getByText("Versão não identificada", { exact: true })).toBeVisible();
  await expect(main).not.toContainText("v0.0.5");
  await expect(main).toContainText("Nenhuma comparação remota confirmada");
  expect(api.mutations).toEqual([]);
  await main.getByRole("button", { name: "Verificar main", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Não foi possível verificar main");
  await main.getByRole("button", { name: "Copiar comando", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Comando copiado" })).toBeVisible();
  await expect(main.getByRole("alert")).toContainText("Não foi possível verificar main");
  await expect(main.getByRole("status").filter({ hasText: "Comando copiado" })).toHaveCount(0, { timeout: 10000 });
  await expect(main.getByRole("alert")).toContainText("Não foi possível verificar main");
  expect(api.mutations.map(row => row.path)).toEqual(["/api/updates/check"]);
  expect(api.unexpected).toEqual([]);
});
