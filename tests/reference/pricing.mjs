// Public catalog estimates only: no invoice, quota conversion or inferred savings.
const SOURCE='https://openrouter.ai/api/v1/models';
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const tokens=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const rate=value=>value===null||value===undefined||value===''?null:amount(Number(value));
const sumKnown=values=>values.length&&values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;
const round=value=>value===null?null:Math.round(value*1e12)/1e12;

export function normalizeCatalog(payload,fetchedAt){
 const rows=Array.isArray(payload?.data)?payload.data:[];
 const models=rows.filter(row=>typeof row?.id==='string').map(row=>{
  const p=row.pricing??row.endpoints?.[0]?.pricing??{};
  return {id:row.id,input_per_million:rate(p.prompt)===null?null:rate(p.prompt)*1e6,
   output_per_million:rate(p.completion)===null?null:rate(p.completion)*1e6,
   cache_input_per_million:rate(p.input_cache_read)===null?null:rate(p.input_cache_read)*1e6,
   ...(row.pricing_overrides?{pricing_overrides:row.pricing_overrides}:{}),
   ...(p.overrides?{pricing_overrides:p.overrides}:{})};
 });
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

export function usageAnalytics(events=[],tasks=[],catalog={source:SOURCE,fetched_at:null,status:'unavailable',models:[]}){
 catalog={...catalog,models:Array.isArray(catalog?.models)?catalog.models:[]};
 const jevEvents=events.filter(e=>e.provider==='typesafe');
 const cachedCalls=jevEvents.filter(e=>e.cached===true).length;
 const jevRows=jevEvents.filter(e=>e.cached!==true);
 const jev=summarize(jevRows,catalog);jev.cached_calls=cachedCalls;
 if(!jevRows.length&&cachedCalls){jev.input_tokens=0;jev.output_tokens=0;jev.estimated_usd=0;}
 const executorRows=events.filter(e=>e.kind==='codex_usage');
 const taskRows=tasks.map(task=>{
  let rows=executorRows.filter(e=>e.task_id===task.id);
  const measurements=taskMeasurements(task);
  if(!rows.length){
   rows=measurements.map(m=>({task_id:task.id,model:m.model,usage:m.usage}));
   executorRows.push(...rows);
  }
  const ownJev=jevRows.filter(e=>e.task_id===task.id),ownCached=jevEvents.filter(e=>e.task_id===task.id&&e.cached===true).length;
  const totals=summarize([...rows,...ownJev],catalog),executorTotals=summarize(rows,catalog),jevTotals=summarize(ownJev,catalog);
  if(!ownJev.length&&ownCached){jevTotals.input_tokens=0;jevTotals.output_tokens=0;jevTotals.estimated_usd=0;}
  if(!rows.length&&!ownJev.length&&ownCached){totals.input_tokens=0;totals.output_tokens=0;totals.estimated_usd=0;}
  const models=[...new Set(rows.map(r=>r.model).filter(Boolean))];
  const finishes=events.filter(e=>e.kind==='task_finished'&&e.task_id===task.id);
  const milliseconds=sumKnown((finishes.length?finishes:measurements).map(m=>amount(finishes.length?m.duration_ms:m.execution_ms)));
  return {task_id:task.id,title:task.title,model:models.length===1?models[0]:models.length?'multiple':task.measurement?.model??null,
   ...totals,executor_input_tokens:executorTotals.input_tokens,executor_output_tokens:executorTotals.output_tokens,executor_estimated_usd:executorTotals.estimated_usd,
   jev_input_tokens:jevTotals.input_tokens,jev_output_tokens:jevTotals.output_tokens,jev_estimated_usd:jevTotals.estimated_usd,jev_cached_calls:ownCached,
   seconds:milliseconds===null?null:milliseconds/1000,seconds_scope:finishes.length?'finished_runs_only':'available_measurements',active:['planning','running'].includes(task.status)};
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
