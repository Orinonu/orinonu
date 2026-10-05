import {buildCompetitorResearch} from './competitor-research.mjs';

/** Normalize project-scoped settings only. Caller validates/canonicalizes an
 * existing workspace and persists the row. Text is untrusted requirements data,
 * never execution authorization; saving does not start research or a mission.
 */
export function normalizeProjectDirection(body={},defaultWorkspace){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Direção do projeto inválida.');
 const bounded=(key,max)=>{const value=body[key]??'';if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new Error(`${key} deve ser texto com até ${max} caracteres.`);return value.trim();};
 if(body.workspace!==undefined&&typeof body.workspace!=='string')throw new Error('Workspace deve ser texto.');
 const workspace=body.workspace?.trim()||defaultWorkspace?.trim();
 if(!workspace||/[\u0000-\u001f\u007f]/.test(workspace))throw new Error('Workspace do projeto é obrigatório.');
 const objective=bounded('objective',3000),success_criteria=bounded('success_criteria',2000),research_focus=bounded('research_focus',800);
 const requested=body.repositories??[];
 if(!Array.isArray(requested)||requested.length>8)throw new Error('Informe até oito repositórios GitHub.');
 const repositories=requested.length?buildCompetitorResearch({workspace,repositories:requested,focus:research_focus},workspace).competitor_repositories:[];
 const charter={};
 for(const key of ['mission','vision','values','principles'])if(body[key]!==undefined)charter[key]=bounded(key,2000);
 return {workspace,objective,success_criteria,repositories,research_focus,...charter};
}
