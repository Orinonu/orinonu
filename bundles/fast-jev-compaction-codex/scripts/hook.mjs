import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { DEFAULTS, createAsker, prepare, inject } from './context.mjs';
import {readHarnessConfiguration} from './settings.mjs';

const mode = String(process.argv[2] ?? '').toLowerCase();
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
let apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? '';
const dataRoot = process.env.PLUGIN_DATA || process.env.JEV_DATA_ROOT;
let event = {};
const timerController = new AbortController();
const timeout = setTimeout(() => timerController.abort(), 20000);
timeout.unref();
function safeError(error) {
  if (timerController.signal.aborted || error.name === 'AbortError') return 'timeout';
  return /^[a-z0-9_]+$/.test(error.message) ? error.message : 'runtime_error';
}
try {
  const config = JSON.parse(await readFile(join(pluginRoot, 'config.json'), 'utf8'));
  const shared=await readHarnessConfiguration({environmentKey:apiKey});
  apiKey=shared.apiKey;
  const options = { ...DEFAULTS, ...config,...(shared.model?{model:shared.model}:{}) };
  if (typeof options.model !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(options.model)) throw Error('invalid_config');
  for (const key of Object.keys(DEFAULTS).filter(key => typeof DEFAULTS[key] === 'number')) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw Error('invalid_config');
  }
  if (options.keepThreshold > 1 || options.snapshotRetention < 1 || options.maxContextChars < 1000 || options.maxContextChars > 8000) throw Error('invalid_config');
  let resolvedModel=null;
  const delegate=createAsker({ apiKey, model: options.model, signal: timerController.signal });
  const asker={async ask(...args){const result=await delegate.ask(...args);if(/^jev-\d+\.\d+\.\d+$/.test(result.model??''))resolvedModel=result.model;return result;}};
  if (mode === 'check') {
    const result = await asker.ask('Esta tarefa exige preservar a API pública do parser.', {
      check: { type: 'noul', instructions: 'A tarefa exige preservar a API pública?' },
    });
    process.stdout.write(JSON.stringify({ ok: true, model: result.model, noul: result.answers.check.noul, usage: result.usage }) + '\n');
  } else {
    if (!dataRoot) throw Error('missing_plugin_data');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1000000) throw Error('hook_input_too_large');
    }
    event = JSON.parse(input.replace(/^\uFEFF/, ''));
    if (mode === 'prepare') {
      const result = await prepare(event, { dataRoot, options, asker, apiKey });
      await mkdir(resolve(dataRoot), { recursive: true });
      await writeFile(join(resolve(dataRoot), 'last-status.json'), JSON.stringify({ ok: true, sessionId: event.session_id,
        checkedAt: new Date().toISOString(), model: resolvedModel, requested_model: options.model, evidenceCount: result.evidenceCount,
        contextChars: result.contextChars ?? 0, stats: result.stats }), { mode: 0o600 });
      process.stdout.write('{}\n');
    } else if (mode === 'inject') {
      process.stdout.write(JSON.stringify(await inject(event, { dataRoot, options })) + '\n');
    } else throw Error('invalid_mode');
  }
} catch (error) {
  const reason = safeError(error);
  if (dataRoot && mode === 'prepare') {
    await mkdir(resolve(dataRoot), { recursive: true }).catch(() => {});
    await writeFile(join(resolve(dataRoot), 'last-status.json'), JSON.stringify({ ok: false,
      checkedAt: new Date().toISOString(), reason }), { mode: 0o600 }).catch(() => {});
  }
  process.stdout.write(JSON.stringify(mode === 'check' ? { ok: false, reason } : {
    systemMessage: `Jev context preservation skipped (${reason}); native compaction continues.`,
  }) + '\n');
} finally { clearTimeout(timeout); }
