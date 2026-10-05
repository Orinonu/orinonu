"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GitBranch, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type UpdateStatus = {
  repository?: string;
  channel?: string;
  installed?: { version?: string | null; commit?: string | null; branch?: string | null; dirty?: boolean };
  latest?: { version?: string | null; commit?: string | null } | null;
  status?: string;
  behind?: number | null;
  ahead?: number | null;
  checked_at?: string | null;
  error?: string | null;
};
export type UpdateReport = { data: UpdateStatus | null; loading: boolean; error: string | null; stale?: boolean };

const versionText = (value?: string | null) => value?.trim() ? `v${value.trim()}` : null;
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validCommit = (value?: string | null) => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
export const installedVersion = (data: Pick<UpdateStatus, "installed"> | null) => versionText(data?.installed?.version) ?? "Versão não identificada";

export function describeUpdate(data: Pick<UpdateStatus, "status" | "behind"> & Partial<Pick<UpdateStatus, "ahead">>): string {
  switch (data.status) {
    case "up_to_date": return data.behind === 0 && data.ahead === 0 ? "Em dia com main" : "Distância não verificada";
    case "update_available": return validCount(data.behind) ? `${data.behind} commits atrás de main` : "Distância não verificada";
    case "ahead": return validCount(data.ahead) ? `${data.ahead} commits locais à frente de main` : "Número não verificado de commits locais à frente de main";
    case "diverged": return "Histórico local divergiu de main";
    case "local_changes": return "Alterações locais: revise antes de atualizar";
    case "untracked": return "Commit instalado não identificado";
    case "unavailable": return "Consulta a main indisponível";
    default: return "Atualizações ainda não verificadas";
  }
}

export function updateFreshness(data: UpdateStatus | null, now = Date.now()): "confirmed" | "stale" | "unknown" {
  const checked = data?.checked_at ? Date.parse(data.checked_at) : NaN;
  if (!Number.isFinite(checked) || checked > now || !validCommit(data?.latest?.commit) || !versionText(data?.latest?.version)) return "unknown";
  if (data?.error || !["up_to_date", "update_available", "ahead", "diverged", "local_changes"].includes(data?.status ?? "") || now - checked > 15 * 60000) return "stale";
  if (!validCommit(data?.installed?.commit) || !validCount(data?.behind) || !validCount(data?.ahead)) return "unknown";
  if (data?.status === "up_to_date" && (data.behind !== 0 || data.ahead !== 0)) return "unknown";
  return "confirmed";
}

const readUpdates = () => api<UpdateStatus>("/api/updates");
const checkUpdates = () => api<UpdateStatus>("/api/updates/check", "POST", {});

function useUpdates(supplied?: UpdateReport, loader = readUpdates) {
  const [report, setReport] = useState<UpdateReport>({ data: null, loading: true, error: null });
  const active = useRef(false), request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setReport(current => ({ ...current, loading: true }));
    try { const data = await loader(); if (active.current && id === request.current) setReport({ data, loading: false, error: null }); }
    catch { if (active.current && id === request.current) setReport(current => ({ ...current, loading: false, error: "Não foi possível consultar a proveniência desta instalação." })); }
  }, [loader]);
  useEffect(() => {
    active.current = true;
    if (supplied) return () => { active.current = false; request.current++; };
    void load(); const timer = setInterval(() => void load(), 60000);
    return () => { active.current = false; request.current++; clearInterval(timer); };
  }, [load, !!supplied]);
  const accept = (data: UpdateStatus) => { request.current++; if (active.current) setReport({ data, loading: false, error: null }); };
  return { report: supplied ?? report, accept };
}

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  return now;
}

function comparisonDescription(report: UpdateReport, now: number) {
  if (!report.data) return report.loading ? "Carregando proveniência da instalação…" : "Atualizações ainda não verificadas";
  if (report.error || report.stale || updateFreshness(report.data, now) !== "confirmed") {
    if (report.data.status === "up_to_date") return "Comparação atual não confirmada; a resposta anterior declarou distância zero.";
    return `${describeUpdate(report.data)} · comparação atual não confirmada`;
  }
  return `${describeUpdate(report.data)} · na consulta registrada`;
}

export function UpdateIndicator({ onOpen, report: supplied, loadUpdates = readUpdates }: { onOpen: () => void; report?: UpdateReport; loadUpdates?: () => Promise<UpdateStatus> }) {
  const { report } = useUpdates(supplied, loadUpdates), now = useClock();
  const hasUpdate = !report.error && !report.stale && updateFreshness(report.data, now) === "confirmed" && report.data?.status === "update_available";
  return <button type="button" className={`update-indicator ${hasUpdate ? "has-update" : ""}`} onClick={onOpen} aria-label={`Ver versão e atualizações · ${installedVersion(report.data)}`} title={comparisonDescription(report, now)}>
    <GitBranch size={13} /> {installedVersion(report.data)}{validCommit(report.data?.installed?.commit) ? ` · ${report.data!.installed!.commit!.slice(0, 7)}` : ""}{hasUpdate ? ` · ${report.data?.behind} atrás de main` : ""}
  </button>;
}

