/** Computes observed harness health and evolution metrics from persisted logs and tasks.
 * Null values represent unmeasured properties, never made-up zeros.
 */

export function computeHarnessMetrics({tasks = [], events = [], campaigns = [], analytics = {}, interventions} = {}) {
  const reviews = tasks.filter(t => t.review_contract?.decision);
  const approved = reviews.filter(t => t.review_contract?.decision === 'approved' && t.integration?.status === 'merged');
  const acceptance_rate = reviews.length ? Math.round((approved.length / reviews.length) * 100) : null;

  let rework_count = 0;
  for (const t of tasks) {
    const replans = (t.autonomy_history ?? []).filter(h => h.status === 'replan').length;
    rework_count += replans;
  }

  const jev_abstentions = events.filter(e => e.kind === 'jev_decision' && e.action === 'abstain').length;

  // The durable intervention registry is authoritative once it exists; before it, fall back to the event heuristic
  // (pending triage items classified as human plus explicit reconciliations).
  let human_interventions = 0;
  let human_interventions_by_category = null;
  if (Array.isArray(interventions)) {
    human_interventions = interventions.length;
    human_interventions_by_category = {planned_approval: 0, clarification: 0, correction: 0, unclassified: 0};
    for (const r of interventions) human_interventions_by_category[r.category ?? 'unclassified'] += 1;
  } else {
    for (const e of events) {
      if (e.kind === 'pending_triage_decision' && typeof e.human === 'number') {
        human_interventions += e.human;
      }
      if (e.kind === 'reconciliation_confirmed' || e.kind === 'attempt_reconciled' || e.kind === 'decision_answered') {
        human_interventions += 1;
      }
    }
  }

  let total_tokens = null;
  let measured_tokens = 0;
  let has_tokens = false;
  for (const t of tasks) {
    const input = t.measurement?.usage?.input_tokens;
    const output = t.measurement?.usage?.output_tokens;
    if (typeof input === 'number' && typeof output === 'number') {
      measured_tokens += (input + output);
      has_tokens = true;
    }
  }
  if (has_tokens) total_tokens = measured_tokens;

  const total_cost_usd = analytics?.totals?.estimated_usd ?? null;

  return {
    acceptance_rate,
    total_reviews: reviews.length,
    approved_reviews: approved.length,
    rework_count,
    human_interventions,
    ...(human_interventions_by_category ? {human_interventions_by_category} : {}),
    jev_abstentions,
    total_tokens,
    total_cost_usd,
    campaigns_count: campaigns.length,
  };
}
