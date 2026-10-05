import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const options = { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
const MAX_OUTPUT = 8192;

export function codexAuthEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) if (['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'].includes(key.toUpperCase())) delete env[key];
  return env;
}

export function parseCodexAuthStatus(output, exitCode) {
  if (exitCode === 0 && /Logged in using ChatGPT/i.test(output)) return 'chatgpt';
  if (exitCode === 0 && /Logged in using (?:an? )?API key/i.test(output)) return 'api_key';
  if (/Not logged in/i.test(output)) return 'unauthenticated';
  return 'unavailable';
}

// Only the official device page and strict device-code format leave this module.
export function parseDeviceChallenge(output) {
  const clean = String(output).replace(/\x1b\[[0-9;]*m/g, '');
  const url = clean.match(/https:\/\/auth\.openai\.com\/codex\/device(?=$|[\s)])/m);
  const code = clean.match(/(?:^|\s)([A-Z0-9]{4}-[A-Z0-9]{5}|[A-Z0-9]{4}-[A-Z0-9]{4})(?=$|\s)/m);
  return { ...(url ? { verification_url: url[0] } : {}), ...(code ? { user_code: code[1] } : {}) };
}

export function createCodexAuth({ codexPath, spawnImpl = spawn, probeTimeoutMs = 5000, loginTimeoutMs = 600000, env = process.env } = {}) {
  const spawnOptions = { ...options, env: codexAuthEnvironment(env) };
  let authStatus = 'unavailable';
  let login = { status: 'idle' };
  let child;
  let timer;
  let generation = 0;
  let startPromise;
  let probePromise;
  let cancelProbe;
  const state = () => ({ status: authStatus, login: { ...login }, ...(authStatus === 'api_key' ? { action: 'approval_required_to_replace_api_key' } : {}) });
  const kill = process => { try { process?.kill(); } catch { /* best effort process cleanup */ } };

  async function probe() {
    if (probePromise) return probePromise;
    probePromise = new Promise(resolve => {
      if (!codexPath) { authStatus = 'unavailable'; resolve(state()); return; }
      let process;
      let output = '';
      let settled = false;
      let deadline;
      const finish = status => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        authStatus = status;
        output = '';
        cancelProbe = undefined;
        resolve(state());
      };
      try {
        process = spawnImpl(codexPath, ['login', 'status'], spawnOptions);
        cancelProbe = () => { finish('unavailable'); kill(process); };
        const append = chunk => { output = (output + String(chunk)).slice(-MAX_OUTPUT); };
        process.stdout?.on('data', append);
        process.stderr?.on('data', append);
        process.once('error', () => finish('unavailable'));
        process.once('close', code => finish(parseCodexAuthStatus(output, code)));
        deadline = setTimeout(() => { finish('unavailable'); kill(process); }, probeTimeoutMs);
        deadline.unref?.();
      } catch { finish('unavailable'); }
    });
    try { return await probePromise; } finally { probePromise = undefined; }
  }

  async function begin(expectedGeneration) {
    login = { status: 'checking' };
    await probe();
    if (generation !== expectedGeneration) return state();
    if (authStatus !== 'unauthenticated') {
      login = { status: authStatus === 'chatgpt' ? 'authenticated' : authStatus === 'api_key' ? 'approval_required' : 'unavailable' };
      return state();
    }
    const id = randomUUID();
    login = { status: 'starting', id };
    let output = '';
    const finish = status => {
      if (generation !== expectedGeneration || login.id !== id || !['starting', 'awaiting_user'].includes(login.status)) return;
      clearTimeout(timer);
      timer = undefined;
      child = undefined;
      output = '';
      login = { status, id };
      if (status === 'completed') void probe();
    };
    try {
      child = spawnImpl(codexPath, ['login', '--device-auth'], spawnOptions);
      const process = child;
      const append = chunk => {
        if (generation !== expectedGeneration || login.id !== id || !['starting', 'awaiting_user'].includes(login.status)) return;
        output = (output + String(chunk)).slice(-MAX_OUTPUT);
        const challenge = parseDeviceChallenge(output);
        login = { ...login, ...challenge, status: challenge.verification_url && challenge.user_code ? 'awaiting_user' : 'starting' };
      };
      process.stdout?.on('data', append);
      process.stderr?.on('data', append);
      process.once('error', () => finish('failed'));
      process.once('close', code => finish(code === 0 ? 'completed' : 'failed'));
      timer = setTimeout(() => { finish('expired'); kill(process); }, loginTimeoutMs);
      timer.unref?.();
    } catch { finish('failed'); }
    return state();
  }

  async function start() {
    if (startPromise) return startPromise;
    if (['starting', 'awaiting_user'].includes(login.status)) return state();
    startPromise = begin(generation);
    try { return await startPromise; } finally { startPromise = undefined; }
  }

  function cancel() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    const process = child;
    child = undefined;
    login = { status: 'cancelled' };
    cancelProbe?.();
    kill(process);
    return state();
  }
  return { probe, start, state, cancel };
}
