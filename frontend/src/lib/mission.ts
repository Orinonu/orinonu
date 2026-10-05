export type ChecklistItem = {
  id: string;
  title?: string;
  label?: string;
  state?: string;
  done?: boolean;
  evidence_count?: number;
};
export type ActivityEvent = {
  time?: string;
  label?: string;
  kind?: string;
  command?: string;
  tool_name?: string;
  tool?: string;
  files?: string[];
  activity_phase?: string;
  activity_attempt?: string;
  duration_ms?: number;
};
export type Progress = {
  measurement_kind?: string;
  items?: ChecklistItem[];
  events?: ActivityEvent[];
  started_at?: string;
  checklist_phase?: string;
  phase?: string;
  attempt_id?: string;
};
export type Task = {
  id: string;
  title: string;
  workspace: string;
  status: string;
  goal?: string;
  acceptance?: string;
  specialist?: string;
  agent?: string;
  executor?: string;
  execution_agent?: string;
  fallback_from?: string;
  fallback_reason?: string;
  profile?: string;
  max_minutes?: number;
  phase_limits?: { planning?: number; implementation?: number; review?: number };
  revision?: number;
  opportunity_audit?: boolean;
  direction_assist?: boolean;
  created_at?: string;
  ended_at?: string;
  archived_at?: string | null;
  external_work?: {
    status: string;
    phase: string;
    owner?: string;
    checklist?: ChecklistItem[];
  };
  queue?: { phase?: string; status?: string };
  queue_wait?: { message?: string };
  progress?: Progress;
  pipeline?: { reason?: string };
  planning?: { status?: string; decision?: unknown };
  plan_report?: string;
  review_report?: string;
  error?: string | null;
  implementation_run?: { progress?: Progress; attempt_id?: string };
  review_run?: { progress?: Progress; attempt_id?: string };
  planning_run?: { progress?: Progress; attempt_id?: string };
  structured_plan?: unknown;
  review_contract?: unknown;
  /** Set only by the host: a verified session receipt is weaker evidence than a merge and is labelled as such. */
  completion?: { kind: string; label?: string; verified_at?: string };
  decision_recovery?: {
    status?: string;
    owner?: string;
    reason?: string;
    resume_condition?: string;
    next_action?: string;
  };
  autonomy?: unknown;
  autonomy_history?: unknown[];
  recovery?: unknown;
  recovery_history?: unknown[];
  post_review_decision?: unknown;
  post_review_history?: unknown[];
};
export type Direction = {
  workspace: string;
  mission?: string;
  vision?: string;
  values?: string;
  principles?: string;
  objective?: string;
  success_criteria?: string;
  repositories?: string[];
  research_focus?: string;
  updated_at?: string;
};
export type Opportunity = {
  id: string;
  workspace: string;
  title: string;
  status: string;
  recommendation?: string;
  goal?: string;
  acceptance?: string;
  evidence?: string[];
  risk?: string;
  source?: string;
  source_task_id?: string;
};
export type UsageSummary = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_usd?: number | null;
  estimated_brl?: number | null;
  unpriced_calls?: number | null;
  cached_calls?: number | null;
};
export type PricingModel = {
  id: string;
  input_per_million?: number | null;
  output_per_million?: number | null;
};
export type CurrencyQuote = {
  source?: string;
  usd_brl?: number | null;
  bid?: number | null;
  ask?: number | null;
  observed_at?: string | null;
  fetched_at?: string | null;
  status?: string;
  refresh?: { refreshing?: boolean; error?: string | null };
};
export type Simulation = {
  model: string;
  estimated_usd?: number | null;
  estimated_brl?: number | null;
  jev_estimated_usd?: number | null;
  jev_estimated_brl?: number | null;
  difference_usd?: number | null;
  difference_brl?: number | null;
};
export type TaskUsage = {
  task_id: string;
  title?: string;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_usd?: number | null;
  estimated_brl?: number | null;
  executor_estimated_usd?: number | null;
  executor_estimated_brl?: number | null;
  jev_estimated_usd?: number | null;
  jev_estimated_brl?: number | null;
  jev_cached_calls?: number | null;
  unpriced_calls?: number | null;
  seconds?: number | null;
  active?: boolean;
};
export type EconomyTotals = {
  estimated_usd?: number | null;
  estimated_brl?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  seconds?: number | null;
  unpriced_calls?: number | null;
};
export type Analytics = {
  pricing?: {
    source?: string;
    fetched_at?: string | null;
    status?: string;
    models?: PricingModel[];
    refresh?: { refreshing?: boolean; error?: string | null };
  };
  currency?: CurrencyQuote;
  jev?: UsageSummary;
  executor?: UsageSummary;
  simulations?: Simulation[];
  tasks?: TaskUsage[];
  totals?: EconomyTotals;
  note?: string;
};
export type Comparison = {
  total?: number;
  controlled_pairs?: number;
  accepted_pairs?: number;
  regressions?: number;
  saved_seconds?: number | null;
  saved_usd?: number | null;
  proven_saved_seconds?: number | null;
  proven_saved_usd?: number | null;
  proven_saved_tokens?: number | null;
  assessment?: { status?: string; reasons?: string[] };
  note?: string;
};
export type Specialist = {
  id: string;
  name: string;
  scope?: string;
  parent?: string | null;
  skills?: string[];
};
export type Snapshot = {
  workspace?: { default?: string };
  tasks: Task[];
  project_directions?: Direction[];
  projects?: { workspace: string; counts?: Record<string, number> }[];
  profiles?: Record<string, { model: string; effort: string; skill: string }>;
  integrations?: { id: string; name: string; status: string; detail: string }[];
  context?: { consultations?: number; trust?: string };
  curator?: {
    window_days?: number;
    consultations?: number;
    observed_tools?: { id: string; uses: number }[];
    disabled_duplicates?: unknown[];
    policy?: string;
    limitations?: string[];
  };
  opportunities?: Opportunity[];
  specialists?: Specialist[];
  specialist_policy?: {
    activation?: string;
    memory_status?: string;
    tool_allowlist_status?: string;
    tool_policy?: string;
    hierarchy?: string;
    runtime?: { kind?: string; openai_agents_sdk?: string; handoffs?: string };
  };
  events?: {
    kind: string;
    time: string;
    task_id?: string;
    workspace?: string;
    provider?: string;
    decision?: unknown;
    status?: string;
    tool?: string;
    error?: string;
  }[];
  metrics?: {
    jev_calls?: number;
    jev_input_tokens?: number;
    jev_output_tokens?: number;
    jev_cached?: number;
    saved_usd?: number | null;
    saved_brl?: number | null;
    saved_seconds?: number | null;
    quota_saved?: null;
    source?: string;
    coverage?: string;
    note?: string;
  };
  analytics?: Analytics;
  comparison?: Comparison;
  autonomy_policies?: { workspace: string; mode: string }[];
  executor_pause?: {
    status: string;
    reason?: string;
    message?: string;
    resume_at_ms?: number | null;
    probe_at_ms?: number;
  };
  scheduler?: {
    running?: Record<string, number>;
    queued?: Record<string, number>;
    planning_limit?: number;
    implementation_limit?: number;
    review_limit?: number;
  };
};
/** The saved per-project flow mode. Absent or unknown workspaces stay supervised:
 * autonomy is only shown when a policy actually says so. */
