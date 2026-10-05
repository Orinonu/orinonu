import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {acceptance,mission,wait,sleep} from './harness.mjs';

const receipt=(workspace,extra={})=>mission(workspace,{status:'review',title:'Receipt mission',
  external_work:{session_id:'session-1',owner:'codex-session',phase:'review',status:'ready_for_integration',recorded_at:'2026-10-04T20:00:00.000Z',checklist:[{id:'a',label:'Add the currency module',done:true},{id:'b',label:'Cover it with tests',done:true}]},...extra});
const promptOf=entry=>entry.args.at(-1)==='-'?entry.child.stdinText:entry.args.at(-1);
const digestOf=entry=>/Snapshot preparado pelo host para revisão: ([a-f0-9]{64})/.exec(promptOf(entry))?.[1];
const finish=(entry,contract)=>{
 entry.child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'```nexo-review\n'+JSON.stringify(contract)+'\n```'}})+'\n');
 entry.child.emit('close',0);
};
const approved=(snapshot,evidence=['file.txt:1 contains the module','node --test passes (330/330)'])=>({version:1,snapshot_digest:snapshot.snapshot_digest,criteria_hash:snapshot.criteria.hash,decision:'approved',reason:'Verified against the workspace.',
 checks:snapshot.criteria.items.map(item=>({criterion_id:item.id,criterion:item.text,status:'passed',evidence}))});
const row=async(f,id)=>(await f.state()).tasks.find(t=>t.id===id);

test('a session receipt is verified by an independent read-only review and completes with its own label',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{tasks:[w=>receipt(w,{id})]});
 await wait(()=>f.children.length===1,20000);
 const entry=f.children[0];
 assert.equal(entry.args[entry.args.indexOf('--sandbox')+1],'read-only');
 assert.match(promptOf(entry),/Revisão independente de um recibo de sessão/);
 assert.match(promptOf(entry),/Add the currency module/);
 assert.equal(entry.options.cwd,f.workspace);
 const digest=digestOf(entry);assert.ok(digest);
 const snapshot=(await row(f,id)).review_snapshot;
 assert.deepEqual(snapshot.criteria.items,[{id:'c1',text:'Tests pass'},{id:'r:a',text:'Add the currency module'},{id:'r:b',text:'Cover it with tests'}]);
 finish(entry,approved(snapshot));
 await wait(async()=>(await row(f,id)).status==='done',20000);
 const done=await row(f,id);
 assert.equal(done.completion.kind,'session_receipt_verified');assert.equal(done.completion.label,'Entrega de sessão verificada');
 assert.deepEqual(done.completion.evidence_refs,['file.txt']);assert.match(done.completion.workspace_fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(done.receipt_review.status,'approved');
 assert.ok(f.events().some(e=>e.kind==='receipt_verified'&&e.task_id===id));
 // The receipt is reviewed exactly once; whatever the completion triggers elsewhere never reviews it again.
 await sleep(2500);
 assert.equal(f.children.filter(child=>/Revisão independente de um recibo/.test(promptOf(child))).length,1);
});

test('a review that cites a file that does not exist rejects the receipt and hands it to a person; re-verifying runs it again',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{tasks:[w=>receipt(w,{id})]});
 await wait(()=>f.children.length===1,20000);
 finish(f.children[0],approved((await row(f,id)).review_snapshot,['src/ghost-module.mjs:10 implements it']));
 await wait(async()=>(await row(f,id)).receipt_review?.status==='rejected',20000);
 const rejected=await row(f,id);
 assert.equal(rejected.status,'blocked');assert.match(rejected.error,/não existe no workspace: src\/ghost-module\.mjs/);
 assert.equal(rejected.completion,undefined);
 const flow=(await f.get('/api/flow'))[0];
 assert.equal(flow.gates.find(g=>g.task_id===id).reason,'session_receipt_rejected');
 await sleep(2500);
 assert.equal(f.children.filter(child=>/Revisão independente de um recibo/.test(promptOf(child))).length,1);
 const [item]=(await f.get('/api/decisions')).items.filter(i=>i.task_id===id);
 assert.equal(item.kind,'session_receipt_rejected');assert.deepEqual(item.options.map(o=>o.id),['reverify','archive']);
 assert.equal((await f.request(`/api/decisions/${item.id}/answer`,{request_id:'rv1',option_id:'reverify'})).status,200);
 await wait(()=>f.children.filter(child=>/Revisão independente de um recibo/.test(promptOf(child))).length===2,20000);
 const second=f.children.filter(child=>/Revisão independente de um recibo/.test(promptOf(child)))[1];
 finish(second,approved((await row(f,id)).review_snapshot));
 await wait(async()=>(await row(f,id)).status==='done',20000);
});

