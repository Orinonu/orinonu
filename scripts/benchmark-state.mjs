import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync,appendFileSync,writeFileSync,renameSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {historyFixture,writeHistoryFixture,normalizedState} from '../tests/fixtures/state-history.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]??null;
const script=fileURLToPath(import.meta.url);
if(process.argv[2]==='--worker'){
 const [arm,countText,policy='bytes']=process.argv.slice(3),count=Number(countText);
 const dir=mkdtempSync(join(tmpdir(),'nexo-state-bench-'));
 // Isolate the plugin status file and auth discovery from the user's live home.
 // This environment change exists only in this worker process.
 process.env.USERPROFILE=dir;process.env.HOME=dir;
 let fixture=historyFixture(count),fixtureHash=hash(JSON.stringify(fixture));
 writeHistoryFixture(dir,fixture);fixture=null;global.gc?.();
 const {createMissionServer}=await import(arm==='before'?'../tests/reference/server.mjs':'../src/server.mjs');
 const app=createMissionServer({dataDir:dir,apiKey:'',codexPath:null,hermesPath:null,historyVerification:policy});await app.listen(0);
 const scenarios={};
 async function scenario(name,action){
  const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();await delay(20);
  const elu=performance.eventLoopUtilization(),start=performance.now(),samples=[],digests=[],fieldDigests=[];
  const request=async()=>{
   const began=performance.now(),response=await fetch(app.url+'/api/state');assert.equal(response.status,200);
   const state=await response.json();samples.push(performance.now()-began);
   const normalized=normalizedState(state);
   digests.push(hash(JSON.stringify(normalized)));
   fieldDigests.push(Object.fromEntries(Object.entries(normalized).map(([key,value])=>[key,hash(JSON.stringify(value))])));return state;
  };
  await action(request);const elapsed=performance.now()-start;
  await delay(20);histogram.disable();
  const transient=process.memoryUsage();global.gc?.();const retained=process.memoryUsage();
  scenarios[name]={requests:samples.length,p50_ms:percentile(samples,.5),p95_ms:percentile(samples,.95),p99_ms:percentile(samples,.99),elapsed_ms:elapsed,throughput_per_second:samples.length*1000/elapsed,
   memory_transient:transient,memory_retained:retained,max_rss_bytes:process.resourceUsage().maxRSS*1024,
   event_loop:{p95_ms:histogram.percentile(95)/1e6,p99_ms:histogram.percentile(99)/1e6,max_ms:histogram.max/1e6,utilization:performance.eventLoopUtilization(elu).utilization},digests,fieldDigests,
   work:app.historyDiagnostics?.()??null};
 }
 try{
  await scenario('cold',async request=>{await request();});
  await scenario('warm',async request=>{for(let i=0;i<12;i++)await request();});
  await scenario('burst',async request=>{await Promise.all(Array.from({length:8},request));});
  await scenario('polling',async request=>{await request();await delay(3000);await request();});
  const addition=JSON.stringify({provider:'typesafe',ok:true,model:'jev-1.13.0',task_id:'t0',usage:{input_tokens:123,output_tokens:2}})+'\n';
  await scenario('append',async request=>{for(let i=0;i<3;i++){appendFileSync(join(dir,'events.ndjson'),addition);await request();}});
  await scenario('rotation',async request=>{renameSync(join(dir,'events.ndjson'),join(dir,'rotated.ndjson'));writeFileSync(join(dir,'events.ndjson'),addition);await request();});
  console.log(JSON.stringify({arm,count,policy,node:process.version,fixtureHash,scenarios}));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
}else{
 const output=resolve(process.argv[2]??'docs/state-benchmark.json'),policy=process.argv[3]??'bytes';
 const run=promisify(execFile),runs=[];
 for(const count of [1000,10000,100000])for(let pair=0;pair<5;pair++){
  const arms=pair%2?['after','before']:['before','after'],paired={};
  for(const arm of arms){
   const {stdout}=await run(process.execPath,['--expose-gc',script,'--worker',arm,String(count),policy],{windowsHide:true,maxBuffer:4*1024*1024});
   paired[arm]=JSON.parse(stdout.trim());
  }
  assert.equal(paired.before.fixtureHash,paired.after.fixtureHash);
  for(const scenario of Object.keys(paired.before.scenarios)){
   try{assert.deepEqual(paired.after.scenarios[scenario].fieldDigests,paired.before.scenarios[scenario].fieldDigests,`Historical fields ${count}/${pair}/${scenario}`);}
   catch(error){writeFileSync(output+'.failure.json',JSON.stringify({count,pair,scenario,paired},null,2));throw error;}
   assert.deepEqual(paired.after.scenarios[scenario].digests,paired.before.scenarios[scenario].digests,`Historical equality ${count}/${pair}/${scenario}`);
  }
  const work=paired.after.scenarios;
  for(const scenario of ['warm','burst','polling'])assert.equal(work[scenario].work.reader.parsedLines,work.cold.work.reader.parsedLines);
  runs.push({pair,count,...paired});
  process.stderr.write(`Equivalent pair ${pair+1}/5, ${count} events\n`);
 }
 const sourceHashes=Object.fromEntries(['tests/reference/server.mjs','tests/reference/pricing.mjs','src/server.mjs','src/pricing.mjs','src/event-history.mjs','src/history-analytics.mjs', 'scripts/benchmark-state.mjs'].map(path=>[path,hash(readFileSync(path))]));
 const summary=[1000,10000,100000].flatMap(count=>['cold','warm','burst','polling','append','rotation'].map(scenario=>{
  const matching=runs.filter(r=>r.count===count),arm=name=>{
   const s=matching.map(r=>r[name].scenarios[scenario]);
   return {p50_ms:percentile(s.map(v=>v.p50_ms),.5),p95_ms:percentile(s.map(v=>v.p95_ms),.5),p99_ms:percentile(s.map(v=>v.p99_ms),.5),retained_rss:percentile(s.map(v=>v.memory_retained.rss),.5),retained_heap:percentile(s.map(v=>v.memory_retained.heapUsed),.5),retained_external:percentile(s.map(v=>v.memory_retained.external),.5),loop_p99_ms:percentile(s.map(v=>v.event_loop.p99_ms),.5),loop_utilization:percentile(s.map(v=>v.event_loop.utilization),.5)};
  };
  return {count,scenario,before:arm('before'),after:arm('after')};
 }));
 writeFileSync(output,JSON.stringify({generated_at:new Date().toISOString(),node:process.version,policy,sourceHashes,equality:'all normalized HTTP responses matched',summary,runs},null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));
}
