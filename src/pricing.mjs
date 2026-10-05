// Public catalog estimates only: no invoice, quota conversion or inferred savings.
const SOURCE='https://openrouter.ai/api/v1/models';
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const tokens=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const rate=value=>value===null||value===undefined||value===''?null:amount(Number(value));
const sumKnown=values=>values.length&&values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;
const round=value=>value===null?null:Math.round(value*1e12)/1e12;

// Precedence when the general catalog and the pinned provider endpoint both price the same model id: the pinned endpoint wins
// (it names the exact version and provider, while the router row is dynamic). It never depends on record order. Rows of the same
// rank that disagree cannot be ordered, so the model is kept with unknown prices and the disagreement is recorded; equal rows collapse.
export const PRICE_RANK={pinned_endpoint:2,catalog:1};
const priceShape=model=>JSON.stringify([model.input_per_million,model.output_per_million,model.cache_input_per_million,model.pricing_overrides??null]);
function resolveDuplicates(models){
 const byId=new Map();
 for(const model of models)byId.set(model.id,[...(byId.get(model.id)??[]),model]);
 return [...byId.values()].map(group=>{
  if(group.length===1)return group[0];
  const top=Math.max(...group.map(model=>PRICE_RANK[model.price_source]??PRICE_RANK.catalog));
  const leaders=group.filter(model=>(PRICE_RANK[model.price_source]??PRICE_RANK.catalog)===top).sort((a,b)=>priceShape(a).localeCompare(priceShape(b))||String(a.price_provider).localeCompare(String(b.price_provider)));
  const superseded=group.filter(model=>!leaders.includes(model)).sort((a,b)=>priceShape(a).localeCompare(priceShape(b))).map(model=>({price_source:model.price_source,price_provider:model.price_provider,input_per_million:model.input_per_million,output_per_million:model.output_per_million,cache_input_per_million:model.cache_input_per_million}));
  if(new Set(leaders.map(priceShape)).size===1)return {...leaders[0],...(superseded.length?{superseded}:{})};
  return {...leaders[0],input_per_million:null,output_per_million:null,cache_input_per_million:null,pricing_overrides:undefined,price_conflict:leaders.map(model=>({price_provider:model.price_provider,input_per_million:model.input_per_million,output_per_million:model.output_per_million})),...(superseded.length?{superseded}:{})};
 }).map(model=>JSON.parse(JSON.stringify(model)));
}
export function normalizeCatalog(payload,fetchedAt){
 const rows=Array.isArray(payload?.data)?payload.data:[];
 const models=resolveDuplicates(rows.filter(row=>typeof row?.id==='string').map(row=>{
  const p=row.pricing??row.endpoints?.[0]?.pricing??{};
  return {id:row.id,input_per_million:rate(p.prompt)===null?null:rate(p.prompt)*1e6,
   output_per_million:rate(p.completion)===null?null:rate(p.completion)*1e6,
   cache_input_per_million:rate(p.input_cache_read)===null?null:rate(p.input_cache_read)*1e6,
   price_source:row.price_source==='pinned_endpoint'?'pinned_endpoint':'catalog',price_provider:typeof row.price_provider==='string'?row.price_provider:null,
   ...(row.pricing_overrides?{pricing_overrides:row.pricing_overrides}:{}),
   ...(p.overrides?{pricing_overrides:p.overrides}:{})};
 }));
 const age=Date.now()-Date.parse(fetchedAt);
 return {source:SOURCE,fetched_at:fetchedAt??null,status:!models.length?'unavailable':Number.isFinite(age)&&age>86400000?'stale':'available',models};
}

export function estimateUsage(usage,modelprice){
 if(!usage||!modelprice)return null;
 const input=tokens(usage.input_tokens),output=tokens(usage.output_tokens);
 const cached=usage.cached_input_tokens===undefined?0:tokens(usage.cached_input_tokens);
 if(input===null||output===null||cached===null||cached>input)return null;
 if(modelprice.pricing_overrides){
  const overrides=Array.isArray(modelprice.pricing_overrides)?modelprice.pricing_overrides:[modelprice.pricing_overrides];
  const thresholds=overrides.map(row=>amount(row.min_prompt_tokens??row.input_threshold??row.context_threshold??row.threshold));
  // Turn usage may cover several requests. Below every threshold it is safe;
  // crossing it does not prove that any individual request used a higher tier.
  if(!thresholds.length||thresholds.some(t=>t===null)||input>=Math.min(...thresholds))return null;
 }
 const components=[[input-cached,modelprice.input_per_million],[cached,modelprice.cache_input_per_million],[output,modelprice.output_per_million]];
 if(components.some(([n,p])=>n>0&&amount(p)===null))return null;
 return round(components.reduce((total,[n,p])=>total+(n===0?0:n*p/1e6),0));
}

function modelPrice(catalog,model){
 if(typeof model!=='string')return null;
 const id=model==='jev-1.13.0'?'typesafe/jev-1.13':model;
 return catalog.models.find(p=>p.id===id)??catalog.models.find(p=>p.id===`openai/${id}`)??null;
}
function summarize(rows,catalog){
 return {input_tokens:sumKnown(rows.map(r=>tokens(r.usage?.input_tokens))),output_tokens:sumKnown(rows.map(r=>tokens(r.usage?.output_tokens))),
  estimated_usd:round(sumKnown(rows.map(r=>estimateUsage(r.usage,modelPrice(catalog,r.model))))),
  unpriced_calls:rows.filter(r=>estimateUsage(r.usage,modelPrice(catalog,r.model))===null).length};
}

