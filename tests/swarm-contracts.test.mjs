import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAgentDefinition,
  validateAgentVariant,
  validateCatalogPackManifest,
  validateAgentBinding,
  validateProjectPolicy,
  validateAutonomyMandate,
} from '../src/swarm/contracts.mjs';

const baseDef = {
  id: 'nextjs', kind: 'specialist', parent_id: 'frontend-lead', team_id: 'frontend-lead',
  version: 1, name: 'Next.js', scope: 'Renderização e roteamento.',
  phases: ['design', 'implementation'], skill_refs: ['tdd'],
  tool_family_requirements: ['fs', 'test-runner'], memory_policy: 'scoped',
};

test('agent definitions accept a valid contract and reject malformed shapes with typed errors', () => {
  assert.equal(validateAgentDefinition(baseDef), true);
  assert.equal(validateAgentDefinition({ ...baseDef, outputs: ['patch'], verification: ['tests'] }), true);
  for (const bad of [
    { ...baseDef, id: 'Bad Id' },
    { ...baseDef, id: '' },
    { ...baseDef, kind: 'root' },
    { ...baseDef, kind: 'central', parent_id: 'x' },
    { ...baseDef, parent_id: null },
    { ...baseDef, version: 0 },
    { ...baseDef, version: 1.5 },
    { ...baseDef, hash: 'not-hex' },
    { ...baseDef, scope: 'x'.repeat(5000) },
    { ...baseDef, phases: ['magic'] },
    { ...baseDef, phases: 'design' },
    { ...baseDef, skill_refs: ['tdd', 'tdd'] },
    { ...baseDef, extra_field: true },
    { ...baseDef, memory_policy: 'everything' },
    JSON.parse('{"id":"a","kind":"specialist","parent_id":"b","team_id":"b","version":1,"scope":"s","__proto__":{"polluted":true}}'),
  ]) assert.throws(() => validateAgentDefinition(bad), /invalid_agent_definition/, JSON.stringify(bad).slice(0, 80));
});

test('variants stay inside the base envelope: only bounded params, versioned, with provenance when active', () => {
  const variant = {
    id: 'nextjs--app-router-strict', base_id: 'nextjs', workspace: 'c:/proj',
    version: 1, params: { scope_overlay: 'App Router apenas.', extra_skill_refs: ['grill-with-docs'], model_preference: 'gpt-6.1-sol', budget_class: 'standard' },
    provenance: { proposed_by: 'orchestrator', proposed_at: '2026-10-05T00:00:00Z' },
    status: 'proposed',
  };
  assert.equal(validateAgentVariant(variant), true);
  const active = { ...variant, status: 'active', provenance: { ...variant.provenance, approved_by: 'user', decision_ref: 'd-1' } };
  assert.equal(validateAgentVariant(active), true);
  for (const bad of [
    { ...variant, id: 'other' },
    { ...variant, base_id: 'missing base!' },
    { ...variant, params: { ...variant.params, new_permission: 'shell' } },
    { ...variant, params: { ...variant.params, parent_id: 'other-team' } },
    { ...variant, params: { extra_skill_refs: Array(20).fill('x') } },
    { ...variant, params: { budget_class: 'unlimited' } },
    { ...active, provenance: variant.provenance },
    { ...variant, status: 'whatever' },
    { ...variant, version: 0 },
  ]) assert.throws(() => validateAgentVariant(bad), /invalid_agent_variant/, JSON.stringify(bad).slice(0, 80));
});

