import test from 'node:test';
import assert from 'node:assert/strict';
import {computeHarnessMetrics} from '../src/harness-metrics.mjs';

test('computeHarnessMetrics preserves nulls for unmeasured values and never invents zeros', () => {
  const metrics = computeHarnessMetrics({tasks: [], events: [], campaigns: []});
  assert.equal(metrics.acceptance_rate, null);
  assert.equal(metrics.rework_count, 0);
  assert.equal(metrics.human_interventions, 0);
  assert.equal(metrics.jev_abstentions, 0);
  assert.equal(metrics.total_tokens, null);
  assert.equal(metrics.total_cost_usd, null);
});

test('computeHarnessMetrics aggregates reviews, JEV abstentions and human interventions', () => {
  const tasks = [
    {
      id: 't1',
      review_contract: {decision: 'approved'},
      integration: {status: 'merged'},
      autonomy_history: [{status: 'replan'}],
      measurement: {duration_ms: 120000, usage: {input_tokens: 100, output_tokens: 200}}
    },
    {
      id: 't2',
      review_contract: {decision: 'rejected'},
      integration: {status: 'revision_required'},
      autonomy_history: []
    }
  ];
  const events = [
    {kind: 'jev_decision', action: 'abstain'},
    {kind: 'pending_triage_decision', human: 1}
  ];
  const metrics = computeHarnessMetrics({tasks, events, campaigns: []});
  assert.equal(metrics.acceptance_rate, 50);
  assert.equal(metrics.rework_count, 1);
  assert.equal(metrics.human_interventions, 1);
  assert.equal(metrics.jev_abstentions, 1);
  assert.equal(metrics.total_tokens, 300);
});
