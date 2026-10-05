import { homedir } from 'node:os';
import { join } from 'node:path';
import { missionContext } from '../src/context.mjs';
import { recordEvent } from '../bundles/jev-decisions/telemetry.mjs';
try{
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2_000_000)process.exit(0);}
  const input=JSON.parse(raw);
  const dataDir=process.env.JEV_MISSION_DATA_DIR??join(homedir(),'.codex','mission-control');
  const context=missionContext(dataDir,typeof input.cwd==='string'?input.cwd:process.cwd());
  recordEvent({kind:'mission_consulted',source:'native_hook',available:context.available,task_count:context.tasks.length,
    session_id:typeof input.session_id==='string'?input.session_id.slice(0,120):undefined},dataDir);
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:context.text}}));
}catch{/* A failed consultation cannot block the user's prompt. */}
