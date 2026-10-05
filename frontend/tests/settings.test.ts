import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsView, SettingsProviderFacts } from "../src/components/settings-view.tsx";
import { settingsFixture } from "../e2e/fixtures.ts";
import { readSettings, providerDraft, settingsPatch, providerStatus, modelOptions, reconcileProviderDraft, quotaBalance, providerFacts, subscriptionStatus } from "../src/lib/settings.ts";

test("changing fallback order preserves untouched provider settings and sends only intended changes", () => {
  const data = readSettings(settingsFixture());
  const draft = providerDraft(data);
  assert.equal(settingsPatch(data, draft, {}), null);
  draft.chain.reverse();
  const patch = settingsPatch(data, draft, {});
  assert.deepEqual(patch, { fallback_chain: ["antigravity", "devin", "anthropic", "openrouter", "codex"] });
  assert.equal(data.provider_settings.providers[0].enabled, false);
  assert.equal(data.provider_settings.providers[0].model, "gpt-6-luna");
});

test("malformed or ambiguous provider quotas cannot initialize settings", () => {
  for (const providers of [[null], [{ id: 42 }], [{ id: "openrouter", limit_detail: { remaining_usd: "0" } }], [{ id: "openrouter" }, { id: "openrouter" }]]) {
    assert.throws(() => readSettings({ ...settingsFixture(), quotas: { providers } }), /cotas/i);
  }
  assert.equal(readSettings({ ...settingsFixture(), quotas: { providers: [{ id: "openrouter", limit_detail: { remaining_usd: 0, remaining_brl: null } }] } }).quotas?.providers[0].limit_detail?.remaining_usd, 0);
});

test("new credentials use the canonical field, blank preserves credentials and invalid data cannot initialize a draft", () => {
  const data = readSettings(settingsFixture()), draft = providerDraft(data);
  assert.deepEqual(settingsPatch(data, draft, { openrouter: " SENTINEL_FAKE_KEY " }), { providers: { openrouter: { key: "SENTINEL_FAKE_KEY" } } });
  assert.equal(settingsPatch(data, draft, { openrouter: "   " }), null);
  assert.throws(() => readSettings({}), /configurações/i);
  assert.throws(() => readSettings({ provider_settings: { providers: [], auto_fallback: "yes", fallback_chain: [] } }), /configurações/i);
});

test("model choices use provider metadata, include the persisted model and never invent catalog entries", () => {
  const data = readSettings(settingsFixture());
  const provider = { ...data.provider_settings.providers[0], model: "custom-persisted", models: ["catalog-model", "catalog-model"] };
  assert.deepEqual(modelOptions(provider), ["custom-persisted", "catalog-model"]);
  assert.deepEqual(modelOptions(undefined), []);
});

test("refresh rebases untouched preferences but preserves edited models, enabled flags, chain and fallback", () => {
  const before = readSettings(settingsFixture()), draft = providerDraft(before);
  draft.providers.openrouter.model = "custom-draft";
  draft.providers.devin.enabled = true;
  draft.chain.reverse();
  draft.autoFallback = true;
  const fresh = readSettings(settingsFixture());
  fresh.provider_settings.providers[0].model = "remote-codex";
  fresh.provider_settings.providers[1].enabled = true;
  const rebased = reconcileProviderDraft(before, draft, fresh);
  assert.equal(rebased.providers.codex.model, "remote-codex");
  assert.equal(rebased.providers.openrouter.enabled, true);
  assert.equal(rebased.providers.openrouter.model, "custom-draft");
  assert.equal(rebased.providers.devin.enabled, true);
  assert.equal(rebased.autoFallback, true);
  assert.deepEqual(rebased.chain, draft.chain);
  assert.equal(draft.providers.codex.model, "gpt-6-luna");
  assert.deepEqual(settingsPatch(fresh, rebased, {}), { fallback_chain: draft.chain, auto_fallback: true, providers: { openrouter: { model: "custom-draft" }, devin: { enabled: true } } });
});

test("drafts cannot submit unknown providers, duplicate fallback entries or malformed models", () => {
  const data = readSettings(settingsFixture());
  const duplicate = providerDraft(data); duplicate.chain.push("codex");
  assert.throws(() => settingsPatch(data, duplicate, {}), /fallback/i);
  const unknown = providerDraft(data); unknown.chain.push("unknown");
  assert.throws(() => settingsPatch(data, unknown, {}), /fallback/i);
  const blank = providerDraft(data); blank.providers.codex.model = "  ";
  assert.throws(() => settingsPatch(data, blank, {}), /modelo/i);
  const unexpected = providerDraft(data); unexpected.providers.unknown = { model: "x", enabled: true };
  assert.throws(() => settingsPatch(data, unexpected, {}), /provedor/i);
});

test("balances distinguish unknown values, explicit zero and missing conversion", () => {
  assert.equal(quotaBalance(undefined), "Saldo não verificado");
  assert.equal(quotaBalance({ id: "openrouter", limit_detail: { remaining_usd: null, remaining_brl: null } }), "Saldo não verificado");
  assert.equal(quotaBalance({ id: "openrouter", limit_detail: { remaining_usd: 0, remaining_brl: null } }), "$0.00 USD (conversão BRL não verificada)");
  assert.equal(quotaBalance({ id: "openrouter", limit_detail: { remaining_usd: 0.5, remaining_brl: 2.5 } }), "$0.50 USD (R$ 2.50)");
  assert.equal(quotaBalance({ id: "openrouter", limit_detail: { remaining_usd: null, remaining_brl: 2.5 } }), "R$ 2.50 (saldo USD não verificado)");
});

