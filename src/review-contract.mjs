import {assertCriteriaCoverage,criteriaPrompt} from './criteria.mjs';
export function reviewContractPrompt(snapshot){
 const evidence=snapshot.evidence?.manifest_path?`\nEvidência imutável antes/depois desta tentativa (criações, alterações e exclusões; texto por hash, binários só por hash): manifesto ${snapshot.evidence.manifest_path} (sha256 ${snapshot.evidence.manifest_sha256}), blobs em ${snapshot.evidence.directory}/blobs. Use-a para comparar versões exatas; ela só vale se o sha256 do manifesto conferir.`:'';
 return `${evidence}${criteriaPrompt(snapshot.criteria)}\nSnapshot preparado pelo host para revisão: ${snapshot.snapshot_digest}. Termine com um único bloco Markdown nexo-review contendo JSON {version:1,snapshot_digest:"${snapshot.snapshot_digest}",decision:"approved"|"rejected"|"abstained",checks:[{criterion:string,status:"passed"|"failed"|"unknown",evidence:string[]}],reason:string}. Inspecione e verifique todos os critérios de aceitação e compatibilidade do plano, incluindo direção permanente e preferências UI. approved exige checks não vazios, todos passed com evidências verificáveis; falha ou lacuna exige rejected ou abstained. Não invente testes, não modifique o snapshot nem declare aprovação humana. Checks são evidência reportada pelo revisor, não testes certificados pelo host.`;
}
export function readReviewContract(report,expectedDigest,criteria){
 const blocks=[...String(report??'').matchAll(/```nexo-review\s*\n([\s\S]*?)```/g)];
 if(blocks.length!==1)throw new Error('Revisão sem contrato único verificável.');
 let value;try{value=JSON.parse(blocks[0][1]);}catch{throw new Error('Contrato de revisão inválido.');}
 if(value?.version!==1||value.snapshot_digest!==expectedDigest||!['approved','rejected','abstained'].includes(value.decision)||typeof value.reason!=='string'||value.reason.length>2000||!Array.isArray(value.checks)||value.checks.length>100)throw new Error('Contrato de revisão ou identidade de snapshot inválido.');
 for(const check of value.checks)if(!check||typeof check.criterion!=='string'||!check.criterion.trim()||check.criterion.length>2000||!['passed','failed','unknown'].includes(check.status)||!Array.isArray(check.evidence)||check.evidence.length>20||check.evidence.some(e=>typeof e!=='string'||!e.trim()||e.length>2000))throw new Error('Critérios de revisão inválidos.');
 if(value.decision==='approved'&&(!value.checks.length||value.checks.some(c=>c.status!=='passed'||!c.evidence.length)))throw new Error('Aprovação exige critérios satisfeitos com evidências.');
 // Coverage of the confirmed criteria set is enforced whenever the snapshot carries one (every snapshot the host now builds does).
 if(criteria!==undefined)assertCriteriaCoverage(value,criteria);
 return value;
}
