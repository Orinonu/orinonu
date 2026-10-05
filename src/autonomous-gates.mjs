/** Pure policy ladder for autonomous mode.
 * Code enforces boundaries; JEV recommends choices.
 * In autonomous mode, reasons that normally pause for a human are mapped to bounded host
 * decisions within the saved charter, while strict external limits (secrets, explicit user stop)
 * are marked as external dependencies without blocking the rest of the swarm.
 */

export const HARD_LIMITS = new Set([
  'human_cancelled',
  'requires_operator',
  'secret_or_private_data',
]);

export function resolveAutonomousGate(reason, context = {}) {
  if (reason === 'human_cancelled') {
    return {
      action: 'gate',
      owner: 'human',
      reason: 'human_cancelled',
      resume_condition: 'explicit_human_reauthorization',
    };
  }

  if (reason === 'requires_operator' || context.sensitive) {
    return {
      action: 'external',
      owner: 'environment',
      reason: 'authorization_required',
      resume_condition: 'environment_ready',
    };
  }

  if (reason === 'human_scope_required') {
    return {
      action: 'decide',
      owner: 'host-scheduler',
      reason: 'awaiting_priority',
      resume_condition: 'diagnosis_or_decision_completed',
      assumption: 'charter_alignment',
    };
  }

  if (reason === 'integration_conflict') {
    if ((context.attempts ?? 0) < 2) {
      return {
        action: 'replan',
        owner: 'host-scheduler',
        reason: 'awaiting_priority',
        resume_condition: 'diagnosis_or_decision_completed',
      };
    }
    return {
      action: 'archive',
      owner: 'host-scheduler',
      reason: 'integration_conflict_limit',
      resume_condition: 'distinct_host_evidence',
    };
  }

  if (reason === 'budget_exhausted') {
    if ((context.extensions ?? 0) < 2) {
      return {
        action: 'extend_budget',
        owner: 'host-scheduler',
        reason: 'awaiting_priority',
        resume_condition: 'budget_extended',
      };
    }
    return {
      action: 'archive',
      owner: 'host-scheduler',
      reason: 'budget_limit_reached',
      resume_condition: 'distinct_host_evidence',
    };
  }

  if (reason === 'diagnosis_limit' || reason === 'decision_limit') {
    return {
      action: 'archive',
      owner: 'host-scheduler',
      reason: reason,
      resume_condition: 'distinct_host_evidence',
    };
  }

  if (reason === 'post_review_hold') {
    return {
      action: 'decide',
      owner: 'host-scheduler',
      reason: 'awaiting_priority',
      resume_condition: 'diagnosis_or_decision_completed',
    };
  }

  return {
    action: 'decide',
    owner: 'host-scheduler',
    reason: 'awaiting_priority',
    resume_condition: 'diagnosis_or_decision_completed',
  };
}