test("credential presence and installation never become verified authentication or eligibility", () => {
  const data = readSettings(settingsFixture());
  data.provider_settings.providers.find(provider => provider.id === "antigravity")!.key_source = "private_store";
  data.antigravity_auth = { status: "authenticated", installed: true, verification: { credential_configured: true, authenticated: null } };
  assert.equal(providerStatus(data, "antigravity").label, "Credencial configurada");
  const facts = providerFacts(data, "antigravity");
  assert.equal(facts.credential, "Configurada (armazenamento privado)");
  assert.equal(facts.installation, "Detectada");
  assert.equal(facts.authentication, "Não verificada");
  assert.equal(facts.eligibility, "Não verificada");
  data.codex_auth = { status: "chatgpt" };
  assert.equal(providerStatus(data, "codex").label, "CLI autenticado");
  assert.equal(providerFacts(data, "codex").eligibility, "Não verificada");
});

test("observed false authentication remains explicit even when a credential exists", () => {
  const data = readSettings(settingsFixture());
  data.devin_auth = { status: "credential_configured", installed: true, verification: { credential_configured: true, cli_authenticated: false, checked_at: "2026-10-05T12:00:00Z", source: "devin_cli_auth_status" } };
  const facts = providerFacts(data, "devin");
  assert.equal(facts.authentication, "CLI não autenticado");
  assert.equal(facts.credential, "Configurada");
  assert.equal(facts.source, "devin_cli_auth_status");
  assert.equal(facts.checkedAt, "2026-10-05T12:00:00Z");
});

test("local policy dates are separate from observed subscription expiry", () => {
  const data = readSettings(settingsFixture());
  data.devin_auth = { status: "expired", plan_active_until: "2999-01-01T00:00:00Z", plan_active_until_source: "local_policy", days_remaining: 9999, verification: { subscription_expires_at: null } };
  assert.equal(subscriptionStatus(data, "devin", Date.parse("2026-10-05T12:00:00Z")).label, "Validade não verificada");
  assert.equal(subscriptionStatus(data, "devin").policy, "2999-01-01T00:00:00Z");
  data.devin_auth.verification!.subscription_expires_at = "2026-10-07T12:00:00Z";
  assert.equal(subscriptionStatus(data, "devin", Date.parse("2026-10-05T12:00:00Z")).label, "2 dias restantes");
  data.devin_auth.verification!.subscription_expires_at = "not-a-date";
  assert.equal(subscriptionStatus(data, "devin").label, "Validade não verificada");
});

test("invalid optional evidence, legacy quotas and ambiguous fallback fail closed", () => {
  const fixture = settingsFixture();
  for (const extra of [
    { antigravity_auth: { status: "authenticated", verification: { authenticated: "yes" } } },
    { codex_auth: { status: "chatgpt", login: { status: 5 } } },
    { quotas: { openrouter: { remaining_usd: 1 } } },
    { quotas: { providers: [{ id: "openrouter", eligible_for_execution: "yes" }] } },
    { quotas: { providers: [], currency: { usd_brl: "5" } } },
    { quotas: { providers: [], currency: { fetched_at: 5 } } },
    { quotas: { providers: [{ id: "openrouter", limit_detail: { source: 5 } }] } },
    { provider_settings: { ...fixture.provider_settings, providers: fixture.provider_settings.providers.map(provider => ({ ...provider, model: " " })) } },
  ]) assert.throws(() => readSettings({ ...fixture, ...extra }), /incompatível/i);
  assert.throws(() => readSettings({ ...fixture, provider_settings: { ...fixture.provider_settings, fallback_chain: ["codex", "codex"] } }), /configurações/i);
});

test("rendered Settings starts fail-closed without invented catalog models or active accounts", () => {
  const html = renderToStaticMarkup(createElement(SettingsView, { workspace: "C:/fixture" }));
  assert.match(html, /Escopo global desta instalação/);
  assert.doesNotMatch(html, /gpt-6\.1-sol|gemini-3\.8-flash|claude-3\.7-sonnet|Assinatura Conectada/);
  assert.match(html, /disabled=""[^>]*>[\s\S]*Salvar Todas as Configurações/);
});

test("rendered provider evidence exposes separate semantic terms and provenance", () => {
  const data = readSettings(settingsFixture());
  data.devin_auth = { status: "credential_configured", installed: true, verification: { credential_configured: true, cli_authenticated: false, source: "devin_cli_auth_status", checked_at: "2026-10-05T12:00:00Z" } };
  const html = renderToStaticMarkup(createElement(SettingsProviderFacts, { data, id: "devin" }));
  assert.match(html, /role="group" aria-label="Evidências de Devin"/);
  for (const term of ["Credencial", "Instalação", "Autenticação", "Elegibilidade"]) assert.match(html, new RegExp(`<dt>${term}</dt>`));
  assert.match(html, /CLI não autenticado/);
  assert.match(html, /devin_cli_auth_status/);
  assert.match(html, /<time dateTime="2026-10-05T12:00:00Z">/);
});
