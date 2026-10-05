const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const missing=reason=>({score:null,status:'unmeasured',reason});
function checksScore(checks){
  if(!Array.isArray(checks)||!checks.length)return missing('Faltam critérios e evidências verificáveis.');
  const ids=new Set();
  for(const item of checks){
    if(typeof item?.id!=='string'||!item.id.trim()||ids.has(item.id)||typeof item.passed!=='boolean'||typeof item.evidence!=='string'||!item.evidence.trim())return missing('Os critérios precisam de identificador único, resultado e referência de evidência.');
    ids.add(item.id);
  }
  return {score:Math.round(100*checks.filter(item=>item.passed).length/checks.length),status:'measured',sample_size:checks.length,reason:null};
}
function targetScore(actual,target){
  if(!finite(actual)||!finite(target)||target===0)return missing('Falta valor observado ou meta definida para esta classe de tarefa.');
  return {score:actual===0?100:Math.round(Math.min(100,100*target/actual)),status:'measured',actual,target,reason:null};
}
export function evaluateHarness(observation={},targets={}){
  const dimensions={
    quality:checksScore(observation.acceptance),
    time:targetScore(observation.duration_ms,targets.duration_ms),
    cost:targetScore(observation.cost_usd,targets.cost_usd),
    tokens:targetScore(observation.total_tokens,targets.total_tokens),
    context:checksScore(observation.context_checks),
    routing:checksScore(observation.routing_checks)
  };
  const scores=Object.values(dimensions).map(item=>item.score);
  return {...dimensions,scale:'0–100; recursos medem cumprimento da meta, não economia comprovada',overall:scores.every(score=>score!==null)?Math.min(...scores):null,needs_research:scores.some(score=>score===null||score<100)};
}
// Only supervisor observations and explicit evidence receipts can become scores.
// Token totals are per attempt, never a cumulative thread total or price estimate.
export function collectHarnessEvidence(task){
  const measurement=task.measurement??{},usage=measurement.usage??{},receipts=task.evaluation_evidence??{};
  const input=usage.input_tokens,output=usage.output_tokens;
  return {
    duration_ms:measurement.duration_ms,
    total_tokens:finite(input)&&finite(output)?input+output:null,
    cost_usd:measurement.actual_cost?.source==='provider_receipt'&&typeof measurement.actual_cost.receipt_id==='string'&&measurement.actual_cost.receipt_id.trim()?measurement.actual_cost.usd:null,
    acceptance:receipts.acceptance,context_checks:receipts.context_checks,routing_checks:receipts.routing_checks
  };
}
export function researchRequest(task,evaluation){
  if(task.queue||task.attempt?.state!=='terminal'||!task.attempt.id||!evaluation.needs_research)return null;
  const gaps=Object.entries(evaluation).filter(([,value])=>value&&typeof value==='object'&&(value.score===null||value.score<100)).map(([dimension,value])=>({dimension,score:value.score,reason:value.reason}));
  return {
    category:'technical',delegated:true,
    goal:`Priorizar investigação de melhoria do harness nesta missão já autorizada. Objetivo: ${String(task.goal??'').slice(0,1000)}. Critérios: ${String(task.acceptance??'').slice(0,1000)}. Lacunas observadas: ${JSON.stringify(gaps)}. Uma nota de recursos mede adesão à meta; não comprova economia. Recomendar investigação com evidências dentro do projeto. Não substituir critérios, autorizar publicação, ampliar escopo ou declarar especialistas criados. Dados sem medição exigem coleta de evidência antes de diagnosticar.`,
    options:[
      {id:'measurement',text:'Investigar e completar medições e evidências ausentes.'},
      {id:'routing',text:'Investigar adequação de skills, ferramentas e especialistas usados.'},
      {id:'context',text:'Investigar recuperação de memória, contexto e compactação.'},
      {id:'performance',text:'Investigar falhas, tempo, tokens e custo contra metas comparáveis.'},
      {id:'hold',text:'Preservar resultados e registrar pendências sem nova execução.'}
    ],
    supervisor:{key:`harness-research:${task.id}:${task.attempt.id}`,task_id:task.id,attempt_id:task.attempt.id,gaps}
  };
}
