import {usageAnalytics} from './pricing.mjs';

// One projection per server. Never retain previous generations or task versions.
export function createHistoryAnalytics(){
 let revision=null,count=0,index,result=null,resultKey=null,relevantVersion=0;
 const stats={indexedEvents:0,taskProjections:0,globalProjections:0};
 let metrics;
 function reset(){
  index={jev:[],executor:[],byTask:new Map(),taskCache:new Map(),recalculated:0};
  metrics={jev_calls:0,jev_input_tokens:0,jev_cached:0,jev_latency_ms:0};
  relevantVersion++;count=0;
 }
 reset();
 return {
  read(generation,tasks,catalog){
   if(revision!==generation.revision){
    if(generation.appendFrom!==count)reset();
    for(let i=count;i<generation.events.length;i++){
     const e=generation.events[i];stats.indexedEvents++;
     const isJev=e.provider==='typesafe',isExecutor=e.kind==='codex_usage',isFinish=e.kind==='task_finished';
     if(!isJev&&!isExecutor&&!isFinish)continue;
     relevantVersion++;
     let own=index.byTask.get(e.task_id);
     if(!own){own={executor:[],jev:[],finishes:[],cached:0,version:0};index.byTask.set(e.task_id,own);}own.version++;
     if(isJev){
      index.jev.push(e);metrics.jev_calls++;
      if(e.cached===true)own.cached++;else own.jev.push(e);
      if(e.ok){metrics.jev_latency_ms+=e.latency_ms??0;if(e.cached)metrics.jev_cached++;else metrics.jev_input_tokens+=e.usage?.input_tokens??0;}
     }
     if(isExecutor){index.executor.push(e);own.executor.push(e);}
     if(isFinish)own.finishes.push(e);
    }
    count=generation.events.length;revision=generation.revision;
   }
   const key=JSON.stringify([relevantVersion,tasks,catalog]);
   if(key!==resultKey){
    const ids=new Set(tasks.map(t=>t.id));for(const id of index.taskCache.keys())if(!ids.has(id))index.taskCache.delete(id);
    const before=index.recalculated;
    result=usageAnalytics([],tasks,catalog??undefined,index);
    stats.taskProjections+=index.recalculated-before;stats.globalProjections++;
    resultKey=key;
   }
   return {analytics:result,metrics:{...metrics}};
  },
  diagnostics(){return {...stats};}
 };
}
