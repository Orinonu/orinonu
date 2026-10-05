import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {receiptOf,receiptDigest,receiptCriteria,receiptReviewRequest,verifyReceiptReview,citedPaths} from './receipts.mjs';
import {readReviewContract} from './review-contract.mjs';
import {redact} from './redact.mjs';
import {fingerprintWorkspace} from './implementation-workspace.mjs';
import {overlappingWorkspaces,schedulerLimits,unmetDependencies} from './queue.mjs';
import {sessionWorkOccupants} from './session-work.mjs';
import {launchAllowance} from './autonomy.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const requirements=task=>sha(JSON.stringify([task.title,task.goal,task.acceptance,task.workspace]));
const elapsed=(review,now=Date.now())=>Math.max(0,Math.min(now,Date.parse(review.expires_at))-Date.parse(review.claimed_at));
const reviewCriteria=task=>{try{return receiptCriteria(task);}catch(error){throw fail(error.message,400);}};
const identity=input=>{
  for(const key of ['session_id','owner'])if(typeof input?.[key]!=='string'||!input[key].trim()||input[key].length>160)throw fail('Identidade da sessão de revisão obrigatória.',400);
};

export function createDesktopReview({store,db,save,event=()=>{},checkBudget=()=>{}}){
  const current=id=>{store.refresh(db);const task=db.tasks.find(t=>t.id===id);if(!task)throw fail('Missão não encontrada.',404);return task;};
  const order=(task,review,token)=>({mission:{id:task.id,title:task.title,goal:task.goal,acceptance:task.acceptance,workspace:review.workspace},phase:'review',read_only:true,review_id:review.id,review_token:token,expires_at:review.expires_at,snapshot_digest:review.snapshot_digest,receipt_digest:review.receipt_digest,criteria:review.criteria,files:review.files,instructions:'Revise somente leitura (read-only), sem editar arquivos, iniciar executores ou integrar código. Entregue um único contrato nexo-review com este snapshot_digest, criteria_hash e uma verificação por criterion_id, cobrindo critérios e checklist. Evidências devem citar arquivos reais. approved não significa merge nem economia medida.'});
  async function claim(id,input){
    identity(input);
    const before=current(id),work=receiptOf(before);
    if(work)reviewCriteria(before);
    if(!work||before.archived_at||before.status==='done'||before.pipeline?.cancelled||before.opportunity_audit||!receiptReviewRequest(before).eligible)throw fail('Missão sem recibo elegível para revisão; recuperação ou autorização necessária.');
    if(work.session_id===input.session_id)throw fail('A sessão implementadora não pode revisar o próprio recibo.');
    const receiptHash=receiptDigest(before),requirementsHash=requirements(before),workspace=realpathSync(before.workspace);
    const fingerprint=await fingerprintWorkspace(workspace);
    return store.transaction(()=>{
      const task=current(id);
      if(receiptDigest(task)!==receiptHash||requirements(task)!==requirementsHash||task.archived_at||task.pipeline?.cancelled||task.status==='done'||!receiptReviewRequest(task).eligible)throw fail('Missão mudou durante a reserva de revisão.');
      if(task.queue||task.attempt&&task.attempt.state!=='terminal'||task.external_work?.status==='active')throw fail('Missão possui execução ou sessão ativa.');
      const now=Date.now();
      store.sql.prepare("UPDATE desktop_review_leases SET status='expired' WHERE status='active' AND expires_at<=?").run(now);
      if(store.sql.prepare("SELECT id FROM desktop_review_leases WHERE task_id=? AND status='active'").get(id))throw fail('Recibo já reservado por uma sessão de revisão.');
      const occupants=[...store.occupants(),...sessionWorkOccupants(db.tasks)];
      if(occupants.some(row=>row.phase==='implementation'&&overlappingWorkspaces(row.workspace,workspace)))throw fail('Workspace ocupado por escritor; revisão exige somente leitura.');
      if(occupants.filter(row=>row.phase==='review').length>=schedulerLimits(db.scheduler).review_limit)throw fail('Capacidade de revisão ocupada.');
      if((task.launches??0)>=launchAllowance(task))throw fail('Limite de lançamentos esgotado.');
      if(unmetDependencies(task,db.tasks).length)throw fail('Dependências ainda não concluídas.');
      checkBudget(task);
      const expiredMs=task.desktop_review?.status==='active'&&Date.parse(task.desktop_review.expires_at)<=now?elapsed(task.desktop_review,now):0;
      const spent=(task.pipeline?.spent_ms??0)+expiredMs;
      const minutes=Math.min(task.phase_limits?.review??task.max_minutes??15,15,(task.pipeline?.budget_minutes??task.max_minutes??15)-spent/60000);
      const ttl=input.ttl_seconds??Math.floor(minutes*60);
      if(!Number.isInteger(ttl)||ttl<1||ttl>900||ttl>minutes*60)throw fail('Prazo da revisão excede o limite ou orçamento restante.',400);
      const token=randomBytes(32).toString('hex'),reviewId=randomUUID(),criteria=reviewCriteria(task);
      const review={id:reviewId,status:'active',session_id:input.session_id,owner:input.owner,workspace,claimed_at:new Date(now).toISOString(),expires_at:new Date(now+ttl*1000).toISOString(),receipt_digest:receiptHash,requirements_hash:requirementsHash,workspace_hash:fingerprint.hash,files:fingerprint.files,criteria};
      review.snapshot_digest=sha(JSON.stringify([reviewId,receiptHash,requirementsHash,fingerprint.hash,criteria.hash]));
      if(task.desktop_review){task.desktop_review_history??=[];task.desktop_review_history.push(task.desktop_review);}
      store.sql.prepare('INSERT INTO desktop_review_leases VALUES(?,?,?,?,?,?,?,?)').run(reviewId,id,input.session_id,input.owner,sha(token),workspace,now+ttl*1000,'active');
      task.desktop_review=review;task.launches=(task.launches??0)+1;task.pipeline??={auto_implement:false};task.pipeline.spent_ms=spent;save();
      event({kind:'desktop_review_claimed',task_id:id,review_id:reviewId,session_id:input.session_id,expires_at:review.expires_at});
      return order(task,review,token);
    });
  }
  const owned=(id,input)=>{
    identity(input);
    const lease=store.sql.prepare('SELECT * FROM desktop_review_leases WHERE id=? AND task_id=?').get(input.review_id??'',id);
    if(!lease||lease.session_id!==input.session_id||lease.owner!==input.owner||typeof input.review_token!=='string'||!/^[a-f0-9]{64}$/.test(input.review_token)||!timingSafeEqual(Buffer.from(lease.token_hash,'hex'),Buffer.from(sha(input.review_token),'hex')))throw fail('Posse da revisão não comprovada.');
    return lease;
  };
  async function report(id,input){
    if(typeof input?.report!=='string'||!input.report.trim()||input.report.length>30000)throw fail('Relatório de revisão inválido ou excessivo.',400);
    const text=redact(input.report),reportHash=sha(text);
    let task=current(id),lease=owned(id,input),review=task.desktop_review;
    if(review?.id!==lease.id)throw fail('Reserva de outra versão da missão.');
    if(lease.status!=='active'){
      if(review.report_hash!==reportHash||!review.response)throw fail('Revisão encerrada ou parecer divergente.');
      return review.response;
    }
    if(lease.expires_at<=Date.now())throw fail('Reserva de revisão expirou.');
    const fingerprint=await fingerprintWorkspace(review.workspace);
    return store.transaction(()=>{
      task=current(id);lease=owned(id,input);review=task.desktop_review;
      if(lease.status!=='active'&&review?.id===lease.id&&review.report_hash===reportHash&&review.response)return review.response;
      if(lease.status!=='active'||lease.expires_at<=Date.now()||review?.id!==lease.id)throw fail('Reserva de revisão não está vigente.');
      if(task.archived_at||task.pipeline?.cancelled||task.queue||task.attempt&&task.attempt.state!=='terminal'||receiptDigest(task)!==review.receipt_digest||requirements(task)!==review.requirements_hash||fingerprint.hash!==review.workspace_hash)throw fail('Recibo, requisitos ou snapshot mudaram durante a revisão.');
      let contract;try{contract=readReviewContract(text,review.snapshot_digest,review.criteria);}catch(error){throw fail(error.message,400);}
      for(const check of contract.checks)if(check.criterion_id&&check.criterion!==review.criteria.items.find(item=>item.id===check.criterion_id)?.text)throw fail('Texto do critério diverge do conjunto confirmado.',400);
      let completion=null;
      if(contract.decision==='approved'){
        if(citedPaths(contract.checks.flatMap(check=>check.evidence)).some(path=>!Object.hasOwn(fingerprint.files,path)))throw fail('Evidência fora do snapshot revisado.',400);
        const verdict=verifyReceiptReview({task,report:text,request:{receipt_digest:review.receipt_digest,snapshot_digest:review.snapshot_digest,checklist:receiptOf(task).checklist},workspace:review.workspace,attemptId:review.id});
        if(!verdict.ok)throw fail(verdict.reason,400);
        completion={...verdict.completion,reviewer_session_id:review.session_id,reviewer_owner:review.owner,snapshot_digest:review.snapshot_digest,criteria_hash:review.criteria.hash,reviewed_workspace_fingerprint:review.workspace_hash};
      }
      const result={ok:true,mission_id:id,decision:contract.decision,completion},stamp=new Date().toISOString();
      const next=structuredClone(task);
      next.desktop_review={...review,status:contract.decision,ended_at:stamp,report_hash:reportHash,response:result};
      next.review_report=text;next.review_contract=contract;next.review_snapshot={kind:'session_receipt',snapshot_digest:review.snapshot_digest,receipt_digest:review.receipt_digest,review_attempt_id:review.id,criteria:review.criteria,changes:[]};
      next.receipt_review={source:'desktop_session',status:completion?'approved':'rejected',receipt_digest:review.receipt_digest,snapshot_digest:review.snapshot_digest,review_attempt_id:review.id,requested_at:review.claimed_at,ended_at:stamp,reason:completion?null:contract.reason};
      next.status=completion?'done':'blocked';next.error=completion?null:'Revisão de sessão não aprovou o recibo: '+contract.decision;
      if(completion)next.completion=completion;
      next.pipeline??={auto_implement:false};next.pipeline.spent_ms=(next.pipeline.spent_ms??0)+elapsed(review);next.pipeline.status=completion?'done':'needs_review';next.pipeline.reason=next.error;
      store.sql.prepare("UPDATE desktop_review_leases SET status=? WHERE id=? AND status='active'").run(contract.decision,review.id);
      Object.assign(task,next);save();
      event({kind:completion?'desktop_receipt_verified':'desktop_review_reported',task_id:id,review_id:review.id,decision:contract.decision});
      return result;
    });
  }
  function cancel(id,input){
    return store.transaction(()=>{
      const task=current(id),lease=owned(id,input),review=task.desktop_review;
      if(review?.id!==lease.id)throw fail('Reserva de outra versão da missão.');
      if(lease.status==='cancelled')return review.response;
      if(!['active','expired'].includes(lease.status))throw fail('Revisão já encerrada.');
      const result={ok:true,mission_id:id,status:'cancelled'};
      store.sql.prepare("UPDATE desktop_review_leases SET status='cancelled' WHERE id=?").run(lease.id);
      task.desktop_review={...review,status:'cancelled',ended_at:new Date().toISOString(),response:result};task.pipeline??={auto_implement:false};task.pipeline.spent_ms=(task.pipeline.spent_ms??0)+elapsed(review);save();
      event({kind:'desktop_review_cancelled',task_id:id,review_id:lease.id});return result;
    });
  }
  return {async handle(id,input){
    try{if(input?.action==='claim')return await claim(id,input);if(input?.action==='report')return await report(id,input);if(input?.action==='cancel')return cancel(id,input);throw fail('Operação de revisão inválida.',400);}
    catch(error){store.refresh(db,true);throw error;}
  }};
}
