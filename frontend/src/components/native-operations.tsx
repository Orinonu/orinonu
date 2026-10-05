"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Cpu, GitBranch, ShieldCheck, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SpecialistCatalog, SpecialistRuntime } from "@/components/specialist-catalog";
import { api } from "@/lib/api";
import { isActive, projectTasks, type Snapshot, type Task } from "@/lib/mission";

const phases: Record<string, string> = { discovery: "Exploração", design: "Planejamento", implementation: "Implementação", review: "Revisão independente" };
export type ModelCatalog = { models: string[]; efforts?: string[]; source?: string; error?: string | null; loading?: boolean; stale?: boolean };
export type ModelReport = { effective_model?: string | null; source?: string | null; precedence?: string | string[] | null };
type AgentsSnapshot = Snapshot & { model_catalog?: ModelCatalog; model_report?: Record<string, ModelReport> };

export function profileOptions(current: string, reported: string[] = []) {
  return [...new Set([current, ...reported].filter(value => typeof value === "string" && value.trim()))];
}

export function catalogFromSettings(settings: { provider_settings?: { providers?: { id: string; models?: string[]; efforts?: string[] }[] } }): ModelCatalog {
  const provider = settings.provider_settings?.providers?.find(row => row.id === "codex");
  return { models: Array.isArray(provider?.models) ? provider.models.filter(model => typeof model === "string" && !!model.trim()) : [], efforts: provider?.efforts, source: provider ? "Metadados do provedor Codex · /api/settings" : "Catálogo não informado pelo servidor" };
}

const readModelCatalog = async () => catalogFromSettings(await api<Parameters<typeof catalogFromSettings>[0]>("/api/settings"));
const sameWorkspace = (a: string, b: string) => a.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase() === b.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();

