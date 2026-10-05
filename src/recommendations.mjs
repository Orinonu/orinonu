import {createHash} from 'node:crypto';
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function normalizeRecommendations(rows,workspace,source,sourceTaskId){
 if(!Array.isArray(rows)||rows.length>3)throw new Error('Até três propostas são permitidas.');
 return rows.map(row=>{
  if(!row||!text(row.title,160)||!text(row.goal,6000)||!text(row.acceptance,3000)||!text(row.recommendation,1200)||!text(row.risk,1200)||!Array.isArray(row.evidence)||!row.evidence.length||row.evidence.length>8||row.evidence.some(e=>!text(e,2000)))throw new Error('Proposta incompleta.');
  const safe={title:row.title,goal:row.goal,acceptance:row.acceptance,recommendation:row.recommendation,risk:row.risk,evidence:[...row.evidence]};
  return {...safe,key:'analysis:'+createHash('sha256').update(JSON.stringify({workspace,...safe})).digest('hex'),workspace,status:'pending',source,source_task_id:sourceTaskId??null,max_minutes:30};
 });
}
export function readRecommendations(report,workspace,sourceTaskId){
 // Reading only the first block would silently ignore later proposals or invalid content: ambiguity is rejected whole.
 if((String(report??'').match(/^[ \t]*```nexo-opportunities\b/gm)??[]).length>1)throw new Error('Relatório com múltiplos blocos de oportunidades é ambíguo.');
 const match=String(report??'').match(/```nexo-opportunities\s*\n([\s\S]*?)\n```/);
 if(!match)return [];
 return normalizeRecommendations(JSON.parse(match[1]),workspace,'codex_read_only_analysis',sourceTaskId);
}
// Admission receives fully validated rows; one identity is admitted at most once.
export function distinctRecommendations(rows,existing,room){
 const known=new Set(existing.map(row=>row.key));
 const incoming=[];
 for(const row of rows){
  if(known.has(row.key))continue;
  known.add(row.key);
  if(incoming.length<room)incoming.push(row);
 }
 return incoming;
}
