import { writeFileSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

// The installed Hermes CLI (separate binary, not a PATH lookup).
export function defaultHermesCli(env = process.env) {
  const localAppData = env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : '');
  return join(localAppData, 'hermes', 'bin', 'hermes.exe');
}

// The pooled credential Mission Control relies on; hermes auth status <provider> reports "logged in".
export const HERMES_PROVIDER = 'openai-codex';
// CLI capabilities the invocation depends on; each is probed against `hermes chat --help` — a missing
// flag means the real binary cannot honour the contract, so eligibility must fail closed.
export const HERMES_REQUIRED_ARGS = ['chat', '--query-file', '--oneshot', '--format', '--max-turns', '--in', '--source', '--resume'];
// The contract actually applied by the invocation below: signal-only cancellation (terminate()),
// resumable sessions via --resume <session_id>, no approval bypass (the --yolo flag is never passed),
// usage reported by the terminal `result` event and the effective model from `system`/`result` events.
export const HERMES_CONTRACT = Object.freeze({
  transport: 'process',
  durable_session: '--resume',
  cancellation: 'signal',
  approval_bypass: false,
  usage_fields: Object.freeze(['input', 'output', 'total', 'cache_read', 'cache_write']),
  effective_model: 'event',
  provider: HERMES_PROVIDER,
});

// Probes are spawnSync calls against a Python CLI (~seconds). Cached by binary path; the state
// endpoint passes probe:false to read the last result without blocking the event loop.
let verifyCache = { at: 0, path: null, value: null };
export function verifyHermes({ hermesPath = defaultHermesCli(), run = spawnSync, ttlMs = 60000, now = Date.now(), probe = true } = {}) {
  const fresh = verifyCache.path === hermesPath && verifyCache.value !== null && now - verifyCache.at < ttlMs;
  if (fresh) return verifyCache.value;
  if (!probe) return { ok: false, verified_at: null, detail: 'verificação ainda não executada para este executor' };
  const fail = detail => ({ ok: false, verified_at: new Date().toISOString(), detail });
  let value;
  if (!hermesPath || !existsSync(hermesPath)) value = fail('binário não encontrado em ' + String(hermesPath));
  else {
    try {
      const version = run(hermesPath, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const versionText = `${version.stdout ?? ''}`;
      const versionMatch = version.error || version.status !== 0 ? null : versionText.match(/Hermes Agent v(\d+\.\d+\.\d+)/i);
      const help = versionMatch ? run(hermesPath, ['chat', '--help'], { encoding: 'utf8', timeout: 8000, windowsHide: true }) : null;
      const helpText = `${help?.stdout ?? ''}`;
      const missingFlags = versionMatch ? HERMES_REQUIRED_ARGS.filter(flag => flag !== 'chat' && !helpText.includes(flag)) : HERMES_REQUIRED_ARGS;
      let loggedIn = false;
      if (versionMatch && missingFlags.length === 0) {
        const auth = run(hermesPath, ['auth', 'status', HERMES_PROVIDER], { encoding: 'utf8', timeout: 8000, windowsHide: true });
        const authText = `${auth.stdout ?? ''} ${auth.stderr ?? ''}`;
        // "not logged in" contains the success phrase — require the positive shape and deny the negative one.
        loggedIn = !auth.error && auth.status === 0 && /logged in/i.test(authText) && !/not logged in/i.test(authText);
      }
      value = versionMatch && missingFlags.length === 0 && loggedIn
        ? { ok: true, verified_at: new Date().toISOString(), version: versionMatch[1], provider: HERMES_PROVIDER, logged_in: true, missing_flags: [] }
        : {
            ok: false,
            verified_at: new Date().toISOString(),
            version: versionMatch?.[1] ?? null,
            provider: HERMES_PROVIDER,
            logged_in: loggedIn,
            missing_flags: missingFlags,
            detail: !versionMatch ? 'falha em `hermes --version`' : missingFlags.length ? 'chat --help não expõe ' + missingFlags.join(', ') : 'auth status ' + HERMES_PROVIDER + ': credencial não autenticada',
          };
    } catch (error) {
      value = fail('sonda falhou: ' + String(error.message ?? error).slice(0, 120));
    }
  }
  verifyCache = { at: now, path: hermesPath, value };
  return value;
}

// The caller owns the private directory and removes the prompt after the run.
// On Windows mode 0600 is not an ACL: the directory must have restricted ACLs.
export function hermesInvocation({ hermesPath, workspace, prompt, promptFile, maxTurns = 20 }) {
  for (const [name, value] of Object.entries({ hermesPath, workspace, promptFile })) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
      throw new TypeError(`${name} must be an absolute path`);
    }
  }
  if (!statSync(workspace).isDirectory()) throw new TypeError('workspace must be a directory');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt must be nonempty text');
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new TypeError('maxTurns must be a positive integer');
  writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return {
    command: hermesPath,
    args: ['chat', '--in', workspace, '--query-file', promptFile, '--oneshot', '--format', 'stream-json', '--max-turns', String(maxTurns), '--source', 'tool'],
    options: { cwd: workspace, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  };
}

const integer = value => Number.isSafeInteger(value) && value >= 0;
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value);
const toolKinds = new Map([
  ['terminal','command_execution'], ['read_file','file_read'],
  ['write_file','file_change'], ['patch','file_change'],
  ['web_search','web_search'], ['web_extract','web_search'],
  ['delegate_task','collab_tool_call'], ['memory','memory_lookup'],
]);

// Persist telemetry only. Prompts, tool arguments, final text and errors may
// contain secrets and deliberately never become dashboard events here.
export function parseHermesEvent(row) {
  let event = row;
  if (typeof row === 'string') {
    try { event = JSON.parse(row); } catch { return null; }
  }
  if (!event || typeof event !== 'object') return null;
  if (['tool_use','tool_result'].includes(event.type)) {
    if (!label(event.name) || !/^[a-zA-Z0-9_.:-]+$/.test(event.name)) return null;
    if (event.type === 'tool_result' && typeof event.is_error !== 'boolean') return null;
    const metadata = { type: event.type, tool: toolKinds.get(event.name) ?? 'hermes_tool_call' };
    if (event.type === 'tool_result') {
      metadata.failed = event.is_error;
      if (typeof event.duration_ms === 'number' && Number.isFinite(event.duration_ms) && event.duration_ms >= 0) metadata.durationMs = event.duration_ms;
    }
    return metadata;
  }
  if (!['system', 'result'].includes(event.type)) return null;
  const metadata = { type: event.type };
  if (label(event.model)) metadata.model = event.model;
  if (label(event.session_id)) metadata.sessionId = event.session_id;
  if (event.type === 'result') {
    if (integer(event.exit_code)) metadata.exitCode = event.exit_code;
    if (typeof event.duration_ms === 'number' && Number.isFinite(event.duration_ms) && event.duration_ms >= 0) metadata.durationMs = event.duration_ms;
    if (event.tokens && typeof event.tokens === 'object') {
      const usage = {};
      for (const key of ['input', 'output', 'total', 'cache_read', 'cache_write']) {
        if (integer(event.tokens[key])) usage[key] = event.tokens[key];
      }
      if (Object.keys(usage).length) metadata.usage = usage;
    }
  }
  return metadata;
}
