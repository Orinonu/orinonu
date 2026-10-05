export type ProviderInfo = {
  id: string; name: string; enabled: boolean; model: string; models: string[];
  category?: string; configured?: boolean; key_source?: string;
  expires_at?: string | null; expires_at_source?: string;
};
export type ProviderAuth = {
  status: string; installed?: boolean; model?: string; models?: string[]; detail?: string;
  cli_authenticated?: boolean | null;
  verification?: {
    credential_configured?: boolean; cli_authenticated?: boolean | null; authenticated?: boolean | null;
    subscription_expires_at?: string | null; checked_at?: string | null; source?: string;
    credential_source?: string; authentication_source?: string; subscription_source?: string;
  };
  plan_active_until?: string | null; plan_active_until_source?: string; days_remaining?: number | null;
  login?: { status?: string; verification_url?: string; user_code?: string };
};
export type ProviderQuota = {
  id: string; status?: string; status_label?: string; eligible_for_execution?: boolean;
  last_checked?: string | null; cooldown_until?: string | null;
  limit_detail?: { remaining_usd?: number | null; remaining_brl?: number | null; limit_usd?: number | null; used_usd?: number | null; limit_brl?: number | null; used_brl?: number | null; source?: string; observed_at?: string | null } | null;
};
export type SettingsData = {
  typesafe?: { configured: boolean; model: string; models: { id: string; label: string }[]; storage?: string; storage_error?: string | null };
  codex_auth?: ProviderAuth; antigravity_auth?: ProviderAuth; devin_auth?: ProviderAuth;
  provider_settings: { providers: ProviderInfo[]; fallback_chain: string[]; auto_fallback: boolean; storage?: string; storage_error?: string | null };
  quotas?: { providers: ProviderQuota[]; current_time?: string; currency?: { usd_brl?: number | null; source?: string; observed_at?: string | null; fetched_at?: string | null; status?: string } };
};
export type ProviderDraft = { providers: Record<string, { enabled: boolean; model: string }>; chain: string[]; autoFallback: boolean };
export type SettingsPatch = { providers?: Record<string, { enabled?: boolean; model?: string; key?: string }>; fallback_chain?: string[]; auto_fallback?: boolean };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const nullableText = (value: unknown) => value === null || text(value);
const nullableBool = (value: unknown) => value === null || bool(value);
const money = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
const optional = (value: Record<string, unknown>, keys: string[], valid: (field: unknown) => boolean) => keys.every(key => value[key] === undefined || valid(value[key]));
const unique = (values: string[]) => new Set(values).size === values.length;

