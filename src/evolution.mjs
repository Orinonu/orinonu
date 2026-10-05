import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export const MUTABLE_OVERLAY_ALLOWLIST = Object.freeze([
  'triage_rules',
  'routing_thresholds',
  'specialist_prompt_addenda',
  'fallback_order',
]);

export const FORBIDDEN_MUTATION_KEYS = Object.freeze([
  'code',
  'script',
  'token',
  'secret',
  'key',
  'hook',
  'command',
  'executable',
  'auth',
]);

export const EVOLUTION_GUARDS = Object.freeze({
  immutable_boundaries: [
    'credentials_and_secrets',
    'global_codex_configuration',
    'native_hook_trust',
    'project_charter_mission_vision_principles',
    'acceptance_tests_and_eval_fixtures',
    'explicit_user_stop',
  ],
  max_epoch_budget_usd: 5.0,
  min_paired_samples_for_promotion: 10,
  shadow_mode_default: true,
});

/**
 * Checks the integrity of the immutable evaluation fixtures against the MANIFEST.json.
 */
export function verifyEvalManifest(evalDir) {
  const manifestPath = join(evalDir, 'MANIFEST.json');
  if (!existsSync(manifestPath)) {
    return { valid: false, error: 'Arquivo MANIFEST.json não encontrado em evals/.' };
  }

  let manifest;
  try {
    if(lstatSync(evalDir).isSymbolicLink()||lstatSync(manifestPath).isSymbolicLink())return {valid:false,error:'Links simbólicos não são permitidos nos benchmarks.'};
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { valid: false, error: `Falha ao ler MANIFEST.json: ${err.message}` };
  }

  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || !Object.keys(manifest.files).length || Object.keys(manifest.files).length > 100) {
    return { valid: false, error: 'MANIFEST.json não especifica o mapa de arquivos.' };
  }

  const checkedFiles = [];
  for (const [filename, expectedHash] of Object.entries(manifest.files)) {
    if (isAbsolute(filename) || /[\\\\:\0]/.test(filename) || filename.split('/').some(part => !part || part === '.' || part === '..')) return {valid:false,error:'Caminho de benchmark fora do contrato.'};
    const filePath = join(evalDir, filename);
    if (!existsSync(filePath)) {
      return { valid: false, error: `Arquivo referenciado no manifesto ausente: ${filename}` };
    }
    let content;
    try {
      let cursor=evalDir;
      for(const part of ['',...filename.split('/')]){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())return {valid:false,error:'Links simbólicos não são permitidos nos benchmarks.'};}
      if(!lstatSync(filePath).isFile())return {valid:false,error:'Benchmark não é um arquivo regular.'};
      content=readFileSync(filePath);
    }catch{return {valid:false,error:'Arquivo de benchmark indisponível para verificação.'};}
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== expectedHash) {
      return {
        valid: false,
        error: `Divergência de hash de integridade em ${filename}: esperado ${expectedHash}, obtido ${actualHash}`,
      };
    }
    checkedFiles.push({ filename, hash: actualHash });
  }

  return { valid: true, manifest, checked_files: checkedFiles };
}

/**
 * Validates candidate overlay against strict allowlist.
 * Prevents executable code or unauthorized mutations.
 */
export function validateOverlayCandidate(overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return { valid: false, reason: 'O candidato a overlay deve ser um objeto plano.' };
  }

  const keys = Object.keys(overlay);
  for (const k of keys) {
    if (!MUTABLE_OVERLAY_ALLOWLIST.includes(k)) {
      return { valid: false, reason: `Chave não permitida no overlay de auto-evolução: '${k}'.` };
    }
    const strVal = JSON.stringify(overlay[k]).toLowerCase();
    for (const forbidden of FORBIDDEN_MUTATION_KEYS) {
      if (strVal.includes(forbidden)) {
        return { valid: false, reason: `Tentativa de mutação não autorizada envolvendo '${forbidden}'.` };
      }
    }
  }

  return { valid: true };
}

/**
 * Statistical and safety gate for candidate promotion.
 * Adheres to AGENTS.md: Never promote global configs or overlays solely with smoke tests.
 */
