import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function historyFixture(count,taskCount=100){
 const tasks=Array.from({length:taskCount},(_,i)=>({id:`t${i}`,title:`Task ${i}`,status:'done',workspace:'.',goal:'Equivalent fixture',acceptance:'Identical historical totals',started_at:`run${i}`,measurement:{model:'worker',usage:{input_tokens:5,output_tokens:1},execution_ms:100,duration_ms:100,effort:'medium',phase:'implementation'}}));
 const events=Array.from({length:count},(_,i)=>{
  const task_id=`t${Math.floor(i/4)%taskCount}`,usage={input_tokens:100+i%101,output_tokens:i%7,cached_input_tokens:i%5};
  const common={task_id,time:'2026-10-01T00:00:00Z'};
  if(i%4===0)return {...common,provider:'typesafe',kind:'jev_decision',ok:i%19!==0,cached:i%17===0,model:'jev-1.13.0',latency_ms:i%10,usage};
  if(i%4===1)return {...common,kind:'codex_usage',model:'worker',usage};
  if(i%4===2)return {...common,kind:'task_finished',duration_ms:i%1000};
  return {...common,kind:'tool_observed',tool:'fixture'};
 });
 return {tasks,events,payload:{data:[{id:'openai/worker',pricing:{prompt:'0.000002',completion:'0.000008',input_cache_read:'0.000001'}},{id:'typesafe/jev-1.13',pricing:{prompt:'0.000000042',completion:'0',input_cache_read:'0.000000021'}}]}};
}
export function writeHistoryFixture(dir,fixture){
 writeFileSync(join(dir,'state.json'),JSON.stringify({tasks:fixture.tasks}));
 writeFileSync(join(dir,'pricing.json'),JSON.stringify({payload:fixture.payload,fetched_at:'2026-10-04T00:00:00Z'}));
 writeFileSync(join(dir,'events.ndjson'),fixture.events.map(e=>JSON.stringify(e)).join('\n')+'\n');
}
export function normalizedState(state){
 // Local compaction status is outside the synthetic benchmark's control.
 const value=structuredClone(state);
 // Orthogonal supervisor additions are covered by their own tests.
 delete value.autonomy_policies;delete value.harness_research;delete value.harness_campaigns;delete value.curator.generated_at;delete value.compaction;delete value.last_compaction_time;delete value.flow;
 delete value.providers;delete value.fallback_chain;delete value.auto_fallback;delete value.quotas;
 delete value.antigravity_auth;delete value.devin_auth;delete value.interventions;delete value.integrations;
 // Currency conversion depends on a public quote, not on history processing.
 delete value.analytics.currency;delete value.analytics.totals;delete value.metrics.saved_brl;
 const stripBrl=row=>{if(row)for(const key of ['estimated_brl','jev_estimated_brl','difference_brl'])delete row[key];};
 stripBrl(value.analytics.jev);stripBrl(value.analytics.executor);
 for(const row of [...(value.analytics.simulations??[]),...(value.analytics.tasks??[]),...(value.mission_evals??[]).map(entry=>entry.resources)])stripBrl(row);
 value.events=value.events.filter(e=>e.kind!=='compaction_observed');
 // Executor contract/verification snapshots are orthogonal supervisor annotations.
 for(const row of value.tasks??[]){delete row.executor_contract;delete row.executor_verification;delete row.measurement?.effective_model;}
 const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 return canonical(value);
}