export const autonomyMode = (
  snapshot: Pick<Snapshot, "autonomy_policies"> | null | undefined,
  workspace: string,
): "autonomous" | "supervised" =>
  snapshot?.autonomy_policies?.some(
    (policy) => sameWorkspace(policy.workspace, workspace) && policy.mode === "autonomous",
  )
    ? "autonomous"
    : "supervised";
/** One workspace entry of GET /api/flow. `gates` holds only items that wait for a person;
 * `external` (autonomous mode) holds dependencies the environment must supply, which never
 * block the rest of the flow. */
export type FlowReport = {
  workspace: string | null;
  mode: string;
  convergence: string;
  active: number;
  gates: { reason: string; title?: string }[];
  waiting: unknown[];
  external?: { reason: string; title?: string }[];
  health?: FlowHealth;
};
export function workspaceKey(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  const key = normalized.replace(/\/+$/, "") || (normalized ? "/" : "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? key.toLowerCase() : key;
}
export const sameWorkspace = (left: string | null | undefined, right: string | null | undefined) =>
  !!left && !!right && workspaceKey(left) === workspaceKey(right);
export function resolveWorkspace(path: string, known: string[]) {
  const selected = path.trim();
  return known.find(candidate => candidate === selected) ?? known.find(candidate => sameWorkspace(candidate, selected)) ?? selected;
}
const normalizePath = workspaceKey;
/** The flow entry of one project; /api/flow lists every workspace and may spell paths differently. */
export function flowFor(
  flows: FlowReport[] | null | undefined,
  workspace: string,
) {
  if (!workspace) return null;
  return (
    flows?.find(
      (row) => row.workspace && normalizePath(row.workspace) === normalizePath(workspace),
    ) ?? null
  );
}
export function flowSummary(flow: FlowReport | null | undefined) {
  if (!flow) return null;
  const awaitingYou = flow.gates.length,
    external = flow.external?.length ?? 0;
  return {
    awaitingYou,
    external,
    active: flow.active,
    text:
      `${awaitingYou} aguardando você · ${flow.active} ativas` +
      (external
        ? ` · ${external} ${external === 1 ? "dependência externa" : "dependências externas"}`
        : ""),
  };
}
/** Who a waiting mission is waiting for, from the persisted decision_recovery facts only.
 * Absent facts say nothing: no owner is invented. */
export function waitOwner(task: Pick<Task, "decision_recovery">) {
  const recovery = task.decision_recovery;
  if (!recovery?.owner) return null;
  if (recovery.owner === "human")
    return { tone: "human", label: "Aguardando você" } as const;
  if (recovery.owner === "environment")
    return { tone: "external", label: "Dependência externa" } as const;
  return { tone: "system", label: "Sistema reavalia" } as const;
}
export const lanes = [
  "backlog",
  "planning",
  "running",
  "review",
  "done",
  "blocked",
] as const;
export const recoveryReasonLabels: Record<string, string> = {
  awaiting_priority: "Priorizando com Jev",
  decision_in_progress: "Decisão Jev em andamento",
  backoff: "Aguardando intervalo entre tentativas",
  already_evaluated: "Evidência avaliada; aguardando alteração",
  realigning: "Realinhando à carta do projeto",
  unknown_recovery_cause: "Diagnosticando causa de bloqueio",
  human_scope_required: "Escopo ou decisão humana necessária",
  execution_outcome_unconfirmed: "Resultado da execução não confirmado",
  authorization_required: "Autorização ou credencial necessária",
  diagnosis_limit: "Limite de diagnósticos atingido",
  technical_hold: "Retenção técnica pós-revisão",
  integration_conflict: "Conflito de integração pendente",
  decision_limit: "Limite de decisões atingido",
  budget_exhausted: "Orçamento de tempo esgotado",
  human_cancelled: "Cancelado pelo operador",
  abstained: "Jev absteve; requer decisão do operador",
  pending_triage: "Triagem de pendências com Jev",
};

export const resumeConditionLabels: Record<string, string> = {
  diagnosis_or_decision_completed: "Aguardando conclusão do diagnóstico ou decisão Jev",
  retry_deadline_reached: "Aguardando término do intervalo para reavaliação",
  current_decision_finished: "Aguardando decisão atual finalizar",
  distinct_host_evidence: "Aguardando novas evidências ou alteração no projeto",
  human_scope_or_permission_clarified: "Aguardando esclarecimento do escopo pelo operador",
  host_executor_outcome_confirmed: "Aguardando confirmação de liberação do executor",
  explicit_human_authorization: "Aguardando autorização explícita do operador",
  new_host_evidence_or_explicit_recovery_limit_extension: "Aguardando extensão do limite ou novas evidências",
  host_integration_receipt: "Aguardando resolução do conflito de integração",
  explicit_budget_extension: "Aguardando ampliação do orçamento de tempo",
  explicit_human_reauthorization: "Aguardando reautorização pelo operador",
};

export const laneLabels: Record<string, string> = {
  backlog: "Backlog",
  planning: "Planejamento",
  running: "Em execução",
  review: "Revisão",
  done: "Concluídas",
  blocked: "Bloqueadas",
};
export const statusLabels: Record<string, string> = {
  ...laneLabels,
  backlog: "Na fila",
  ready: "Plano preparado",
  queued: "Na fila",
  reviewing: "Revisão em execução",
};
export function laneOf(task: Task): string {
  if (task.external_work?.status === "active")
    return (
      (
        {
          planning: "planning",
          implementation: "running",
          review: "review",
        } as Record<string, string>
      )[task.external_work.phase] ?? task.status
    );
  return (
    (
      { ready: "backlog", queued: "running", reviewing: "review" } as Record<
        string,
        string
      >
    )[task.status] ?? task.status
  );
}
export function isActive(task: Task) {
  return !task.archived_at && task.status !== "done" && (
    task.external_work?.status === "active" ||
    ["queued", "selecting"].includes(task.queue?.status ?? "") ||
    ["planning", "queued", "running", "reviewing"].includes(task.status)
  );
}
export type MissionAction = { kind: "start" | "stop" | "decision" | "follow" | "evidence"; label: string; state: string };
export function missionAction(task: Task, pendingDecision = false): MissionAction {
  if (task.archived_at) return { kind: "evidence", label: "Ver evidências", state: "Arquivada" };
  if (task.status === "done") return { kind: "evidence", label: "Ver evidências", state: "Concluída" };
  if (pendingDecision || task.decision_recovery?.owner === "human") return { kind: "decision", label: "Abrir decisão", state: "Aguardando você" };
  if (task.external_work?.status === "active") return { kind: "follow", label: "Acompanhar", state: `Sessão · ${task.external_work.owner ?? "ativa"}` };
  const queued = task.status === "queued" || ["queued", "selecting"].includes(task.queue?.status ?? "");
  if (queued) return { kind: "stop", label: "Retirar da fila", state: task.queue?.status === "selecting" ? "Selecionando executor" : "Aguardando vaga na fila" };
  if (isActive(task)) return { kind: "stop", label: "Parar", state: statusLabels[task.status] ?? task.status };
  if (task.opportunity_audit || task.direction_assist) return { kind: "follow", label: "Ver investigação", state: "Somente leitura" };
  if (task.decision_recovery?.owner === "environment") return { kind: "follow", label: "Acompanhar dependência", state: "Dependência externa" };
  if (["backlog", "ready"].includes(task.status)) return { kind: "start", label: "Planejar e implementar", state: statusLabels[task.status] };
  return { kind: "evidence", label: "Ver evidências", state: statusLabels[task.status] ?? task.status };
}
export function projectTasks(tasks: Task[], workspace: string) {
  return tasks.filter(
    (t) =>
      !t.archived_at &&
      !t.opportunity_audit &&
      !t.direction_assist &&
      sameWorkspace(t.workspace, workspace),
  );
}
export function filteredTasks(
  tasks: Task[],
  {
    query = "",
    stage = "all",
    specialist = "all",
  }: { query?: string; stage?: string; specialist?: string } = {},
) {
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  return tasks.filter(
    (t) =>
      (stage === "all" ||
        (stage === "active" && isActive(t)) ||
        (stage === "attention" &&
          ["review", "blocked"].includes(laneOf(t)) &&
          !isActive(t)) ||
        laneOf(t) === stage) &&
      (specialist === "all" || t.specialist === specialist) &&
      (!query.trim() ||
        normalize(
          [t.title, t.goal, t.acceptance, t.specialist].join(" "),
        ).includes(normalize(query.trim()))),
  );
}
export const charterKeys = [
  "mission",
  "vision",
  "values",
  "principles",
  "objective",
  "success_criteria",
] as const;
export function referenceSave(
  saved: Direction | undefined,
  draft: Direction,
): Direction {
  return {
    ...saved,
    workspace: draft.workspace,
    repositories: (draft.repositories ?? [])
      .map((repo) => repo.trim())
      .filter(Boolean),
    research_focus: draft.research_focus ?? "",
  };
}
export function directionSave(
  saved: Direction | undefined,
  draft: Direction,
): Direction {
  return {
    ...saved,
    workspace: draft.workspace,
    ...Object.fromEntries(charterKeys.map((key) => [key, draft[key] ?? ""])),
  };
}
export function checklistProgress(progress?: Progress) {
  const items = progress?.items;
  if (
    progress?.measurement_kind !== "task_checklist" ||
    !items?.length ||
    new Set(items.map((i) => i.id)).size !== items.length ||
    items.some(
      (i) =>
        !i.id ||
        !["pending", "in_progress", "completed"].includes(i.state ?? "") ||
        (i.state === "completed" &&
          (!Number.isSafeInteger(i.evidence_count) ||
            (i.evidence_count ?? 0) < 1)),
    )
  )
    return null;
  return Math.floor(
    (100 * items.filter((i) => i.state === "completed").length) / items.length,
  );
}
export function taskProgress(task: Task) {
  if (task.external_work?.status === "active") {
    const items = task.external_work.checklist ?? [];
    return items.length
      ? Math.floor(
          (items.filter((i) => i.done === true).length * 100) / items.length,
        )
      : null;
  }
  if (task.status === "backlog" && !task.queue) return null;
  return checklistProgress(task.progress);
}
export function taskPriority(task: Task) {
  if (
    task.external_work?.status === "active" ||
    (["planning", "running", "reviewing"].includes(task.status) && !task.queue)
  )
    return 0;
  if (task.queue?.status === "selecting") return 1;
  if (task.queue || task.status === "queued") return 2;
  return 3;
}
export function projectName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Selecionar projeto";
}
export function taskHistory(task: Task): ActivityEvent[] {
  const seen = new Set<string>(),
    events: ActivityEvent[] = [];
  const sources = [
    ["current", task.progress, undefined],
    ["planning", task.planning_run?.progress, task.planning_run?.attempt_id],
    [
      "implementation",
      task.implementation_run?.progress,
      task.implementation_run?.attempt_id,
    ],
    ["review", task.review_run?.progress, task.review_run?.attempt_id],
  ] as const;
  for (const [source, progress, attempt] of sources) {
    const phase =
        progress?.checklist_phase ??
        (source === "current" ? progress?.phase : source),
      id = progress?.attempt_id ?? attempt;
    for (const event of progress?.events ?? []) {
      const key = JSON.stringify([phase, id ?? source, event]);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...event, activity_phase: phase, activity_attempt: id });
    }
  }
  return events.sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
}
const knownNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export function sumKnown(values: (number | null | undefined)[]) {
  return values.length && values.every(knownNumber)
    ? values.reduce((total, value) => total + value, 0)
    : null;
}
export function brlFrom(usd?: number | null, rate?: number | null) {
  return knownNumber(usd) && knownNumber(rate) && rate > 0
    ? Math.round(usd * rate * 1e12) / 1e12
    : null;
}
export function formatBrl(value?: number | null) {
  if (!knownNumber(value)) return "—";
  const small = Math.abs(value) > 0 && Math.abs(value) < 1;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: small ? 4 : 2,
    maximumFractionDigits: small ? 6 : 2,
  }).format(value);
}
export function formatUsd(value?: number | null) {
  if (!knownNumber(value)) return "—";
  const small = Math.abs(value) > 0 && Math.abs(value) < 1;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: small ? 4 : 2,
    maximumFractionDigits: small ? 6 : 2,
  }).format(value);
}
export function formatTokens(value?: number | null) {
  return knownNumber(value) ? value.toLocaleString("pt-BR") : "—";
}
export function formatSeconds(value?: number | null) {
  if (!knownNumber(value)) return "—";
  if (value < 60) return `${Math.round(value)} s`;
  if (value < 3600) return `${Math.floor(value / 60)} min`;
  const hours = Math.floor(value / 3600),
    minutes = Math.round((value % 3600) / 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}
export function repoLabel(url: string) {
  const match =
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return match ? `${match[1]}/${match[2]}` : url.trim();
}
export type EconomySummary = ReturnType<typeof economySummary>;
export function economySummary(
  analytics?: Analytics,
  metrics?: Snapshot["metrics"],
  comparison?: Comparison,
) {
  const rate = analytics?.currency?.usd_brl ?? null,
    rateStatus = analytics?.currency
      ? (analytics.currency.status ?? "unavailable")
      : "missing";
  const brl = (usd?: number | null, direct?: number | null) =>
    direct ?? brlFrom(usd, rate);
  const totalUsd =
    analytics?.totals?.estimated_usd ??
    sumKnown([analytics?.executor?.estimated_usd, analytics?.jev?.estimated_usd]);
  const measuredUsd = comparison?.proven_saved_usd ?? null,
    measuredBrl = metrics?.saved_brl ?? brl(measuredUsd),
    measuredSeconds =
      comparison?.proven_saved_seconds ?? metrics?.saved_seconds ?? null,
    regressions = comparison?.regressions ?? null,
    measuredStatus: "pending" | "regression" | "neutral" | "measured" =
      measuredUsd === null
        ? "pending"
        : (regressions ?? 0) > 0 || measuredUsd < 0
          ? "regression"
          : measuredUsd === 0
            ? "neutral"
            : "measured";
  const missions = (analytics?.tasks ?? [])
    .map((row) => ({
      id: row.task_id,
      title: row.title ?? row.task_id,
      model: row.model ?? null,
      usd: knownNumber(row.estimated_usd) ? row.estimated_usd : null,
      brl: brl(row.estimated_usd, row.estimated_brl),
      seconds: knownNumber(row.seconds) ? row.seconds : null,
      active: !!row.active,
      unpriced: row.unpriced_calls ?? 0,
    }))
    .sort((a, b) => (b.brl ?? -1) - (a.brl ?? -1));
  return {
    rate,
    rateStatus,
    quote: analytics?.currency ?? null,
    totalUsd,
    totalBrl: brl(totalUsd, analytics?.totals?.estimated_brl),
    inputTokens:
      analytics?.totals?.input_tokens ??
      sumKnown([
        analytics?.executor?.input_tokens,
        analytics?.jev?.input_tokens,
      ]),
    outputTokens:
      analytics?.totals?.output_tokens ??
      sumKnown([
        analytics?.executor?.output_tokens,
        analytics?.jev?.output_tokens,
      ]),
    seconds:
      analytics?.totals?.seconds ??
      sumKnown((analytics?.tasks ?? []).map((row) => row.seconds)),
    unpricedCalls:
      analytics?.totals?.unpriced_calls ??
      sumKnown([
        analytics?.executor?.unpriced_calls,
        analytics?.jev?.unpriced_calls,
      ]),
    jev: analytics?.jev ?? null,
    executor: analytics?.executor ?? null,
    jevCalls: metrics?.jev_calls ?? null,
    cachedCalls:
      metrics?.jev_cached ?? analytics?.jev?.cached_calls ?? null,
    measured: {
      status: measuredStatus,
      usd: measuredUsd,
      brl: measuredBrl,
      seconds: measuredSeconds,
      tokens: comparison?.proven_saved_tokens ?? null,
      controlledPairs: comparison?.controlled_pairs ?? null,
      acceptedPairs: comparison?.accepted_pairs ?? null,
      regressions,
      reasons: comparison?.assessment?.reasons ?? [],
    },
    missions,
    simulations: analytics?.simulations ?? [],
  };
}

/** Flow health as the host classifies it: progress that really moves, not queue length. */
export type PhaseCapacity = { limit: number; live: number; phantom: number; queued: number };
export type FlowHealth = {
  state: "progressing" | "stalled" | "gated" | "idle" | "empty";
  counts?: Record<string, number>;
  stalled: { task_id: string; reason: string; owner?: string; since: string | null; quiet_ms: number }[];
  capacity: Record<string, PhaseCapacity> | null;
  noop_suppressed?: number;
  wip: { count: number; max: number; full: boolean } | null;
  breaker: { state: string; reason: string | null; opened_at: string | null } | null;
};
export const healthLabels: Record<FlowHealth["state"], { label: string; tone: "ok" | "warn" | "human" | "idle" }> = {
  progressing: { label: "Progredindo", tone: "ok" },
  stalled: { label: "Parado", tone: "warn" },
  gated: { label: "Aguardando você", tone: "human" },
  idle: { label: "Ocioso", tone: "idle" },
  empty: { label: "Sem missões", tone: "idle" },
};
export const phaseLabels: Record<string, string> = {
  planning: "Planejamento",
  implementation: "Implementação",
  review: "Revisão",
};
export const stallReasonLabels: Record<string, string> = {
  executor_silent: "Executor sem atividade",
  dispatch_stuck: "Vaga livre sem despacho",
  capacity_held_by_unconfirmed: "Vagas presas por tentativas interrompidas",
  session_receipt: "Recibo de sessão aguardando revisão",
  already_evaluated: "Evidência já avaliada; sem fato novo",
  awaiting_priority: "Priorização não atendida",
};
export function capacityRows(health?: FlowHealth | null) {
  return Object.entries(health?.capacity ?? {}).map(([phase, row]) => ({
    phase,
    label: phaseLabels[phase] ?? phase,
    limit: row.limit,
    live: row.live,
    phantom: row.phantom,
    queued: row.queued,
    used: row.live + row.phantom,
    full: row.live + row.phantom >= row.limit,
  }));
}
export function quietLabel(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

/** The decision inbox (GET /api/decisions): every gate or stall as a typed question. */
export type DecisionOption = { id: string; label: string; effect: string; reversible: boolean; requires_note?: boolean };
export type DecisionRecommendation = {
  state: "none" | "ready" | "leaning" | "abstained" | "failed";
  option_id?: string;
  confidence?: number | null;
  probabilities?: Record<string, number> | null;
  reason?: string | null;
  checked_at?: string;
};
export type DecisionItem = {
  id: string;
  kind: string;
  label: string;
  workspace: string | null;
  task_id: string | null;
  opportunity_id: string | null;
  title: string;
  question: string;
  questions: string[];
  reason: string;
  resume_condition: string | null;
  options: DecisionOption[];
  recommendation: DecisionRecommendation;
  since: string | null;
  owner: string;
};
export const decisionsFor = (items: DecisionItem[] | null | undefined, workspace: string) =>
  workspace
    ? (items ?? []).filter((item) => !item.workspace || normalizePath(item.workspace) === normalizePath(workspace))
    : (items ?? []);
/** The option JEV points to, when it named one the person can still pick. */
export function recommendedOption(item: DecisionItem) {
  const { state, option_id } = item.recommendation;
  return (state === "ready" || state === "leaning") && option_id
    ? (item.options.find((option) => option.id === option_id) ?? null)
    : null;
}
/** Honest wording: a lean below the autonomy threshold is a lean, never a recommendation. */
export function recommendationLabel(item: DecisionItem) {
  const rec = item.recommendation,
    option = recommendedOption(item),
    percent = typeof rec.confidence === "number" ? ` · ${Math.round(rec.confidence * 100)}%` : "";
  if (rec.state === "ready" && option) return { tone: "ready", text: `Jev recomenda: ${option.label}${percent}` } as const;
  if (rec.state === "leaning" && option)
    return { tone: "leaning", text: `Jev inclina para: ${option.label}${percent} (abaixo do limiar de autonomia)` } as const;
  if (rec.state === "abstained") return { tone: "abstained", text: "Jev se absteve: a decisão é sua" } as const;
  if (rec.state === "failed") return { tone: "abstained", text: "Recomendação indisponível agora" } as const;
  return { tone: "pending", text: "Consultando o Jev…" } as const;
}
export function ageLabel(since: string | null | undefined, now = Date.now()) {
  const at = Date.parse(since ?? "");
  if (!Number.isFinite(at)) return "sem data";
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return "agora";
  return minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h`;
}
