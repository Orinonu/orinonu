import {readRecommendations} from './recommendations.mjs';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// An audit produces evidence for separate implementation missions; its own
// execution remains read-only even if a restored queue or plan requests writes.
export function assertOpportunityPhase(task,phase){
 if(!task?.opportunity_audit||phase==='planning')return;
 const error=new Error('Auditoria de oportunidades é somente leitura; gere uma missão de implementação separada.');
 error.status=409;error.code='audit_read_only';throw error;
}
export const opportunityFingerprint=(proposal,direction,source)=>digest({goal:proposal.goal,acceptance:proposal.acceptance,evidence:proposal.evidence,source_task_id:proposal.source_task_id,source_attempt:source?.attempt?.id,source_result:source?.discovery_result,direction});
export function implementationOpportunity(proposal,source){
 let proven=false;try{proven=readRecommendations(source?.plan_report,source?.workspace,source?.id).some(row=>row.key===proposal.key&&row.goal===proposal.goal&&row.acceptance===proposal.acceptance&&JSON.stringify(row.evidence)===JSON.stringify(proposal.evidence));}catch{}
 return proven&&proposal.source==='codex_read_only_analysis'&&source?.opportunity_audit===true&&source.attempt?.state==='terminal'
  &&source.recommendation_processed===true&&source.discovery_result?.status==='completed'
  &&source.workspace===proposal.workspace&&Array.isArray(proposal.evidence)&&proposal.evidence.length>0
  &&proposal.evidence.every(v=>typeof v==='string'&&v.trim())&&!!proposal.goal?.trim()&&!!proposal.acceptance?.trim()
  &&proposal.goal!==source.goal&&!/^Investigar somente leitura/i.test(proposal.goal);
}
// Research allowance renews only after verified integration, not after wording,
// toggling autonomy, empty research or newly generated proposals.
export function researchEpoch(policy,tasks,completed){
 const signature=digest(tasks.filter(completed).map(t=>[t.id,t.integration.snapshot_digest]).sort((a,b)=>a[0].localeCompare(b[0])));
 if(!policy.research_epoch||policy.research_epoch.signature!==signature)policy.research_epoch={signature,investigations:0,reserved_minutes:0};
 return policy.research_epoch;
}