test('catalog pack manifests declare wave, provenance and bounded definitions', () => {
  const pack = {
    pack_id: 'data-ai', wave: 2, version: 1,
    required_tool_families: ['python', 'test-db'],
    provenance: { proposed_by: 'user', proposed_at: '2026-10-05T00:00:00Z', approved_by: 'user', decision_ref: 'd-9' },
    definitions: [
      { id: 'data-lead', name: 'Líder de dados', parent_id: 'orchestrator', scope: 'Coordena dados/IA.', skill_refs: ['research'] },
      { id: 'data-engineer', name: 'Engenharia de dados', parent_id: 'data-lead', scope: 'Pipelines.', skill_refs: ['tdd'] },
    ],
  };
  assert.equal(validateCatalogPackManifest(pack), true);
  for (const bad of [
    { ...pack, pack_id: 'data ai' },
    { ...pack, wave: 0 },
    { ...pack, wave: 9 },
    { ...pack, definitions: [] },
    { ...pack, definitions: [...pack.definitions, pack.definitions[0]] },
    { ...pack, definitions: [{ ...pack.definitions[0], parent_id: 'data-engineer' }] },
    { ...pack, required_tool_families: 'python' },
    { ...pack, unknown: 1 },
  ]) assert.throws(() => validateCatalogPackManifest(bad), /invalid_catalog_pack/, JSON.stringify(bad).slice(0, 80));
});

test('bindings carry connection/model refs and strategy without granting anything', () => {
  const binding = {
    workspace: 'c:/proj', agent_id: 'nextjs', phase: 'implementation', revision: 3,
    model_connection_ref: 'conn-1', model_id: 'gpt-6.1-sol', settings: { effort: 'medium' },
    execution_strategy: 'codex_harness', harness_connection_ref: 'conn-codex', harness_model_id: 'gpt-6.1-sol',
    limits: { max_turns: 20, deadline_minutes: 45, context_tokens: 128000 },
    capability_requirements: ['fs', 'test-runner'],
    fallback_policy: { allowed: false },
  };
  assert.equal(validateAgentBinding(binding), true);
  assert.equal(validateAgentBinding({ ...binding, phase: 'all', model_connection_ref: null, model_id: null }), true);
  for (const bad of [
    { ...binding, agent_id: 'Bad Id' },
    { ...binding, phase: 'deploy' },
    { ...binding, revision: 0 },
    { ...binding, execution_strategy: 'yolo' },
    { ...binding, limits: { max_turns: -1 } },
    { ...binding, fallback_policy: { allowed: true, silent_paid: true } },
    { ...binding, model_payload: { endpoint: 'https://evil.example' } },
    { ...binding, workspace: 42 },
  ]) assert.throws(() => validateAgentBinding(bad), /invalid_agent_binding/, JSON.stringify(bad).slice(0, 80));
});

test('project policy and autonomy mandate keep readiness and levels honest', () => {
  const policy = {
    workspace: 'c:/proj', revision: 1, requested: 'swarm', enabled: false,
    readiness: { state: 'blocked', reasons: ['no verified connection'] },
    approved_bindings: [], limits: { max_nodes: 64 },
  };
  assert.equal(validateProjectPolicy(policy), true);
  const mandate = {
    workspace: 'c:/proj', level: 2, permitted_actions: ['read_workspace', 'bounded_write'],
    evidence: { verified_deliveries: 4, review_passes: 3, interventions: 1, unknown_effects: 0 },
    promoted_by: 'user', promoted_at: '2026-10-05T00:00:00Z', revision: 2,
  };
  assert.equal(validateAutonomyMandate(mandate), true);
  for (const bad of [
    { ...policy, enabled: true, readiness: { state: 'blocked', reasons: ['x'] } },
    { ...policy, readiness: { state: 'ok' } },
    { ...mandate, level: 5 },
    { ...mandate, level: 4, evidence: { ...mandate.evidence, verified_deliveries: 0 }, promoted_by: 'orchestrator' },
    { ...mandate, permitted_actions: 'everything' },
    { ...mandate, evidence: { verified_deliveries: -1 } },
  ]) {
    const isPolicy = 'requested' in bad;
    assert.throws(() => (isPolicy ? validateProjectPolicy(bad) : validateAutonomyMandate(bad)),
      isPolicy ? /invalid_project_policy/ : /invalid_autonomy_mandate/, JSON.stringify(bad).slice(0, 80));
  }
});
