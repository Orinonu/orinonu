// Only generated metadata is exposed. CLI arguments, output and message text
// are deliberately excluded from this public activity feed.
const toolLabels={command_execution:'Comando local',mcp_tool_call:'Ferramenta MCP',web_search:'Pesquisa web',file_change:'Alteração de arquivos',collab_tool_call:'Delegação de agente',file_read:'Leitura de arquivos',memory_lookup:'Consulta de memória',hermes_tool_call:'Ferramenta Hermes'};
export function observeHermesProgress(progress,metadata){
 if(!metadata||!['tool_use','tool_result'].includes(metadata.type)||!Object.hasOwn(toolLabels,metadata.tool))return null;
 return observeCodexProgress(progress,{type:metadata.type==='tool_use'?'item.started':'item.completed',item:{type:metadata.tool,status:metadata.failed?'failed':'completed'}});
}
export function appendProgress(progress,entry){
 const time=new Date().toISOString();
 const row={seq:++progress.sequence,time,...entry};
 progress.last_activity_at=time;
 progress.events.push(row);
 if(progress.events.length>30)progress.events.splice(0,progress.events.length-30);
 return row;
}
export function startProgress(planningOnly,{attempt_id=null,phase=planningOnly?'planning':'implementation'}={}){
 const progress={phase:planningOnly?'planning':'running',attempt_id,checklist_phase:phase,checklist_revision:0,sequence:0,last_activity_at:null,events:[],tool_events:0,failed_tools:0,measurement_kind:'task_checklist',items:null};
 appendProgress(progress,{kind:'execution_started',state:'running',label:planningOnly?'Investigação Codex iniciada · somente leitura':'Implementação Codex iniciada'});
 return progress;
}
export function progressContractInstructions({attempt_id,phase}){
 return `\nDurante esta etapa, emita atualizações completas de checklist em mensagens com um único bloco Markdown nexo-progress: JSON {version:1,attempt_id:${JSON.stringify(attempt_id)},phase:${JSON.stringify(phase)},revision:1,items:[{id:"item-1",title:"Entrega concreta da etapa",state:"pending"|"in_progress"|"completed",evidence:[]}]}. Antes de executar, declare todos os itens necessários desta etapa. IDs, títulos, ordem e quantidade permanecem iguais durante esta tentativa; incremente revision a cada atualização. Completed exige evidence com pelo menos uma referência textual concreta do trabalho realizado; nunca conclua um item só por iniciar sessão, terminar turno ou emitir mensagem. Não inclua comandos, saídas ou segredos em títulos/evidências. Atualize após concluir cada item. O percentual mede itens reportados, não certificação host da qualidade. Não omita itens pendentes para aumentar o progresso.`;
}
function observeChecklist(progress,text){
 if(typeof text!=='string'||text.length>100000||!progress.attempt_id)return null;
 const blocks=[...text.matchAll(/```nexo-progress\s*\r?\n([\s\S]*?)```/g)];if(blocks.length!==1||blocks[0][1].length>60000)return null;
 let value;try{value=JSON.parse(blocks[0][1]);}catch{return null;}
 if(value?.version!==1||value.attempt_id!==progress.attempt_id||value.phase!==progress.checklist_phase||!Number.isSafeInteger(value.revision)||value.revision<=progress.checklist_revision||!Array.isArray(value.items)||!value.items.length||value.items.length>100)return null;
 const ids=new Set();
 for(const item of value.items){
  if(!item||typeof item.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(item.id)||ids.has(item.id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>160||!['pending','in_progress','completed'].includes(item.state)||!Array.isArray(item.evidence)||item.evidence.length>10||item.evidence.some(row=>typeof row!=='string'||!row.trim()||row.length>1000)||item.state==='completed'&&!item.evidence.length)return null;
  ids.add(item.id);
 }
 if(progress.items&&(progress.items.length!==value.items.length||progress.items.some((item,i)=>item.id!==value.items[i].id||item.title!==value.items[i].title)))return null;
 // Evidence text stays in the private agent report, never the public activity feed.
 progress.items=value.items.map(item=>({id:item.id,title:item.title,state:item.state,evidence_count:item.evidence.length}));progress.checklist_revision=value.revision;
 const completed=progress.items.filter(item=>item.state==='completed').length;
 return appendProgress(progress,{kind:'checklist_updated',state:'running',label:`Checklist reportado: ${completed}/${progress.items.length} itens concluídos`});
}
export function observeCodexProgress(progress,row){
 if(!progress)return null;
 if(row.type==='thread.started')return appendProgress(progress,{kind:'session_started',state:'completed',label:'Sessão Codex conectada'});
 if(row.type==='turn.failed')return appendProgress(progress,{kind:'turn_failed',state:'failed',label:'Codex reportou falha no turno'});
 if(row.type==='turn.completed')return appendProgress(progress,{kind:'turn_completed',state:'completed',label:'Turno Codex concluído'});
 const item=row.item;
 if(!item||!['item.started','item.completed'].includes(row.type))return null;
 const name=toolLabels[item.type];
 if(name){
  const started=row.type==='item.started';
  const failed=!started&&(item.status==='failed'||item.status==='declined'||(Number.isFinite(item.exit_code)&&item.exit_code!==0)||item.error!=null);
  const state=started?'running':failed?'failed':'completed';
  if(!started){progress.tool_events=(progress.tool_events??0)+1;if(failed)progress.failed_tools=(progress.failed_tools??0)+1;}
  return appendProgress(progress,{kind:started?'tool_started':'tool_completed',tool:item.type,state,label:`${name} · ${started?'em andamento':failed?'falhou ou foi recusado':'concluído'}`});
 }
 if(item.type==='agent_message'&&row.type==='item.completed')return observeChecklist(progress,item.text)??appendProgress(progress,{kind:'agent_message',state:'completed',label:'Resposta do agente recebida'});
 return null;
}
// Legacy host lifecycle calls cannot complete checklist work items.
export function completeMilestone(){ }
export function finishProgress(progress,status,planningOnly){
 if(!progress)return null;
 progress.phase=status;
 return appendProgress(progress,{kind:'execution_finished',state:['review','done'].includes(status)?'completed':'failed',label:status==='done'?'Revisão aprovada · alterações integradas':status==='review'?(planningOnly?'Plano entregue · aguardando revisão':'Execução concluída · aguardando revisão'):'Execução interrompida ou com falha · verificar pendência'});
}