function isProvider(value: unknown): value is ProviderInfo {
  return record(value) && text(value.id) && !!value.id.trim() && text(value.name) && bool(value.enabled) && text(value.model) && !!value.model.trim() && strings(value.models)
    && optional(value, ["category", "key_source", "expires_at_source"], text)
    && optional(value, ["configured"], bool) && optional(value, ["expires_at"], nullableText);
}
function isAuth(value: unknown): value is ProviderAuth {
  if (!record(value) || !text(value.status) || !optional(value, ["installed"], bool) || !optional(value, ["model", "detail", "plan_active_until_source"], text)
    || !optional(value, ["models"], strings) || !optional(value, ["cli_authenticated"], nullableBool)
    || !optional(value, ["plan_active_until"], nullableText) || !optional(value, ["days_remaining"], money)) return false;
  if (value.verification !== undefined) {
    const verification = value.verification;
    if (!record(verification) || !optional(verification, ["credential_configured"], bool)
      || !optional(verification, ["cli_authenticated", "authenticated"], nullableBool)
      || !optional(verification, ["subscription_expires_at", "checked_at"], nullableText)
      || !optional(verification, ["source", "credential_source", "authentication_source", "subscription_source"], text)) return false;
  }
  return value.login === undefined || (record(value.login) && optional(value.login, ["status", "verification_url", "user_code"], text));
}
function isQuota(value: unknown): value is ProviderQuota {
  if (!record(value) || !text(value.id) || !value.id.trim() || !optional(value, ["status", "status_label"], text)
    || !optional(value, ["eligible_for_execution"], bool) || !optional(value, ["last_checked", "cooldown_until"], nullableText)) return false;
  return value.limit_detail === undefined || value.limit_detail === null || (record(value.limit_detail)
    && optional(value.limit_detail, ["remaining_usd", "remaining_brl", "limit_usd", "used_usd", "limit_brl", "used_brl"], money)
    && optional(value.limit_detail, ["source"], text) && optional(value.limit_detail, ["observed_at"], nullableText));
}
function assertSettings(value: unknown): asserts value is SettingsData {
  if (!record(value) || !record(value.provider_settings)) throw Error("Resposta de configurações incompatível com esta interface.");
  const data = value.provider_settings;
  if (!Array.isArray(data.providers) || !data.providers.every(isProvider) || !strings(data.fallback_chain) || !bool(data.auto_fallback)
    || !optional(data, ["storage"], text) || !optional(data, ["storage_error"], nullableText)) throw Error("Resposta de configurações incompatível com esta interface.");
  const ids = data.providers.map(provider => provider.id);
  if (!unique(ids) || !unique(data.fallback_chain) || data.fallback_chain.some(id => !ids.includes(id))) throw Error("Resposta de configurações incompatível com esta interface.");
  for (const key of ["codex_auth", "antigravity_auth", "devin_auth"]) if (value[key] !== undefined && !isAuth(value[key])) throw Error("Resposta de autenticação incompatível com esta interface.");
  if (value.typesafe !== undefined) {
    const config = value.typesafe;
    if (!record(config) || !bool(config.configured) || !text(config.model) || !Array.isArray(config.models)
      || !config.models.every(model => record(model) && text(model.id) && text(model.label))
      || !optional(config, ["storage"], text) || !optional(config, ["storage_error"], nullableText)) throw Error("Resposta de configurações incompatível com esta interface.");
  }
  if (value.quotas !== undefined) {
    const quotas = value.quotas;
    if (!record(quotas) || !Array.isArray(quotas.providers) || !quotas.providers.every(isQuota) || !optional(quotas, ["current_time"], text)) throw Error("Resposta de cotas incompatível com esta interface.");
    if (!unique(quotas.providers.map(provider => provider.id))) throw Error("Resposta de cotas ambígua nesta interface.");
    if (quotas.currency !== undefined && (!record(quotas.currency) || !optional(quotas.currency, ["usd_brl"], money)
      || !optional(quotas.currency, ["source", "status"], text) || !optional(quotas.currency, ["observed_at", "fetched_at"], nullableText))) throw Error("Resposta de cotas incompatível com esta interface.");
  }
}
export function readSettings(value: unknown): SettingsData {
  assertSettings(value);
  return value;
}
export function readProviderAuth(value: unknown): ProviderAuth {
  if (!isAuth(value)) throw Error("Resposta de autenticação incompatível com esta interface.");
  return value;
}
export function providerDraft(data: SettingsData): ProviderDraft {
  return { providers: Object.fromEntries(data.provider_settings.providers.map(provider => [provider.id, { enabled: provider.enabled, model: provider.model }])), chain: [...data.provider_settings.fallback_chain], autoFallback: data.provider_settings.auto_fallback };
}
export function reconcileProviderDraft(before: SettingsData | null, draft: ProviderDraft | null, fresh: SettingsData): ProviderDraft {
  const next = providerDraft(fresh);
  if (!before || !draft) return next;
  for (const provider of before.provider_settings.providers) {
    const edited = draft.providers[provider.id], target = next.providers[provider.id];
    if (!edited || !target) continue;
    if (edited.enabled !== provider.enabled) target.enabled = edited.enabled;
    if (edited.model !== provider.model) target.model = edited.model;
  }
  if (draft.autoFallback !== before.provider_settings.auto_fallback) next.autoFallback = draft.autoFallback;
  if (JSON.stringify(draft.chain) !== JSON.stringify(before.provider_settings.fallback_chain)) {
    const known = new Set(fresh.provider_settings.providers.map(provider => provider.id));
    next.chain = draft.chain.filter(id => known.has(id));
    for (const id of fresh.provider_settings.fallback_chain) if (!next.chain.includes(id)) next.chain.push(id);
  }
  return next;
}
export function settingsPatch(data: SettingsData, draft: ProviderDraft, keys: Record<string, string>): SettingsPatch | null {
  const ids = data.provider_settings.providers.map(provider => provider.id);
  if (!unique(draft.chain) || draft.chain.some(id => !ids.includes(id))) throw Error("Cadeia de fallback inválida.");
  if (Object.keys(draft.providers).some(id => !ids.includes(id))) throw Error("Preferências de provedor desconhecido.");
  const patch: SettingsPatch = {}, providers: NonNullable<SettingsPatch["providers"]> = {};
  if (JSON.stringify(draft.chain) !== JSON.stringify(data.provider_settings.fallback_chain)) patch.fallback_chain = [...draft.chain];
  if (draft.autoFallback !== data.provider_settings.auto_fallback) patch.auto_fallback = draft.autoFallback;
  for (const provider of data.provider_settings.providers) {
    const value = draft.providers[provider.id];
    if (!value || typeof value.enabled !== "boolean") throw Error("Preferências de provedor não carregadas.");
    if (!value.model.trim()) throw Error("Modelo de provedor inválido.");
    const changes: { enabled?: boolean; model?: string; key?: string } = {};
    if (value.enabled !== provider.enabled) changes.enabled = value.enabled;
    if (value.model !== provider.model) changes.model = value.model;
    if (keys[provider.id]?.trim()) changes.key = keys[provider.id].trim();
    if (Object.keys(changes).length) providers[provider.id] = changes;
  }
  if (Object.keys(providers).length) patch.providers = providers;
  return Object.keys(patch).length ? patch : null;
}
export function modelOptions(provider: ProviderInfo | undefined): string[] {
  return provider ? [...new Set([provider.model, ...provider.models].filter(model => model.trim()))] : [];
}
export function quotaBalance(quota: ProviderQuota | undefined): string {
  const usd = quota?.limit_detail?.remaining_usd, brl = quota?.limit_detail?.remaining_brl;
  const hasUsd = typeof usd === "number" && Number.isFinite(usd), hasBrl = typeof brl === "number" && Number.isFinite(brl);
  if (!hasUsd) return hasBrl ? `R$ ${brl.toFixed(2)} (saldo USD não verificado)` : "Saldo não verificado";
  return `$${usd.toFixed(2)} USD ${hasBrl ? `(R$ ${brl.toFixed(2)})` : "(conversão BRL não verificada)"}`;
}
const providerAuth = (data: SettingsData, id: string) => id === "codex" ? data.codex_auth : id === "devin" ? data.devin_auth : id === "antigravity" ? data.antigravity_auth : undefined;
export function providerFacts(data: SettingsData, id: string) {
  const provider = data.provider_settings.providers.find(provider => provider.id === id), auth = providerAuth(data, id);
  const verification = auth?.verification;
  const cli = verification?.cli_authenticated ?? auth?.cli_authenticated ?? (id === "codex" && auth?.status === "chatgpt" ? true : null);
  const source = provider?.key_source;
  const credential = verification?.credential_configured === true || (!!source && source !== "none");
  const quota = data.quotas?.providers.find(provider => provider.id === id);
  return {
    credential: credential ? source === "private_store" ? "Configurada (armazenamento privado)" : source === "environment" ? "Configurada (ambiente)" : "Configurada" : source === "none" || verification?.credential_configured === false ? "Não configurada" : "Não verificada",
    installation: auth?.installed === true ? "Detectada" : auth?.installed === false ? "Não detectada" : "Não verificada",
    authentication: cli === true ? "CLI autenticado" : cli === false ? "CLI não autenticado" : verification?.authenticated === true ? "Verificada" : verification?.authenticated === false ? "Não autenticado" : "Não verificada",
    eligibility: quota?.eligible_for_execution === true ? "Elegível segundo o servidor; autorização continua necessária" : quota?.eligible_for_execution === false ? "Não elegível segundo o servidor" : "Não verificada",
    source: verification?.authentication_source ?? verification?.source,
    checkedAt: verification?.checked_at,
    quotaStatus: quota?.status_label ?? quota?.status,
    quotaCheckedAt: quota?.limit_detail?.observed_at ?? quota?.last_checked,
    quotaSource: quota?.limit_detail?.source,
  };
}
export function subscriptionStatus(data: SettingsData, id: string, now = Date.now()) {
  const auth = providerAuth(data, id), provider = data.provider_settings.providers.find(provider => provider.id === id);
  const observed = auth?.verification?.subscription_expires_at;
  const expiry = observed ? Date.parse(observed) : NaN;
  const days = Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 86400000)) : undefined;
  const policy = auth?.plan_active_until_source === "local_policy" ? auth.plan_active_until : provider?.expires_at_source === "local_policy" ? provider.expires_at : null;
  return { label: days === undefined ? "Validade não verificada" : days > 0 ? `${days} dias restantes` : "Expirado", expiry: Number.isFinite(expiry) ? observed : null, days, policy: policy && Number.isFinite(Date.parse(policy)) ? policy : null, source: auth?.verification?.subscription_source };
}
export function providerStatus(data: SettingsData, id: string): { label: string; detail: string } {
  const facts = providerFacts(data, id);
  if (facts.authentication === "CLI autenticado") return { label: "CLI autenticado", detail: "Autenticação reportada pelo CLI. Elegibilidade e autorização continuam separadas; modelo e esforço efetivos seguem o perfil de cada etapa." };
  if (facts.authentication === "Verificada") return { label: "Autenticação verificada", detail: "O servidor reportou uma verificação de autenticação. Elegibilidade e autorização continuam separadas." };
  if (facts.credential.startsWith("Configurada")) return { label: "Credencial configurada", detail: "Credencial presente na instalação. Presença não comprova autenticação nem assinatura ativa." };
  if (facts.installation === "Detectada") return { label: "Instalação detectada", detail: "Cliente detectado. Autenticação e condições de execução ainda precisam ser verificadas." };
  return { label: "Não verificado", detail: "Não há evidência suficiente de autenticação nesta instalação." };
}
