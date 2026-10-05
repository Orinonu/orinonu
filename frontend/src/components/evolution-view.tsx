"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle, Cpu, Lock, Play, RefreshCw, Shield, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { boundaryLabels, evolutionState, measuredCount, measuredPercent, observedTime, type EvolutionData, type EvolutionReport } from "@/lib/evolution";

const readEvolution = () => api<EvolutionData>("/api/evolution");
const executeEpoch = () => api("/api/evolution/epoch", "POST");

type EvolutionViewProps = {
  workspace?: string;
  report?: EvolutionReport;
  loadEvolution?: () => Promise<EvolutionData>;
  onRefresh?: () => Promise<void>;
  runEpoch?: () => Promise<unknown>;
  disabled?: boolean;
};

export function EvolutionView({ report: supplied, loadEvolution = readEvolution, onRefresh, runEpoch = executeEpoch, disabled = false }: EvolutionViewProps) {
  const [report, setReport] = useState<EvolutionReport>({ data: null, loading: true, error: null });
  const [runningEpoch, setRunningEpoch] = useState(false), [actionError, setActionError] = useState<string | null>(null);
  const active = useRef(false), request = useRef(0), epochPending = useRef(false);
  const load = useCallback(async () => {
    if (supplied) { await onRefresh?.(); return; }
    const id = ++request.current;
    setReport(current => ({ ...current, loading: true }));
    try {
      const data = await loadEvolution();
      if (active.current && id === request.current) setReport({ data, loading: false, error: null, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (active.current && id === request.current) setReport(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Métricas da instalação indisponíveis." }));
    }
  }, [supplied, loadEvolution, onRefresh]);
  useEffect(() => {
    active.current = true;
    if (!supplied) void load();
    return () => { active.current = false; request.current++; };
  }, [load, supplied]);
  const refresh = async () => {
    try { await load(); }
    catch (error) { if (active.current) setActionError(error instanceof Error ? error.message : "Não foi possível atualizar as métricas."); }
  };
  const handleRunEpoch = async () => {
    if (epochPending.current || disabled || (supplied ?? report).loading) return;
    epochPending.current = true;
    setRunningEpoch(true); setActionError(null);
    try { await runEpoch(); if (active.current) await load(); }
    catch (error) { if (active.current) setActionError(error instanceof Error ? error.message : "Não foi possível executar a época."); }
    finally { epochPending.current = false; if (active.current) setRunningEpoch(false); }
  };
  return <EvolutionReportView report={supplied ?? report} runningEpoch={runningEpoch} actionError={actionError} disabled={disabled || (!!supplied && !onRefresh)} onRefresh={() => void refresh()} onRunEpoch={() => void handleRunEpoch()} />;
}

export function EvolutionReportView({ report, runningEpoch = false, actionError, disabled = false, onRefresh, onRunEpoch }: {
  report: EvolutionReport;
  runningEpoch?: boolean;
  actionError?: string | null;
  disabled?: boolean;
  onRefresh: () => void;
  onRunEpoch: () => void;
}) {
  const { data, loading, error } = report;
  const state = evolutionState(report), metrics = data?.metrics, manifest = data?.manifest_status, guards = data?.guards;
  const epochs = Array.isArray(data?.epochs) ? data.epochs : null, campaigns = Array.isArray(data?.campaigns) ? data.campaigns : null;
  const checkedFiles = Array.isArray(manifest?.checked_files) ? manifest.checked_files : [];
  const hashesReported = checkedFiles.length > 0 && checkedFiles.every(file => typeof file.filename === "string" && file.filename.trim() && typeof file.hash === "string" && /^[a-f0-9]{64}$/i.test(file.hash));
  const status = { loading: "Carregando métricas da instalação…", refreshing: "Atualizando; dados anteriores permanecem visíveis.", stale: "Dados anteriores · consulta desatualizada, não uma medição atual.", error: "Indisponível · nenhuma medição carregada.", unknown: "Métricas ainda não observadas.", ready: "Dados da instalação recebidos." }[state];
  return <div className="evolution-page" aria-busy={loading}>
    <div className="evolution-header">
      <div><h2>Auto-Aprimoramento e Evals Operacionais</h2><p>Escopo global da instalação · todos os projetos. O projeto selecionado não filtra estas métricas.</p><p>Observações de logs, revisões e épocas declaradas pelo servidor. Pré-checagens e resultados simulados não comprovam qualidade, economia ou promoção estatística independente.</p></div>
      <div className="evolution-actions">
        <Button variant="outline" size="sm" onClick={onRunEpoch} disabled={disabled || loading || runningEpoch || !data}><Play size={14} />{runningEpoch ? "Avaliando…" : "Executar época (modo sombra)"}</Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={disabled || loading || runningEpoch}><RefreshCw size={14} />Atualizar</Button>
      </div>
    </div>
    <p className="native-copy" role="status" aria-live="polite">{status}{report.updatedAt ? ` Última resposta recebida: ${observedTime(report.updatedAt)}.` : ""}</p>
    {error && <p role="alert" className="native-copy">Falha na consulta: {error}</p>}
    {actionError && <p role="alert" className="native-copy">Falha na ação: {actionError}</p>}
    <p className="native-copy">Executar uma época registra uma avaliação global somente após o clique. O modo sombra não aplica um candidato; limites declarados não equivalem a cobrança ou proteção comprovadas.</p>
    <div className="evolution-grid">
      <Card className="evolution-card"><span className="evolution-card-icon"><CheckCircle size={18} /></span><small>TAXA DE ACEITAÇÃO TÉCNICA</small><strong>{measuredPercent(metrics?.acceptance_rate)}</strong><span>{measuredCount(metrics?.approved_reviews)} de {measuredCount(metrics?.total_reviews)} revisões aprovadas</span></Card>
      <Card className="evolution-card"><span className="evolution-card-icon"><RefreshCw size={18} /></span><small>RETRABALHO E REPLANS</small><strong>{measuredCount(metrics?.rework_count)}</strong><span>Replanejamentos registrados na história</span></Card>
      <Card className="evolution-card"><span className="evolution-card-icon"><AlertTriangle size={18} /></span><small>INTERVENÇÕES HUMANAS</small><strong>{measuredCount(metrics?.human_interventions)}</strong><span>Intervenções declaradas pelo servidor</span></Card>
      <Card className="evolution-card"><span className="evolution-card-icon"><Zap size={18} /></span><small>ABSTENÇÕES JEV</small><strong>{measuredCount(metrics?.jev_abstentions)}</strong><span>Julgamentos com abstenção técnica</span></Card>
    </div>
    <div className="native-grid">
      <Card><div className="section-title"><h3><Shield size={16} /> Conferência do benchmark (evals/)</h3></div>
        <p>Status do manifesto: <strong>{manifest?.valid === true ? hashesReported ? "Hashes conferem nesta consulta, segundo o servidor" : "Manifesto declarado válido; arquivos conferidos não informados" : manifest?.valid === false ? "Falha na integridade" : "Não verificado"}</strong></p>
        {manifest?.error && <p role="alert">{manifest.error}</p>}
        <ul className="native-notes">{checkedFiles.map(file => <li key={file.filename}><span>{file.filename} · SHA-256: </span><code style={{ overflowWrap: "anywhere" }} title={file.hash}>{file.hash}</code></li>)}</ul>
        <p className="native-copy">Não comprova proteção contra auto-mutação. A comparação SHA-256 verifica os arquivos contra o manifesto apresentado; não demonstra imutabilidade nem independência desse manifesto.</p>
      </Card>
      <Card><div className="section-title"><h3><Lock size={16} /> Guardas declaradas pelo servidor</h3></div>
        <p>Modo padrão: {guards?.shadow_mode_default === true ? "Modo sombra declarado" : guards?.shadow_mode_default === false ? "Modo sombra não é o padrão declarado" : "Não informado"}</p>
        <p>Critério declarado de promoção: {measuredCount(guards?.min_paired_samples_for_promotion) === "Não medido" ? "Não informado" : `≥ ${guards?.min_paired_samples_for_promotion} amostras pareadas`}</p>
        <p>Orçamento máximo declarado por época: {typeof guards?.max_epoch_budget_usd === "number" && Number.isFinite(guards.max_epoch_budget_usd) && guards.max_epoch_budget_usd >= 0 ? `US$ ${guards.max_epoch_budget_usd.toFixed(2)}` : "Não informado"}</p>
        <p>Fronteiras declaradas:</p>{Array.isArray(guards?.immutable_boundaries) ? <ul className="native-notes">{guards.immutable_boundaries.map(boundary => <li key={boundary}>{boundaryLabels[boundary] ?? boundary}</li>)}</ul> : <p>Não informado</p>}
        <p className="native-copy">Declarações de política, não uma certificação de enforcement. Elegibilidade informada pelo gate não autoriza promoção global.</p>
      </Card>
    </div>
    <Card className="evolution-campaigns-panel"><header><Cpu size={16} /><h3>Épocas de Auto-Evolução (Ciclos de Avaliação)</h3><span className="campaign-count">{epochs ? `${epochs.length} registradas` : "Não observado"}</span></header>
      <div className="campaigns-list">{epochs?.length ? epochs.slice(0, 10).map(epoch => <div key={epoch.id} className="campaign-row"><span className="campaign-status">{epoch.gate?.status ?? "Gate não informado"}{epoch.gate?.status === "awaiting_paired_samples" ? ` (${measuredCount(epoch.gate.current_pairs)}/${measuredCount(epoch.gate.min_pairs)})` : ""}</span><span className="campaign-reason">{epoch.gate?.reason ?? "Motivo não informado"} · {epoch.simulated_result !== undefined ? "Resultado simulado" : "Tipo de resultado não informado"} · {epoch.applied === false ? "Não aplicado" : epoch.applied === true ? "Aplicado segundo o registro" : "Aplicação não informada"} · {epoch.mode ?? "Modo não informado"}</span><small className="campaign-time">{observedTime(epoch.time)}</small></div>) : <p className="empty-copy">{epochs ? "Nenhuma época registrada na resposta da instalação." : "Histórico de épocas não observado."}</p>}</div>
    </Card>
    <Card className="evolution-campaigns-panel"><header><Activity size={16} /><h3>Campanhas de Auto-Pesquisa do Harness</h3><span className="campaign-count">{campaigns ? `${campaigns.length} registradas` : "Não observado"}</span></header><div className="campaigns-list">{campaigns?.length ? campaigns.slice(0, 10).map(campaign => <div key={campaign.id} className="campaign-row"><span className="campaign-status">{campaign.status ?? "Status não informado"}</span><span className="campaign-reason">{campaign.reason ?? "Motivo não informado"}</span><small className="campaign-time">{observedTime(campaign.time)}</small></div>) : <p className="empty-copy">{campaigns ? "Nenhuma campanha registrada na resposta da instalação." : "Campanhas não observadas."}</p>}</div></Card>
  </div>;
}
