"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Coins,
  Compass,
  ExternalLink,
  FlaskConical,
  FolderGit2,
  GitBranch,
  GitFork as Github,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, admit, finishAdmission, performReportedAction } from "@/lib/api";
import { useMissionQueries } from "@/lib/use-mission-queries";
import { singleFlight, type QueryState } from "@/lib/query";
import { KanbanBoard } from "@/components/kanban-board";
import { MissionViewBoundary } from "@/components/mission-view-boundary";
import { MissionCard } from "@/components/mission-card";
export { MissionCard } from "@/components/mission-card";
import { AutonomyModeSwitch } from "@/components/autonomy-mode-switch";
import { AutonomyHealthPanel } from "@/components/autonomy-health";
import { DecisionInbox, DecisionInboxCard } from "@/components/decision-inbox";
import { EvolutionView } from "@/components/evolution-view";
import { SettingsView } from "@/components/settings-view";
import { OrinonuMark } from "@/components/brand-mark";
import { OriInonuPresence } from "@/components/ori-inonu-presence";
import { WorkflowOverview } from "@/components/workflow-overview";
import { NotificationCenter, type Notice } from "@/components/notification-center";
import { ReportContent } from "@/components/report-content";
import { Tabs as TabsPrimitive } from "radix-ui";
import { brand } from "@/lib/brand";
import { AgentsView, CurationView, DecisionHistory, JevSettings, QueueControls, TaskControls } from "@/components/native-operations";
import { UpdateIndicator, UpdatesView } from "@/components/updates-view";
import {
  autonomyMode,
  brlFrom,
  charterKeys,
  checklistProgress,
  directionSave,
  economySummary,
  flowFor,
  flowSummary,
  formatBrl,
  formatSeconds,
  formatTokens,
  formatUsd,
  isActive,
  laneLabels,
  laneOf,
  lanes,
  projectName,
  projectTasks,
  resolveWorkspace,
  sameWorkspace,
  workspaceKey,
  missionAction,
  referenceSave,
  repoLabel,
  statusLabels,
  sumKnown,
  taskProgress,
  taskPriority,
  taskHistory,
  waitOwner,
  recoveryReasonLabels,
  resumeConditionLabels,
  recommendationLabel,
  type Direction,
  type EconomySummary,
  type FlowReport,
  type DecisionItem,
  decisionsFor,
  type Opportunity,
  type Snapshot,
  type Task,
} from "@/lib/mission";

type View =
  | "overview"
  | "direction"
  | "board"
  | "research"
  | "decisions"
  | "evaluations"
  | "agents"
  | "curation"
  | "updates"
  | "settings";
const navigation = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "direction", label: "Direção do projeto", icon: Compass },
  { id: "board", label: "Missões", icon: LayoutGrid },
  { id: "research", label: "Pesquisa e referências", icon: BookOpen },
  { id: "decisions", label: "Decisões JEV", icon: GitBranch },
  { id: "evaluations", label: "Avaliações e evidências", icon: FlaskConical },
  { id: "agents", label: "Agentes e etapas", icon: Users },
  { id: "curation", label: "Harness e curadoria", icon: ShieldCheck },
  { id: "updates", label: "Atualizações", icon: RefreshCw },
] as const;
const descriptions: Record<View, string> = {
  overview: "Direção clara. Trabalho em foco. Entregas com evidências.",
  direction: "O que orienta o projeto e como reconhecer o sucesso.",
  board: "Acompanhe cada objetivo, da intenção à entrega.",
  research: "Transforme referências e investigação em melhorias verificáveis.",
  decisions: "Escolhas, contexto e recomendações do JEV.",
  evaluations: "Resultados observados e evidências de qualidade.",
  agents: "Especialistas, planejamento e execução.",
  curation: "Contexto e ferramentas da sua operação.",
  updates: "Versão, commit e evolução do repositório oficial.",
  settings: "Conexões e preferências desta instalação.",
};
const fields: {
  key: (typeof charterKeys)[number];
  label: string;
  help: string;
  placeholder: string;
}[] = [
  {
    key: "objective",
    label: "Objetivo atual",
    help: "O resultado concreto que o projeto busca agora.",
    placeholder: "Que mudança queremos produzir?",
  },
  {
    key: "success_criteria",
    label: "Evidências de sucesso",
    help: "Resultados e critérios que permitam verificar a entrega.",
    placeholder: "Como saberemos que o objetivo foi alcançado?",
  },
  {
    key: "mission",
    label: "Missão",
    help: "A razão de existir do projeto.",
    placeholder: "Para quem e por que construímos?",
  },
  {
    key: "vision",
    label: "Visão de longo prazo",
    help: "O futuro que queremos construir.",
    placeholder: "Onde o projeto deve chegar?",
  },
  {
    key: "values",
    label: "Valores",
    help: "O que importa ao tomar decisões.",
    placeholder: "Que valores guiam as escolhas?",
  },
  {
    key: "principles",
    label: "Princípios permanentes",
    help: "Compromissos que orientam cada melhoria.",
    placeholder: "Que princípios devem ser respeitados?",
  },
];
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Sem data registrada";

