#!/usr/bin/env node
// Hook do Devin CLI: injeta o snapshot do Nexo Mission Control no contexto da sessão.
// Espelha scripts/consult.mjs do Codex, reaproveitando src/context.mjs. Somente leitura.
// Nunca bloqueia o prompt: qualquer falha sai com código 0 e sem saída.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { missionContext } from '../src/context.mjs';

try {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 2_000_000) process.exit(0); }
  const input = raw.trim() ? JSON.parse(raw) : {};
  const dataDir = process.env.JEV_MISSION_DATA_DIR ?? join(homedir(), '.codex', 'mission-control');
  const projectDir = process.env.DEVIN_PROJECT_DIR ?? (typeof input.cwd === 'string' ? input.cwd : process.cwd());
  const context = missionContext(dataDir, resolve(projectDir));
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: typeof input.hook_event_name === 'string' ? input.hook_event_name : 'UserPromptSubmit',
      additionalContext: context.text,
    },
  }));
} catch { /* Uma consulta falha nunca pode bloquear o pedido do usuário. */ }
