import { recordEvent } from '../bundles/jev-decisions/telemetry.mjs';
let raw='';
try {
  for await(const part of process.stdin){raw+=part;if(raw.length>2_000_000)process.exit(0);}
  const input=JSON.parse(raw);
  // Keep metadata only. Inputs, responses, commands and transcripts are never journaled.
  recordEvent({kind:'tool_observed',source:'native_hook',hook_event:input.hook_event_name??'PostToolUse',
    session_id:typeof input.session_id==='string'?input.session_id.slice(0,120):undefined,
    workspace:typeof input.cwd==='string'?input.cwd.slice(0,1000):undefined,
    tool:typeof input.tool_name==='string'?input.tool_name.slice(0,160):undefined});
}catch{/* Telemetry must not interrupt work. */}
