import { randomUUID } from 'node:crypto';
import { projectKey, summarizeComparisons } from './comparisons.mjs';
import { FORBIDDEN_MUTATION_KEYS } from './evolution.mjs';

// Bounded evaluation campaigns: a declared hypothesis over a fixed benchmark of missions, comparing
// a baseline profile/model configuration against a candidate using already measured, reviewed mission
// pairs. Campaigns recommend; they never apply changes — profile updates keep the existing reviewed
// PATCH path and any promotion still requires the evolution gate (>=10 controlled paired samples).

const MAX_PAIRS=20;
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
const forbidden=value=>{const blob=String(value).toLowerCase();return FORBIDDEN_MUTATION_KEYS.find(word=>blob.includes(word));};

export function defineCampaign(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Campanha inválida.');
  const {title,hypothesis,benchmark_id,baseline_config,candidate_config,workspace}=input;
  if(!text(title,160)||!text(hypothesis,2000)||!text(benchmark_id,160))throw new Error('Título, hipótese e benchmark são obrigatórios.');
  if(!text(workspace,1000)||typeof workspace!=='string'||workspace.includes('\0'))throw new Error('Workspace do projeto inválido.');
  if(!text(baseline_config,120)||!text(candidate_config,120))throw new Error('Configurações de referência e candidata são obrigatórias.');
  if(baseline_config===candidate_config)throw new Error('Os braços da campanha devem ser configurações distintas.');
  for(const value of [baseline_config,candidate_config,hypothesis]){
    const hit=forbidden(value);
    if(hit)throw new Error(`Conteúdo não permitido na campanha: '${hit}'.`);
  }
  const min_pairs=input.min_pairs??10,max_pairs=input.max_pairs??min_pairs;
  if(!Number.isInteger(min_pairs)||min_pairs<1||min_pairs>MAX_PAIRS||!Number.isInteger(max_pairs)||max_pairs<min_pairs||max_pairs>MAX_PAIRS)throw new Error(`Limites de pares inválidos (1..${MAX_PAIRS}, máximo ≥ mínimo).`);
  const budget_usd=input.budget_usd??null;
  if(budget_usd!==null&&(!Number.isFinite(budget_usd)||budget_usd<0))throw new Error('Orçamento da campanha inválido.');
  return {
    id:randomUUID(),created_at:new Date().toISOString(),status:'collecting',applied:false,
    title,hypothesis,benchmark_id,baseline_config,candidate_config,workspace,min_pairs,max_pairs,budget_usd,
    review_policy:'Os braços correm pelo mesmo fluxo de missão: mesma revisão independente, mesmos limites de fase e orçamento. Candidatos nunca editam critérios de aceitação.',
    rollback:`Nada é aplicado. Se a recomendação for adotada manualmente, a reversão é restaurar '${baseline_config}' pelo caminho revisado de perfis; os pares medidos e este relatório permanecem como evidência.`,
  };
}

export function campaignPairs(campaign,allPairs){
  const wanted=projectKey(campaign.workspace);
  return (allPairs??[]).filter(pair=>pair.benchmark_id===campaign.benchmark_id
    &&projectKey(pair.project)===wanted
    &&pair.baseline?.config===campaign.baseline_config
    &&pair.candidate?.config===campaign.candidate_config);
}

export function summarizeCampaign(campaign,pairs){
  const summary=summarizeComparisons(pairs,{project:campaign.workspace});
  const measured=summary.controlled_pairs;
  const unknowns=[];
  const accepted=pairs.filter(p=>p.controlled&&p.baseline.accepted&&p.candidate.accepted);
  if(summary.proven_saved_usd===null)unknowns.push('cost_usd');
  if(summary.proven_saved_seconds===null)unknowns.push('seconds');
  if(summary.proven_saved_tokens===null)unknowns.push('tokens');
  if(summary.proven_saved_interventions===null)unknowns.push('interventions');
  const reasons=[];
  if(measured<campaign.min_pairs)reasons.push(`${measured}/${campaign.min_pairs} pares controlados medidos`);
  if(summary.regressions)reasons.push('regressão de aceitação no candidato');
  if(pairs.some(p=>!p.candidate.accepted))reasons.push('entregas do candidato reprovadas');
  if(summary.proven_saved_seconds===null||summary.proven_saved_seconds<=0)reasons.push('sem ganho de tempo controlado');
  if(summary.proven_saved_usd===null||summary.proven_saved_usd<=0)reasons.push('sem ganho de custo controlado');
  // Reject only on measured harm or rejection; an unknown (null) is insufficient evidence, never proof of harm.
  const measuredHarm=(summary.proven_saved_seconds!==null&&summary.proven_saved_seconds<=0)||(summary.proven_saved_usd!==null&&summary.proven_saved_usd<=0);
  const verdict=pairs.some(p=>!p.candidate.accepted)||summary.regressions||measuredHarm?'reject':(reasons.length?'insufficient_evidence':'recommend');
  const costs=accepted.flatMap(p=>[p.baseline.cost_usd,p.candidate.cost_usd]);
  return {
    campaign_id:campaign.id,reported_at:new Date().toISOString(),verdict,reasons,unknowns,
    measured_pairs:measured,total_pairs:pairs.length,accepted_pairs:accepted.length,
    proven_saved_seconds:summary.proven_saved_seconds,proven_saved_usd:summary.proven_saved_usd,
    proven_saved_tokens:summary.proven_saved_tokens,proven_saved_interventions:summary.proven_saved_interventions,
    budget:{declared_usd:campaign.budget_usd,measured:costs.length>0&&costs.every(Number.isFinite),measured_usd:costs.length&&costs.every(Number.isFinite)?costs.reduce((a,b)=>a+b,0):null},
    applied:false,
    recommendation:verdict==='recommend'?`Evidências controladas favorecem '${campaign.candidate_config}' sobre '${campaign.baseline_config}'. Aplicação segue o fluxo revisado de perfis; nada foi alterado.`:null,
    rollback:campaign.rollback,
    dataset_hash:summary.dataset_hash,
    note:'Campanha delimitada: pares medidos reais do mesmo benchmark, projeto, revisão e orçamento. Qualidade e economia não medidas ficam explícitas em unknowns; recomendação nunca aplica a mudança.',
  };
}
