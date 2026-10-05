import {existsSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hermesInvocation} from './hermes.mjs';
import {codexAuthEnvironment} from './codex-auth.mjs';
import {isExecutableProvider} from './executor-catalog.mjs';

// The agent CLI that ships with Devin Desktop; the editor launcher (devin-desktop.cmd) is a different program.
export function defaultDevinCli(env = process.env) {
  return join(env.LOCALAPPDATA ?? '', 'Programs', 'Devin', 'resources', 'app', 'extensions', 'windsurf', 'devin', 'bin', 'devin.exe');
}
const DEVIN_BRIDGE = fileURLToPath(new URL('../scripts/devin-bridge.mjs', import.meta.url));
const CODEX_APPSERVER_BRIDGE = fileURLToPath(new URL('../scripts/codex-appserver-bridge.mjs', import.meta.url));

export const QUOTA_REGEX = /quota|usage limit|rate[ -]?limit|too many requests|429|usage cap|insufficient[ _-]?quota|credits? (?:exhausted|depleted|empty)|billing|plan limit|capacity/i;
export const AUTH_REGEX = /unauthori[sz]ed|invalid[ _-]?token|expired[ _-]?session|auth[ _-]?failed|login required|forbidden|api[ _-]?key (?:invalid|missing)/i;

export function isQuotaFailure(diagnostics = '') {
  return QUOTA_REGEX.test(String(diagnostics));
}

export function isAuthFailure(diagnostics = '') {
  return AUTH_REGEX.test(String(diagnostics));
}

export function resolveNextProvider(currentProvider, fallbackChain = [], isEligibleFn = () => true) {
  if (!Array.isArray(fallbackChain) || !fallbackChain.length) return null;
  const currentIndex = fallbackChain.indexOf(currentProvider);
  
  // Look for the next eligible provider after the current one
  if (currentIndex >= 0) {
    for (let i = currentIndex + 1; i < fallbackChain.length; i++) {
      const candidate = fallbackChain[i];
      if (isEligibleFn(candidate)) return candidate;
    }
  }

  // If not found after current, check from beginning (excluding current)
  for (let i = 0; i < fallbackChain.length; i++) {
    const candidate = fallbackChain[i];
    if (candidate !== currentProvider && isEligibleFn(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildProviderExecution({
  providerId,
  credentials = {},
  task,
  fullPrompt,
  cwd,
  profile,
  codexPath,
  hermesPath,
  devinPath = defaultDevinCli(),
  dataDir,
  planningOnly = false,
  reviewOnly = false,
  subscriptionOnly = false,
  env = process.env,
} = {}) {
  if (!isExecutableProvider(providerId)) throw new Error(`Provedor sem contrato de execução verificado: ${providerId}`);
  const sandboxMode = planningOnly || reviewOnly ? 'read-only' : 'workspace-write';
  
  if (providerId === 'codex') {
    return {
      type: 'process',
      command: codexPath,
      args: [
        'exec', '--json', '--skip-git-repo-check',
        '--sandbox', sandboxMode,
        '-c', 'approval_policy="never"',
        '-m', profile.model,
        '-c', `model_reasoning_effort="${profile.effort}"`,
        '--cd', cwd,
        '-'
      ],
      options: {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: subscriptionOnly ? codexAuthEnvironment(env) : { ...env },
      },
      stdin: fullPrompt,
    };
  }

  if (providerId === 'codex-appserver') {
    // The durable app-server transport: one JSON-RPC turn over the same Codex login, with thread/turn
    // lifecycle, turn/interrupt for cancellation and real token usage — translated into NDJSON by the bridge.
    if (!codexPath || !existsSync(codexPath)) throw new Error('Codex CLI não encontrado em ' + String(codexPath) + '; o provedor codex-appserver precisa do mesmo binário do executor codex.');
    const promptDir = join(dataDir, 'prompts');
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, `codex-appserver-${randomUUID()}.txt`);
    writeFileSync(promptFile, fullPrompt, 'utf8');
    const args = [CODEX_APPSERVER_BRIDGE, '--codex', codexPath, '--cwd', cwd, '--prompt-file', promptFile, '--mode', sandboxMode];
    if (profile?.model) args.push('--model', profile.model);
    if (profile?.effort) args.push('--effort', profile.effort);
    return {
      type: 'process',
      command: process.execPath,
      args,
      options: { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: subscriptionOnly ? codexAuthEnvironment(env) : { ...env } },
      promptFile,
    };
  }

  if (providerId === 'hermes') {
    const promptDir = join(dataDir, 'prompts');
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, randomUUID() + '.txt');
    const invocation = hermesInvocation({
      hermesPath,
      workspace: cwd,
      prompt: fullPrompt,
      promptFile,
      maxTurns: 20
    });
    return {
      type: 'process',
      command: invocation.command,
      args: invocation.args,
      options: invocation.options,
      promptFile,
    };
  }

  // Antigravity has no verified execution or read-only transport.
  // Stored Gemini credentials do not establish an executor contract.
  // The admission gate above refuses it before allocating a prompt file.

  if (providerId === 'devin') {
    const exists = existsSync(devinPath);
    const model = credentials.model ?? 'devin-2.0';
    const env = { ...process.env };
    if (credentials.key) env.DEVIN_API_KEY = credentials.key;

    const promptDir = join(dataDir, 'prompts');
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, `devin-${randomUUID()}.txt`);
    writeFileSync(promptFile, fullPrompt, 'utf8');

    // devinPath is the Devin agent CLI (devin.exe), not the editor launcher. The bridge runs `devin -p`, refuses to start when the
    // CLI is not logged in, and reports the result in the NDJSON shape the supervisor reads. A missing CLI fails visibly.
    if (!exists) throw new Error('Devin CLI não encontrado em ' + devinPath + '; instale o Devin e execute "devin auth login".');
    return {
      type: 'process',
      command: process.execPath,
      args: [DEVIN_BRIDGE, '--devin', devinPath, '--cwd', cwd, '--prompt-file', promptFile, '--mode', sandboxMode === 'read-only' ? 'read-only' : 'write', ...(credentials.model && credentials.model !== 'devin-2.0' && credentials.model !== 'windsurf-cascade' ? ['--model', credentials.model] : [])],
      options: { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env },
      promptFile,
    };
  }

  throw new Error(`Provedor de execução não suportado: ${providerId}`);
}
