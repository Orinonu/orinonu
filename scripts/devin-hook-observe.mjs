#!/usr/bin/env node
// Hook do Devin CLI: registra apenas metadados das ferramentas usadas, para o painel
// mostrar atividade real. Espelha scripts/observe.mjs do Codex. Nunca grava entradas,
// respostas, comandos ou transcrições, e nunca interrompe o trabalho.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { recordEvent } from '../bundles/jev-decisions/telemetry.mjs';

try {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 2_000_000) process.exit(0); }
  const input = JSON.parse(raw);
  const dataDir = process.env.JEV_MISSION_DATA_DIR ?? join(homedir(), '.codex', 'mission-control');
  recordEvent({
    kind: 'tool_observed',
    source: 'native_hook',
    hook_event: typeof input.hook_event_name === 'string' ? input.hook_event_name : 'PostToolUse',
    session_id: typeof input.session_id === 'string' ? input.session_id.slice(0, 120) : undefined,
    workspace: typeof process.env.DEVIN_PROJECT_DIR === 'string' ? process.env.DEVIN_PROJECT_DIR.slice(0, 1000) : undefined,
    tool: typeof input.tool_name === 'string' ? input.tool_name.slice(0, 160) : undefined,
  }, dataDir);
} catch { /* A telemetria não pode interromper o trabalho. */ }
