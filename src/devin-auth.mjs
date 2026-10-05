import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultDevinCli } from './providers.mjs';

export const DEVIN_MODELS = [
  'devin-2.0',
  'windsurf-cascade',
];

export const DEVIN_PLAN_EXPIRY = null;

export function findDevinExecutable(env = process.env) {
  const localAppData = env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : '');
  const candidate = localAppData ? join(localAppData, 'Programs', 'Devin', 'Devin.exe') : null;
  if (candidate && existsSync(candidate)) return candidate;
  return null;
}

// Whether the Devin agent CLI itself is logged in. It is separate from the editor: Mission Control can only use Devin as an
// executor through this CLI. The answer is cached briefly because the panel probes on every state read.
let cliCache = { at: 0, path: null, value: null };
export function devinCliLoggedIn(cliPath, { now = Date.now(), run = spawnSync, ttlMs = 60000 } = {}) {
  if (!cliPath || !existsSync(cliPath)) return null;
  if (cliCache.path === cliPath && now >= cliCache.at && now - cliCache.at < ttlMs && cliCache.value !== undefined && cliCache.at > 0) return cliCache.value;
  let value = null;
  try {
    const result = run(cliPath, ['auth', 'status'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    value = result.error || result.status === null ? null : result.status === 0 && !/not logged in/i.test(`${result.stdout} ${result.stderr}`);
  } catch { value = null; }
  cliCache = { at: now, path: cliPath, value };
  return value;
}

export function createDevinAuth({
  providerSettings,
  executablePath = findDevinExecutable(),
  planExpiry = DEVIN_PLAN_EXPIRY,
  env = process.env,
  cliPath = defaultDevinCli(env),
  cliLogin = devinCliLoggedIn,
} = {}) {
  const devinDir = join(homedir(), '.devin');
  let status = 'ready';
  let detail = 'Verificando plano e instalação do Devin / Windsurf...';

  function calculateDaysRemaining() {
    const expiryTime = Date.parse(planExpiry);
    if (!Number.isFinite(expiryTime)) return null;
    const now = Date.now();
    const diffMs = expiryTime - now;
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  function probe() {
    const installed = Boolean(executablePath && existsSync(executablePath));
    const hasDevinDir = existsSync(devinDir);
    const daysRemaining = calculateDaysRemaining();
    const key = providerSettings ? providerSettings.credentials('devin')?.key : (env.DEVIN_API_KEY || '');
    const currentModel = providerSettings ? providerSettings.credentials('devin')?.model : 'devin-2.0';

    const cliAuthenticated = cliPath && existsSync(cliPath) ? cliLogin(cliPath) : null;
    if (cliPath && existsSync(cliPath) && cliAuthenticated === false && (daysRemaining === null || daysRemaining > 0)) {
      status = 'unauthenticated';
      detail = 'Devin Desktop instalado, mas o Devin CLI não está autenticado: execute "devin auth login" uma vez para o Mission Control poder usar o Devin como executor.';
    } else if (daysRemaining !== null && daysRemaining <= 0) {
      status = 'expired';
      detail = 'Prazo da política local expirado. A validade da assinatura não foi observada.';
    } else if (cliAuthenticated === true) {
      status = 'authenticated';
      detail = 'Login do Devin CLI verificado. A validade da assinatura não foi observada.';
    } else if (key && key.trim()) {
      status = 'credential_configured';
      detail = 'Credencial configurada. Isso não comprova login do CLI nem assinatura ativa.';
    } else if (installed || hasDevinDir) {
      status = 'unverified';
      detail = 'Instalação local do Devin detectada. A assinatura e sua validade não foram observadas.';
    } else {
      status = 'unauthenticated';
      detail = 'Insira o token ou conecte a assinatura Devin / Windsurf para habilitar a execução.';
    }

    return {
      status,
      installed,
      cli_path: cliPath,
      cli_authenticated: cliAuthenticated,
      path: executablePath,
      has_devin_dir: hasDevinDir,
      plan_name: null,
      plan_active_until: planExpiry,
      plan_active_until_source: planExpiry ? 'local_policy' : 'unknown',
      days_remaining: daysRemaining,
      verification: {credential_configured:Boolean(key?.trim()),cli_authenticated:cliAuthenticated,subscription_expires_at:null},
      model: currentModel || 'devin-2.0',
      models: DEVIN_MODELS,
      detail,
    };
  }

  // Initial probe
  probe();

  return {
    probe,
    state() {
      return probe();
    },
    connect({ api_key, token, model } = {}) {
      const activeKey = api_key || token;
      if (providerSettings) {
        const updatePayload = {
          providers: {
            devin: {
              enabled: true,
              ...(model ? { model } : {}),
              ...(activeKey ? { key: activeKey } : {}),
            },
          },
        };
        providerSettings.update(updatePayload);
      }
      return probe();
    },
  };
}
