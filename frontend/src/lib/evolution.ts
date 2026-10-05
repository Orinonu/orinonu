export type ManifestStatus = {
  valid?: boolean;
  error?: string;
  checked_files?: { filename: string; hash: string }[];
};

export type EvolutionGuards = {
  immutable_boundaries?: string[];
  max_epoch_budget_usd?: number | null;
  min_paired_samples_for_promotion?: number | null;
  shadow_mode_default?: boolean;
};

export type EpochRecord = {
  id: string;
  time?: string;
  duration_ms?: number;
  mode?: string;
  manifest_verified?: boolean;
  simulated_result?: unknown;
  gate?: { eligible?: boolean; status?: string; current_pairs?: number; min_pairs?: number; reason?: string };
  applied?: boolean;
};

export type EvolutionData = {
  metrics?: {
    acceptance_rate?: number | null;
    total_reviews?: number | null;
    approved_reviews?: number | null;
    rework_count?: number | null;
    human_interventions?: number | null;
    jev_abstentions?: number | null;
    total_tokens?: number | null;
    total_cost_usd?: number | null;
    campaigns_count?: number | null;
  };
  campaigns?: { id: string; task_id?: string; status?: string; reason?: string; time?: string }[];
  epochs?: EpochRecord[];
  manifest_status?: ManifestStatus;
  guards?: EvolutionGuards;
};

export type EvolutionReport = { data: EvolutionData | null; loading: boolean; error: string | null; updatedAt?: string | null; stale?: boolean };

export function evolutionState(report: EvolutionReport) {
  if (report.data && (report.error || report.stale)) return "stale";
  if (report.loading) return report.data ? "refreshing" : "loading";
  if (report.error) return "error";
  return report.data ? "ready" : "unknown";
}

export function measuredCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "Não medido";
}

export function measuredPercent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? `${value}%` : "Não medido";
}

export function observedTime(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("pt-BR") : "Data não informada";
}

export const boundaryLabels: Record<string, string> = {
  credentials_and_secrets: "Credenciais e segredos",
  global_codex_configuration: "Configuração global do Codex",
  native_hook_trust: "Confiança dos hooks nativos",
  project_charter_mission_vision_principles: "Direção permanente do projeto",
  acceptance_tests_and_eval_fixtures: "Testes de aceitação e fixtures de avaliação",
  explicit_user_stop: "Parada explícita do usuário",
};