function taskMeasurements(task){
 const runs=[task.planning_run,task.implementation_run,{started_at:task.started_at,thread_id:task.thread_id,measurement:task.measurement}].filter(r=>r?.measurement);
 const seen=new Set();
 return runs.flatMap(run=>{
  // Snapshots may still describe the current run. Identity, not phase alone,
  // prevents billing the same measurement twice while preserving reruns.
  const key=run.started_at??null;
  if(key&&seen.has(key))return [];if(key)seen.add(key);
  return [run.measurement];
 });
}

export function usageAnalytics(events=[],tasks=[],catalog={source:SOURCE,fetched_at:null,status:'unavailable',models:[]},index=null){
 catalog={...catalog,models:Array.isArray(catalog?.models)?catalog.models:[]};
 const jevEvents=index?.jev??events.filter(e=>e.provider==='typesafe');
 const cachedCalls=jevEvents.filter(e=>e.cached===true).length;
 const jevRows=jevEvents.filter(e=>e.cached!==true);
 const jev=summarize(jevRows,catalog);jev.cached_calls=cachedCalls;
 if(!jevRows.length&&cachedCalls){jev.input_tokens=0;jev.output_tokens=0;jev.estimated_usd=0;}
 const executorRows=index?[...index.executor]:events.filter(e=>e.kind==='codex_usage');
 const taskRows=tasks.map(task=>{
  let rows=index?(index.byTask.get(task.id)?.executor??[]):executorRows.filter(e=>e.task_id===task.id);
  const measurements=taskMeasurements(task);
  if(!rows.length){
   rows=measurements.map(m=>({task_id:task.id,model:m.model,usage:m.usage}));
   executorRows.push(...rows);
  }
  const ownJev=index?(index.byTask.get(task.id)?.jev??[]):jevRows.filter(e=>e.task_id===task.id),ownCached=index?(index.byTask.get(task.id)?.cached??0):jevEvents.filter(e=>e.task_id===task.id&&e.cached===true).length;
  const cacheKey=index?JSON.stringify([task,catalog,index.byTask.get(task.id)?.version??0]):null;
  const cached=index?.taskCache.get(task.id);
  if(cached?.key===cacheKey)return cached.value;
  const totals=summarize([...rows,...ownJev],catalog),executorTotals=summarize(rows,catalog),jevTotals=summarize(ownJev,catalog);
  if(!ownJev.length&&ownCached){jevTotals.input_tokens=0;jevTotals.output_tokens=0;jevTotals.estimated_usd=0;}
  if(!rows.length&&!ownJev.length&&ownCached){totals.input_tokens=0;totals.output_tokens=0;totals.estimated_usd=0;}
  const models=[...new Set(rows.map(r=>r.model).filter(Boolean))];
  const finishes=index?(index.byTask.get(task.id)?.finishes??[]):events.filter(e=>e.kind==='task_finished'&&e.task_id===task.id);
  const milliseconds=sumKnown((finishes.length?finishes:measurements).map(m=>amount(finishes.length?m.duration_ms:m.execution_ms)));
  const value={task_id:task.id,title:task.title,model:models.length===1?models[0]:models.length?'multiple':task.measurement?.model??null,
   ...totals,executor_input_tokens:executorTotals.input_tokens,executor_output_tokens:executorTotals.output_tokens,executor_estimated_usd:executorTotals.estimated_usd,
   jev_input_tokens:jevTotals.input_tokens,jev_output_tokens:jevTotals.output_tokens,jev_estimated_usd:jevTotals.estimated_usd,jev_cached_calls:ownCached,
   seconds:milliseconds===null?null:milliseconds/1000,seconds_scope:finishes.length?'finished_runs_only':'available_measurements',active:['planning','running','reviewing'].includes(task.status)};
  if(index){index.taskCache.set(task.id,{key:cacheKey,value});index.recalculated++;}
  return value;
 });
 const executor=summarize(executorRows,catalog);
 const candidates=[...new Set(executorRows.map(e=>e.model).filter(Boolean))];
 const simulations=candidates.map(model=>{
  const cost=round(sumKnown(jevRows.map(r=>estimateUsage(r.usage,modelPrice(catalog,model)))));
  return {model,estimated_usd:cost,jev_estimated_usd:jev.estimated_usd,difference_usd:cost===null||jev.estimated_usd===null?null:round(cost-jev.estimated_usd)};
 });
 return {pricing:catalog,jev,executor,simulations,tasks:taskRows,
  note:'Estimativas de tokens por tarifas públicas OpenRouter, não cobranças TypeSafe/OpenAI nem consumo da franquia Codex. Totais por tarefa incluem executor e chamadas JEV associadas ao task_id; cache JEV não consome tokens novos. Não incluem cache write, ferramentas ou serviços adicionais. Tempo soma execuções finalizadas observadas (incluindo retomadas); tarefa ativa pode ter tempo parcial. Simulações aplicam os mesmos tokens JEV aos modelos observados; não comprovam equivalência, qualidade ou economia. Cobertura limitada aos eventos e medições disponíveis. Usage por turno não permite selecionar preços acima de limiares de contexto por requisição.'};
}
