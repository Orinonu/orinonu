import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAutonomousGate, HARD_LIMITS} from '../src/autonomous-gates.mjs';

test('hard limits always keep human or environment owner regardless of autonomy', () => {
  assert.ok(HARD_LIMITS.has('human_cancelled'));
  assert.ok(HARD_LIMITS.has('requires_operator'));
  const cancelled = resolveAutonomousGate('human_cancelled', {});
  assert.equal(cancelled.owner, 'human');
  assert.equal(cancelled.action, 'gate');

  const operator = resolveAutonomousGate('requires_operator', {});
  assert.equal(operator.owner, 'environment');
  assert.equal(operator.action, 'external');
});

test('scope and semantic items resolve automatically within charter in autonomous mode', () => {
  const scope = resolveAutonomousGate('human_scope_required', {sensitive: false});
  assert.equal(scope.owner, 'host-scheduler');
  assert.equal(scope.action, 'decide');

  const sensitive = resolveAutonomousGate('human_scope_required', {sensitive: true});
  assert.equal(sensitive.owner, 'environment');
  assert.equal(sensitive.action, 'external');
});

test('technical obstacles trigger bounded automatic replanning or extension', () => {
  const conflict = resolveAutonomousGate('integration_conflict', {attempts: 1});
  assert.equal(conflict.owner, 'host-scheduler');
  assert.equal(conflict.action, 'replan');

  const exhausted = resolveAutonomousGate('budget_exhausted', {extensions: 1});
  assert.equal(exhausted.owner, 'host-scheduler');
  assert.equal(exhausted.action, 'extend_budget');

  const maxBudget = resolveAutonomousGate('budget_exhausted', {extensions: 3});
  assert.equal(maxBudget.owner, 'host-scheduler');
  assert.equal(maxBudget.action, 'archive');
});
