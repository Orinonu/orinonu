import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.mjs';

// Bounded memory pilot: a fixed sanitized corpus with answer keys replays the same writes and
// queries through pluggable backends. The local baseline is a real, durable fact store with
// project scope and provenance; the Honcho arm is a credential-gated adapter contract. Every arm
// is measured for recall, isolation, corrections, retention, latency and measured cost. Nothing is
// promoted — recommendation needs evidence and credentials; unknowns stay explicit.

export const PILOT_CASES = Object.freeze({
  writes: Object.freeze([
    { id:'f-alpha-store', project:'alpha', kind:'fact', text:'alpha usa sqlite como armazenamento canônico', source:'docs/alpha.md' },
    { id:'f-alpha-lang', project:'alpha', kind:'preference', text:'relatórios em português preferidos pelo usuário', source:'decision:2026-01' },
    { id:'f-alpha-rev-old', project:'alpha', kind:'fact', text:'limite de revisão é duas tentativas', source:'policy:v1' },
    { id:'f-alpha-rev', project:'alpha', kind:'fact', text:'limite de revisão é três tentativas', source:'policy:v2', supersedes:'f-alpha-rev-old' },
    { id:'f-beta-store', project:'beta', kind:'fact', text:'beta usa arquivos jsonl no filesystem', source:'docs/beta.md' },
  ]),
  queries: Object.freeze([
    { id:'q-store', kind:'recall', project:'alpha', text:'sqlite armazenamento', expect:['f-alpha-store'] },
    { id:'q-pref', kind:'recall', project:'alpha', text:'português relatórios', expect:['f-alpha-lang'] },
    { id:'q-rev', kind:'correction', project:'alpha', text:'limite revisão tentativas', expect:['f-alpha-rev'] },
    { id:'q-iso-1', kind:'isolation', project:'beta', text:'sqlite português', expect:[] },
    { id:'q-iso-2', kind:'isolation', project:'beta', text:'limite revisão', expect:[] },
    { id:'q-beta', kind:'recall', project:'beta', text:'filesystem jsonl', expect:['f-beta-store'] },
    { id:'q-unknown', kind:'recall', project:'alpha', text:'kubernetes orchestrator', expect:[] },
  ]),
});

const tokens = text => new Set(String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(t=>t.length>2));

// Local baseline: append-only JSONL per data dir; query is deterministic token overlap inside the
// project scope only. Corrections are tombstones: the superseded fact is recorded as replaced.
export function localMemoryBackend(dir){
  const file=join(dir,'memory-facts.jsonl');
  mkdirSync(dir,{recursive:true});
  const load=()=>!existsSync(file)?[]:readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  return {
    id:'local', configured:true,
    async verify(){return {available:true,max_operation_cost_usd:0};},
    async write({project,fact}){
      const row={id:fact.id,project,text:fact.text,source:fact.source,kind:fact.kind??'fact',recorded_at:new Date().toISOString()};
      appendFileSync(file,JSON.stringify(row)+'\n');
      if(fact.supersedes)appendFileSync(file,JSON.stringify({id:fact.supersedes,project,superseded_by:fact.id,recorded_at:new Date().toISOString()})+'\n');
      return {ok:true,cost_usd:0};
    },
    async query({project,text}){
      // Last write wins per fact id: a replayed corpus must not double-count durable facts.
      const byId=new Map();for(const r of load())if(r.project===project)byId.set(r.id,r);
      const rows=[...byId.values()];
      const superseded=new Set(rows.filter(r=>r.superseded_by).map(r=>r.id));
      const want=tokens(text);
      const hits=rows.filter(r=>r.text&&r.project===project&&!superseded.has(r.id))
        .map(r=>({r,score:[...tokens(r.text)].filter(t=>want.has(t)).length}))
        .filter(({score})=>score>0)
        .sort((a,b)=>b.score-a.score)
        .map(({r})=>({id:r.id,text:r.text,provenance:{fact_id:r.id,source:r.source,recorded_at:r.recorded_at,project:r.project}}));
      return {facts:hits,cost_usd:0};
    },
  };
}

