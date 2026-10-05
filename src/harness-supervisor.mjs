import {randomUUID} from 'node:crypto';
import {collectHarnessEvidence,evaluateHarness,researchRequest} from './harness-evaluation.mjs';

const eligible=t=>t?.attempt?.state==='terminal'&&!t.queue&&!t.pipeline?.cancelled&&!/parada pelo usuário/i.test(t.error??'');
const labels={measurement:'Completar medições e evidências',routing:'Investigar roteamento de especialistas e ferramentas',context:'Investigar memória e recuperação de contexto',performance:'Investigar desempenho contra metas comparáveis'};

// Completion-driven: reading the dashboard never schedules research or inference.
export function createHarnessSupervisor({db,save,refresh=()=>{},engine,engineFor=()=>engine,event=()=>{},isClosed=()=>false,maxPending=32,ownerId=null,canRecover=()=>true}){
  db.harness_campaigns??=[];
  for(const c of db.harness_campaigns)if(['queued','researching'].includes(c.status)&&canRecover(c)){
    c.status='interrupted';c.reason='Supervisor reiniciado; dados preservados, sem repetir consulta automaticamente.';
  }
  save();
  const pending=new Map();let running=false;
  const current=c=>{const task=db.tasks.find(t=>t.id===c.task_id);return eligible(task)&&task.attempt.id===c.attempt_id&&task.revision===c.revision?task:null;};
  function persist(c,status,reason){c.status=status;c.reason=reason;save();}
  async function drain(){
    if(running||isClosed())return;running=true;
    try{while(pending.size&&!isClosed()){
      const [id]=pending.entries().next().value;pending.delete(id);
      refresh();let c=db.harness_campaigns.find(item=>item.id===id);if(!c)continue;
      const task=current(c);
      if(!task){persist(c,'superseded','Missão mudou antes da consulta; avaliação preservada.');continue;}
      const request=researchRequest(task,c.evaluation);
      if(!request){persist(c,'observed','Nenhuma investigação necessária.');continue;}
      const {supervisor,...wire}=request;
      persist(c,'researching','JEV priorizando investigação a partir das evidências observadas.');
      try{
        const output=await engineFor(task).call('resolve_decision',wire);
        if(isClosed())return;
        refresh();
        c=db.harness_campaigns.find(item=>item.id===id);if(!c)continue;
        event({kind:'jev_decision',provider:'typesafe',tool:'resolve_decision',decision_kind:'harness_research',task_id:c.task_id,campaign_id:c.id,ok:output?.ok,usage:output?.usage,latency_ms:output?.latency_ms,cached:output?.cached});
        if(!current(c)){persist(c,'superseded','Missão ou revisão mudou durante a consulta; proposta não aplicada.');continue;}
        const selected=output?.selected_id;
        if(!output?.ok||output.action!=='recommend'||!wire.options.some(o=>o.id===selected)){
          persist(c,'abstained','JEV não recomendou uma opção válida; medições e lacunas preservadas.');continue;
        }
        c.selected_id=selected;
        if(selected==='hold'){persist(c,'held','JEV recomendou preservar resultados e pendências.');continue;}
        const key=`harness-research:${c.task_id}:${c.attempt_id}:${c.phase}`;
        const previous=db.opportunities.find(o=>o.key===key);
        if(previous){c.proposal_id=previous.id;persist(c,'proposed','Investigação já registrada.');continue;}
        if(db.opportunities.length>=200){persist(c,'proposal_limit','Limite de propostas atingido; prioridade e evidências preservadas.');continue;}
        const proposal={id:randomUUID(),key,created_at:new Date().toISOString(),workspace:c.workspace,status:'pending',source:'harness_supervisor',source_task_id:c.task_id,max_minutes:30,
          title:labels[selected],goal:`Investigar melhorias dentro do escopo desta missão: ${String(task.goal??'').slice(0,4000)}. Prioridade: ${labels[selected]}. Coletar evidências antes de recomendar implementação.`,
          acceptance:'Relatório com evidências reproduzíveis, lacunas medidas e recomendações delimitadas. Não executar implementação, alterar critérios ou declarar economia sem comparação equivalente.',
          recommendation:'Investigação recomendada pelo JEV; executar exige aprovação da proposta.',risk:'Medições ausentes não demonstram falha nem economia.',
          evidence:[`Missão ${c.task_id}; tentativa ${c.attempt_id}; fase ${c.phase}; revisão ${c.revision}.`,`Observação: ${JSON.stringify(c.observation).slice(0,2000)}`,`Avaliação: ${JSON.stringify(c.evaluation).slice(0,2000)}`]};
        db.opportunities.push(proposal);c.proposal_id=proposal.id;
        persist(c,'proposed','Proposta de investigação disponível no backlog; nenhum executor iniciado.');
      }catch{
        if(isClosed())return;
        refresh();c=db.harness_campaigns.find(item=>item.id===id);if(c)persist(c,current(c)?'failed':'superseded','Consulta não concluída; evidências preservadas, sem repetição automática.');
      }
    }}finally{running=false;}
  }
  return {
    record(task,phase,{stopped=false}={}){
      if(isClosed()||task.attempt?.state!=='terminal')return null;
      const id=`${task.id}:${task.attempt.id}:${phase}`;
      const existing=db.harness_campaigns.find(c=>c.id===id);if(existing)return existing;
      const observation=collectHarnessEvidence(task),evaluation=evaluateHarness(observation,task.evaluation_targets??{});
      const c={id,task_id:task.id,attempt_id:task.attempt.id,phase,workspace:task.workspace,revision:task.revision,supervisor_id:ownerId,time:new Date().toISOString(),observation,evaluation,status:'observed',selected_id:null,proposal_id:null,reason:'Avaliação determinística registrada.'};
      db.harness_campaigns.push(c);
      if(stopped||!eligible(task)){c.status='cancelled';c.reason='Tentativa interrompida; nenhuma pesquisa automática.';}
      else if(evaluation.needs_research){
        for(const [key,old] of pending)if(old.task_id===task.id){pending.delete(key);const stored=db.harness_campaigns.find(item=>item.id===key);if(stored){stored.status='superseded';stored.reason='Uma conclusão mais recente substituiu esta consulta pendente.';}}
        if(pending.size>=maxPending){c.status='deferred';c.reason='Limite de consultas pendentes atingido; avaliação preservada.';}
        else{c.status='queued';pending.set(id,c);}
      }
      save();event({kind:'harness_evaluated',task_id:task.id,campaign_id:id,phase,status:c.status});
      queueMicrotask(()=>{void drain().catch(()=>{event({kind:'harness_supervisor_failed'});});});
      return c;
    },
    summary(){return {automatic:true,trigger:'confirmed_attempt_completion',running,queued:pending.size,campaigns:db.harness_campaigns,counts:db.harness_campaigns.reduce((a,c)=>(a[c.status]=(a[c.status]??0)+1,a),{})};}
  };
}
