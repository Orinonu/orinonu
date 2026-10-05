import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function curatorReport(dataDir,events,now=Date.now()){
  let inventory={duplicates:[]};try{inventory=JSON.parse(readFileSync(join(dataDir,'skill-inventory.json'),'utf8'));}catch{}
  const recent=events.filter(e=>now-Date.parse(e.time)<=7*86400000&&Date.parse(e.time)<=now);
  const tools=new Map();for(const e of recent){if(e.kind==='tool_observed'&&e.tool)tools.set(e.tool,(tools.get(e.tool)??0)+1);}
  const phases=new Map();for(const e of recent){if(e.kind==='task_started'&&e.profile)phases.set(e.profile,(phases.get(e.profile)??0)+1);}
  return {window_days:7,generated_at:new Date(now).toISOString(),coverage:'partial',
    consultations:recent.filter(e=>e.kind==='mission_consulted'&&e.source==='native_hook').length,
    observed_tools:[...tools].map(([id,uses])=>({id,uses})).sort((a,b)=>b.uses-a.uses),
    observed_phases:[...phases].map(([id,uses])=>({id,uses})),
    disabled_duplicates:inventory.duplicates??[],
    policy:'Sem observação não significa sem uso. Duplicatas conhecidas desativadas são recuperáveis. Nenhuma skill ou MCP é removida por frequência.',
    limitations:['Hooks dependem de confiança nativa e não cobrem todas as ferramentas.','Leitura de skills não é inferida a partir de comandos privados.','O painel calcula a janela de 7 dias; a revisão semanal usa automação nativa separada, que precisa ser restaurada em uma nova instalação.']};
}