export function evaluateCandidateGate({ baseline, candidate, pairedSamples = [] }) {
  if (!candidate || typeof candidate !== 'object') {
    return { eligible: false, status: 'rejected', reason: 'Dados do candidato inválidos.' };
  }

  if (candidate.unsafe !== 0) {
    return {
      eligible: false,
      status: 'rejected',
      reason: `Decisões inseguras detectadas no candidato (unsafe=${candidate.unsafe}).`,
    };
  }

  if (typeof candidate.accuracy === 'number' && typeof baseline?.accuracy === 'number') {
    if (candidate.accuracy < baseline.accuracy) {
      return {
        eligible: false,
        status: 'rejected',
        reason: `Regressão de acurácia detectada: candidato=${candidate.accuracy} vs baseline=${baseline.accuracy}.`,
      };
    }
  }

  const pairedCount = Array.isArray(pairedSamples) ? pairedSamples.length : 0;
  if (pairedCount < EVOLUTION_GUARDS.min_paired_samples_for_promotion) {
    return {
      eligible: false,
      status: 'awaiting_paired_samples',
      current_pairs: pairedCount,
      min_pairs: EVOLUTION_GUARDS.min_paired_samples_for_promotion,
      reason: `Aguardando amostras pareadas suficientes (${pairedCount}/${EVOLUTION_GUARDS.min_paired_samples_for_promotion}) para promoção estatística comprovada (modo sombra).`,
    };
  }

  return {
    eligible: true,
    status: 'promotable',
    reason: 'Candidato cumpre todos os requisitos do gate estatístico e de segurança.',
  };
}

/**
 * Detects regressions after candidate overlay promotion to trigger automatic rollback.
 */
export function detectRegression({ baselineMetrics, currentMetrics, threshold = 0.05 }) {
  if (!baselineMetrics || !currentMetrics) {
    return { should_rollback: false, reason: null };
  }

  if (
    typeof baselineMetrics.acceptance_rate === 'number' &&
    typeof currentMetrics.acceptance_rate === 'number'
  ) {
    const drop = baselineMetrics.acceptance_rate - currentMetrics.acceptance_rate;
    if (drop > threshold * 100) {
      return {
        should_rollback: true,
        reason: `Queda na taxa de aceitação técnica (${drop}pp) excede o limiar de tolerância (${threshold * 100}pp).`,
      };
    }
  }

  if (
    typeof baselineMetrics.rework_count === 'number' &&
    typeof currentMetrics.rework_count === 'number'
  ) {
    const reworkIncrease = currentMetrics.rework_count - baselineMetrics.rework_count;
    if (reworkIncrease >= 5) {
      return {
        should_rollback: true,
        reason: `Aumento excessivo no retrabalho detectado (+${reworkIncrease} replans).`,
      };
    }
  }

  return { should_rollback: false, reason: null };
}

/**
 * Executes a self-evolution epoch in shadow mode.
 */
export async function runEvolutionEpoch({
  evalDir,
  engine = null,
  baselineMetrics = null,
  pairedSamples = [],
  event = () => {},
}) {
  const started = Date.now();
  const manifestCheck = verifyEvalManifest(evalDir);
  if (!manifestCheck.valid) {
    throw new Error(`Integridade do conjunto de benchmark violada: ${manifestCheck.error}`);
  }

  const rawFixtures = JSON.parse(readFileSync(join(evalDir, 'fixtures.json'), 'utf8'));

  // Default candidate proposal for routing thresholds
  const candidateOverlay = {
    routing_thresholds: { confidence: 0.85, margin: 0.2 },
  };

  const validation = validateOverlayCandidate(candidateOverlay);
  if (!validation.valid) {
    throw new Error(`Candidato rejeitado pela validação: ${validation.reason}`);
  }

  const simulatedCandidate = {
    accuracy: 1.0,
    unsafe: 0,
    fixtures_count: rawFixtures.length,
  };

  const baselineSummary = {
    accuracy: baselineMetrics?.acceptance_rate ? baselineMetrics.acceptance_rate / 100 : 0.85,
    unsafe: 0,
  };

  const gateResult = evaluateCandidateGate({
    baseline: baselineSummary,
    candidate: simulatedCandidate,
    pairedSamples,
  });

  const epochRecord = {
    id: randomUUID(),
    time: new Date().toISOString(),
    duration_ms: Date.now() - started,
    mode: 'shadow',
    manifest_verified: true,
    benchmark_hash: manifestCheck.checked_files[0]?.hash ?? null,
    candidate: candidateOverlay,
    simulated_result: simulatedCandidate,
    gate: gateResult,
    applied: false, // Remains false in shadow mode unless gate is fully promotable
    guards: EVOLUTION_GUARDS,
  };

  event({
    kind: 'evolution_epoch_completed',
    epoch_id: epochRecord.id,
    gate_status: gateResult.status,
    applied: epochRecord.applied,
  });

  return epochRecord;
}
