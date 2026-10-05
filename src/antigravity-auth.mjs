import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ANTIGRAVITY_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

export function findAntigravityExecutable(env = process.env) {
  const localAppData = env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : '');
  const candidate = localAppData ? join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe') : null;
  if (candidate && existsSync(candidate)) return candidate;
  return null;
}

export function createAntigravityAuth({
  providerSettings,
  executablePath = findAntigravityExecutable(),
  env = process.env,
} = {}) {
  const geminiDir = join(homedir(), '.gemini');
  let status = 'unauthenticated';
  let detail = 'Verificando status da conta Google e Antigravity CLI...';

  function probe() {
    const installed = Boolean(executablePath && existsSync(executablePath));
    const hasGeminiDir = existsSync(geminiDir);
    const key = providerSettings ? providerSettings.credentials('antigravity')?.key : (env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '');
    const currentModel = providerSettings ? providerSettings.credentials('antigravity')?.model : 'gemini-3.8-flash';

    if (key && key.trim()) {
      status = 'authenticated';
      detail = 'Credencial Google configurada. Autenticação e cotas não foram verificadas.';
    } else if (installed || hasGeminiDir) {
      status = 'ready';
      detail = 'Instalação ou diretório local detectado. Isso não comprova autenticação nem disponibilidade.';
    } else {
      status = 'unauthenticated';
      detail = 'Conecte sua conta Google ou configure sua API Key para habilitar o Antigravity como fallback.';
    }

    return {
      status,
      installed,
      path: executablePath,
      has_gemini_dir: hasGeminiDir,
      model: currentModel || 'gemini-3.8-flash',
      models: ANTIGRAVITY_MODELS,
      verification: {credential_configured:Boolean(key?.trim()),authenticated:null,subscription_expires_at:null},
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
    connect({ api_key, model } = {}) {
      if (providerSettings) {
        const updatePayload = {
          providers: {
            antigravity: {
              enabled: true,
              ...(model ? { model } : {}),
              ...(api_key ? { key: api_key } : {}),
            },
          },
        };
        providerSettings.update(updatePayload);
      }
      return probe();
    },
  };
}
