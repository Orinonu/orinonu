// Circuit breaker for an exhausted executor quota. When the Codex subscription reports that its usage limit was hit, every
// further launch fails within seconds, and each failure used to spawn recoveries and failure investigations. Pausing admission
// stops that amplification; a bounded half-open probe resumes the flow on its own once the quota is back.
// The breaker only reads executor messages and clocks: it grants no permission and never touches credentials.
import {randomUUID} from 'node:crypto';
export const PROBE_MS=30*60000;
export const PROBE_REPLY='NEXO_QUOTA_OK';
export function quotaProbeTask(pause,workspace){
 return {id:randomUUID(),executor_probe:true,workspace,title:'Verificar cota do executor',goal:`Reply with exactly ${PROBE_REPLY}. Do not use tools, read files, edit files, run commands or perform external actions.`,acceptance:'Resposta mínima do executor sem falha de cota.',agent:pause.provider??'codex',profile:'design',specialist:'generalist',status:'backlog',max_minutes:1,phase_limits:{planning:1},created_at:new Date().toISOString(),pipeline:{auto_implement:false}};
}
const USAGE_LIMIT=/usage limit|rate.?limit|quota (?:exceeded|exhausted)|limite de uso|insufficient_quota/i;
export const isUsageLimit=text=>USAGE_LIMIT.test(String(text??''));
export function resumeAt(text){
 const match=/try again at\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(String(text??''));
 const time=match?Date.parse(`${match[1]} ${match[2]}, ${match[3]} ${match[4]}`):NaN;
 return Number.isFinite(time)?time:null;
}
export function newPause(text,now=Date.now(),provider='codex'){
 const resume=resumeAt(text);
 return {status:'paused',reason:'usage_limit',provider:provider==='codex-appserver'?'codex':provider,message:String(text).replace(/\s+/g,' ').slice(0,240),detected_at:new Date(now).toISOString(),resume_at_ms:resume,probe_at_ms:Math.min(resume>now?resume:Infinity,now+PROBE_MS)};
}
// 'open' admits normally, 'paused' admits nothing, 'probe' admits one read-only planning run to test whether the quota returned.
export function admission(pause,now=Date.now()){
 if(pause?.status!=='paused')return 'open';
 return now>=pause.probe_at_ms?'probe':'paused';
}
export const openPause=(pause,now=Date.now())=>({...pause,status:'open',resumed_at:new Date(now).toISOString()});