function PhaseProfile({ phase, profile, catalog, report, disabled, onSave }: {
  phase: string; profile: NonNullable<Snapshot["profiles"]>[string]; catalog: ModelCatalog | null; report?: ModelReport;
  disabled: boolean; onSave: (phase: string, model: string, effort: string) => Promise<void>;
}) {
  const [model, setModel] = useState(profile.model ?? ""), [effort, setEffort] = useState(profile.effort ?? "");
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!dirty) { setModel(profile.model ?? ""); setEffort(profile.effort ?? ""); }
    else if (profile.model === model && profile.effort === effort) setDirty(false);
  }, [profile.model, profile.effort, model, effort, dirty]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); }, [notice]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || pending.current || !dirty || !model || !effort) return;
    pending.current = true; setSaving(true); setError(""); setNotice("");
    try { await onSave(phase, model, effort); if (active.current) setNotice("Perfil enviado. Aguarde a confirmação nos dados da instalação."); }
    catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : "Não foi possível salvar o perfil. Seu rascunho foi preservado."); }
    finally { pending.current = false; if (active.current) setSaving(false); }
  };
  return <Card>
    <span className="eyebrow"><Cpu size={14} /> {phases[phase] ?? phase}</span>
    <p className="native-copy">Skill de referência: {profile.skill || "Não informada"}</p>
    <p className="native-copy">Modelo configurado: {profile.model || "Não informado"}. Modelo efetivo: {report?.effective_model || "Não observado"}.</p>
    <p className="native-copy">Precedência: {Array.isArray(report?.precedence) ? report.precedence.join(" → ") : report?.precedence || "Não informada pelo servidor"}{report?.source ? ` · ${report.source}` : ""}.</p>
    <form className="native-form" onSubmit={event => void save(event)}>
      <label>Modelo<select name="model" aria-label={"Modelo da fase " + phase} value={model} onChange={event => { setModel(event.target.value); setDirty(true); }} disabled={disabled || saving}>{!model && <option value="">Modelo não informado</option>}{profileOptions(model, profileOptions(profile.model, catalog?.models)).map(option => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>Esforço de raciocínio<select name="effort" aria-label={"Esforço da fase " + phase} value={effort} onChange={event => { setEffort(event.target.value); setDirty(true); }} disabled={disabled || saving}>{!effort && <option value="">Esforço não informado</option>}{profileOptions(effort, profileOptions(profile.effort, catalog?.efforts ?? ["low", "medium", "high", "xhigh"])).map(option => <option key={option} value={option}>{option}</option>)}</select></label>
      <Button disabled={disabled || saving || !dirty || !model || !effort} aria-label={"Salvar perfil da fase " + phase}>{saving ? "Salvando…" : "Salvar perfil"}</Button>
      {dirty && <Button type="button" variant="ghost" disabled={saving} onClick={() => { setModel(profile.model ?? ""); setEffort(profile.effort ?? ""); setDirty(false); }}>Descartar rascunho da fase {phase}</Button>}
    </form>
    <p className="native-copy">Esforços são opções de solicitação do perfil. Compatibilidade efetiva depende do executor; valores atuais desconhecidos são preservados.</p>
    {!catalog?.models.includes(profile.model) && <p className="native-copy">Modelo atual preservado fora do catálogo observado. Sua disponibilidade não foi verificada.</p>}
    {dirty && <p className="native-copy">Rascunho preservado durante atualizações. Salvar altera o perfil global, não uma missão em execução.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </Card>;
}

export function AgentsView({ snapshot, disabled, onSave, modelCatalog, modelReports, loadModelCatalog = readModelCatalog }: {
  snapshot: AgentsSnapshot; disabled: boolean; onSave: (phase: string, model: string, effort: string) => Promise<void>;
  modelCatalog?: ModelCatalog | null; modelReports?: Record<string, ModelReport>; loadModelCatalog?: () => Promise<ModelCatalog>;
}) {
  const supplied = modelCatalog !== undefined ? modelCatalog : snapshot.model_catalog;
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null), [catalogError, setCatalogError] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(supplied === undefined), [catalogAttempt, setCatalogAttempt] = useState(0);
  useEffect(() => {
    if (supplied !== undefined) return;
    let active = true;
    setLoadingCatalog(true);
    loadModelCatalog().then(value => { if (active) { setCatalog(value); setCatalogError(""); } }).catch(() => { if (active) { setCatalogError("Catálogo de modelos indisponível. Valores atuais foram preservados."); setCatalog(current => current ? { ...current, stale: true } : current); } }).finally(() => { if (active) setLoadingCatalog(false); });
    return () => { active = false; };
  }, [supplied, loadModelCatalog, catalogAttempt]);
  const observed = supplied === undefined ? catalog : supplied;
  const catalogLoading = supplied === undefined ? loadingCatalog : observed?.loading;
  const error = supplied === undefined ? catalogError || observed?.error : observed?.error;
  return <div className="native-page">
    <Card className="native-intro"><Users size={22} /><div><h2>Uma direção. Muitas inteligências.</h2><p>Escopo global da instalação · perfis e catálogo são compartilhados por todos os projetos. O projeto selecionado não altera este escopo.</p><p>Perfis organizam o trabalho; especialistas são contratos de escopo, não agentes filhos automaticamente ativos. Cada instalação usa suas próprias conexões e limites.</p></div></Card>
    <p className="native-copy" role="status">{catalogLoading ? "Carregando catálogo de modelos…" : observed?.source ?? "Catálogo de modelos não observado"}{observed?.stale ? " · Dados anteriores, catálogo desatualizado" : ""}. Opções declaradas não garantem disponibilidade, autenticação ou compatibilidade com cada fase.</p>
    {error && <p role="alert">{error}</p>}
    {supplied === undefined && catalogError && <Button variant="outline" disabled={loadingCatalog} onClick={() => setCatalogAttempt(value => value + 1)}>Consultar catálogo novamente</Button>}
    <div className="native-grid">{Object.entries(snapshot.profiles ?? {}).map(([phase, profile]) => <PhaseProfile key={phase} phase={phase} profile={profile} catalog={observed ?? null} report={(modelReports ?? snapshot.model_report)?.[phase]} disabled={disabled} onSave={onSave} />)}</div>
    {!Object.keys(snapshot.profiles ?? {}).length && <Card><p>Perfis ainda não observados nesta instalação.</p></Card>}
    <Card><h2>Integrações observadas</h2><div className="native-list">{(snapshot.integrations ?? []).map(integration => <article key={integration.id}><strong>{integration.name}</strong><span className="native-status">{integration.status}</span><p>{integration.detail}</p></article>)}</div><p className="native-copy">Instalado não significa autenticado ou autorizado. Gerencie conexões na página Configurações.</p></Card>
    <SpecialistRuntime policy={snapshot.specialist_policy} />
    <SpecialistCatalog roles={snapshot.specialists} />
  </div>;
}

export function CurationView({ snapshot }: { snapshot: Snapshot }) {
  const report = snapshot.curator;
  return <div className="native-page">
    <Card className="native-intro"><ShieldCheck size={22} /><div><h2>Contexto com proveniência</h2><p>{snapshot.context?.consultations === undefined ? "Não observado" : `${snapshot.context.consultations} consultas observadas pelo hook nativo.`}</p><p>{snapshot.context?.trust ?? "Confiança não verificada."}</p></div></Card>
    <div className="native-grid">
      <Card><h2>Ferramentas observadas</h2><p className="native-copy">Cobertura parcial{report?.window_days ? ` · janela de ${report.window_days} dias` : " · janela não informada"}.</p><ul className="native-rows">{(report?.observed_tools ?? []).map(tool => <li key={tool.id}><code>{tool.id}</code><span>{tool.uses} usos</span></li>)}</ul>{!report?.observed_tools?.length && <p>Nenhuma observação disponível.</p>}</Card>
      <Card><h2>Limites da curadoria</h2><p>{report?.policy ?? "Não observado: sem evidência não se presume desuso."}</p><ul className="native-notes">{report?.limitations?.map(text => <li key={text}>{text}</li>)}</ul><p className="native-copy">{report?.disabled_duplicates?.length ?? "Não observado"} duplicatas conhecidas desativadas. Esta tela não apaga ferramentas nem altera confiança de hooks.</p></Card>
    </div>
    <Card><h2>Projetos e ocupação</h2><div className="native-list">{(snapshot.projects ?? []).map(project => <article key={project.workspace}><strong>{project.workspace}</strong><p>{Object.entries(project.counts ?? {}).map(([status, count]) => `${status}: ${count}`).join(" · ") || "Sem contagem observada."}</p></article>)}</div>{!snapshot.projects?.length && <p>Os projetos aparecem conforme o trabalho é registrado.</p>}</Card>
  </div>;
}

export function DecisionHistory({ snapshot, workspace }: { snapshot: Snapshot; workspace: string }) {
  const ids = new Set(projectTasks(snapshot.tasks, workspace).map(task => task.id));
  const events = (snapshot.events ?? []).filter(row => (row.provider === "typesafe" || row.kind.startsWith("jev_")) && (row.workspace ? sameWorkspace(row.workspace, workspace) : !!row.task_id && ids.has(row.task_id)));
  return <Card><h2>Histórico de decisões tipadas</h2><p className="native-copy">Eventos observados deste projeto. Recomendações não concedem autorização.</p><div className="native-list">{events.map((event, index) => <details key={event.time + index}><summary>{event.kind} · {new Date(event.time).toLocaleString("pt-BR")}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>)}</div>{!events.length && <p>Nenhuma decisão atribuída a este projeto na janela observada.</p>}</Card>;
}

export function QueueControls({ scheduler, disabled, onSave }: { scheduler: Snapshot["scheduler"]; disabled: boolean; onSave: (limits: Record<string, number>) => Promise<void> }) {
  return <details className="operational-details"><summary>Capacidade e limites da fila</summary><p className="native-copy">Estes limites afetam todos os projetos desta instalação. Alterar capacidade não inicia missões nem muda sua autorização.</p><form className="native-form native-grid" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void onSave(Object.fromEntries(["planning", "implementation", "review"].map(phase => [phase + "_limit", Number(fields.get(phase + "_limit"))]))); }}>
    {(["planning", "implementation", "review"] as const).map(phase => <label key={phase}>{phase === "planning" ? "Planejamento" : phases[phase]}<Input name={phase + "_limit"} type="number" required min="1" max="10" defaultValue={scheduler?.[`${phase}_limit`] ?? ""} disabled={disabled} /><small>{scheduler?.running?.[phase] ?? "Não observado"} em execução · {scheduler?.queued?.[phase] ?? "Não observado"} na fila</small></label>)}
    <Button disabled={disabled || !scheduler}>Salvar limites da instalação</Button>
  </form></details>;
}

