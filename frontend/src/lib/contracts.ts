import type { Snapshot, FlowReport, DecisionItem } from "./mission";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const texts = (value: unknown) => Array.isArray(value) && value.every(text);
const collection = (value: unknown, valid: (row: Record<string, unknown>) => boolean) => Array.isArray(value) && value.every(row => record(row) && valid(row));
const optional = (value: unknown, valid: (value: unknown) => boolean) => value == null || valid(value);
const strings = (row: Record<string, unknown>, keys: string[]) => keys.every(key => optional(row[key], text));
const numbers = (row: Record<string, unknown>) => Object.values(row).every(value => optional(value, numeric));
const numericFields = (row: Record<string, unknown>, keys: string[]) => keys.every(key => optional(row[key], numeric));
const usageFields = ["input_tokens", "output_tokens", "estimated_usd", "estimated_brl", "unpriced_calls", "cached_calls", "seconds"];
const incompatible = () => Error("Resposta do servidor incompatível com esta interface. Tente atualizar a consulta.");
const event = (row: Record<string, unknown>) => strings(row, ["time", "label", "kind", "command", "activity_phase", "activity_attempt", "tool", "tool_name"]) && optional(row.files, texts);
const checklist = (row: Record<string, unknown>) => text(row.id) && strings(row, ["title", "label", "state"]) && optional(row.evidence_count, numeric) && optional(row.done, value => typeof value === "boolean");
const progress = (value: unknown): boolean => record(value) && optional(value.items, value => collection(value, checklist)) && optional(value.events, value => collection(value, event));
const direction = (row: Record<string, unknown>) => text(row.workspace) && strings(row, ["mission", "vision", "values", "principles", "objective", "success_criteria", "research_focus", "updated_at"]) && optional(row.repositories, texts);
const task = (row: Record<string, unknown>) => [row.id, row.title, row.workspace, row.status].every(text)
  && strings(row, ["goal", "acceptance", "specialist", "agent", "executor", "execution_agent", "plan_report", "review_report", "error", "archived_at", "created_at", "ended_at"])
  && ["autonomy_history", "recovery_history", "post_review_history"].every(key => optional(row[key], Array.isArray))
  && optional(row.progress, progress)
  && ["planning_run", "review_run", "implementation_run"].every(key => optional(row[key], value => record(value) && optional(value.progress, progress)))
  && optional(row.external_work, value => record(value) && text(value.status) && text(value.phase) && optional(value.checklist, value => collection(value, checklist)))
  && ["opportunity_audit", "direction_assist"].every(key => optional(row[key], value => typeof value === "boolean"))
  && ["queue", "queue_wait", "pipeline", "planning", "decision_recovery", "completion"].every(key => optional(row[key], value => record(value) && strings(value, ["status", "phase", "message", "reason", "owner", "resume_condition", "next_action", "label", "kind"])));

