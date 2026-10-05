import { createInterface } from 'node:readline';
import { createEngine, TOOLS, agentCallOptions } from './engine.mjs';
import { recordEvent } from './telemetry.mjs';
import {createLiveTypesafeSettings} from './typesafe-settings.mjs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const configuration=createLiveTypesafeSettings({dataDir:process.env.JEV_MISSION_DATA_DIR??join(homedir(),'.codex','mission-control'),repositoryRoot:dirname(fileURLToPath(import.meta.url)),environmentKey:process.env.TYPESAFE_API_KEY??''});
let engine,previous;
function currentEngine(){const next=configuration();if(!previous||previous.model!==next.model||previous.apiKey!==next.apiKey){engine=createEngine(next);previous=next;}return engine;}
const running = new Map();
let initialized = false;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const protocols = ['2025-11-25', '2025-06-18', '2024-11-05'];
async function handle(line) {
  let request;
  try { if (Buffer.byteLength(line) > 256000) throw new Error(); request = JSON.parse(line); }
  catch { error(null, -32700, 'Invalid JSON message'); return; }
  if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
    (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number')) {
    error(request?.id ?? null, -32600, 'Invalid request'); return;
  }
  if (request.id === undefined) {
    if (request.method === 'notifications/cancelled') running.get(request.params?.requestId)?.abort();
    return;
  }
  const { id, method, params = {} } = request;
  const result = value => send({ jsonrpc: '2.0', id, result: value });
  if (method === 'initialize') {
    initialized = true;
    result({ protocolVersion: protocols.includes(params.protocolVersion) ? params.protocolVersion : protocols[0],
      capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'jev-decisions', version: '0.2.0' },
      instructions: 'Use bounded semantic judgments when simpler code is insufficient. Ranking never deletes original evidence. Missing keys or failed requests return an explicit fallback.' }); return;
  }
  if (!initialized) { error(id, -32000, 'Initialize first'); return; }
  if (method === 'ping') { result({}); return; }
  if (method === 'tools/list') { result({ tools: TOOLS }); return; }
  if (method !== 'tools/call') { error(id, -32601, 'Method not found'); return; }
  if (running.has(id) || running.size >= 8) { error(id, -32000, 'Too many active requests'); return; }
  const controller = new AbortController();
  running.set(id, controller);
  try {
    const output = await currentEngine().call(params.name, params.arguments, controller.signal, agentCallOptions(params.name, params.arguments));
    recordEvent({kind:'jev_mcp',provider:'typesafe',tool:params.name,ok:output.ok,model:output.model,requested_model:output.requested_model,
      category:params.arguments?.category,selected_id:output.selected_id,action:output.action,reason:output.reason,policy:output.policy,confidence:output.confidence,
      probabilities:output.probabilities,usage:output.usage,cached:output.cached,latency_ms:output.latency_ms,
      priority:output.priority?.map(({id,score,confidence})=>({id,score,confidence})),error:output.error});
    result({ content: [{ type: 'text', text: JSON.stringify(output) }], isError: !output.ok });
  } catch { result({ content: [{ type: 'text', text: '{"ok":false,"error":"invalid_tool_arguments"}' }], isError: true }); }
  finally { running.delete(id); }
}
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => { void handle(line); })
  .on('close', () => { for (const controller of running.values()) controller.abort(); });