// Honcho adapter contract: scoped writes/queries over an injected transport. Without endpoint+key it
// reports unavailable and performs no network call; errors are redacted; cost is only what the
// response measures, never estimated.
export function honchoBackend({endpoint=null,apiKey=null,transport=null}={}){
  const configured=typeof endpoint==='string'&&!!endpoint.trim()&&typeof apiKey==='string'&&!!apiKey.trim();
  let verified=false;
  const scope=project=>`project:${project}`;
  const call=async(method,body)=>{
    if(!verified)throw new Error('Honcho sem transporte com contrato verificado; operação bloqueada.');
    try{return await transport[method]({endpoint,apiKey,...body});}
    catch{throw new Error('Operação do transporte Honcho não concluída.');}
  };
  return {
    id:'honcho', configured,
    async verify(){
      verified=false;
      if(!configured)return {available:false,reason:'Credenciais Honcho ausentes (endpoint/api key não configurados); braço não executado.'};
      if(!['verify','write','query'].every(method=>typeof transport?.[method]==='function'))return {available:false,reason:'Transporte Honcho com contrato validado não configurado; rede bloqueada.'};
      let result;try{result=await transport.verify({endpoint,apiKey});}catch{return {available:false,reason:'Verificação do transporte Honcho não concluída.'};}
      verified=result?.available===true&&result.contract_verified===true&&typeof result.contract==='string'&&!!result.contract.trim();
      return verified?{available:true,contract:result.contract,max_operation_cost_usd:result.max_operation_cost_usd}:{available:false,reason:'Contrato ou autenticação do transporte Honcho não verificados.'};
    },
    async write({project,fact}){
      const out=await call('write',{scope:scope(project),fact});
      if(out?.ok!==true)throw new Error('Gravação Honcho não confirmada.');
      return {ok:true,cost_usd:Number.isFinite(out.cost_usd)&&out.cost_usd>=0?out.cost_usd:null};
    },
    async query({project,text}){
      const out=await call('query',{scope:scope(project),text});
      if(!Array.isArray(out?.facts))throw new Error('Resposta Honcho fora do contrato.');
      return {facts:out.facts,cost_usd:Number.isFinite(out.cost_usd)&&out.cost_usd>=0?out.cost_usd:null};
    },
  };
}

