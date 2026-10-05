import {execFileSync} from 'node:child_process';

/** Windows recycles PIDs quickly, so a live PID alone never proves that the executor an attempt recorded is still
 * running. These helpers add the missing proof; anything they cannot establish stays "not proven". */
export const REUSE_TOLERANCE_MS=5000;

/** Start time (ms since epoch) of the live process under `pid`, or null when it cannot be established. */
export function processStartTime(pid){
  if(!Number.isInteger(pid)||pid<=0||process.platform!=='win32')return null;
  try{
    const out=execFileSync('powershell',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],{timeout:4000,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    const ms=Date.parse(out);return Number.isFinite(ms)?ms:null;
  }catch{return null;}
}

/** True only with proof: the live process under this PID started after the attempt spawned its executor. */
export function pidReused(pid,spawnedAt,probe=processStartTime){
  if(!Number.isFinite(spawnedAt))return false;
  const started=probe(pid);
  return Number.isFinite(started)&&started>spawnedAt+REUSE_TOLERANCE_MS;
}
