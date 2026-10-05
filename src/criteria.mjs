import {createHash} from 'node:crypto';

// The acceptance text of a mission becomes a confirmed, numbered set of criteria with a hash. A review can only approve by
// covering exactly that set: a missing, duplicated, unknown or foreign criterion is refused, and a criteria set that no longer
// matches the mission's acceptance text invalidates the approval. Checks stay evidence reported by the reviewer; the host
// verifies coverage and identity, not the truth of each check.
export const MAX_CRITERIA=40,MAX_CRITERION_LENGTH=500;
const BULLET=/^(?:[-*•]|\d{1,2}[.)])\s+/;
const SPLIT=/\r?\n|;|(?<=[.!?])\s+(?=[\p{Lu}\d])/u;

export function criteriaSet(acceptance){
 const all=String(acceptance??'').split(SPLIT).map(part=>part.replace(BULLET,'').trim()).filter(Boolean);
 if(all.length>MAX_CRITERIA||all.some(part=>part.length>MAX_CRITERION_LENGTH))throw new Error('Critérios excedem os limites do contrato; revisão completa indisponível.');
 const items=(all.length?all:['(sem critérios declarados)']).map((text,index)=>({id:'c'+(index+1),text}));
 return {version:1,items,hash:createHash('sha256').update(JSON.stringify(items)).digest('hex')};
}

/** Throws unless the contract covers the confirmed set. Non-approving decisions only need valid ids where they use any. */
export function assertCriteriaCoverage(contract,criteria){
 const fail=reason=>Object.assign(new Error('Cobertura de critérios inválida: '+reason),{code:'criteria_coverage'});
 if(!criteria||!Array.isArray(criteria.items)||typeof criteria.hash!=='string')throw fail('conjunto confirmado ausente.');
 const known=new Set(criteria.items.map(item=>item.id)),seen=new Set();
 const approved=contract.decision==='approved';
 if(approved&&contract.criteria_hash!==criteria.hash)throw fail('o contrato não referencia o conjunto confirmado (hash divergente ou ausente).');
 if(!approved&&contract.criteria_hash!==undefined&&contract.criteria_hash!==criteria.hash)throw fail('hash de critérios de outra versão.');
 for(const check of contract.checks){
  if(check.criterion_id===undefined){if(approved)throw fail('toda verificação aprovada precisa de criterion_id.');continue;}
  if(typeof check.criterion_id!=='string'||!known.has(check.criterion_id))throw fail(`critério desconhecido ou de outra versão (${String(check.criterion_id).slice(0,40)}).`);
  if(seen.has(check.criterion_id))throw fail(`critério duplicado (${check.criterion_id}).`);
  seen.add(check.criterion_id);
 }
 if(approved){
  const missing=criteria.items.filter(item=>!seen.has(item.id)).map(item=>item.id);
  if(missing.length)throw fail('critérios não cobertos: '+missing.join(', ')+'.');
 }
 return true;
}

export const criteriaPrompt=criteria=>criteria?.items?.length
 ?`\nConjunto confirmado de critérios (hash ${criteria.hash}): ${JSON.stringify(criteria.items)}. O contrato deve incluir criteria_hash:"${criteria.hash}" e, para approved, exatamente uma verificação por critério com criterion_id igual ao id acima, sem repetir, omitir nem inventar critérios; um relatório approved que cubra outros critérios é recusado pelo host.`
 :'';

/** The approval still refers to the criteria the mission has today. */
export const criteriaCurrent=(snapshot,acceptance)=>{try{return !snapshot?.criteria||snapshot.criteria.hash===criteriaSet(acceptance).hash;}catch{return false;}};