export function readSnapshot(value: unknown): Snapshot {
  if (!record(value) || !collection(value.tasks, task)) throw incompatible();
  const arrays: Record<string, (row: Record<string, unknown>) => boolean> = {
    project_directions: direction, projects: row => text(row.workspace),
    specialists: row => text(row.id) && text(row.name) && optional(row.skills, texts),
    opportunities: row => [row.id, row.title, row.workspace, row.status].every(text) && strings(row, ["goal", "acceptance", "recommendation", "risk"]) && optional(row.evidence, texts),
    events: row => text(row.kind) && text(row.time), autonomy_policies: row => text(row.workspace) && text(row.mode),
    integrations: row => text(row.id) && text(row.name) && strings(row, ["status", "detail"]),
  };
  for (const [key, valid] of Object.entries(arrays)) if (value[key] !== undefined && !collection(value[key], valid)) throw incompatible();
  for (const key of ["workspace", "scheduler", "context", "curator", "comparison", "executor_pause", "specialist_policy"]) if (!optional(value[key], record)) throw incompatible();
  if (record(value.workspace) && !optional(value.workspace.default, text)) throw incompatible();
  const scheduler = value.scheduler;
  if (record(scheduler) && (!["running", "queued"].every(key => optional(scheduler[key], value => record(value) && numbers(value))) || !numericFields(scheduler, ["planning_limit", "implementation_limit", "review_limit"]))) throw incompatible();
  if (record(value.comparison) && !numericFields(value.comparison, ["controlled_pairs", "accepted_pairs", "regressions", "proven_saved_usd", "proven_saved_seconds", "proven_saved_tokens"])) throw incompatible();
  if (!optional(value.metrics, value => record(value) && ["saved_usd", "saved_brl", "saved_seconds", "jev_calls", "jev_input_tokens", "jev_output_tokens", "jev_cached"].every(key => optional(value[key], numeric)))) throw incompatible();
  if (value.profiles !== undefined && (!record(value.profiles) || Object.values(value.profiles).some(row => !record(row) || !text(row.model) || !text(row.effort)))) throw incompatible();
  if (value.analytics !== undefined) {
    if (!record(value.analytics)) throw incompatible();
    if (!optional(value.analytics.tasks, value => collection(value, row => text(row.task_id) && strings(row, ["title", "model"]) && numericFields(row, usageFields)))) throw incompatible();
    if (!optional(value.analytics.simulations, value => collection(value, row => text(row.model) && numericFields(row, ["estimated_usd", "estimated_brl", "jev_estimated_usd", "jev_estimated_brl", "difference_usd", "difference_brl"])))) throw incompatible();
    for (const key of ["jev", "executor", "totals"]) if (!optional(value.analytics[key], value => record(value) && numericFields(value, usageFields))) throw incompatible();
    for (const key of ["currency", "pricing"]) if (!optional(value.analytics[key], record)) throw incompatible();
    const quote = value.analytics.currency;
    if (record(quote) && (!numericFields(quote, ["usd_brl", "bid", "ask"]) || !strings(quote, ["status", "source", "fetched_at", "observed_at"]) || !optional(quote.refresh, value => record(value) && strings(value, ["error"])))) throw incompatible();
  }
  return value as Snapshot;
}

export function readFlow(value: unknown): FlowReport[] {
  if (!collection(value, row => (row.workspace === null || text(row.workspace)) && text(row.mode) && text(row.convergence) && numeric(row.active)
    && collection(row.gates, gate => text(gate.reason)) && Array.isArray(row.waiting)
    && optional(row.external, value => collection(value, gate => text(gate.reason)))
    && optional(row.health, value => record(value) && typeof value.state === "string" && ["progressing", "stalled", "gated", "idle", "empty"].includes(value.state) && collection(value.stalled, row => text(row.task_id) && text(row.reason) && numeric(row.quiet_ms))
      && optional(value.capacity, value => record(value) && Object.values(value).every(row => record(row) && [row.limit, row.live, row.phantom, row.queued].every(numeric)))
      && optional(value.counts, value => record(value) && numbers(value))))) throw incompatible();
  return value as FlowReport[];
}

export function readDecisions(value: unknown): DecisionItem[] {
  if (!record(value) || !collection(value.items, row => text(row.id) && text(row.title) && (row.workspace === null || text(row.workspace))
    && strings(row, ["kind", "label", "question", "reason", "since", "owner", "task_id", "opportunity_id", "resume_condition"])
    && texts(row.questions) && record(row.recommendation) && text(row.recommendation.state)
    && strings(row.recommendation, ["option_id", "reason", "checked_at"]) && numericFields(row.recommendation, ["confidence"])
    && collection(row.options, option => text(option.id) && text(option.label) && text(option.effect) && typeof option.reversible === "boolean" && optional(option.requires_note, value => typeof value === "boolean")))) throw incompatible();
  return value.items as DecisionItem[];
}