export default function MissionControl() {
  // The flow summary is secondary: its failure never marks the panel as disconnected.
  const { snapshot, setSnapshot, flow, decisions, queries, refresh, retry } = useMissionQueries();
  const connected = queries.snapshot.status === "ready", lastUpdate = queries.snapshot.updatedAt;
  const [view, setView] = useState<View>("overview");
  const [workspaceSelection, setWorkspace] = useState(""),
    [workspaceOpen, setWorkspaceOpen] = useState(false),
    [workspaceInput, setWorkspaceInput] = useState(""),
    [mobileNav, setMobileNav] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Direction>>({}),
    [message, setMessageState] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"info" | "error">("info"),
    [pauseNotice, setPauseNotice] = useState<string | null>(null),
    [connectionNotice, setConnectionNotice] = useState(false);
  const setMessage = useCallback((value: string, tone: "info" | "error" = "info") => {
    setMessageState(value);
    setMessageTone(tone);
  }, []);
  const hasSnapshot = !!snapshot;
  const pauseMessage = snapshot?.executor_pause?.status === "paused"
    ? `O limite de uso do Codex foi atingido. ${snapshot.executor_pause.resume_at_ms ? `Retomada prevista: ${date(new Date(snapshot.executor_pause.resume_at_ms).toISOString())}.` : "Previsão de retorno não informada."} O sistema verifica a cota a cada 30 minutos e preserva as missões na fila.`
    : null;
  useEffect(() => setPauseNotice(pauseMessage), [pauseMessage]);
  useEffect(() => setConnectionNotice(hasSnapshot && !connected), [hasSnapshot, connected]);
  const dismissNotice = useCallback((id: string) => {
    if (id === "message") setMessage("");
    if (id === "pause") setPauseNotice(null);
    if (id === "connection") setConnectionNotice(false);
  }, []);
  const notices: Notice[] = [];
  if (message) notices.push({ id: "message", title: messageTone === "error" ? "Operação não concluída" : "Atualização", message, tone: messageTone });
  if (pauseNotice) notices.push({ id: "pause", title: "Execução pausada", message: pauseNotice, tone: "warning" });
  if (connectionNotice) notices.push({ id: "connection", title: "Conexão interrompida", message: "Exibindo a última atualização disponível. As ações serão liberadas quando o servidor reconectar.", tone: "error" });
  const [selected, setSelected] = useState<{
      id: string;
      opportunity?: boolean;
    } | null>(null),
    [newMission, setNewMission] = useState(false),
    [aboutOpen, setAboutOpen] = useState(false);
  const [assistance, setAssistance] = useState<
    Record<
      string,
      {
        task_id: string;
        status: string;
        proposal?: Partial<Direction>;
        questions?: string[];
        reason?: string;
      }
    >
  >({});
  const busyOperation = useRef<string | null>(null);
  const [boardReveal, setBoardReveal] = useState<string | null>(null);
  const [decisionReveal, setDecisionReveal] = useState<string | null>(null);
  const [economyExpanded, setEconomyExpanded] = useState(false);
  const [researchExpanded, setResearchExpanded] = useState(false);
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileNav) return;
    const previous = document.activeElement;
    const sidebar = sidebarRef.current;
    const buttons = Array.from(
      sidebar?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    buttons[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNav(false);
      } else if (event.key === "Tab" && buttons.length) {
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [mobileNav]);
  useEffect(() => {
    try {
      setWorkspace(localStorage.getItem("nexo-selected-workspace") ?? "");
    } catch {}
    const hash = location.hash.slice(1);
    if ([...navigation.map((n) => n.id), "settings"].includes(hash))
      setView(hash as View);
    const onHash = () => {
      const hash = location.hash.slice(1);
      if ([...navigation.map((n) => n.id), "settings"].includes(hash))
        setView(hash as View);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  const knownWorkspaces = [
    ...(snapshot?.project_directions ?? []).map(row => row.workspace),
    ...(snapshot?.projects ?? []).map(row => row.workspace),
    snapshot?.workspace?.default ?? "",
    ...(snapshot?.tasks ?? []).map(row => row.workspace),
  ].filter(Boolean);
  const selectedPath = workspaceSelection || snapshot?.workspace?.default || "";
  const localWorkspaceKeys = [...Object.keys(drafts), ...Object.keys(assistance)];
  const workspace = localWorkspaceKeys.find(path => sameWorkspace(path, selectedPath)) ?? resolveWorkspace(selectedPath, knownWorkspaces);
  const saved = snapshot?.project_directions?.find(
      (d) => sameWorkspace(d.workspace, workspace),
    ),
    draft = drafts[workspace] ?? saved ?? { workspace };
  const tasks = useMemo(
    () => projectTasks(snapshot?.tasks ?? [], workspace),
    [snapshot, workspace],
  );
  const active = tasks
      .filter(isActive)
      .sort((a, b) => taskPriority(a) - taskPriority(b)),
    attention = tasks.filter(
      (t) => ["review", "blocked"].includes(laneOf(t)) && !isActive(t),
    );
  const directionsKnown = Array.isArray(snapshot?.project_directions);
  const opportunitiesKnown = Array.isArray(snapshot?.opportunities);
  const opportunities = (snapshot?.opportunities ?? []).filter(
    (o) => sameWorkspace(o.workspace, workspace) && o.status === "pending",
  );
  const workspaces = [workspace, ...knownWorkspaces].filter((path, index, rows) =>
    !!path && rows.findIndex(candidate => workspaceKey(candidate) === workspaceKey(path)) === index,
  );
  const charterDirty = charterKeys.some(
    (k) => (draft[k] ?? "") !== (saved?.[k] ?? ""),
  );
  const referencesDirty =
    JSON.stringify(draft.repositories ?? []) !==
      JSON.stringify(saved?.repositories ?? []) ||
    (draft.research_focus ?? "") !== (saved?.research_focus ?? "");
  const boardTasks = useMemo(
    () => [...tasks].sort((a, b) => taskPriority(a) - taskPriority(b)),
    [tasks],
  );
  const selectedTask = snapshot?.tasks.find((t) => t.id === selected?.id && sameWorkspace(t.workspace, workspace) && !t.archived_at),
    selectedOpportunity = snapshot?.opportunities?.find(
      (o) => o.id === selected?.id && sameWorkspace(o.workspace, workspace),
    );
  useEffect(() => {
    if (selected && !(selected.opportunity ? selectedOpportunity : selectedTask)) setSelected(null);
  }, [selected, selectedOpportunity, selectedTask]);
  const autonomous = autonomyMode(snapshot, workspace) === "autonomous";
  const projectFlow = flowFor(flow, workspace);
  const knownHealth = projectFlow?.health && typeof projectFlow.health.counts?.running === "number" && typeof projectFlow.health.counts?.queued_admissible === "number";
  const modeSummary = queries.flow.status === "ready" ? flowSummary(projectFlow)?.text ?? null : "Fluxo indisponível ou desatualizado";
  const projectDecisions = workspace ? decisionsFor(decisions, workspace) : decisions.filter(item => !item.workspace);
  const modeDisabledReason = !workspace
    ? "Selecione um projeto."
    : !connected
      ? "Sem conexão com o servidor local."
      : !autonomous && !saved?.objective?.trim()
        ? "Defina o objetivo do projeto em Direção para liberar o modo autônomo."
        : undefined;
  const economy = useMemo(
    () =>
      economySummary(snapshot?.analytics, snapshot?.metrics, snapshot?.comparison),
    [snapshot],
  );
  const investigations = useMemo(
    () =>
      (snapshot?.tasks ?? [])
        .filter((t) => sameWorkspace(t.workspace, workspace) && !t.archived_at && t.opportunity_audit)
        .sort((a, b) =>
          (b.created_at ?? "").localeCompare(a.created_at ?? ""),
        ),
    [snapshot, workspace],
  );
  const projectIds = useMemo(
    () =>
      new Set(
        (snapshot?.tasks ?? [])
          .filter((t) => sameWorkspace(t.workspace, workspace) && !t.archived_at)
          .map((t) => t.id),
      ),
    [snapshot, workspace],
  );
  const projectMissions = economy.missions.filter((m) => projectIds.has(m.id)),
    projectCost = {
      usd: sumKnown(projectMissions.map((m) => m.usd)),
      brl: sumKnown(projectMissions.map((m) => m.brl)),
    },
    projectPriced = projectMissions.filter((m) => m.brl !== null).length;
  const updateDraft = (changes: Partial<Direction>) =>
    setDrafts((current) => ({
      ...current,
      [workspace]: {
        ...(current[workspace] ?? saved ?? { workspace }),
        ...changes,
        workspace,
      },
    }));
  const navigate = (next: View) => {
    setView(next);
    setMobileNav(false);
    location.hash = next;
  };
  const revealBoard = (lane: string) => {
    setBoardReveal(lane);
    navigate("board");
  };
  useEffect(() => {
    if (view !== "board" || !boardReveal || !snapshot) return;
    const board = boardAreaRef.current?.querySelector<HTMLElement>(".kanban");
    const column = boardAreaRef.current?.querySelector<HTMLElement>(`[data-lane="${boardReveal}"]`);
    if (!board || !column) return;
    board.scrollTo({ left: board.scrollLeft + column.getBoundingClientRect().left - board.getBoundingClientRect().left, behavior: "auto" });
    board.focus({ preventScroll: true });
    setBoardReveal(null);
  }, [view, boardReveal, snapshot]);
  const openTaskDecision = (task: Task) => {
    setDecisionReveal(projectDecisions.find(item => item.task_id === task.id)?.id ?? null);
    setSelected(null);
    navigate("decisions");
  };
  useEffect(() => {
    if (view !== "decisions" || !decisionReveal) return;
    const frame = requestAnimationFrame(() => {
      const option = document.querySelector<HTMLInputElement>(`input[name="${CSS.escape("decision-" + decisionReveal)}"]`);
      option?.closest(".inbox-item")?.scrollIntoView({ block: "start", behavior: "auto" });
      option?.focus({ preventScroll: true });
      setDecisionReveal(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [view, decisionReveal]);
  const switchWorkspace = (path: string) => {
    path = localWorkspaceKeys.find(key => sameWorkspace(key, path)) ?? resolveWorkspace(path, knownWorkspaces);
    setDecisionReveal(null);
    setWorkspace(path);
    setBoardReveal(null);
    setWorkspaceOpen(false);
    setSelected(null);
    try {
      localStorage.setItem("nexo-selected-workspace", path);
    } catch {}
  };
  const perform = async (key: string, action: () => Promise<void>, propagateFailure = false) => {
    if (busyOperation.current) {
      if (propagateFailure) throw Error("Outra operação está em andamento. Seu rascunho foi preservado.");
      return;
    }
    busyOperation.current = key;
    setBusy(key);
    setMessage("");
    setMessageTone("info");
    try {
      await performReportedAction(action, refresh, error => {
        setMessage(error instanceof Error ? error.message : "Operação indisponível.", "error");
      }, propagateFailure);
    } finally {
      busyOperation.current = null;
      setBusy(null);
    }
  };
  // Switching the project between supervised and autonomous is an explicit human
  // decision; autonomous still requires a saved objective and keeps review, budget and gates.
  const setAutonomyMode = (next: boolean) =>
    perform("autonomy", async () => {
      await api("/api/autonomy", "POST", {
        workspace,
        mode: next ? "autonomous" : "supervised",
      });
      setMessage(
        next
          ? "Modo autônomo ativado: o sistema decide, executa, revisa e integra sozinho, guiado pela carta e pelos objetivos salvos. Segredos, contas, dados privados, publicação externa e paradas explícitas suas continuam fora do alcance dele."
          : "Modo supervisionado ativado: as próximas decisões do fluxo aguardam você.",
      );
    });
  const save = async (kind: "direction" | "references") => {
    if (!connected || !directionsKnown || !workspace) return;
    return perform("save-" + kind, async () => {
      const row =
          kind === "direction"
            ? directionSave(saved, draft)
            : referenceSave(saved, draft),
        path = workspace;
      const updated = await api<Direction>(
        "/api/project-direction",
        "PATCH",
        row,
      );
      setSnapshot((current) =>
        current
          ? {
              ...current,
              project_directions: [
                ...(current.project_directions ?? []).filter(
                  (d) => !sameWorkspace(d.workspace, path),
                ),
                updated,
              ],
            }
          : current,
      );
      const keys =
        kind === "direction"
          ? charterKeys
          : (["repositories", "research_focus"] as const);
      setDrafts((current) => {
        const local = current[path];
        if (!local) return current;
        const next = { ...local };
        for (const key of keys)
          if (
            JSON.stringify(local[key] ?? "") === JSON.stringify(row[key] ?? "")
          )
            Object.assign(next, { [key]: updated[key] });
        return { ...current, [path]: next };
      });
      setMessage(
        kind === "direction"
          ? "Direção do projeto salva."
          : "Referências salvas. Você pode iniciar a investigação quando quiser.",
      );
    });
  };
  const startTask = (task: Task) => {
    if (!connected || queries.decisions.status !== "ready" || !sameWorkspace(task.workspace, workspace) || missionAction(task, projectDecisions.some(item => item.task_id === task.id)).kind !== "start") return Promise.resolve();
    return perform(task.id, async () => {
      const path = `/api/tasks/${task.id}/prepare`,
        body = { auto_implement: true };
      await admit(path, body, task.revision ?? 0);
      finishAdmission(path, body);
      setMessage(
        "Missão enviada para planejamento e implementação conforme as vagas e o plano validado.",
      );
    });
  };
  const stopTask = (task: Task) => {
    if (!connected || !sameWorkspace(task.workspace, workspace) || missionAction(task).kind !== "stop") return Promise.resolve();
    return perform(task.id, async () => {
      await api(`/api/tasks/${task.id}/stop`, "POST", {});
      setMessage("Solicitação de parada registrada.");
    });
  };
  // A decision is an explicit human answer to a typed question; retries reuse one request id so it applies once.
  const answerDecision = (item: DecisionItem, optionId: string, note?: string) => {
    if (!connected || queries.decisions.status !== "ready" || !projectDecisions.some(current => current.id === item.id)) return Promise.resolve();
    return perform("decision-" + item.id, async () => {
      const path = `/api/decisions/${item.id}/answer`,
        body = { option_id: optionId, ...(note ? { note } : {}) };
      await admit(path, body, 0);
      finishAdmission(path, body);
      setMessage("Decisão registrada. O ciclo retoma a missão no próximo ciclo.");
    });
  };
  const refreshCurrency = () =>
    void perform("currency-refresh", async () => {
      await api("/api/currency/refresh", "POST", {});
      setMessage("Cotação USD→BRL atualizada pela fonte pública.");
    });
  const request = assistance[workspace];
  useEffect(() => {
    if (!workspace || assistance[workspace]) return;
    const latest = snapshot?.tasks
      .filter((t) => sameWorkspace(t.workspace, workspace) && !t.archived_at && t.direction_assist)
      .sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      )[0];
    if (latest)
      setAssistance((current) =>
        current[workspace]
          ? current
          : {
              ...current,
              [workspace]: { task_id: latest.id, status: "queued" },
            },
      );
  }, [workspace, snapshot, assistance]);
  useEffect(() => {
    if (!request || !["queued", "running", "planning"].includes(request.status))
      return;
    let cancelled = false;
    const path = workspace;
    const controller = new AbortController();
    const poll = singleFlight(async () => {
      try {
        const result = await api<typeof request>(
          "/api/project-direction/assist/" + request.task_id, "GET", undefined, { signal: controller.signal },
        );
        if (!result || typeof result.status !== "string" || (result.questions && !Array.isArray(result.questions))) throw Error("Resposta da assistência incompatível.");
        if (!cancelled)
          setAssistance((current) => ({ ...current, [path]: result }));
      } catch (error) {
        if (!cancelled)
          setAssistance((current) => ({
            ...current,
            [path]: {
              ...request,
              status: "failed",
              reason:
                error instanceof Error
                  ? error.message
                  : "Assistência indisponível",
            },
          }));
      }
    });
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [workspace, request?.task_id, request?.status]);
  const openTask = (task: Task) => {
    if (!task.archived_at && sameWorkspace(task.workspace, workspace)) setSelected({ id: task.id });
  };
  const card = (task: Task) => (
    <MissionCard
      key={task.id}
      task={task}
      compact={view === "board"}
      specialistName={
        snapshot?.specialists?.find((s) => s.id === task.specialist)?.name
      }
      onOpen={() => openTask(task)}
      onStart={() => void startTask(task)}
      onStop={() => void stopTask(task)}
      pendingDecision={projectDecisions.some(item => item.task_id === task.id)}
      onDecision={() => openTaskDecision(task)}
      busy={!!busy || !connected}
      startDisabled={queries.decisions.status !== "ready"}
    />
  );

  return (
    <div className="mission-app">
      <NotificationCenter notices={notices} onDismiss={dismissNotice} />
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="main-navigation"
        className={`sidebar ${mobileNav ? "mobile-open" : ""}`}
        aria-label="Menu principal"
        role={mobileNav ? "dialog" : undefined}
        aria-modal={mobileNav || undefined}
      >
        <div className="brand">
          <button className="brand-home" aria-label="Orinonu · visão geral" onClick={() => navigate("overview")}>
            <span className="brand-mark"><OrinonuMark /></span>
            <span className="brand-wordmark">
              <strong>{brand.wordmark}</strong>
              <span>AGENTIC OS</span>
            </span>
          </button>
          <button
            className="mobile-close"
            aria-label="Fechar menu"
            onClick={() => setMobileNav(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="nav-label">PROJETO</div>
        <nav>
          {navigation.map((item, index) => (
            <div key={item.id}>
              {index === 4 && (
                <div className="nav-label operations-label">OPERAÇÃO</div>
              )}
              <button
                className={`nav-item ${view === item.id ? "selected" : ""}`}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.id === "board" && tasks.length > 0 && (
                  <span className="nav-count">{tasks.length}</span>
                )}
                {item.id === "decisions" && projectDecisions.length > 0 && (
                  <span className="nav-count attention">
                    {projectDecisions.length}
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-info">
            <Radio size={16} />
            <div>
              <strong>Operação local</strong>
              <span>Agentes + decisões tipadas</span>
            </div>
            <span
              className={`status-dot ${connected ? "online" : "offline"}`}
            />
          </div>
          <button
            className={`nav-item ${view === "settings" ? "selected" : ""}`}
            onClick={() => navigate("settings")}
            aria-current={view === "settings" ? "page" : undefined}
          >
            <Settings size={18} />
            Configurações
          </button>
          <button className="brand-community" onClick={() => { setMobileNav(false); setAboutOpen(true); }}>
            <span>UMA DIREÇÃO. MUITOS AGENTES.</span>
            <strong>Sobre Orinonu <ArrowUpRight size={14} /></strong>
            <small>Código comunitário · uso não comercial</small>
          </button>
          <span className="sidebar-footnote">{brand.tagline}</span>
        </div>
      </aside>
      <div className="main-shell" inert={mobileNav}>
        <div className="topbar">
          <button
            className="mobile-menu"
            aria-label="Abrir menu"
            aria-controls="main-navigation"
            aria-expanded={mobileNav}
            onClick={() => setMobileNav(true)}
          >
            <Menu size={22} />
          </button>
          <button
            className="project-picker"
            onClick={() => {
              setWorkspaceInput(workspace);
              setWorkspaceOpen(true);
            }}
            aria-label="Trocar projeto"
          >
            <span className="project-icon">
              <FolderGit2 size={19} />
            </span>
            <span>
              <small>PROJETO EM FOCO</small>
              <strong>{projectName(workspace)}</strong>
            </span>
            <ChevronDown size={16} />
          </button>
          <AutonomyModeSwitch
            className="topbar-autonomy"
            mode={autonomous ? "autonomous" : "supervised"}
            busy={busy === "autonomy"}
            disabledReason={modeDisabledReason}
            summary={modeSummary}
            onChange={(next) => void setAutonomyMode(next === "autonomous")}
          />
          <div className="connection-status" role="status">
            <span
              className={`status-dot ${connected ? "online" : "offline"}`}
            />
            <span>
              {connected
                ? "Conectado localmente"
                : snapshot
                  ? "Conexão interrompida"
                  : queries.snapshot.status === "error" ? "Consulta indisponível" : "Conectando…"}
            </span>
            {pauseMessage && <button type="button" className="executor-pause-chip" aria-label="Ver aviso de execução pausada" onClick={() => setPauseNotice(pauseMessage)}>Execução pausada</button>}
            {lastUpdate && (
              <small title="Última atualização">{date(lastUpdate)}</small>
            )}
          </div>
        </div>
        <main id="content" className={view === "board" ? "board-content" : undefined} tabIndex={-1}>
          <header className="page-heading">
            <div>
              {view !== "board" && (
                <div className="eyebrow">
                  CENTRO DE COMANDO <span>/</span> {projectName(workspace)}
                </div>
              )}
              <h1>
                {navigation.find((n) => n.id === view)?.label ??
                  "Configurações"}
              </h1>
              {view !== "board" && <p>{descriptions[view]}</p>}
            </div>
            <Button
              className="new-mission"
              onClick={() => setNewMission(true)}
              disabled={!connected || !workspace}
            >
              <Plus size={17} />
              Nova missão
            </Button>
          </header>
          {!snapshot ? (
            <div className="loading-state">
              {queries.snapshot.status === "loading" && <Loader2 className="spin" size={28} />}
              <ResourceState title="Missões e projeto" query={queries.snapshot} onRetry={() => void retry("snapshot")} />
            </div>
          ) : (
            <MissionViewBoundary key={`${view}:${workspace}`} onRetry={refresh}>
              {queries.snapshot.status !== "ready" && <ResourceState title="Missões e projeto" query={queries.snapshot} onRetry={() => void retry("snapshot")} />}
              {!workspace && <p className="section-note" role="status">Selecione um projeto para consultar seu trabalho. Métricas da instalação são identificadas como globais.</p>}
              {view === "overview" && (
                <div className="overview">
                  <Card className="objective-hero">
                    <div className="hero-orbit" aria-hidden="true">
                      <OrinonuMark />
                    </div>
                    <div className="hero-top">
                      <span className="eyebrow">
                        <Target size={14} /> OBJETIVO EM FOCO
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => navigate("direction")}
                      >
                        Ver direção <ArrowUpRight size={16} />
                      </Button>
                    </div>
                    <h2>
                      {saved?.objective || "Dê uma direção ao próximo avanço."}
                    </h2>
                    <p>
                      {saved?.mission ||
                        "Defina o propósito do projeto e o resultado que orientará cada missão."}
                    </p>
                    <div className="hero-evidence">
                      <span>
                        <CheckCircle2 size={15} />
                        EVIDÊNCIAS DE SUCESSO
                      </span>
                      <p>
                        {saved?.success_criteria ||
                          "Registre critérios concretos para reconhecer uma entrega bem-sucedida."}
                      </p>
                    </div>
                  </Card>
                  <div className="stat-grid">
                    {[
                      {
                        label: "Em atividade",
                        lane: active[0] ? laneOf(active[0]) : "running",
                        value: active.length,
                        icon: Activity,
                        tone: "teal",
                        note: "Sessões e etapas em andamento",
                      },
                      {
                        label: "Precisam de atenção",
                        lane: attention[0] ? laneOf(attention[0]) : "blocked",
                        value: attention.length,
                        icon: ShieldCheck,
                        tone: "amber",
                        note: `${tasks.filter((t) => laneOf(t) === "blocked" && !isActive(t)).length} bloqueadas · ${tasks.filter((t) => laneOf(t) === "review" && !isActive(t)).length} em revisão`,
                      },
                      {
                        label: "No backlog",
                        lane: "backlog",
                        value: tasks.filter((t) => laneOf(t) === "backlog")
                          .length,
                        icon: LayersIcon,
                        tone: "blue",
                        note: "Objetivos aguardando o próximo passo",
                      },
                      {
                        label: "Concluídas",
                        lane: "done",
                        value: tasks.filter((t) => laneOf(t) === "done").length,
                        icon: CheckCircle2,
                        tone: "purple",
                        note: "Missões registradas como concluídas",
                      },
                    ].map((s) => (
                      <button
                        className={`stat-card tone-${s.tone}`}
                        key={s.label}
                        disabled={!workspace}
                        onClick={() => revealBoard(s.lane)}
                      >
                        <span className="stat-label">
                          {s.label}
                          <s.icon size={18} />
                        </span>
                        <strong>{workspace ? s.value.toString().padStart(2, "0") : "—"}</strong>
                        <small>{s.note}</small>
                      </button>
                    ))}
                  </div>
                  <div className="overview-columns autonomy-row">
                    <div>
                      <ResourceState title="Saúde da autonomia" query={queries.flow} onRetry={() => void retry("flow")} />
                      {queries.flow.updatedAt && knownHealth && queries.decisions.status === "ready" && <AutonomyHealthPanel
                        flow={projectFlow}
                        awaitingYou={projectDecisions.length}
                        titles={Object.fromEntries(tasks.map((t) => [t.id, t.title]))}
                        onOpenDecisions={() => navigate("decisions")}
                      />}
                      {queries.flow.status === "ready" && !knownHealth && <p className="empty-copy">Saúde da autonomia não informada para este projeto.</p>}
                    </div>
                    <div>
                      <ResourceState title="Caixa de decisões" query={queries.decisions} onRetry={() => void retry("decisions")} />
                      {(queries.decisions.status === "ready" || projectDecisions.length > 0) && <DecisionInboxCard
                        items={projectDecisions}
                        onOpen={() => navigate("decisions")}
                      />}
                    </div>
                  </div>
                  <div className="overview-columns">
                    <Card className="work-panel">
                      <SectionTitle
                        icon={Activity}
                        title="Em atividade e na fila"
                        count={active.length}
                        action={() => navigate("board")}
                        actionLabel="Ver missões"
                      />
                      <p className="muted">Capacidade por etapa · instalação global, todos os projetos.</p>
                      <OperationsStrip scheduler={snapshot.scheduler} />
                      <div className="active-missions">
                        {active.length ? (
                          active.slice(0, 4).map(card)
                        ) : (
                          <Empty
                            icon={Activity}
                            title="Pronto para o próximo avanço"
                            text="Selecione uma missão no backlog para iniciar o planejamento."
                            action={() => navigate("board")}
                            actionLabel="Abrir missões"
                          />
                        )}
                      </div>
                    </Card>
                    <Card className="attention-panel">
                      <SectionTitle
                        icon={ShieldCheck}
                        title="Revisões e bloqueios"
                        count={attention.length}
                      />
                      {attention.slice(0, 4).map((t) => (
                        <button
                          className="attention-row"
                          key={t.id}
                          onClick={() => openTask(t)}
                        >
                          <span className={`lane-dot lane-${laneOf(t)}`} />
                          <span>
                            <strong>{t.title}</strong>
                            <small>
                              {statusLabels[t.status]} ·{" "}
                              {t.pipeline?.reason ??
                                "Abra os detalhes para consultar as evidências."}
                            </small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                      {!attention.length && (
                        <Empty
                          icon={CheckCircle2}
                          title="Nenhuma revisão ou bloqueio"
                          text="Bloqueios e revisões aparecerão aqui."
                        />
                      )}
                      {attention.length > 4 && (
                        <Button
                          variant="ghost"
                          onClick={() => navigate("board")}
                        >
                          Ver {attention.length} missões{" "}
                          <ArrowRight size={16} />
                        </Button>
                      )}
                      <div className="direction-health">
                        <span className="eyebrow">BASE DO PROJETO</span>
                        <div className="health-items">
                          {[
                            { label: "Objetivo", ok: !!saved?.objective },
                            {
                              label: "Critérios de sucesso",
                              ok: !!saved?.success_criteria,
                            },
                            {
                              label: "Missão e visão",
                              ok: !!saved?.mission && !!saved?.vision,
                            },
                            {
                              label: "Referências",
                              ok: !!saved?.repositories?.length,
                            },
                          ].map((i) => (
                            <span key={i.label}>
                              {i.ok ? (
                                <Check size={14} />
                              ) : (
                                <Circle size={12} />
                              )}{" "}
                              {i.label}
                            </span>
                          ))}
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => navigate("direction")}
                        >
                          Revisar direção <ArrowRight size={14} />
                        </Button>
                      </div>
                    </Card>
                  </div>
                  <details className="overview-disclosure" open={economyExpanded} onToggle={event => setEconomyExpanded(event.currentTarget.open)}>
                    <summary>Custos e evidências financeiras · projeto e instalação</summary>
                    {economyExpanded && <EconomyPanel
                      economy={economy}
                      missions={projectMissions}
                      workspace={workspace}
                      busy={busy}
                      connected={connected}
                      projectCost={projectCost}
                      projectMissionCount={projectMissions.length}
                      projectPriced={projectPriced}
                      onRefresh={refreshCurrency}
                      onOpenMission={id => { const task = snapshot.tasks.find(row => row.id === id && sameWorkspace(row.workspace, workspace)); if (task) openTask(task); }}
                      onOpenEvaluations={() => navigate("evaluations")}
                    />}
                  </details>
                  <details className="overview-disclosure" open={researchExpanded} onToggle={event => setResearchExpanded(event.currentTarget.open)}>
                    <summary>Pesquisa, referências e últimos avanços · projeto em foco</summary>
                    {researchExpanded && <div className="overview-columns bottom-panels">
                    <ResearchPanel
                      references={saved?.repositories}
                      focus={saved?.research_focus}
                      opportunities={opportunities}
                      opportunitiesKnown={opportunitiesKnown}
                      investigations={investigations}
                      onOpenTask={openTask}
                      onNavigate={() => navigate("research")}
                    />
                    <Card className="recent-panel">
                      <SectionTitle icon={GitBranch} title="Últimos avanços" />
                      {[...tasks]
                        .filter((t) => t.ended_at)
                        .sort((a, b) =>
                          (b.ended_at ?? "").localeCompare(a.ended_at ?? ""),
                        )
                        .slice(0, 4)
                        .map((t) => (
                          <button
                            className="recent-row"
                            key={t.id}
                            onClick={() => openTask(t)}
                          >
                            <span className={`lane-dot lane-${laneOf(t)}`} />
                            <strong>{t.title}</strong>
                            <span>{statusLabels[t.status]}</span>
                            <small>{date(t.ended_at)}</small>
                          </button>
                        ))}
                      {!tasks.some((t) => t.ended_at) && (
                        <p className="empty-copy">
                          As execuções finalizadas aparecerão aqui.
                        </p>
                      )}
                    </Card>
                  </div>}
                  </details>
                  <details className="overview-disclosure">
                    <summary>Etapas e perfis · instalação global</summary>
                    <WorkflowOverview profiles={snapshot.profiles} />
                  </details>
                </div>
              )}
              {view === "direction" && (
                <form
                  className="direction-page"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save("direction");
                  }}
                >
                  <div className="section-note">
                    <Compass size={20} />
                    <p>
                      Uma direção por projeto. Estes objetivos orientam a
                      priorização e a investigação de melhorias.
                    </p>
                    <Badge variant="outline">
                      {charterDirty
                        ? "Rascunho local"
                        : saved
                          ? "Direção salva"
                          : "A definir"}
                    </Badge>
                  </div>
                  <Card className="direction-result">
                    <SectionTitle
                      icon={Target}
                      title="Resultado e evidências"
                      subtitle="O foco que conecta intenção e entrega."
                    />
                    <div className="field-grid">
                      {fields.slice(0, 2).map((f) => (
                        <DirectionField
                          key={f.key}
                          field={f}
                          value={draft[f.key] ?? ""}
                          onChange={(value) => updateDraft({ [f.key]: value })}
                        />
                      ))}
                    </div>
                  </Card>
                  <Card className="charter-panel">
                    <SectionTitle
                      icon={Compass}
                      title="Identidade do projeto"
                      subtitle="A base permanente para orientar decisões."
                    />
                    <div className="field-grid">
                      {fields.slice(2).map((f) => (
                        <DirectionField
                          key={f.key}
                          field={f}
                          value={draft[f.key] ?? ""}
                          onChange={(value) => updateDraft({ [f.key]: value })}
                        />
                      ))}
                    </div>
                  </Card>
                  {!directionsKnown && <div role="status" className="resource-state"><p>Direção salva não informada pelo servidor. Seu rascunho pode ser editado, mas não salvo até uma consulta compatível.</p><Button type="button" variant="outline" onClick={() => void retry("snapshot")}>Atualizar consulta do projeto</Button></div>}
                  <div className="save-bar">
                    <span>
                      {charterDirty ? (
                        <>
                          <span className="draft-dot" />
                          Alterações ainda não salvas
                        </>
                      ) : saved?.updated_at ? (
                        `Salvo em ${date(saved.updated_at)}`
                      ) : (
                        "Defina a direção para este projeto"
                      )}
                    </span>
                    <Button
                      type="submit"
                      disabled={!!busy || !connected || !workspace || !directionsKnown}
                    >
                      {busy === "save-direction" ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      Salvar direção
                    </Button>
                  </div>
                  <Card className="assistant-panel">
                    <div>
                      <Sparkles size={20} />
                      <h3>Uma ajuda para formular a direção</h3>
                      <p>
                        O agente prepara uma proposta a partir do projeto. Você
                        revisa o rascunho antes de salvar.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !!busy ||
                        !connected ||
                        !workspace ||
                        (!!request &&
                          ["queued", "running", "planning"].includes(
                            request.status,
                          ))
                      }
                      onClick={() =>
                        void perform("assist", async () => {
                          const result = await api<{ task_id: string }>(
                            "/api/project-direction/assist",
                            "POST",
                            draft,
                          );
                          setAssistance((current) => ({
                            ...current,
                            [workspace]: { ...result, status: "queued" },
                          }));
                          setMessage(
                            "Assistência iniciada. A proposta ficará disponível para revisão.",
                          );
                        })
                      }
                    >
                      <Sparkles size={15} />
                      Ajudar a definir objetivos
                    </Button>
                    {request && (
                      <div className="assistant-output" role="status">
                        <p>
                          {request.reason ??
                            (["queued", "running", "planning"].includes(
                              request.status,
                            )
                              ? "Agente preparando a proposta…"
                              : "Proposta recebida para revisão.")}
                        </p>
                        {request.questions?.map((q) => (
                          <p key={q}>{q}</p>
                        ))}
                        {request.proposal && (
                          <>
                            <details>
                              <summary>Revisar proposta</summary>
                              {fields.map(
                                (f) =>
                                  request.proposal?.[f.key] && (
                                    <div key={f.key}>
                                      <strong>{f.label}</strong>
                                      <p>{request.proposal[f.key]}</p>
                                    </div>
                                  ),
                              )}
                            </details>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                updateDraft(request.proposal ?? {});
                                setMessage(
                                  "Proposta aplicada ao rascunho. Revise os campos e salve para alterar a direção.",
                                );
                              }}
                            >
                              Aplicar ao rascunho
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </Card>
                </form>
              )}
              {view === "board" && (
                <div className="missions-page" ref={boardAreaRef}>
                  <KanbanBoard
                    listMode={false}
                    renderCard={card}
                    columns={lanes.map((lane) => ({
                      id: lane,
                      label: lane === "backlog" ? "Fila" : lane === "running" ? "Implementação" : laneLabels[lane],
                      tasks: boardTasks.filter((task) => laneOf(task) === lane),
                    }))}
                  />
                </div>
              )}
              {view === "research" && (
                <div className="research-page">
                  <div className="research-flow">
                    <span>
                      <Github size={17} />
                      Referências
                    </span>
                    <ArrowRight size={14} />
                    <span>
                      <Search size={17} />
                      Investigação
                    </span>
                    <ArrowRight size={14} />
                    <span>
                      <Sparkles size={17} />
                      Propostas
                    </span>
                    <ArrowRight size={14} />
                    <span>
                      <Target size={17} />
                      Missões
                    </span>
                  </div>
                  <div className="research-columns">
                    <Card className="references-panel">
                      <SectionTitle
                        icon={Github}
                        title="Concorrentes e projetos de referência"
                        subtitle="Bases de código que podem informar a evolução do projeto."
                      />
                      <label className="form-field" htmlFor="repositories">
                        <span>
                          Repositórios GitHub <small>até 8 referências</small>
                        </span>
                        <Textarea
                          id="repositories"
                          rows={5}
                          placeholder={
                            "https://github.com/organização/projeto\nUm repositório por linha"
                          }
                          value={(draft.repositories ?? []).join("\n")}
                          onChange={(e) =>
                            updateDraft({
                              repositories: e.target.value.split(/\r?\n/),
                            })
                          }
                        />
                        <small>
                          URLs públicas que você deseja usar como referência.
                        </small>
                      </label>
                      <label className="form-field" htmlFor="research-focus">
                        <span>Foco da análise</span>
                        <Textarea
                          id="research-focus"
                          rows={3}
                          maxLength={800}
                          value={draft.research_focus ?? ""}
                          onChange={(e) =>
                            updateDraft({ research_focus: e.target.value })
                          }
                          placeholder="Quais componentes, fluxos ou decisões queremos investigar?"
                        />
                      </label>
                      <div className="reference-actions">
                        <Button
                          variant="outline"
                          disabled={!!busy || !connected || !workspace || !directionsKnown}
                          onClick={() => void save("references")}
                        >
                          {busy === "save-references" ? (
                            <Loader2 className="spin" size={15} />
                          ) : (
                            <Check size={15} />
                          )}
                          Salvar referências
                        </Button>
                        <Button
                          disabled={
                            !!busy ||
                            !connected ||
                            !draft.repositories?.some((repo) => repo.trim()) ||
                            !opportunitiesKnown ||
                            opportunities.length >= 3 ||
                            !workspace
                          }
                          onClick={() =>
                            void perform("research", async () => {
                              await api("/api/opportunities/research", "POST", {
                                workspace,
                                repositories: draft.repositories
                                  ?.map((repo) => repo.trim())
                                  .filter(Boolean),
                                focus: draft.research_focus?.trim() ?? "",
                              });
                              setMessage(
                                "Análise de referências enviada à investigação. Acompanhe a atividade abaixo.",
                              );
                            })
                          }
                        >
                          <Search size={15} />
                          Investigar referências
                        </Button>
                      </div>
                      <small className="draft-caption">
                        {referencesDirty
                          ? "Referências alteradas · rascunho local"
                          : "Referências salvas para este projeto"}
                      </small>
                    </Card>
                    <Card className="investigate-panel">
                      <span className="research-icon">
                        <Compass size={25} />
                      </span>
                      <h2>Investigar o próprio projeto</h2>
                      <p>
                        Identifique melhorias alinhadas ao objetivo, aos
                        princípios e às evidências da base de código.
                      </p>
                      <div className="research-context">
                        <span className="eyebrow">
                          DIREÇÃO USADA NA INVESTIGAÇÃO
                        </span>
                        <p>
                          {saved?.objective ||
                            "O projeto ainda não tem um objetivo salvo."}
                        </p>
                        <button onClick={() => navigate("direction")}>
                          Revisar objetivos <ArrowUpRight size={14} />
                        </button>
                      </div>
                      <Button
                        variant="outline"
                        disabled={
                          !!busy ||
                          !connected ||
                          !workspace ||
                          !opportunitiesKnown ||
                          opportunities.length >= 3
                        }
                        onClick={() =>
                          void perform("investigate", async () => {
                            await api(
                              "/api/opportunities/investigate",
                              "POST",
                              { workspace },
                            );
                            setMessage(
                              "Investigação do projeto iniciada em modo de leitura.",
                            );
                          })
                        }
                      >
                        <Sparkles size={15} />
                        Identificar oportunidades
                      </Button>
                    </Card>
                  </div>
                  <div className="research-proposals">
                    <SectionTitle
                      icon={Sparkles}
                      title="Propostas para tomar decisões"
                      count={opportunitiesKnown ? opportunities.length : undefined}
                      subtitle={`${autonomous ? "JEV avalia propostas conforme a direção salva e o modo autônomo." : "Revise as evidências antes de aprovar uma investigação."} ${!opportunitiesKnown ? "Propostas e capacidade não informadas pelo servidor." : opportunities.length >= 3 ? "Capacidade cheia. Aprove ou descarte propostas para liberar espaço para novas pesquisas." : `${3 - opportunities.length} vagas disponíveis para novas propostas.`}`}
                    />
                    <div className="proposal-grid">
                      {opportunities.map((o) => (
                        <Card key={o.id} className="proposal-card">
                          <span className="eyebrow">
                            PROPOSTA · {o.source ?? "INVESTIGAÇÃO"}
                          </span>
                          <h3>{o.title}</h3>
                          <p>{o.recommendation ?? o.goal}</p>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setSelected({ id: o.id, opportunity: true })
                            }
                          >
                            Ver proposta e evidências <ArrowUpRight size={15} />
                          </Button>
                        </Card>
                      ))}
                    </div>
                    {!opportunitiesKnown && <div className="resource-state" role="status"><p>Propostas não informadas. Atualize a consulta antes de iniciar uma pesquisa.</p><Button variant="outline" onClick={() => void retry("snapshot")}>Atualizar consulta do projeto</Button></div>}
                    {opportunitiesKnown && !opportunities.length && (
                      <Empty
                        icon={BookOpen}
                        title="As próximas melhorias começam na pesquisa"
                        text="Uma investigação registra propostas com evidências para você avaliar."
                      />
                    )}
                  </div>
                  <Card className="research-history">
                    <SectionTitle
                      icon={Activity}
                      title="Atividade das investigações"
                    />
                    {investigations.map((t) => (
                        <button
                          className="investigation-row"
                          key={t.id}
                          onClick={() => openTask(t)}
                        >
                          <span className="research-icon">
                            <Search size={16} />
                          </span>
                          <span>
                            <strong>{t.title}</strong>
                            <small>
                              {statusLabels[t.status] ?? t.status} ·{" "}
                              {date(t.created_at)}
                            </small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    {!snapshot.tasks.some(
                      (t) => sameWorkspace(t.workspace, workspace) && !t.archived_at && t.opportunity_audit,
                    ) && (
                      <p className="empty-copy">
                        Nenhuma investigação registrada neste projeto.
                      </p>
                    )}
                    <p className="native-copy">Abra uma investigação acima para consultar suas etapas e relatórios completos.</p>
                  </Card>
                </div>
              )}
              {view === "evaluations" && (
                <EvolutionView workspace={workspace} />
              )}
              {view === "decisions" && (
                <div className="decisions-page">
                  <p className="section-note">Perguntas do projeto {projectName(workspace)}. Perguntas sem projeto declarado pertencem à instalação global.</p>
                  <ResourceState title="Caixa de decisões" query={queries.decisions} onRetry={() => void retry("decisions")} />
                  {(queries.decisions.status === "ready" || projectDecisions.length > 0) && <DecisionInbox
                    items={projectDecisions}
                    busy={!connected || queries.decisions.status !== "ready" ? "query-unavailable" : busy}
                    onAnswer={answerDecision}
                  />}
                  {snapshot && <DecisionHistory snapshot={snapshot} workspace={workspace} />}
                </div>
              )}
              {view === "settings" && (
                <div className="settings-page-container">
                  <JevSettings />
                  <SettingsView workspace={workspace} />
                </div>
              )}
              {view === "agents" && snapshot && (
                <div className="native-page">
                  <AgentsView snapshot={snapshot} disabled={!!busy || !connected} onSave={(phase, model, effort) => perform("profile-" + phase, async () => { await api("/api/profiles", "PATCH", { phase, model, effort }); setMessage("Perfil de etapa atualizado."); }, true)} />
                  <QueueControls scheduler={snapshot.scheduler} disabled={!!busy || !connected} onSave={limits => perform("scheduler", async () => { await api("/api/scheduler", "PATCH", limits); setMessage("Limites da instalação atualizados."); })} />
                </div>
              )}
              {view === "curation" && snapshot && <CurationView snapshot={snapshot} />}
              {view === "updates" && <UpdatesView />}
            </MissionViewBoundary>
          )}
          <footer className="page-footer">
            <span>
              {brand.name} <span>·</span> Agentic OS
            </span>
            <UpdateIndicator onOpen={() => navigate("updates")} />
            <span>
              Projeto local <span>·</span>{" "}
              {autonomous ? "Operação autônoma" : "Operação supervisionada"}
            </span>
          </footer>
        </main>
      </div>
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="brand-dialog">
          <DialogHeader>
            <div className="brand-dialog-mark"><OrinonuMark /></div>
            <DialogTitle>{brand.name}</DialogTitle>
            <DialogDescription>{brand.tagline}</DialogDescription>
          </DialogHeader>
          <div className="brand-identity">
            <OriInonuPresence />
            <div>
              <h3 className="brand-symbolic-name">{brand.symbolicName}</h3>
              <p className="brand-narrative">{brand.narrative}</p>
              <div className="brand-personality">{brand.personality.map(quality => <span key={quality}>{quality}</span>)}</div>
              <p className="brand-purpose">{brand.purpose}</p>
            </div>
          </div>
          <div className="brand-principles">
            <section><Compass size={20} /><h3>Uma direção compartilhada</h3><p>Objetivos, linguagem comum e evidências orientam cada contribuição. A comunidade evolui os meios; o mantenedor preserva a direção oficial.</p></section>
            <section><Users size={20} /><h3>Muitas inteligências</h3><p>Cada instalação usa suas próprias credenciais, assinatura ou API. A visão é colaboração em equipe sem compartilhar segredos; um serviço multiusuário hospedado ainda exige implementação própria.</p></section>
            <section><GitBranch size={20} /><h3>Construção comunitária</h3><p>{brand.community} Serviços oficiais de infraestrutura, hospedagem e suporte poderão ser pagos, sem retirar o código comunitário publicado.</p></section>
          </div>
          <p className="brand-license">PolyForm Noncommercial 1.0.0 · source-available, não open source OSI. Componentes de terceiros preservam suas licenças.</p>
        </DialogContent>
      </Dialog>
      <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <DialogContent className="project-dialog">
          <DialogHeader>
            <DialogTitle>Escolher projeto</DialogTitle>
            <DialogDescription>
              Missões, direção e referências acompanham o projeto selecionado.
            </DialogDescription>
          </DialogHeader>
          <div className="project-options">
            {workspaces.map((path) => (
              <button key={path} onClick={() => switchWorkspace(path)}>
                <FolderGit2 size={18} />
                <span>
                  <strong>{projectName(path)}</strong>
                  <small>{path}</small>
                </span>
                {path === workspace && <Check size={17} />}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (workspaceInput.trim()) switchWorkspace(workspaceInput.trim());
            }}
          >
            <label className="form-field" htmlFor="workspace-path">
              <span>Outro projeto local</span>
              <Input
                id="workspace-path"
                value={workspaceInput}
                onChange={(e) => setWorkspaceInput(e.target.value)}
                placeholder="C:\projetos\meu-projeto"
              />
            </label>
            <Button type="submit" disabled={!workspaceInput.trim()}>
              Usar este projeto <ArrowRight size={15} />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className={`mission-dialog ${selected?.opportunity ? "" : "mission-evidence-dialog"}`}>
          <DialogHeader>
            <DialogTitle>
              {selected?.opportunity
                ? selectedOpportunity?.title
                : selectedTask?.title}
            </DialogTitle>
            <DialogDescription>
              {selected?.opportunity
                ? "Proposta de investigação · revise o escopo e as evidências."
                : (statusLabels[selectedTask?.status ?? ""] ??
                  "Detalhes da missão")}
            </DialogDescription>
          </DialogHeader>
          {selected?.opportunity && selectedOpportunity ? (
            <OpportunityDetail
              opportunity={selectedOpportunity}
              busy={!!busy || !connected}
              onAction={(action) =>
                void perform(selectedOpportunity.id, async () => {
                  await api(
                    `/api/opportunities/${selectedOpportunity.id}/${action}`,
                    "POST",
                    {},
                  );
                  setSelected(null);
                  setMessage(
                    action === "approve"
                      ? "Investigação aprovada e criada no backlog."
                      : "Proposta descartada.",
                  );
                })
              }
            />
          ) : (
            selectedTask && (
              <MissionViewBoundary key={selectedTask.id} onRetry={refresh}>
              <TaskDetail
                key={selectedTask.id}
                task={selectedTask}
                decisions={projectDecisions.filter(item => item.task_id === selectedTask.id)}
                decisionEvents={snapshot?.events?.filter(event => event.task_id === selectedTask.id && event.kind.includes("decision"))}
                onOpenDecisions={() => openTaskDecision(selectedTask)}
                specialist={
                  snapshot?.specialists?.find(
                    (s) => s.id === selectedTask.specialist,
                  )?.name
                }
                onStart={() => void startTask(selectedTask)}
                onStop={() => void stopTask(selectedTask)}
                busy={!!busy || !connected}
                decisionsQuery={queries.decisions}
                onRetryDecisions={() => void retry("decisions")}
                workspace={workspace}
              />
              </MissionViewBoundary>
            )
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={newMission} onOpenChange={setNewMission}>
        <DialogContent className="new-mission-dialog">
          <DialogHeader>
            <DialogTitle>Nova missão</DialogTitle>
            <DialogDescription>
              Defina um resultado verificável para {projectName(workspace)}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = Object.fromEntries(new FormData(form));
              void perform("new-mission", async () => {
                await api("/api/tasks", "POST", {
                  ...values,
                  workspace,
                  agent: "codex",
                  profile: "implementation",
                  plan: true,
                  max_minutes: Number(values.max_minutes),
                  phase_limits: {
                    planning: Number(values.planning_minutes),
                    implementation: Number(values.max_minutes),
                    review: Number(values.review_minutes),
                  },
                });
                setNewMission(false);
                navigate("board");
                setMessage(
                  "Missão criada. Consulte o plano e eventuais pendências antes de executar.",
                );
              });
            }}
          >
            <label className="form-field">
              <span>Título da missão</span>
              <Input
                name="title"
                required
                maxLength={120}
                placeholder="Qual melhoria será entregue?"
              />
            </label>
            <label className="form-field">
              <span>Objetivo</span>
              <Textarea
                name="goal"
                required
                rows={3}
                placeholder="Descreva o resultado esperado."
              />
            </label>
            <label className="form-field">
              <span>Critérios de sucesso</span>
              <Textarea
                name="acceptance"
                required
                rows={3}
                placeholder="Como a entrega será verificada?"
              />
            </label>
            <label className="form-field">
              <span>Especialista inicial</span>
              <select name="specialist" defaultValue="generalist">
                {snapshot?.specialists?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="phase-budgets">
              <legend>Limite por etapa · minutos</legend>
              {[
                { name: "planning_minutes", label: "Planejamento", value: 15 },
                { name: "max_minutes", label: "Implementação", value: 30 },
                { name: "review_minutes", label: "Revisão", value: 15 },
              ].map((p) => (
                <label key={p.name}>
                  <span>{p.label}</span>
                  <Input
                    name={p.name}
                    type="number"
                    min={1}
                    max={720}
                    defaultValue={p.value}
                    required
                  />
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={!!busy || !connected}>
              {busy === "new-mission" ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              Criar missão e consultar plano
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export function ResourceState({ title, query, onRetry }: { title: string; query: QueryState; onRetry: () => void }) {
  if (query.status === "ready") return null;
  return <Card className={`resource-state state-${query.status}`} aria-label={title}>
    <div role={query.status === "error" ? "alert" : "status"}>
      <strong>{title} · {query.status === "loading" ? "Carregando…" : query.status === "stale" ? "Dados desatualizados" : "Consulta indisponível"}</strong>
      <p>{query.error ?? "Aguardando uma resposta válida; pendências e contagens ainda são desconhecidas."}</p>
      {query.updatedAt && <small>Última resposta válida: {date(query.updatedAt)}. Ações dependentes ficam bloqueadas até atualizar.</small>}
    </div>
    <Button variant="outline" onClick={onRetry} disabled={query.status === "loading"}>Tentar novamente</Button>
  </Card>;
}

function LayersIcon({ size = 18 }: { size?: number }) {
  return <LayoutGrid size={size} />;
}
function SectionTitle({
  icon: Icon,
  title,
  subtitle,
  count,
  action,
  actionLabel,
}: {
  icon: typeof Activity;
  title: string;
  subtitle?: string;
  count?: number;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>
          <Icon size={17} />
          {title}
          {count !== undefined && <span className="count-badge">{count}</span>}
        </h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && (
        <Button variant="ghost" size="sm" onClick={action}>
          {actionLabel}
          <ArrowUpRight size={14} />
        </Button>
      )}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
  actionLabel,
}: {
  icon: typeof Activity;
  title: string;
  text: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <Button variant="outline" onClick={action}>
          {actionLabel}
          <ArrowRight size={15} />
        </Button>
      )}
    </div>
  );
}
function OperationsStrip({ scheduler }: { scheduler?: Snapshot["scheduler"] }) {
  if (!scheduler) return null;
  const count = (value?: number) => (Number.isFinite(value) ? value : null),
    limits: Record<string, number | undefined> = {
      planning: scheduler.planning_limit,
      implementation: scheduler.implementation_limit,
      review: scheduler.review_limit,
    };
  return (
    <div className="phase-strip" role="list">
      {[
        { id: "planning", label: "Planejamento", lane: "planning" },
        { id: "implementation", label: "Implementação", lane: "running" },
        { id: "review", label: "Revisão", lane: "review" },
      ].map((phase) => {
        const running = count(scheduler.running?.[phase.id]),
          queued = count(scheduler.queued?.[phase.id]),
          limit = count(limits[phase.id]);
        return (
          <div className="phase-chip" role="listitem" key={phase.id}>
            <span className={`lane-dot lane-${phase.lane}`} />
            <span>
              <strong>{phase.label}</strong>
              <small>
                {running ?? "—"} em execução · {queued ?? "—"} na fila
                {limit !== null ? ` · limite ${limit}` : ""}
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}
function EconomyPanel({
  economy,
  missions,
  workspace,
  busy,
  connected,
  projectCost,
  projectMissionCount,
  projectPriced,
  onRefresh,
  onOpenMission,
  onOpenEvaluations,
}: {
  economy: EconomySummary;
  missions: EconomySummary["missions"];
  workspace: string;
  busy: string | null;
  connected: boolean;
  projectCost: { usd: number | null; brl: number | null };
  projectMissionCount: number;
  projectPriced: number;
  onRefresh: () => void;
  onOpenMission: (id: string) => void;
  onOpenEvaluations: () => void;
}) {
  const measured = economy.measured,
    quote = economy.quote,
    statusLabel =
      economy.rateStatus === "available"
        ? "Cotação de referência"
        : economy.rateStatus === "stale"
          ? "Cotação desatualizada"
          : economy.rateStatus === "unavailable"
            ? "Cotação indisponível"
            : "Cotação não configurada";
  const measuredText =
    measured.status === "measured"
      ? `${measured.seconds !== null ? `${formatSeconds(measured.seconds)} de diferença · ` : ""}${measured.controlledPairs ?? "—"} pares controlados`
      : measured.status === "regression"
        ? `Regressão observada nos pares controlados${measured.regressions ? ` · ${measured.regressions} reprovada(s)` : ""}`
        : measured.status === "neutral"
          ? "Sem ganho de custo observado nos pares controlados"
          : "Economia medida não informada. Ela exige pares controlados aceitos em Avaliações e evidências.";
  return (
    <Card className="economy-panel">
      <div className="economy-head">
        <SectionTitle
          icon={Coins}
          title="Economia e custos"
          subtitle="Totais, tokens, tempo e pares controlados: instalação global. Custos por missão: apenas o projeto em foco. Estimativas de API, não cobranças ou franquia de assinatura."
        />
        <div className="quote-box">
          <div className="quote-rate">
            <span
              className={`status-dot ${economy.rateStatus === "available" ? "online" : economy.rateStatus === "stale" ? "stale" : "offline"}`}
            />
            <span>
              <strong>
                {economy.rate
                  ? `US$ 1 = ${formatBrl(economy.rate)}`
                  : statusLabel}
              </strong>
              <small>
                {quote?.fetched_at
                  ? `${statusLabel} · ${date(quote.fetched_at)}`
                  : economy.rateStatus === "missing"
                    ? "Nenhuma cotação pública preservada nesta instalação."
                    : "Sem data registrada."}
              </small>
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || !connected}
            onClick={onRefresh}
          >
            {busy === "currency-refresh" ? (
              <Loader2 className="spin" size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            Atualizar cotação
          </Button>
        </div>
      </div>
      {quote?.refresh?.error && (
        <p className="economy-warning" role="status">
          {quote.refresh.error}
        </p>
      )}
      <div className="economy-grid">
        <div className="economy-stat">
          <span>Custo estimado · operação</span>
          <strong>{formatBrl(economy.totalBrl)}</strong>
          <small>
            {economy.totalUsd !== null
              ? `≈ ${formatUsd(economy.totalUsd)} · todos os projetos`
              : "Sem preço para parte das chamadas"}
          </small>
        </div>
        <div className={`economy-stat status-${measured.status}`}>
          <span>
            Economia medida{" "}
            {measured.status === "measured" ? (
              <TrendingUp size={14} />
            ) : measured.status === "regression" ? (
              <TrendingDown size={14} />
            ) : null}
          </span>
          <strong>{formatBrl(measured.brl)}</strong>
          <small>{measuredText}</small>
        </div>
        <div className="economy-stat">
          <span>Tokens · entrada / saída</span>
          <strong>
            {formatTokens(economy.inputTokens)} /{" "}
            {formatTokens(economy.outputTokens)}
          </strong>
          <small>
            {economy.jevCalls !== null
              ? `${formatTokens(economy.jevCalls)} chamadas JEV`
              : "Chamadas JEV não observadas"}
            {economy.cachedCalls !== null
              ? ` · ${formatTokens(economy.cachedCalls)} do cache`
              : ""}
          </small>
        </div>
        <div className="economy-stat">
          <span>Tempo observado</span>
          <strong>{formatSeconds(economy.seconds)}</strong>
          <small>Execuções finalizadas somadas</small>
        </div>
      </div>
      <div className="economy-parts">
        <div className="economy-part">
          <span className="eyebrow">JEV · DECISÕES</span>
          <strong>
            {formatBrl(
              economy.jev?.estimated_brl ??
                brlFrom(economy.jev?.estimated_usd, economy.rate),
            )}
          </strong>
          <small>
            {formatTokens(economy.jev?.input_tokens)} ent ·{" "}
            {formatTokens(economy.jev?.output_tokens)} sai
            {economy.jev?.unpriced_calls
              ? ` · ${economy.jev.unpriced_calls} sem preço`
              : ""}
          </small>
        </div>
        <div className="economy-part">
          <span className="eyebrow">EXECUTORES · INSTALAÇÃO GLOBAL</span>
          <strong>
            {formatBrl(
              economy.executor?.estimated_brl ??
                brlFrom(economy.executor?.estimated_usd, economy.rate),
            )}
          </strong>
          <small>
            {formatTokens(economy.executor?.input_tokens)} ent ·{" "}
            {formatTokens(economy.executor?.output_tokens)} sai
            {economy.executor?.unpriced_calls
              ? ` · ${economy.executor.unpriced_calls} sem preço`
              : ""}
          </small>
        </div>
        <div className="economy-part project">
          <span className="eyebrow">PROJETO EM FOCO</span>
          <strong>{formatBrl(projectCost.brl)}</strong>
          <small>
            {projectMissionCount ? `${projectPriced}/${projectMissionCount} missões com preço conhecido` : "Preços por missão não informados"}
            {projectCost.usd !== null
              ? ` · ≈ ${formatUsd(projectCost.usd)}`
              : ""}
          </small>
        </div>
      </div>
      {missions.length > 0 ? (
        <div className="economy-missions">
          <div className="economy-subhead">
            <strong>Custo por missão · {projectName(workspace)}</strong>
            <small>
              Estimativa equivalente por API; valores sem preço permanecem
              desconhecidos.
            </small>
          </div>
          {missions.map((row) => (
            <button
              className="economy-row"
              key={row.id}
              onClick={() => onOpenMission(row.id)}
            >
              <span className="economy-row-title">
                <strong>{row.title}</strong>
                <small>
                  {row.model ?? "Modelo não registrado"}
                  {row.active ? " · em atividade" : ""}
                  {row.unpriced ? ` · ${row.unpriced} sem preço` : ""}
                </small>
              </span>
              <span className="economy-row-values">
                <strong>{formatBrl(row.brl)}</strong>
                <small>
                  {row.usd !== null ? formatUsd(row.usd) : "—"} ·{" "}
                  {formatSeconds(row.seconds)}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : <p className="empty-copy">{workspace ? "Custos por missão não informados para este projeto." : "Selecione um projeto para consultar custos por missão."}</p>}
      {economy.simulations.length > 0 && (
        <details className="economy-simulations">
          <summary>
            Simulações: os mesmos tokens do JEV em outros modelos{" "}
            <ChevronDown size={14} />
          </summary>
          <p className="economy-caveat">
            Comparação hipotética de tarifas, sem executar o outro modelo. A
            diferença não é economia medida nem comprova resultado equivalente.
          </p>
          {economy.simulations.map((row) => (
            <div className="simulation-row" key={row.model}>
              <strong>{row.model}</strong>
              <span>
                {formatBrl(
                  row.estimated_brl ?? brlFrom(row.estimated_usd, economy.rate),
                )}
              </span>
              <small>
                JEV{" "}
                {formatBrl(
                  row.jev_estimated_brl ??
                    brlFrom(row.jev_estimated_usd, economy.rate),
                )}{" "}
                · diferença{" "}
                {formatBrl(
                  row.difference_brl ??
                    brlFrom(row.difference_usd, economy.rate),
                )}
              </small>
            </div>
          ))}
        </details>
      )}
      <div className="economy-foot">
        <p>
          {economy.unpricedCalls !== null && economy.unpricedCalls > 0
            ? `${economy.unpricedCalls} chamadas sem preço ficam desconhecidas. `
            : ""}
          Economia medida exige pares controlados aceitos; tokens não equivalem à
          franquia Codex.
        </p>
        <Button variant="ghost" size="sm" onClick={onOpenEvaluations}>
          Ver avaliações e evidências <ArrowRight size={14} />
        </Button>
      </div>
    </Card>
  );
}
function ResearchPanel({
  references,
  focus,
  opportunities,
  opportunitiesKnown,
  investigations,
  onOpenTask,
  onNavigate,
}: {
  references?: string[];
  focus?: string;
  opportunities: Opportunity[];
  opportunitiesKnown: boolean;
  investigations: Task[];
  onOpenTask: (task: Task) => void;
  onNavigate: () => void;
}) {
  const latest = investigations[0];
  return (
    <Card className="research-panel">
      <SectionTitle
        icon={BookOpen}
        title="Pesquisa e referências"
        subtitle="Referências que ajudam a construir o ecossistema Orinonu."
        count={references?.length}
        action={onNavigate}
        actionLabel="Abrir pesquisa"
      />
      {references?.length ? (
        <ul className="reference-list">
          {references.slice(0, 8).map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Github size={15} />
                <span>{repoLabel(url)}</span>
                <ExternalLink size={13} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">
          {references ? "Conecte projetos de referência para transformar boas ideias em propostas com evidências." : "Referências não informadas pelo servidor."}
        </p>
      )}
      {focus && <p className="research-focus">{focus}</p>}
      <div className="research-stats">
        <span>
          <Sparkles size={14} />
          <strong>{opportunitiesKnown ? opportunities.length : "—"}</strong> propostas pendentes
        </span>
        <span>
          <Search size={14} />
          <strong>{investigations.length}</strong> investigações registradas
        </span>
      </div>
      {latest && (
        <button
          className="investigation-row"
          onClick={() => onOpenTask(latest)}
        >
          <span className="research-icon">
            <Search size={15} />
          </span>
          <span>
            <strong>{latest.title}</strong>
            <small>
              {statusLabels[latest.status] ?? latest.status} ·{" "}
              {date(latest.created_at)}
            </small>
          </span>
          <ArrowUpRight size={15} />
        </button>
      )}
    </Card>
  );
}
function DirectionField({
  field,
  value,
  onChange,
}: {
  field: (typeof fields)[number];
  value: string;
  onChange: (value: string) => void;
}) {
  const labelId = `${field.key}-label`;
  const helpId = `${field.key}-help`;
  return (
    <label className="form-field" htmlFor={field.key}>
      <span id={labelId}>{field.label}</span>
      <p id={helpId}>{field.help}</p>
      <Textarea
        id={field.key}
        rows={
          field.key === "objective" || field.key === "success_criteria" ? 5 : 4
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={field.key === "objective" ? 3000 : 2000}
        placeholder={field.placeholder}
        aria-labelledby={labelId}
        aria-describedby={helpId}
      />
    </label>
  );
}
export function TaskDetail({
  task, specialist, onStart, onStop, busy, decisions = [], decisionEvents = [], onOpenDecisions,
  decisionsQuery = { status: "ready" }, onRetryDecisions = () => {}, initialTab,
}: {
  task: Task;
  specialist?: string;
  onStart: () => void;
  onStop: () => void;
  busy: boolean;
  workspace: string;
  decisions?: DecisionItem[];
  decisionEvents?: Snapshot["events"];
  onOpenDecisions?: () => void;
  decisionsQuery?: QueryState;
  onRetryDecisions?: () => void;
  initialTab?: "activity" | "reports" | "decisions" | "scope";
}) {
  const action = missionAction(task, decisions.length > 0);
  const [tab, setTab] = useState<string>(initialTab ?? (action.kind === "decision" ? "decisions" : action.kind === "evidence" ? "reports" : "activity"));
  const external = task.external_work?.status === "active",
    items = external ? task.external_work?.checklist : task.progress?.items,
    percent = taskProgress(task), events = taskHistory(task),
    readOnly = task.opportunity_audit || task.direction_assist;
  const reports = [
    { title: "Planejamento", content: task.plan_report },
    { title: "Revisão técnica", content: task.review_report },
  ].filter(report => report.content?.trim());
  const records = [
    { title: "Planejamento", value: task.planning },
    { title: "Fluxo autônomo", value: task.autonomy },
    { title: "Recuperação", value: task.recovery },
    { title: "Após a revisão", value: task.post_review_decision },
    ...(task.autonomy_history ?? []).slice(-10).reverse().map(value => ({ title: "Histórico do fluxo", value })),
    ...(task.recovery_history ?? []).slice(-10).reverse().map(value => ({ title: "Histórico de recuperação", value })),
    ...(task.post_review_history ?? []).slice(-10).reverse().map(value => ({ title: "Histórico após revisão", value })),
    ...decisionEvents.slice(-10).reverse().map(event => ({ title: "Decisão JEV registrada", value: event })),
  ].filter(record => record.value != null && (typeof record.value !== "object" || Object.keys(record.value).length > 0));
  return (
    <TabsPrimitive.Root value={tab} onValueChange={setTab} className="task-detail">
      <div className="mission-context">
        <span><Users size={14} />{specialist ?? task.specialist ?? "Especialista a definir"}</span>
        <span><Activity size={14} />{external ? `Sessão · ${task.external_work?.owner ?? "ativa"}` : task.execution_agent ?? task.executor ?? task.agent ?? "Executor a definir"}</span>
        {readOnly && <Badge variant="outline">Somente leitura</Badge>}
      </div>
      {task.completion && (
        <p className="completion-note" role="status">
          <CheckCircle2 size={14} /><strong>{task.completion.label ?? "Conclusão registrada"}</strong>
          {task.completion.kind === "session_receipt_verified" && " — o recibo foi verificado por revisão independente; isso não certifica integração por snapshot."}
        </p>
      )}
      <TabsPrimitive.List className="mission-tabs" aria-label="Conteúdo da missão">
        <TabsPrimitive.Trigger value="activity"><Activity size={15} />Andamento</TabsPrimitive.Trigger>
        <TabsPrimitive.Trigger value="reports"><BookOpen size={15} />Relatórios{reports.length > 0 && <span>{reports.length}</span>}</TabsPrimitive.Trigger>
        <TabsPrimitive.Trigger value="decisions"><GitBranch size={15} />Decisões{decisions.length > 0 && <span>{decisions.length}</span>}</TabsPrimitive.Trigger>
        <TabsPrimitive.Trigger value="scope"><Target size={15} />Escopo</TabsPrimitive.Trigger>
      </TabsPrimitive.List>
      <TabsPrimitive.Content value="activity" forceMount className="mission-tab-panel">
        <section className={`mission-current ${task.error ? "has-error" : ""}`}>
          <h3>{task.error ? "A missão precisa de atenção" : "Situação atual"}</h3>
          <p>{task.error ?? task.queue_wait?.message ?? task.pipeline?.reason ?? statusLabels[task.status] ?? task.status}</p>
        </section>
        <section>
          <h3>Checklist e evidências <Badge variant="outline">{percent === null ? "Sem medição" : `${percent}%`}</Badge></h3>
          {percent !== null && <progress value={percent} max={100} aria-label="Progresso do checklist" />}
          {percent !== null && items?.map(item => <div className="checklist-row" key={item.id}>
            {item.done || item.state === "completed" ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            <span>{item.title ?? item.label ?? item.id}</span>
          </div>)}
          <p className="muted">{percent === null ? "O progresso ainda não foi informado por um checklist válido." : "Progresso baseado nos itens com evidências. A entrega permanece sujeita à revisão."}</p>
        </section>
        <section>
          <h3>Atividade recente</h3>
          <ol className="detail-timeline">
            {events.slice(0, 30).map((event, index) => <li key={index}>
              <div className="timeline-heading"><strong>{event.label ?? event.kind ?? "Atividade registrada"}</strong><time>{date(event.time)}</time></div>
              <small>{phaseLabel(event.activity_phase)}{(event.tool_name ?? event.tool) && ` · ${event.tool_name ?? event.tool}`}</small>
              {(event.command || event.files?.length || event.activity_attempt) && <details className="technical-note"><summary>Detalhes do registro</summary>
                {event.activity_attempt && <small>Tentativa: {event.activity_attempt}</small>}
                {event.command && <code>{event.command}</code>}
                {!!event.files?.length && <small>{event.files.join(" · ")}</small>}
              </details>}
            </li>)}
          </ol>
          {!events.length && <p className="muted">Nenhuma atividade registrada nesta missão.</p>}
        </section>
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="reports" className="mission-tab-panel">
        {reports.map(report => <article className="mission-report" key={report.title}>
          <h3><BookOpen size={17} />{report.title}</h3>
          <ReportContent content={report.content ?? ""} />
          <details className="technical-note"><summary>Ver texto original</summary><pre>{report.content}</pre></details>
        </article>)}
        {!reports.length && <div className="mission-empty"><BookOpen size={24} /><h3>Ainda não há relatórios</h3><p>Os relatórios de planejamento e revisão aparecerão aqui quando forem recebidos.</p></div>}
        {task.review_contract != null && <details className="technical-note"><summary>Contrato da revisão técnica</summary><pre>{JSON.stringify(task.review_contract, null, 2)}</pre></details>}
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="decisions" forceMount className="mission-tab-panel">
        <ResourceState title="Decisões desta missão" query={decisionsQuery} onRetry={onRetryDecisions} />
        {decisions.map(item => <article className="mission-decision pending-decision" key={item.id}>
          <span className="eyebrow">Aguardando uma resposta</span><h3>{item.question || item.reason}</h3>
          <p>{recommendationLabel(item).text}</p>
          <ul>{item.options.map(option => <li key={option.id}>{option.label}</li>)}</ul>
          {onOpenDecisions && <Button variant="outline" onClick={onOpenDecisions}>Responder na caixa de decisões <ArrowUpRight size={15} /></Button>}
        </article>)}
        {task.decision_recovery && <section className="mission-current">
          <h3>O que falta para avançar</h3>
          <p>{(task.decision_recovery.reason && recoveryReasonLabels[task.decision_recovery.reason]) || task.decision_recovery.reason}</p>
          <p>{(task.decision_recovery.resume_condition && resumeConditionLabels[task.decision_recovery.resume_condition]) || task.decision_recovery.resume_condition}</p>
        </section>}
        {records.map((record, index) => <MissionDecision key={index} title={record.title} value={record.value} />)}
        {decisionsQuery.status === "ready" && !records.length && !decisions.length && !task.decision_recovery && <div className="mission-empty"><GitBranch size={24} /><h3>Nenhuma decisão registrada</h3><p>Recomendações, pendências e transições desta missão aparecerão aqui.</p></div>}
        {records.length > 0 && <details className="technical-note"><summary>Todos os registros técnicos</summary><pre>{JSON.stringify({ planning: task.planning, autonomy: task.autonomy, autonomy_history: task.autonomy_history, recovery: task.recovery, recovery_history: task.recovery_history, post_review: task.post_review_decision, post_review_history: task.post_review_history, events: decisionEvents }, null, 2)}</pre></details>}
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="scope" forceMount className="mission-tab-panel">
        <section><h3>Objetivo da missão</h3><p>{task.goal || "Objetivo não registrado."}</p></section>
        <section><h3>Critérios de sucesso</h3><div className="criteria-block"><CheckCircle2 size={17} /><p>{task.acceptance || "Critérios não registrados."}</p></div></section>
        <details className="technical-note"><summary>Projeto e identificação</summary><p>{task.workspace}</p><code>{task.id}</code></details>
        {!readOnly && !task.archived_at && <fieldset disabled={busy || decisionsQuery.status !== "ready"}><TaskControls task={task} /></fieldset>}
      </TabsPrimitive.Content>
      <div className="detail-actions">
        <span>Execução e alterações exigem autorização.</span>
        {action.kind === "decision" ? <Button variant="outline" onClick={onOpenDecisions ?? (() => setTab("decisions"))}>Abrir decisão <ArrowUpRight size={15} /></Button>
          : action.kind === "stop" || action.kind === "start" ? <Button variant="outline" disabled={busy || (action.kind === "start" && decisionsQuery.status !== "ready")} onClick={action.kind === "stop" ? onStop : onStart}>{action.label}</Button>
          : action.kind === "evidence" ? <Button variant="outline" onClick={() => setTab("reports")}>Ver evidências <BookOpen size={15} /></Button>
          : <Badge variant="outline">{external ? "Reservada por uma sessão · acompanhar em Andamento" : action.state}</Badge>}
      </div>
    </TabsPrimitive.Root>
  );
}

function MissionDecision({ title, value }: { title: string; value: unknown }) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const nested = object.decision && typeof object.decision === "object" && !Array.isArray(object.decision) ? object.decision as Record<string, unknown> : object;
  const action = typeof nested.action === "string" ? nested.action : typeof object.status === "string" ? object.status : null;
  const labels: Record<string, string> = { select: "Opção selecionada", abstain: "Abstenção", hold: "Em espera", recommended: "Recomendação recebida", needs_review: "Aguardando revisão", approved: "Aprovado", rejected: "Rejeitado", failed: "Falha registrada", planning: "Planejamento", implementation: "Implementação", review: "Revisão" };
  const choice = typeof nested.choice === "string" ? nested.choice : null;
  const reason = typeof object.reason === "string" ? object.reason : typeof nested.reason === "string" ? nested.reason : null;
  const confidence = typeof nested.confidence === "number" && nested.confidence >= 0 && nested.confidence <= 1 ? nested.confidence : null;
  return <article className="mission-decision">
    <div className="decision-heading"><h3><GitBranch size={16} />{title}</h3>{action && <Badge variant="outline">{labels[action] ?? action.replaceAll("_", " ")}</Badge>}</div>
    {choice && <p>Opção: <strong>{labels[choice] ?? choice}</strong></p>}
    {reason && <p>{reason}</p>}
    {confidence !== null && <small>Confiança reportada: {Math.round(confidence * 100)}%</small>}
    <details className="technical-note"><summary>Ver registro técnico</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
  </article>;
}
function OpportunityDetail({
  opportunity: o,
  busy,
  onAction,
}: {
  opportunity: Opportunity;
  busy: boolean;
  onAction: (action: "approve" | "dismiss") => void;
}) {
  return (
    <div className="opportunity-detail">
      {[
        { title: "Recomendação", value: o.recommendation },
        { title: "Objetivo", value: o.goal },
        { title: "Critérios de sucesso", value: o.acceptance },
        { title: "Evidências", value: o.evidence?.join("\n") },
        { title: "Riscos", value: o.risk },
      ]
        .filter((item) => item.value)
        .map((item) => (
          <section key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.value}</p>
          </section>
        ))}
      <div className="detail-actions">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onAction("dismiss")}
        >
          Descartar proposta
        </Button>
        <Button disabled={busy} onClick={() => onAction("approve")}>
          Aprovar investigação <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}
function phaseLabel(phase?: string) {
  return (
    (
      {
        discovery: "exploração",
        design: "planejamento",
        planning: "planejamento",
        implementation: "implementação",
        review: "revisão",
      } as Record<string, string>
    )[phase ?? ""] ?? "etapa não registrada"
  );
}
