#!/usr/bin/env node
// Hook SessionStart do Devin: garante que o painel do Mission Control esteja de pé, como o hook de início do Codex.
// Executa o mesmo scripts/start.ps1 (que verifica o runtime e só sobe o servidor se ele ainda não responde), sem abrir o navegador
// e sem escrever nada na saída padrão, para não interferir na resposta do hook. Nunca bloqueia a sessão.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'start.ps1');
  if (process.platform === 'win32' && existsSync(script) && process.env.NEXO_HOOK_DRY_RUN !== '1') {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  }
} catch { /* Falha ao iniciar o painel não pode interromper a sessão. */ }