export async function runPilot({backends={},cases=PILOT_CASES,budget_usd=null,clock=()=>Date.now()}={}){
  if(budget_usd!==null&&(!Number.isFinite(budget_usd)||budget_usd<0))throw new Error('Orçamento do piloto inválido.');
  const arms={};
  for(const [id,backend] of Object.entries(backends)){
    const verification=await backend.verify().catch(()=>({available:false,reason:'Verificação falhou.'}));
    if(!verification.available){arms[id]={available:false,reason:verification.reason??'Indisponível.',measurements:null};continue;}
    let spent=0,complete=true,budgetExceeded=false,budgetUnverifiable=false,latency=0,writesCompleted=0;
    const bound=verification.max_operation_cost_usd;
    const admit=()=>{
      if(budget_usd!==null){
        if(!complete||!Number.isFinite(bound)||bound<0)budgetUnverifiable=true;
        else if(spent+bound>budget_usd)budgetExceeded=true;
      }
      return !budgetExceeded&&!budgetUnverifiable;
    };
    const timed=async fn=>{
      const t0=clock(),out=await fn();latency+=Math.max(0,clock()-t0);
      if(Number.isFinite(out?.cost_usd)&&out.cost_usd>=0)spent+=out.cost_usd;else complete=false;
      if(budget_usd!==null&&spent>budget_usd)budgetExceeded=true;
      return out;
    };
    try{
      for(const fact of cases.writes){if(!admit())break;await timed(()=>backend.write({project:fact.project,fact:structuredClone(fact)}));writesCompleted++;}
      const rows=[];
      for(const q of cases.queries){
        if(!admit())break;
        const out=await timed(()=>backend.query({project:q.project,text:q.text}));
        const returned=(out?.facts??[]).map(f=>f.id);
        const correct=JSON.stringify([...returned].sort())===JSON.stringify([...q.expect].sort());
        rows.push({query_id:q.id,kind:q.kind,expected:q.expect,returned_ids:returned,correct,provenance:(out?.facts??[]).every(f=>f.provenance!=null)});
      }
      // retention: after all writes, the recall queries must still resolve
      let retained=0,retentionTotal=0;
      const retentionCases=cases.queries.filter(q=>q.kind==='recall'&&q.expect.length);
      for(const q of retentionCases){
        if(!admit())break;
        retentionTotal++;
        const out=await timed(()=>backend.query({project:q.project,text:q.text}));
        const returned=(out?.facts??[]).map(f=>f.id);
        if(JSON.stringify([...returned].sort())===JSON.stringify([...q.expect].sort()))retained++;
      }
      const completed=!budgetExceeded&&!budgetUnverifiable&&writesCompleted===cases.writes.length&&rows.length===cases.queries.length&&retentionTotal===retentionCases.length;
      const recallRows=rows.filter(r=>r.kind==='recall');
      const correctionRows=rows.filter(r=>r.kind==='correction');
      const isolationRows=rows.filter(r=>r.kind==='isolation');
      // Isolation queries expect zero results: every returned id is a cross-project leak.
      const violations=isolationRows.reduce((n,r)=>n+r.returned_ids.length,0);
      arms[id]={available:true,completed,budget_exceeded:budgetExceeded,budget_unverifiable:budgetUnverifiable,measurements:{
        recall:{correct:recallRows.filter(r=>r.correct).length,total:recallRows.length,rows:recallRows},
        corrections:{correct:correctionRows.filter(r=>r.correct).length,total:correctionRows.length,rows:correctionRows},
        isolation:{violations,total:isolationRows.length,rows:isolationRows},
        retention:{retained,total:retentionTotal},
        latency_ms:latency,cost_usd:complete&&completed?spent:null,measured_cost_usd:spent,cost_complete:complete&&completed,
      }};
    }catch(error){
      arms[id]={available:true,budget_exceeded:budgetExceeded,measurements:null,error:redact(error.message).slice(0,300)};
    }
  }
  const measuredArms=Object.values(arms).filter(a=>a.available&&a.completed&&a.measurements);
  const [first,second]=measuredArms;
  const delta=(a,b)=>first&&second&&Number.isFinite(a)&&Number.isFinite(b)?b-a:null;
  return {
    id:randomUUID(),time:new Date().toISOString(),kind:'memory_pilot',
    dataset_hash:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    budget_usd,arms,
    comparison:{
      recall_delta:delta(first?.measurements.recall.correct,second?.measurements.recall.correct),
      isolation_violations_delta:delta(first?.measurements.isolation.violations,second?.measurements.isolation.violations),
      latency_delta_ms:delta(first?.measurements.latency_ms,second?.measurements.latency_ms),
      cost_delta_usd:delta(first?.measurements.cost_usd,second?.measurements.cost_usd),
    },
    credential_gate:{honcho:!backends.honcho?.configured?'not_configured':arms.honcho?.available?'verified_transport':'configured_unverified'},
    promoted:false,
    rollback:'Nada é promovido nem integrado: o piloto só mede. Adotar um backend exige evidência medida, credenciais apropriadas e revisão; a reversão é descartar a recomendação e manter a busca local.',
    limitations:[
      'Corpus sanitizado fixo com gabarito; não mede memória derivada por inferência de terceiros.',
      'Latência mede a chamada local ao adaptador, não a derivação assíncrona em background do serviço.',
      'Custo existe apenas quando medido na resposta; estimativas de tarifa não entram.',
      'Isolamento é verificado por escopo de projeto nas consultas; prova de vazamento interno do serviço exige auditoria própria.',
    ],
  };
}

