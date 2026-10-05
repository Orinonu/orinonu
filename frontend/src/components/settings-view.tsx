"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  Sparkles,
  Cpu,
  Calendar,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { CodexDeviceChallenge } from "@/components/codex-device-challenge";
import { NotificationCenter, type Notice } from "@/components/notification-center";
import { readSettings, readProviderAuth, settingsPatch, reconcileProviderDraft, modelOptions, providerFacts, providerStatus, quotaBalance, subscriptionStatus, type SettingsData, type ProviderDraft } from "@/lib/settings";

export function SettingsProviderFacts({ data, id }: { data: SettingsData; id: string }) {
  const facts = providerFacts(data, id);
  const name = data.provider_settings.providers.find(provider => provider.id === id)?.name ?? id;
  return <div className="settings-provider-facts" role="group" aria-label={`Evidências de ${name}`}>
    <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", margin: "8px 0", fontSize: 12, overflowWrap: "anywhere" }}>
      <dt>Credencial</dt><dd style={{ margin: 0 }}>{facts.credential}</dd>
      <dt>Instalação</dt><dd style={{ margin: 0 }}>{facts.installation}</dd>
      <dt>Autenticação</dt><dd style={{ margin: 0 }}>{facts.authentication}</dd>
      <dt>Elegibilidade</dt><dd style={{ margin: 0 }}>{facts.eligibility}</dd>
      {facts.source && <><dt>Fonte da verificação</dt><dd style={{ margin: 0 }}>{facts.source}</dd></>}
      {facts.checkedAt && <><dt>Verificado em</dt><dd style={{ margin: 0 }}><time dateTime={facts.checkedAt}>{facts.checkedAt}</time></dd></>}
      {facts.quotaStatus && <><dt>Cota reportada</dt><dd style={{ margin: 0 }}>{facts.quotaStatus}</dd></>}
      {facts.quotaSource && <><dt>Fonte da cota</dt><dd style={{ margin: 0 }}>{facts.quotaSource}</dd></>}
      {facts.quotaCheckedAt && <><dt>Cota consultada em</dt><dd style={{ margin: 0 }}><time dateTime={facts.quotaCheckedAt}>{facts.quotaCheckedAt}</time></dd></>}
    </dl>
  </div>;
}

