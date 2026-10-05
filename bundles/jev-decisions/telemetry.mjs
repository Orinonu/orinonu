import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export function recordEvent(event, dir=process.env.JEV_MISSION_DATA_DIR??join(homedir(),'.codex','mission-control')) {
  try { mkdirSync(dir,{recursive:true}); appendFileSync(join(dir,'events.ndjson'),JSON.stringify({id:randomUUID(),time:new Date().toISOString(),...event})+'\n'); }
  catch { /* Observability never blocks a task or leaks errors into MCP stdout. */ }
}