export function UpdatesView({ report: supplied, loadUpdates = readUpdates, checkRemote = checkUpdates, onChecked }: {
  report?: UpdateReport; loadUpdates?: () => Promise<UpdateStatus>; checkRemote?: () => Promise<UpdateStatus>; onChecked?: (data: UpdateStatus) => void;
} = {}) {
  const { report, accept } = useUpdates(supplied, loadUpdates);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [actionError, setActionError] = useState(""), [copyError, setCopyError] = useState("");
  const pending = useRef(false), active = useRef(true), now = useClock();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); }, [notice]);
  const check = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice("");
    try { const data = await checkRemote(); if (active.current) { accept(data); onChecked?.(data); setActionError(""); } }
    catch { if (active.current) setActionError("Não foi possível verificar main. Nenhum código foi alterado."); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText("npm run update:prepare"); if (active.current) { setCopyError(""); setNotice("Comando copiado. Execute-o na pasta de código-fonte do Orinonu."); } }
    catch { if (active.current) setCopyError("Não foi possível copiar. Copie o comando exibido e execute-o na pasta de código-fonte."); }
  };
  return <UpdatesReport report={actionError ? { ...report, stale: true } : report} busy={busy} notice={notice} actionError={actionError} copyError={copyError} now={now} onCheck={() => void check()} onCopy={() => void copy()} />;
}

export function UpdatesReport({ report, busy, notice, actionError, copyError, now = Date.now(), onCheck, onCopy }: {
  report: UpdateReport; busy: boolean; notice?: string; actionError?: string; copyError?: string; now?: number; onCheck: () => void; onCopy: () => void;
}) {
  const { data, loading, error } = report;
  const freshness = (error || report.stale) && data?.latest ? "stale" : updateFreshness(data, now);
  const checked = data?.checked_at && Number.isFinite(Date.parse(data.checked_at)) ? new Date(data.checked_at).toLocaleString("pt-BR") : null;
  return <div className="native-page" aria-busy={loading || busy}>
    <Card className="native-intro"><GitBranch size={22} /><div><h2>Evolução contínua. Versões deliberadas.</h2><p>Escopo global da instalação, independente do projeto selecionado. Contribuições revisadas entram em main. O número da versão avança somente quando o mantenedor aprova um marco; commits novos não viram uma versão automaticamente.</p></div></Card>
    <Card>
      <div className="section-title"><h2>Proveniência da instalação</h2><Button variant="outline" disabled={busy} onClick={onCheck}><RefreshCw size={15} />{busy ? "Verificando…" : "Verificar main"}</Button></div>
      <div className="update-facts">
        <section><span>Versão instalada</span><strong>{installedVersion(data)}</strong></section>
        <section><span>Commit instalado</span><code>{validCommit(data?.installed?.commit) ? data!.installed!.commit!.slice(0, 12) : "Não identificado"}</code></section>
        <section><span>Branch / canal declarado</span><strong>{data?.installed?.branch || "Não identificado"} / {data?.channel || "Não informado"}</strong></section>
        <section><span>{freshness === "confirmed" ? "Versão em main na consulta" : "Versão remota anterior / não confirmada"}</span><strong>{versionText(data?.latest?.version) ?? "Não verificada"}</strong></section>
      </div>
      <p className="update-status" role="status" aria-live="polite">{comparisonDescription(report, now)}{loading && data ? " · Atualizando dados locais…" : ""}</p>
      <p className="native-copy">{freshness === "confirmed" ? `Última comparação confirmada: ${checked}.` : freshness === "stale" ? "Dados remotos anteriores; a comparação atual não está confirmada. Informações expiram após 15 minutos ou uma falha." : "Nenhuma comparação remota confirmada."}{freshness !== "confirmed" && checked ? ` Última tentativa registrada: ${checked}.` : ""} {validCommit(data?.latest?.commit) ? `Commit remoto na resposta: ${data!.latest!.commit!.slice(0, 12)}.` : ""}</p>
      {error && <p role="alert">{error}</p>}
      {data?.error && <p role="alert">Erro na consulta remota: {data.error}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {copyError && <p role="alert">{copyError}</p>}
      {notice && <p role="status" aria-live="polite">{notice}</p>}
      {data?.status === "unavailable" && <p className="native-copy">Rede, limite da API ou repositório ainda indisponível. Distância desconhecida não significa instalação atualizada.</p>}
    </Card>
    <Card>
      <div className="section-title"><h2><ShieldCheck size={18} /> Preparar sem interromper a operação</h2></div>
      <ol className="update-steps"><li>Execute o comando abaixo na pasta de código-fonte. Ele baixa somente main do repositório oficial para uma nova pasta privada e valida backend, interface, compilação e instalador.</li><li>Confira a versão, o commit e o snapshot preparados. A preparação não substitui a instalação, não muda credenciais e não reinicia agentes.</li><li>Depois que missões e reservas terminarem, revise o comando de promoção mostrado no terminal. Execute primeiro com <code>-DryRun</code>; a aplicação é uma decisão explícita, com backup e verificações.</li></ol>
      <div className="update-command"><code>npm run update:prepare</code><Button variant="outline" onClick={onCopy}>Copiar comando</Button></div>
      <p className="native-copy">Histórico divergente ou alterações locais exigem revisão; não há reset forçado. Instalações com commit identificado consultam main periodicamente; <code>ORINONU_UPDATE_CHECK=0</code> desliga essa consulta automática. Não há atualização automática de código.</p>
    </Card>
  </div>;
}