export function SettingsView({ workspace }: { workspace: string }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeIdRef = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const aliveRef = useRef(false);
  const requestRef = useRef(0);
  const loadRef = useRef<{ sequence: number; promise: Promise<boolean> } | null>(null);
  const dataRef = useRef<SettingsData | null>(null);
  const draftRef = useRef<ProviderDraft | null>(null);

  // Form states
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const chain = draft?.chain ?? [];
  const autoFallback = draft?.autoFallback ?? false;
  const editDraft = (edit: (current: ProviderDraft) => ProviderDraft) => {
    if (!draftRef.current || busyRef.current?.startsWith("save")) return;
    const next = edit(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  };
  const setModel = (id: string, model: string) => editDraft(current => ({ ...current, providers: { ...current.providers, [id]: { ...current.providers[id], model } } }));
  const setKey = (id: string, key: string) => setKeys(current => ({ ...current, [id]: key }));
  const setChain = (chain: string[]) => editDraft(current => ({ ...current, chain }));
  const setAutoFallback = (autoFallback: boolean) => editDraft(current => ({ ...current, autoFallback }));

  // Antigravity inputs
  const antigravityModel = draft?.providers.antigravity?.model ?? "";
  const antigravityKey = keys.antigravity ?? "";
  const setAntigravityModel = (model: string) => setModel("antigravity", model);
  const setAntigravityKey = (key: string) => setKey("antigravity", key);

  // Devin inputs
  const devinModel = draft?.providers.devin?.model ?? "";
  const devinKey = keys.devin ?? "";
  const setDevinModel = (model: string) => setModel("devin", model);
  const setDevinKey = (key: string) => setKey("devin", key);

  // OpenRouter inputs
  const openrouterModel = draft?.providers.openrouter?.model ?? "";
  const openrouterKey = keys.openrouter ?? "";
  const setOpenrouterModel = (model: string) => setModel("openrouter", model);
  const setOpenrouterKey = (key: string) => setKey("openrouter", key);

  // Anthropic inputs
  const anthropicModel = draft?.providers.anthropic?.model ?? "";
  const anthropicKey = keys.anthropic ?? "";
  const setAnthropicModel = (model: string) => setModel("anthropic", model);
  const setAnthropicKey = (key: string) => setKey("anthropic", key);

  const acceptSettings = useCallback((fresh: SettingsData, before = dataRef.current) => {
    if (!aliveRef.current) return;
    const next = reconcileProviderDraft(before, draftRef.current, fresh);
    dataRef.current = fresh;
    draftRef.current = next;
    setData(fresh);
    setDraft(next);
    setLoadError("");
  }, []);
  const loadSettings = useCallback((): Promise<boolean> => {
    if (!aliveRef.current) return Promise.resolve(false);
    if (loadRef.current?.sequence === requestRef.current) return loadRef.current.promise;
    const sequence = ++requestRef.current;
    setLoading(true);
    const promise = (async () => {
      try {
        const res = readSettings(await api<unknown>("/api/settings"));
        if (!aliveRef.current || sequence !== requestRef.current) return false;
        acceptSettings(res);
        return true;
      } catch {
        if (aliveRef.current && sequence === requestRef.current) setLoadError("Não foi possível carregar configurações válidas. Tente novamente antes de salvar.");
        return false;
      } finally {
        if (aliveRef.current && sequence === requestRef.current) setLoading(false);
        if (loadRef.current?.sequence === sequence) loadRef.current = null;
      }
    })();
    loadRef.current = { sequence, promise };
    return promise;
  }, [acceptSettings]);

  useEffect(() => {
    aliveRef.current = true;
    void loadSettings();
    return () => { aliveRef.current = false; requestRef.current++; };
  }, [loadSettings]);

  const codexLoginStatus = data?.codex_auth?.login?.status;
  useEffect(() => {
    if (!codexLoginStatus || !["checking", "starting", "awaiting_user"].includes(codexLoginStatus)) return;
    const timer = setInterval(() => { if (!busyRef.current) void loadSettings(); }, 2000);
    return () => clearInterval(timer);
  }, [codexLoginStatus, loadSettings]);

  const dismissNotice = useCallback((id: string) => setNotices(current => current.filter(notice => notice.id !== id)), []);
  const showNotice = (message: string, tone: Notice["tone"] = "info") => {
    if (!aliveRef.current) return;
    const id = `settings-${++noticeIdRef.current}`;
    setNotices(current => [...current, { id, title: tone === "error" ? "Erro em Configurações" : "Configurações", message, tone }]);
  };
  const runMutation = async (id: string, operation: () => Promise<void>, error: string) => {
    if (busyRef.current || !aliveRef.current) return;
    busyRef.current = id;
    setBusy(id);
    requestRef.current++;
    setLoading(false);
    try { await operation(); }
    catch { showNotice(error, "error"); }
    finally {
      busyRef.current = null;
      if (aliveRef.current) setBusy(null);
    }
  };

  const handleRefreshQuotas = () => runMutation("refresh", async () => {
    await api("/api/quotas/refresh", "POST", {});
    if (!aliveRef.current) return;
    if (await loadSettings()) showNotice("Consulta de cotas concluída. Saldos e conexões exibem apenas os dados reportados pelo servidor.");
  }, "Erro ao atualizar cotas remotas. Seu rascunho foi preservado.");

  // Antigravity actions
  const verifyAntigravity = () => runMutation("antigravity", async () => {
    const auth = readProviderAuth(await api<unknown>("/api/antigravity/auth/refresh", "POST", {}));
    if (dataRef.current) acceptSettings({ ...dataRef.current, antigravity_auth: auth });
    showNotice("Consulta Google concluída. Presença de chave ou instalação não comprova autenticação.");
  }, "Falha ao verificar conexão com Google Antigravity.");

  const connectAntigravity = () => persistSettings("antigravity");

  // Devin actions
  const verifyDevin = () => runMutation("devin", async () => {
    const auth = readProviderAuth(await api<unknown>("/api/devin/auth/refresh", "POST", {}));
    if (dataRef.current) acceptSettings({ ...dataRef.current, devin_auth: auth });
    showNotice("Consulta Devin concluída. Login do CLI e validade da assinatura são evidências separadas.");
  }, "Falha ao verificar conexão com Devin / Windsurf.");

  const connectDevin = () => persistSettings("devin");

  // Codex actions
  const verifyCodex = () => runMutation("codex", async () => {
    const auth = readProviderAuth(await api<unknown>("/api/codex/auth/refresh", "POST", {}));
    if (dataRef.current) acceptSettings({ ...dataRef.current, codex_auth: auth });
    showNotice("Consulta do Codex CLI concluída. A verificação não inicia execução nem comprova validade da assinatura.");
  }, "Falha ao verificar Codex.");

  const connectCodex = () => runMutation("codex-login", async () => {
    const auth = readProviderAuth(await api<unknown>("/api/codex/auth/connect", "POST", {}));
    if (dataRef.current) acceptSettings({ ...dataRef.current, codex_auth: auth });
    showNotice("Solicitação de login enviada. Consulte o estado, o código e o link oficial exibidos no painel.");
  }, "Falha ao iniciar autenticação Codex.");

  const cancelCodex = () => runMutation("codex-cancel", async () => {
    const auth = readProviderAuth(await api<unknown>("/api/codex/auth/cancel", "POST", {}));
    if (dataRef.current) acceptSettings({ ...dataRef.current, codex_auth: auth });
    showNotice("Solicitação de cancelamento do login Codex concluída.");
  }, "Não foi possível cancelar o login Codex.");

  // Chain ordering
  const moveUp = (index: number) => {
    if (index <= 0) return;
    const next = [...chain];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    setChain(next);
  };

  const moveDown = (index: number) => {
    if (index >= chain.length - 1) return;
    const next = [...chain];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    setChain(next);
  };

  const persistSettings = (id?: string) => runMutation(id ? `save-${id}` : "save", async () => {
    const current = dataRef.current, edited = draftRef.current;
    if (!current || !edited || loadError || loading) return;
    const all = settingsPatch(current, edited, keys);
    const patch = id ? all?.providers?.[id] ? { providers: { [id]: all.providers[id] } } : null : all;
    if (!patch) return;
    const acknowledged: SettingsData = { ...current, provider_settings: {
      ...current.provider_settings,
      fallback_chain: patch.fallback_chain ?? current.provider_settings.fallback_chain,
      auto_fallback: patch.auto_fallback ?? current.provider_settings.auto_fallback,
      providers: current.provider_settings.providers.map(provider => ({ ...provider,
        enabled: patch.providers?.[provider.id]?.enabled ?? provider.enabled,
        model: patch.providers?.[provider.id]?.model ?? provider.model,
      })),
    } };
    const fresh = readSettings(await api<unknown>("/api/settings", "PATCH", patch));
    if (!aliveRef.current) return;
    acceptSettings(fresh, acknowledged);
    setKeys(latest => {
      const next = { ...latest };
      for (const providerId of Object.keys(patch.providers ?? {})) if (patch.providers?.[providerId].key && latest[providerId] === keys[providerId]) next[providerId] = "";
      return next;
    });
    showNotice("Preferências persistidas nesta instalação. Salvar credenciais não comprova autenticação, assinatura ou autorização de execução.");
  }, "Erro ao salvar configurações. Seu rascunho e suas credenciais não persistidas foram preservados.");
  const saveAllSettings = () => persistSettings();
  const providerNames = Object.fromEntries(data?.provider_settings.providers.map(provider => [provider.id, provider.name]) ?? []);
  const pendingPatch = data && draft && !loadError ? settingsPatch(data, draft, keys) : null;
  const settingsDirty = pendingPatch !== null;
  const fieldsDisabled = !data || !!loadError || !!busy?.startsWith("save");
  const actionDisabled = loading || !!busy || !data || !!loadError;
  const options = (id: string) => {
    const provider = data?.provider_settings.providers.find(provider => provider.id === id);
    const values = modelOptions(provider);
    const current = draft?.providers[id]?.model;
    if (current && !values.includes(current)) values.unshift(current);
    return values.map(model => <option value={model} key={model}>{model}</option>);
  };
  const status = (id: string) => data ? providerStatus(data, id) : { label: "Não verificado", detail: "Aguardando dados válidos da instalação." };
  const controls = (id: string) => {
    const provider = data?.provider_settings.providers.find(provider => provider.id === id);
    if (!provider) return null;
    return <>
      <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13 }}>
        <input type="checkbox" checked={draft?.providers[id]?.enabled ?? false} disabled={fieldsDisabled}
          onChange={event => editDraft(current => ({ ...current, providers: { ...current.providers, [id]: { ...current.providers[id], enabled: event.target.checked } } }))} />
        Habilitar {provider.name} nesta instalação
      </label>
      <small style={{ color: "var(--muted)" }}>Habilitação é preferência global, não autenticação ou autorização.</small>
      {data && <SettingsProviderFacts data={data} id={id} />}
    </>;
  };
  const openrouterQuota = data?.quotas?.providers.find(provider => provider.id === "openrouter");
  const balance = quotaBalance(openrouterQuota);
  const devinSubscription = data ? subscriptionStatus(data, "devin", Date.parse(data.quotas?.current_time ?? "") || Date.now()) : { label: "Validade não verificada", expiry: null, days: undefined, policy: null, source: undefined };

  return (
    <div className="settings-page" style={{ width: "100%", minWidth: 0, maxWidth: 1050, margin: "0 auto", paddingBottom: 40 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 6px" }}>
            Provedores e preferências da instalação
          </h2>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>
            Configure suas credenciais privadas. Fallback exige executor implementado, autenticação verificada e autorização; instalação ou chave presente não comprova execução disponível.
          </p>
          <p className="settings-scope-notice" style={{ color: "var(--muted)", margin: "8px 0 0", fontSize: 13, overflowWrap: "anywhere" }}>
            Escopo global desta instalação: provedores, credenciais e fallback valem para todos os projetos, não apenas {workspace || "o projeto selecionado"}. Salvar aqui não promove configurações para outra instalação.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshQuotas}
          disabled={loading || !!busy}
          style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 44, height: "auto", maxWidth: "100%", whiteSpace: "normal" }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar Cotas & Conexões
        </Button>
      </div>

      {loadError && <div className="resource-error" role="alert"><p>{loadError}</p><Button type="button" variant="outline" disabled={loading || !!busy} onClick={() => void loadSettings()}>Tentar novamente</Button></div>}
      {!data && loading && <p role="status">Carregando configurações da instalação…</p>}
      {data?.provider_settings.storage_error && <div className="resource-error" role="alert">Armazenamento privado indisponível. Revise a instalação antes de persistir credenciais.</div>}
      <NotificationCenter notices={notices} onDismiss={dismissNotice} />

      {/* Grid de Contas de Assinatura Principais */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 20, marginBottom: 24 }}>
        
        {/* CARD 1: GOOGLE ANTIGRAVITY / GEMINI */}
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, borderColor: "var(--border-strong)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={18} style={{ color: "var(--neural-cyan)" }} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Google Antigravity</h3>
              </div>
              <small style={{ color: "var(--muted)" }}>Modelos Gemini & Google Ecosystem</small>
            </div>
            <Badge variant="secondary">{status("antigravity").label}</Badge>
          </div>

          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--surface-input)", fontSize: 12 }}>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {status("antigravity").detail}
            </p>
          </div>

          {controls("antigravity")}
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
              Modelo Gemini para Execução & Fallback:
              <select
                aria-label="Modelo Gemini para Execução & Fallback:"
                disabled={fieldsDisabled}
                value={antigravityModel}
                onChange={(e) => { setAntigravityModel(e.target.value); }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  minHeight: 44,
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--surface-input)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                {options("antigravity")}
              </select>
            </label>

            <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
              Google API Key / Token Antigravity:
              <Input
                disabled={fieldsDisabled}
                type="password"
                aria-label="Google API Key / Token Antigravity:"
                value={antigravityKey}
                onChange={(e) => { setAntigravityKey(e.target.value); }}
                placeholder="Cole a chave para atualizar ou deixe vazio"
                autoComplete="new-password"
                style={{ marginTop: 4, minHeight: 44 }}
              />
              <small style={{ color: "var(--muted)", display: "block", marginTop: 2, fontSize: 11 }}>
                Protegido pelo Windows DPAPI CurrentUser. Não precisa reinserir se já configurado.
              </small>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8 }}>
            <Button
              variant="outline"
              size="sm"
              onClick={verifyAntigravity}
              disabled={actionDisabled}
              style={{ flex: 1, minWidth: 0, minHeight: 44, height: "auto", whiteSpace: "normal" }}
            >
              Verificar Conexão
            </Button>
            <Button
              size="sm"
              onClick={connectAntigravity}
              disabled={actionDisabled || !pendingPatch?.providers?.antigravity}
              style={{ flex: 1, minWidth: 0, minHeight: 44, height: "auto", whiteSpace: "normal", background: "var(--neural-cyan)", color: "var(--primary-foreground)" }}
            >
              Salvar preferências Google
            </Button>
          </div>
        </Card>

        {/* CARD 2: DEVIN / WINDSURF */}
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, borderColor: "var(--border-strong)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Zap size={18} style={{ color: "var(--celestial-gold)" }} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Devin / Windsurf</h3>
              </div>
              <small style={{ color: "var(--muted)" }}>Login do CLI e validade da assinatura são verificações separadas.</small>
            </div>
            <Badge variant={devinSubscription.days === undefined ? "secondary" : devinSubscription.days > 0 ? "default" : "destructive"}>
              {devinSubscription.label}
            </Badge>
          </div>

          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--surface-input)", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--celestial-gold)", fontWeight: 500 }}>
              <Calendar size={14} />
              <span>{devinSubscription.expiry ? `Validade observada até ${new Date(devinSubscription.expiry).toLocaleDateString("pt-BR", { timeZone: "UTC" })}.` : "Nenhuma validade da assinatura foi observada."}</span>
            </div>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 11 }}>
              {status("devin").detail}
            </p>
            {devinSubscription.source && <p style={{ margin: "8px 0 0", color: "var(--muted)", overflowWrap: "anywhere" }}>Fonte da validade: {devinSubscription.source}.</p>}
            {devinSubscription.policy && <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>Política local declarada até {new Date(devinSubscription.policy).toLocaleDateString("pt-BR", { timeZone: "UTC" })}; não é validade observada da assinatura.</p>}
          </div>

          {controls("devin")}
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
              Modelo Devin / Windsurf:
              <select
                aria-label="Modelo Devin / Windsurf:"
                disabled={fieldsDisabled}
                value={devinModel}
                onChange={(e) => { setDevinModel(e.target.value); }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  minHeight: 44,
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--surface-input)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                {options("devin")}
              </select>
            </label>

            <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
              Token de Sessão / API Key Devin:
              <Input
                disabled={fieldsDisabled}
                type="password"
                aria-label="Token de Sessão / API Key Devin:"
                value={devinKey}
                onChange={(e) => { setDevinKey(e.target.value); }}
                placeholder="Cole o token para substituir ou deixe vazio"
                autoComplete="new-password"
                style={{ marginTop: 4, minHeight: 44 }}
              />
              <small style={{ color: "var(--muted)", display: "block", marginTop: 2, fontSize: 11 }}>
                Credencial privada fora do git. Não substitui o login verificado do Devin CLI.
              </small>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8 }}>
            <Button
              variant="outline"
              size="sm"
              onClick={verifyDevin}
              disabled={actionDisabled}
              style={{ flex: 1, minWidth: 0, minHeight: 44, height: "auto", whiteSpace: "normal" }}
            >
              Verificar Conexão
            </Button>
            <Button
              size="sm"
              onClick={connectDevin}
              disabled={actionDisabled || !pendingPatch?.providers?.devin}
              style={{ flex: 1, minWidth: 0, minHeight: 44, height: "auto", whiteSpace: "normal", background: "var(--celestial-gold)", color: "var(--primary-foreground)" }}
            >
              Salvar preferências Devin
            </Button>
          </div>
        </Card>

        {/* CARD 3: OPENAI CODEX (CHATGPT SUBSCRIPTION) */}
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Cpu size={18} style={{ color: "var(--neural-cyan)" }} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>OpenAI Codex</h3>
              </div>
              <small style={{ color: "var(--muted)" }}>Assinatura oficial ChatGPT / CLI Local</small>
            </div>
            <Badge variant="secondary">{status("codex").label}</Badge>
          </div>

          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--surface-input)", fontSize: 12 }}>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {status("codex").detail}
            </p>
          </div>

          {controls("codex")}
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
              Modelo Principal do Codex:
              <select aria-label="Modelo Principal do Codex:" value={draft?.providers.codex?.model ?? ""} disabled={fieldsDisabled}
                onChange={event => setModel("codex", event.target.value)}
                style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 6, minHeight: 44, background: "var(--surface-input)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" }}>
                {options("codex")}
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8 }}>
            <Button variant="outline" size="sm" onClick={verifyCodex} disabled={actionDisabled} style={{ flex: 1, minWidth: 0, minHeight: 44, height: "auto", whiteSpace: "normal" }}>
              Verificar Conexão
            </Button>
            <Button size="sm" onClick={connectCodex} disabled={actionDisabled || ["checking", "starting", "awaiting_user"].includes(codexLoginStatus ?? "")} style={{ flex: 1, minWidth: 0, minHeight: 44, height: "auto", whiteSpace: "normal" }}>
              Conectar ChatGPT
            </Button>
          </div>
          <CodexDeviceChallenge login={data?.codex_auth?.login} onCancel={() => void cancelCodex()} />
        </Card>

      </div>

      {/* CARD 4: PROVEDORES ADICIONAIS & SALDO (OPENROUTER / ANTHROPIC) */}
      <Card style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Provedores de API Externa & Saldo em Tempo Real</h3>
            <p style={{ color: "var(--muted)", margin: "4px 0 0", fontSize: 12 }}>
              Conecte modelos disponíveis no seu provedor. As credenciais, cotas, custos e permissões são próprios desta instalação; autonomia não amplia autorização.
            </p>
          </div>
          <Badge variant="outline" style={{ fontSize: 13, borderColor: "var(--neural-cyan)", color: "var(--neural-cyan)", whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {balance === "Saldo não verificado" ? "Saldo OpenRouter não verificado" : `Saldo OpenRouter: ${balance}`}
          </Badge>
          {data?.quotas?.currency?.source && <small style={{ color: "var(--muted)" }}>Conversão reportada: {data.quotas.currency.source} · {data.quotas.currency.observed_at ?? data.quotas.currency.fetched_at ?? "data não verificada"}{data.quotas.currency.status ? ` · ${data.quotas.currency.status}` : ""}.</small>}
          <small style={{ color: "var(--muted)" }}>Saldo reportado não comprova autenticação, disponibilidade de modelo ou autorização para gastos.</small>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 16 }}>
          {/* OpenRouter Form */}
          <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-input)", border: "1px solid var(--border-subtle)" }}>
            <strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>OpenRouter Hub</strong>
            {controls("openrouter")}
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Modelo OpenRouter:
              <select
                aria-label="Modelo OpenRouter:"
                disabled={fieldsDisabled}
                value={openrouterModel}
                onChange={(e) => { setOpenrouterModel(e.target.value); }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  minHeight: 44,
                  marginTop: 4,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "var(--surface-panel)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-strong)",
                  fontSize: 12,
                }}
              >
                {options("openrouter")}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>
              API Key (sk-or-v1-...):
              <Input
                disabled={fieldsDisabled}
                type="password"
                value={openrouterKey}
                onChange={(e) => { setOpenrouterKey(e.target.value); }}
                placeholder="Cole a chave para atualizar"
                autoComplete="new-password"
                style={{ marginTop: 4, fontSize: 12, minHeight: 44 }}
              />
            </label>
          </div>

          {/* Anthropic Form */}
          <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-input)", border: "1px solid var(--border-subtle)" }}>
            <strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>Anthropic Direto</strong>
            {controls("anthropic")}
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Modelo Claude:
              <select
                aria-label="Modelo Claude:"
                disabled={fieldsDisabled}
                value={anthropicModel}
                onChange={(e) => { setAnthropicModel(e.target.value); }}
                style={{
                  width: "100%",
                  minWidth: 0,
                  minHeight: 44,
                  marginTop: 4,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "var(--surface-panel)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-strong)",
                  fontSize: 12,
                }}
              >
                {options("anthropic")}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>
              API Key (sk-ant-...):
              <Input
                disabled={fieldsDisabled}
                type="password"
                value={anthropicKey}
                onChange={(e) => { setAnthropicKey(e.target.value); }}
                placeholder="Cole a chave para atualizar"
                autoComplete="new-password"
                style={{ marginTop: 4, fontSize: 12, minHeight: 44 }}
              />
            </label>
          </div>
        </div>
      </Card>

      {/* CARD 5: CADEIA DE PRIORIDADES & AUTO-FALLBACK */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>Cadeia de Prioridade & Fallback Automático</h3>
        <p style={{ color: "var(--muted)", margin: "0 0 16px", fontSize: 13 }}>
          Ao esgotar a cota, o host considera somente os próximos executores elegíveis. Antigravity, OpenRouter e Anthropic permanecem sem despacho até terem um adaptador verificado.
        </p>

        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", minHeight: 44, marginBottom: 16, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={autoFallback}
            disabled={fieldsDisabled}
            onChange={(e) => { setAutoFallback(e.target.checked); }}
            style={{ width: 16, height: 16 }}
          />
          <span><strong>Habilitar fallback automático nesta instalação</strong> (usa somente executores elegíveis; sem alternativa, preserva a missão na fila)</span>
        </label>

        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {chain.map((providerId, index) => (
            <div
              key={providerId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
                minWidth: 0,
                padding: "10px 14px",
                borderRadius: 8,
                background: "var(--surface-input)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 160px" }}>
                <span style={{ color: "var(--muted)", fontSize: 12, width: 20, flexShrink: 0 }}>#{index + 1}</span>
                <span style={{ fontWeight: 500, fontSize: 14, minWidth: 0, overflowWrap: "anywhere" }}>{providerNames[providerId] || providerId}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fieldsDisabled || index === 0}
                  aria-label={`Mover ${providerNames[providerId] || providerId} para cima`}
                  onClick={() => moveUp(index)}
                  style={{ padding: 10, minWidth: 44, minHeight: 44 }}
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fieldsDisabled || index === chain.length - 1}
                  aria-label={`Mover ${providerNames[providerId] || providerId} para baixo`}
                  onClick={() => moveDown(index)}
                  style={{ padding: 10, minWidth: 44, minHeight: 44 }}
                >
                  <ArrowDown size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={saveAllSettings}
          disabled={actionDisabled || !settingsDirty}
          style={{ width: "100%", minHeight: 44, height: "auto", whiteSpace: "normal", padding: 12, fontWeight: 600, background: "var(--celestial-gold)", color: "var(--primary-foreground)" }}
        >
          <ShieldCheck size={16} style={{ marginRight: 8 }} />
          Salvar Todas as Configurações & Prioridades de Fallback
        </Button>
      </Card>
    </div>
  );
}
