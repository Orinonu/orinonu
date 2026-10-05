import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import {createHash} from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  verifyEvalManifest,
  validateOverlayCandidate,
  evaluateCandidateGate,
  detectRegression,
  runEvolutionEpoch,
  EVOLUTION_GUARDS,
} from '../src/evolution.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const EVALS_DIR = join(ROOT, 'evals');

test('verifyEvalManifest verifies the canonical benchmark dataset', () => {
  const result = verifyEvalManifest(EVALS_DIR);
  assert.equal(result.valid, true);
  assert.equal(result.checked_files.length, 1);
  assert.equal(result.checked_files[0].filename, 'fixtures.json');
  assert.equal(typeof result.checked_files[0].hash, 'string');
});

test('verifyEvalManifest detects tampered or missing benchmark files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tamper-eval-'));
  try {
    writeFileSync(
      join(tmp, 'MANIFEST.json'),
      JSON.stringify({ files: { 'fixtures.json': 'fakehash123' } })
    );
    writeFileSync(join(tmp, 'fixtures.json'), 'altered content');

    const result = verifyEvalManifest(tmp);
    assert.equal(result.valid, false);
    assert.match(result.error, /Divergência de hash de integridade/);

    rmSync(join(tmp, 'fixtures.json'));
    const missingResult = verifyEvalManifest(tmp);
    assert.equal(missingResult.valid, false);
    assert.match(missingResult.error, /Arquivo referenciado no manifesto ausente/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('evaluation manifests cannot reference files outside the benchmark directory or an empty dataset',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'scoped-evals-')),evalDir=join(tmp,'evals');
 try{
  mkdirSync(evalDir);writeFileSync(join(tmp,'outside.json'),'synthetic outside fixture');
  const hash=createHash('sha256').update('synthetic outside fixture').digest('hex');
  for(const filename of ['../outside.json','..\\outside.json',join(tmp,'outside.json')]){
   writeFileSync(join(evalDir,'MANIFEST.json'),JSON.stringify({files:{[filename]:hash}}));
   assert.equal(verifyEvalManifest(evalDir).valid,false,filename);
  }
  writeFileSync(join(evalDir,'MANIFEST.json'),JSON.stringify({files:{}}));
  assert.equal(verifyEvalManifest(evalDir).valid,false);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});

test('validateOverlayCandidate enforces strict allowlist and rejects unsafe keys', () => {
  const valid = validateOverlayCandidate({
    routing_thresholds: { confidence: 0.85, margin: 0.2 },
    fallback_order: ['generalist', 'design'],
  });
  assert.equal(valid.valid, true);

  const invalidKey = validateOverlayCandidate({
    code_patches: 'console.log("bad")',
  });
  assert.equal(invalidKey.valid, false);
  assert.match(invalidKey.reason, /Chave não permitida/);

  const forbiddenContent = validateOverlayCandidate({
    triage_rules: [{ name: 'bypass', action: 'extract_token_from_env' }],
  });
  assert.equal(forbiddenContent.valid, false);
  assert.match(forbiddenContent.reason, /Tentativa de mutação não autorizada/);
});

test('evaluateCandidateGate enforces shadow mode when paired samples < 10', () => {
  const gate = evaluateCandidateGate({
    baseline: { accuracy: 0.85 },
    candidate: { accuracy: 0.9, unsafe: 0 },
    pairedSamples: [{ id: 'p1' }, { id: 'p2' }], // Only 2 pairs
  });

  assert.equal(gate.eligible, false);
  assert.equal(gate.status, 'awaiting_paired_samples');
  assert.equal(gate.current_pairs, 2);
  assert.equal(gate.min_pairs, 10);
});

test('evaluateCandidateGate rejects regressions and unsafe decisions', () => {
  const unsafeGate = evaluateCandidateGate({
    baseline: { accuracy: 0.85 },
    candidate: { accuracy: 0.95, unsafe: 1 },
    pairedSamples: Array.from({ length: 15 }, (_, i) => ({ id: `p${i}` })),
  });
  assert.equal(unsafeGate.eligible, false);
  assert.equal(unsafeGate.status, 'rejected');
  assert.match(unsafeGate.reason, /Decisões inseguras detectadas/);

  const regressedGate = evaluateCandidateGate({
    baseline: { accuracy: 0.9 },
    candidate: { accuracy: 0.8, unsafe: 0 },
    pairedSamples: Array.from({ length: 15 }, (_, i) => ({ id: `p${i}` })),
  });
  assert.equal(regressedGate.eligible, false);
  assert.equal(regressedGate.status, 'rejected');
  assert.match(regressedGate.reason, /Regressão de acurácia/);
});

test('evaluateCandidateGate approves promotion when paired samples >= 10 and no regression', () => {
  const gate = evaluateCandidateGate({
    baseline: { accuracy: 0.85 },
    candidate: { accuracy: 0.9, unsafe: 0 },
    pairedSamples: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` })),
  });

  assert.equal(gate.eligible, true);
  assert.equal(gate.status, 'promotable');
});

test('detectRegression triggers rollback on acceptance drop or rework spike', () => {
  const ok = detectRegression({
    baselineMetrics: { acceptance_rate: 90, rework_count: 2 },
    currentMetrics: { acceptance_rate: 88, rework_count: 3 },
  });
  assert.equal(ok.should_rollback, false);

  const acceptanceDrop = detectRegression({
    baselineMetrics: { acceptance_rate: 90, rework_count: 2 },
    currentMetrics: { acceptance_rate: 80, rework_count: 2 },
    threshold: 0.05, // 5 percentage points
  });
  assert.equal(acceptanceDrop.should_rollback, true);
  assert.match(acceptanceDrop.reason, /Queda na taxa de aceitação técnica/);

  const reworkSpike = detectRegression({
    baselineMetrics: { acceptance_rate: 90, rework_count: 2 },
    currentMetrics: { acceptance_rate: 90, rework_count: 8 },
  });
  assert.equal(reworkSpike.should_rollback, true);
  assert.match(reworkSpike.reason, /Aumento excessivo no retrabalho/);
});

test('runEvolutionEpoch executes shadow-mode evaluation with frozen benchmark', async () => {
  const events = [];
  const epoch = await runEvolutionEpoch({
    evalDir: EVALS_DIR,
    baselineMetrics: { acceptance_rate: 85, rework_count: 1 },
    pairedSamples: [],
    event: (e) => events.push(e),
  });

  assert.equal(epoch.mode, 'shadow');
  assert.equal(epoch.manifest_verified, true);
  assert.equal(epoch.applied, false);
  assert.equal(epoch.gate.status, 'awaiting_paired_samples');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'evolution_epoch_completed');
});
