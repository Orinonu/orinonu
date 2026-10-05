import { test, expect } from "@playwright/test";
import { setupApi, settingsFixture } from "./fixtures";

test("settings save only the intended credential change without enabling providers or changing Codex", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("PATCH", "/api/settings", { body: settingsFixture() });
  await page.goto("/#settings");
  const save = page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" });
  await expect(save).toBeDisabled();
  await page.getByLabel("API Key (sk-or-v1-...):", { exact: true }).fill("SENTINEL_FAKE_UI_KEY");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => api.mutations.length).toBe(1);
  expect(api.mutations[0].body).toEqual({ providers: { openrouter: { key: "SENTINEL_FAKE_UI_KEY" } } });
  expect(api.unexpected).toEqual([]);
});

test("settings displays observed quota balances without inventing subscription validity", async ({ page }) => {
  const api = await setupApi(page);
  await page.goto("/#settings");
  await expect(page.getByText("Saldo OpenRouter: $0.50 USD (R$ 2.50)", { exact: true })).toBeVisible();
  await expect(page.getByText("Validade não verificada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Plano ativo até/)).toHaveCount(0);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("unknown balances and local expiry policies do not become zero balances or active subscriptions", async ({ page }) => {
  const api = await setupApi(page);
  const settings = { ...settingsFixture(), devin_auth: { status: "unauthenticated", plan_active_until: "2999-01-01T00:00:00Z", plan_active_until_source: "local_policy", days_remaining: 9999, verification: { subscription_expires_at: null } }, quotas: { providers: [{ id: "openrouter", limit_detail: { remaining_usd: null, remaining_brl: null } }] } };
  api.responses.set("/api/settings", { body: settings });
  await page.goto("/#settings");
  await expect(page.getByText("Validade não verificada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Saldo OpenRouter:/)).toHaveCount(0);
  await expect(page.getByText(/9999 dias|Plano ativo até/)).toHaveCount(0);
  await expect(page.getByText(/Política local declarada.*2999/)).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("an explicit zero USD balance preserves an unknown BRL conversion", async ({ page }) => {
  const api = await setupApi(page);
  const settings = { ...settingsFixture(), quotas: { providers: [{ id: "openrouter", limit_detail: { remaining_usd: 0, remaining_brl: null } }] } };
  api.responses.set("/api/settings", { body: settings });
  await page.goto("/#settings");
  await expect(page.getByText("Saldo OpenRouter: $0.00 USD (conversão BRL não verificada)", { exact: true })).toBeVisible();
  expect(api.mutations).toEqual([]);
});

test("unavailable settings cannot be submitted as defaults", async ({ page }) => {
  const api = await setupApi(page);
  api.responses.set("/api/settings", { status: 503, body: { error: "Consulta indisponível." } });
  await page.goto("/#settings");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("configurações válidas");
  await expect(page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" })).toBeDisabled();
  expect(api.mutations).toEqual([]);
});

test("settings exposes metadata models and explicit global provider enablement without automatic mutation", async ({ page }) => {
  const api = await setupApi(page);
  const fixture = settingsFixture();
  fixture.provider_settings.providers[0].model = "custom-codex-current";
  api.responses.set("/api/settings", { body: fixture });
  api.allow("PATCH", "/api/settings", { body: fixture });
  await page.goto("/#settings");
  await expect(page.getByText(/Escopo global desta instalação/)).toBeVisible();
  const model = page.getByLabel("Modelo Principal do Codex:", { exact: true });
  await expect(model).toHaveValue("custom-codex-current");
  expect(await model.locator("option").allTextContents()).toEqual(["custom-codex-current", "gpt-6-luna", "gpt-6.1-sol"]);
  const openrouter = page.getByLabel("Modelo OpenRouter:", { exact: true });
  expect(await openrouter.locator("option").allTextContents()).toEqual(["openai/gpt-4o"]);
  expect(api.mutations).toEqual([]);
  await page.getByLabel("Habilitar OpenRouter nesta instalação", { exact: true }).check();
  await page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" }).click();
  await expect.poll(() => api.mutations.length).toBe(1);
  expect(api.mutations[0].body).toEqual({ providers: { openrouter: { enabled: true } } });
  expect(api.unexpected).toEqual([]);
});

test("Google preference save uses PATCH and never silently activates a provider", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("PATCH", "/api/settings", { body: settingsFixture() });
  await page.goto("/#settings");
  await page.getByLabel("Google API Key / Token Antigravity:", { exact: true }).fill("SENTINEL_FAKE_GOOGLE_KEY");
  await page.getByRole("button", { name: "Salvar preferências Google", exact: true }).click();
  await expect.poll(() => api.mutations.length).toBe(1);
  expect(api.mutations[0]).toEqual({ method: "PATCH", path: "/api/settings", body: { providers: { antigravity: { key: "SENTINEL_FAKE_GOOGLE_KEY" } } } });
  await expect(page.getByLabel("Google API Key / Token Antigravity:", { exact: true })).toHaveValue("");
  expect(api.unexpected).toEqual([]);
});

test("provider facts separate key presence, installation, CLI verification and execution eligibility", async ({ page }) => {
  const api = await setupApi(page);
  const fixture = settingsFixture();
  api.responses.set("/api/settings", { body: { ...fixture, devin_auth: { status: "credential_configured", installed: true, verification: { credential_configured: true, cli_authenticated: false, subscription_expires_at: null, source: "devin_cli_auth_status", checked_at: "2026-10-05T12:00:00Z" } } } });
  await page.goto("/#settings");
  const facts = page.getByRole("group", { name: "Evidências de Devin" });
  await expect(facts).toContainText(/Credencial\s*Configurada/);
  await expect(facts).toContainText(/Instalação\s*Detectada/);
  await expect(facts).toContainText(/Autenticação\s*CLI não autenticado/);
  await expect(facts).toContainText(/Elegibilidade\s*Não verificada/);
  await expect(facts).toContainText("devin_cli_auth_status");
  await expect(facts).not.toContainText("Assinatura Conectada");
  expect(api.mutations).toEqual([]);
});

test("quota refresh preserves edits while rebasing untouched provider metadata", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("POST", "/api/quotas/refresh", { body: {}, delay: 200 });
  await page.goto("/#settings");
  await expect(page.getByLabel("Modelo Principal do Codex:", { exact: true })).toHaveValue("gpt-6-luna");
  await page.getByLabel("API Key (sk-or-v1-...):", { exact: true }).fill("SENTINEL_FAKE_DRAFT");
  await page.getByLabel("Habilitar Devin nesta instalação", { exact: true }).check();
  const fresh = settingsFixture();
  fresh.provider_settings.providers[0].model = "gpt-6.1-sol";
  api.responses.set("/api/settings", { body: fresh, delay: 200 });
  await page.getByRole("button", { name: "Atualizar Cotas & Conexões" }).click();
  await expect(page.getByLabel("Modelo Principal do Codex:", { exact: true })).toHaveValue("gpt-6.1-sol");
  await expect(page.getByLabel("API Key (sk-or-v1-...):", { exact: true })).toHaveValue("SENTINEL_FAKE_DRAFT");
  await expect(page.getByLabel("Habilitar Devin nesta instalação", { exact: true })).toBeChecked();
  api.allow("PATCH", "/api/settings", { body: fresh });
  await page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" }).click();
  await expect.poll(() => api.mutations.length).toBe(2);
  expect(api.mutations[1].body).toEqual({ providers: { openrouter: { key: "SENTINEL_FAKE_DRAFT" }, devin: { enabled: true } } });
  expect(api.unexpected).toEqual([]);
});

test("failed persistence retains credentials and a dismissible error beyond the info timeout", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("PATCH", "/api/settings", { status: 503, body: { error: "SENTINEL_FAKE_KEY must not be echoed" }, delay: 150 });
  await page.goto("/#settings");
  const key = page.getByLabel("API Key (sk-or-v1-...):", { exact: true });
  await key.fill("SENTINEL_FAKE_KEY");
  await page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Erro ao salvar configurações" });
  await expect(alert).toContainText("Erro ao salvar configurações");
  await expect(alert).not.toContainText("SENTINEL_FAKE_KEY");
  await expect(key).toHaveValue("SENTINEL_FAKE_KEY");
  await page.waitForTimeout(6500);
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Fechar Erro em Configurações" }).click();
  await expect(alert).toHaveCount(0);
  expect(api.mutations).toHaveLength(1);
});

test("fallback reorder buttons have provider-specific accessible names and touch targets", async ({ page }) => {
  await setupApi(page);
  await page.goto("/#settings");
  const up = page.getByRole("button", { name: "Mover Codex para cima", exact: true });
  const down = page.getByRole("button", { name: "Mover Codex para baixo", exact: true });
  await expect(up).toBeDisabled();
  await expect(down).toBeEnabled();
  const box = await down.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await down.click();
  await expect(up).toBeEnabled();
});

test("slow device-login polls are single-flight and stop after leaving Settings without starting login", async ({ page }) => {
  const api = await setupApi(page);
  const fixture = { ...settingsFixture(), codex_auth: { status: "unauthenticated", login: { status: "awaiting_user", verification_url: "https://auth.openai.com/codex/device", user_code: "ABCD-12345" } } };
  api.responses.set("/api/settings", { body: fixture });
  let reads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/settings" && request.method() === "GET") reads++; });
  await page.goto("/#settings");
  await expect(page.getByRole("link", { name: "Abrir login oficial do Codex" })).toBeVisible();
  await page.getByLabel("API Key (sk-or-v1-...):", { exact: true }).fill("SENTINEL_FAKE_POLL_DRAFT");
  const initialReads = reads;
  api.responses.set("/api/settings", { body: fixture, delay: 4500 });
  await expect.poll(() => reads).toBe(initialReads + 1);
  await page.waitForTimeout(2300);
  expect(reads).toBe(initialReads + 1);
  await expect(page.getByLabel("API Key (sk-or-v1-...):", { exact: true })).toHaveValue("SENTINEL_FAKE_POLL_DRAFT");
  await page.goto("/#overview");
  await page.waitForTimeout(3000);
  expect(reads).toBe(initialReads + 1);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("saving selected provider preferences preserves other unsaved drafts and only persisted credentials clear", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("PATCH", "/api/settings", { body: settingsFixture(), delay: 250 });
  await page.goto("/#settings");
  const google = page.getByLabel("Google API Key / Token Antigravity:", { exact: true });
  const router = page.getByLabel("API Key (sk-or-v1-...):", { exact: true });
  await google.fill("SENTINEL_FAKE_GOOGLE");
  await router.fill("SENTINEL_FAKE_ROUTER");
  await page.getByLabel("Habilitar Devin nesta instalação", { exact: true }).check();
  await page.getByRole("button", { name: "Salvar preferências Google", exact: true }).click();
  await expect(google).toHaveValue("");
  await expect(router).toHaveValue("SENTINEL_FAKE_ROUTER");
  await expect(page.getByLabel("Habilitar Devin nesta instalação", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" }).click();
  await expect.poll(() => api.mutations.length).toBe(2);
  expect(api.mutations[0].body).toEqual({ providers: { antigravity: { key: "SENTINEL_FAKE_GOOGLE" } } });
  expect(api.mutations[1].body).toEqual({ providers: { openrouter: { key: "SENTINEL_FAKE_ROUTER" }, devin: { enabled: true } } });
  expect(api.unexpected).toEqual([]);
});

test("double activation of save is a single mutation and errors remain after a later success", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("PATCH", "/api/settings", { status: 503, body: { error: "Synthetic failure" }, delay: 350 });
  await page.goto("/#settings");
  await page.getByLabel("API Key (sk-or-v1-...):", { exact: true }).fill("SENTINEL_FAKE_RETRY");
  const save = page.getByRole("button", { name: "Salvar Todas as Configurações & Prioridades de Fallback" });
  await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  const alert = page.getByRole("alert").filter({ hasText: "Erro ao salvar configurações" });
  await expect(alert).toContainText("Erro ao salvar configurações");
  expect(api.mutations).toHaveLength(1);
  api.allow("PATCH", "/api/settings", { body: settingsFixture() });
  await save.click();
  await expect(page.getByLabel("API Key (sk-or-v1-...):", { exact: true })).toHaveValue("");
  await expect(alert).toContainText("Erro ao salvar configurações");
  expect(api.mutations).toHaveLength(2);
});