export function TaskControls({ task }: { task: Task }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const disabled = busy || isActive(task) || !!task.queue || task.opportunity_audit === true;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    try { await api(`/api/tasks/${task.id}`, "PATCH", { title: fields.get("title"), goal: fields.get("goal"), acceptance: fields.get("acceptance"), max_minutes: Number(fields.get("max_minutes")) }); setNotice("Objetivo salvo. A visão será atualizada na próxima consulta."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar a missão."); }
    finally { setBusy(false); }
  };
  return <details className="operational-details"><summary>Editar objetivo e critérios</summary><p className="native-copy">Alterar requisitos invalida o planejamento anterior. Missões em atividade e auditorias não são editadas por este formulário.</p><form className="native-form" key={task.id} onSubmit={event => void save(event)}>
    <label>Título<Input name="title" required maxLength={160} defaultValue={task.title} disabled={disabled} /></label>
    <label>Objetivo<Textarea name="goal" required maxLength={6000} defaultValue={task.goal} disabled={disabled} /></label>
    <label>Critérios verificáveis<Textarea name="acceptance" required maxLength={3000} defaultValue={task.acceptance} disabled={disabled} /></label>
    <label>Limite de execução · minutos<Input name="max_minutes" type="number" required min={1} max={720} defaultValue={task.max_minutes ?? ""} disabled={disabled} /></label>
    <Button disabled={disabled}>Salvar requisitos</Button>
  </form>{notice && <p role="status">{notice}</p>}</details>;
}

type JevMetadata = { configured: boolean; model: string; models: { id: string; label: string }[]; storage: string; storage_error?: string };
export function JevSettings() {
  const [data, setData] = useState<JevMetadata | null>(null), [key, setKey] = useState(""), [model, setModel] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { let active = true; api<{ typesafe: JevMetadata }>("/api/settings").then(result => { if (active) { setData(result.typesafe); setModel(result.typesafe.model); } }).catch(() => { if (active) setNotice("Configuração JEV indisponível."); }); return () => { active = false; }; }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice("");
    try { const result = await api<{ typesafe: JevMetadata }>("/api/settings", "PATCH", { jev_model: model, ...(key.trim() ? { typesafe_api_key: key.trim() } : {}) }); setData(result.typesafe); setKey(""); setNotice("Configuração JEV salva no armazenamento privado da instalação."); }
    catch { setNotice("Não foi possível salvar. Verifique o modelo e o armazenamento privado."); }
    finally { setBusy(false); }
  };
  return <Card><div className="section-title"><h2><GitBranch size={18} /> Decisões JEV · TypeSafe</h2><span className="native-status">{data ? data.configured ? "Configurado" : "Sem credencial" : "Não verificado"}</span></div><p className="native-copy">Configuração global da instalação, compartilhada por todos os projetos. A assinatura do seu executor não autentica o JEV. Use sua própria API TypeSafe; a chave permanece fora do código e não é devolvida pela API.</p><form className="native-form" onSubmit={event => void save(event)}>
    <label>Modelo<select aria-label="Modelo JEV da instalação" value={model} onChange={event => setModel(event.target.value)} disabled={!data || busy}>{!model && <option value="">Modelo não informado</option>}{profileOptions(model, (data?.models ?? []).map(option => option.id)).map(id => <option key={id} value={id}>{data?.models.find(option => option.id === id)?.label ?? id}</option>)}</select></label>
    <label>Nova chave API · opcional<Input type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder="Deixe vazio para preservar a chave atual" disabled={!data || busy} /></label>
    <small>{data?.storage ?? "Armazenamento ainda não verificado."}</small>
    {data?.storage_error && <p role="alert">{data.storage_error}</p>}
    <Button disabled={!data || busy}>Salvar conexão JEV</Button>
  </form>{notice && <p role="status">{notice}</p>}</Card>;
}