test('a review that leaves a checklist item unproven does not complete the receipt',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{tasks:[w=>receipt(w,{id})]});
 await wait(()=>f.children.length===1,20000);
 const contract=approved((await row(f,id)).review_snapshot);
 finish(f.children[0],{...contract,checks:contract.checks.map(check=>check.criterion_id==='r:b'?{...check,status:'unknown',evidence:[]}:check)});
 await wait(async()=>(await row(f,id)).receipt_review?.status==='rejected',20000);
 assert.match((await row(f,id)).receipt_review.reason,/Revisão sem|não comprovou|Aprovação exige/);
 assert.notEqual((await row(f,id)).status,'done');
});

test('a review that dies midway is retried later instead of rejecting the receipt',async t=>{
 const id=randomUUID();
 const f=await acceptance(t,{tasks:[w=>receipt(w,{id})]});
 await wait(()=>f.children.length===1,20000);
 f.children[0].child.emit('close',1);
 await wait(async()=>(await row(f,id)).receipt_review?.status==='failed',20000);
 const failed=await row(f,id);
 assert.equal(failed.completion,undefined);
 const flow=(await f.get('/api/flow'))[0];
 assert.equal(flow.gates.some(g=>g.task_id===id),false);
 assert.equal(flow.waiting.find(w=>w.task_id===id).reason,'session_receipt');
});

test('native receipt review cannot approve a checklist without covering the authorized acceptance criteria',async t=>{
 const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,{id,acceptance:'Reject unauthenticated requests; Prevent cross-project data access'})]});
 await wait(()=>f.children.length===1,20000);
 finish(f.children[0],{version:1,snapshot_digest:digestOf(f.children[0]),decision:'approved',reason:'Checklist only',checks:[{criterion:'Add the currency module',status:'passed',evidence:['file.txt:1']},{criterion:'Cover it with tests',status:'passed',evidence:['file.txt:1']}]});
 await wait(async()=>['approved','rejected'].includes((await row(f,id)).receipt_review?.status),20000);
 const current=await row(f,id);
 assert.equal(current.receipt_review.status,'rejected');
 assert.equal(current.status,'blocked');
 assert.equal(current.completion,undefined);
});

test('a session receipt is reviewed in the canonical workspace even when an old isolated attempt remains attached',async t=>{
 const id=randomUUID(),f=await acceptance(t,{tasks:[workspace=>receipt(workspace,{id,implementation_workspace:{workspace:workspace+'-old-isolated'},implementation_run:{attempt_id:'old-attempt'},integration:{status:'awaiting_review'}})]});
 await wait(()=>f.children.length===1,8000);
 assert.equal(f.children[0].options.cwd,f.workspace);
 assert.match(promptOf(f.children[0]),/Revisão independente de um recibo de sessão/);
 finish(f.children[0],approved((await row(f,id)).review_snapshot));
 await wait(async()=>(await row(f,id)).status==='done',8000);
 assert.equal((await row(f,id)).completion.kind,'session_receipt_verified');
 assert.notEqual((await row(f,id)).integration?.status,'merged');
});
