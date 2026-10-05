import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
export function validateComparisons(input){
  if(!input||!Array.isArray(input.pairs)||input.pairs.length<1||input.pairs.length>100)throw new Error('Informe de 1 a 100 pares.');
  const seen=new Set();
  return input.pairs.map(row=>{
    if(typeof row.id!=='string'||row.id.length>120||seen.has(row.id)||typeof row.benchmark_id!=='string'||row.benchmark_id.length>160||!row.benchmark_id||typeof row.controlled!=='boolean')throw new Error('Par inválido.');
    seen.add(row.id);
    const arm=entry=>{
      if(!entry||typeof entry.config!=='string'||entry.config.length>120||typeof entry.accepted!=='boolean'||!Number.isFinite(entry.seconds)||entry.seconds<=0||entry.seconds>86400||
        (entry.cost_usd!==null&&(!Number.isFinite(entry.cost_usd)||entry.cost_usd<0))||typeof entry.evidence!=='string'||!entry.evidence||entry.evidence.length>500)throw new Error('Medição inválida.');
      if(entry.tokens!=null&&(!Number.isSafeInteger(entry.tokens)||entry.tokens<0))throw new Error('Tokens inválidos.');
      if(entry.interventions!=null&&(!Number.isSafeInteger(entry.interventions)||entry.interventions<0))throw new Error('Intervenções inválidas.');
      return {config:entry.config,accepted:entry.accepted,seconds:entry.seconds,cost_usd:entry.cost_usd,evidence:entry.evidence,tokens:entry.tokens??null,interventions:entry.interventions??null};
    };
    // The logical project a pair was measured in. Records written before this field existed stay without it (unknown scope).
    if(row.project!==undefined&&(typeof row.project!=='string'||!row.project.trim()||row.project.length>1000||row.project.includes('\0')))throw new Error('Projeto de origem inválido.');
    return {id:row.id,benchmark_id:row.benchmark_id,controlled:row.controlled,...(row.project!==undefined?{project:row.project}:{}),baseline:arm(row.baseline),candidate:arm(row.candidate)};
  });
}
export const projectKey=path=>typeof path==='string'&&path.trim()?resolve(path).replace(/[\\/]+$/,'').toLowerCase():null;
/** `project` narrows the summary to pairs measured there; pairs without an origin never count toward a project, they only
 * appear in `unscoped_pairs`. Without `project` the summary is the explicitly global aggregate. */
export function summarizeComparisons(allPairs,{project}={}){
  const wanted=project===undefined?null:projectKey(project);
  const pairs=project===undefined?allPairs:allPairs.filter(p=>wanted!==null&&projectKey(p.project)===wanted);
  const unscoped=allPairs.filter(p=>projectKey(p.project)===null).length;
  const comparable=pairs.filter(p=>p.baseline.accepted&&p.candidate.accepted);
  const controlled=pairs.filter(p=>p.controlled);
  const priced=comparable.filter(p=>p.baseline.cost_usd!==null&&p.candidate.cost_usd!==null);
  const regressions=pairs.filter(p=>p.baseline.accepted&&!p.candidate.accepted).length;
  const saved_seconds=comparable.length?comparable.reduce((n,p)=>n+p.baseline.seconds-p.candidate.seconds,0):null;
  const saved_usd=priced.length===comparable.length&&priced.length?priced.reduce((n,p)=>n+p.baseline.cost_usd-p.candidate.cost_usd,0):null;
  const measured=controlled.filter(p=>p.baseline.accepted&&p.candidate.accepted);
  const proven_saved_seconds=measured.length?measured.reduce((n,p)=>n+p.baseline.seconds-p.candidate.seconds,0):null;
  const proven_saved_usd=measured.length&&measured.every(p=>p.baseline.cost_usd!==null&&p.candidate.cost_usd!==null)?measured.reduce((n,p)=>n+p.baseline.cost_usd-p.candidate.cost_usd,0):null;
  const proven_saved_tokens=measured.length&&measured.every(p=>Number.isSafeInteger(p.baseline.tokens)&&Number.isSafeInteger(p.candidate.tokens))?measured.reduce((n,p)=>n+p.baseline.tokens-p.candidate.tokens,0):null;
  // Human effort is compared the same way: only when every accepted controlled pair measured it; absent stays unknown.
  // A needed approval is an intervention, never a failure — acceptance (`accepted`) is unchanged by it.
  const proven_saved_interventions=measured.length&&measured.every(p=>Number.isSafeInteger(p.baseline.interventions)&&Number.isSafeInteger(p.candidate.interventions))?measured.reduce((n,p)=>n+p.baseline.interventions-p.candidate.interventions,0):null;
  const reasons=[];
  if(controlled.length<10)reasons.push('menos de 10 pares controlados');
  if(regressions)reasons.push('regressão de aceitação');
  if(pairs.some(p=>!p.candidate.accepted))reasons.push('entregas reprovadas');
  // Eligibility rests on controlled measurements only: a favourable uncontrolled pair can never offset controlled losses,
  // and a controlled cost that is unknown stays unknown instead of being filled from other pairs.
  if(proven_saved_seconds===null||proven_saved_seconds<=0)reasons.push('sem ganho de tempo controlado');
  if(proven_saved_usd===null||proven_saved_usd<=0)reasons.push('sem ganho de custo controlado');
  return {scope:project===undefined?'global':'project',...(project===undefined?{}:{project:wanted}),unscoped_pairs:unscoped,total:pairs.length,controlled_pairs:controlled.length,accepted_pairs:comparable.length,regressions,saved_seconds,saved_usd,proven_saved_seconds,proven_saved_usd,proven_saved_tokens,proven_saved_interventions,
    assessment:{status:reasons.length?'improve':'eligible',reasons},dataset_hash:createHash('sha256').update(JSON.stringify(pairs)).digest('hex'),
    note:'Medições importadas com referências de evidência; não são verificação automática dos artefatos. Elegibilidade exige revisão, sem promoção global automática.'};
}
