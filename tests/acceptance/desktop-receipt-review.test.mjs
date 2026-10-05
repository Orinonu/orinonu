import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createMissionServer} from '../../src/server.mjs';
import {acceptance,mission,sleep} from './harness.mjs';

const receipt=(workspace,id)=>mission(workspace,{id,status:'review',acceptance:'The fix is covered by regression tests; The local interface remains compatible',external_work:{session_id:'implementer',owner:'devin',phase:'implementation',status:'ready_for_integration',released_at:'2026-10-05T12:00:00Z',checklist:[{id:'code',label:'Implement the fix',done:true},{id:'tests',label:'Add regression tests',done:true}]}});
const reviewer={session_id:'reviewer-2',owner:'devin'};
const reportFor=(order,changes={})=>'```nexo-review\n'+JSON.stringify({version:1,snapshot_digest:order.snapshot_digest,criteria_hash:order.criteria.hash,decision:'approved',reason:'Reviewed the fixture and requirements.',checks:order.criteria.items.map(item=>({criterion_id:item.id,criterion:item.text,status:'passed',evidence:['file.txt:1 contains the reviewed fixture']})),...changes})+'\n```';
const submit=(f,id,order,report=reportFor(order),extra={})=>f.request(`/api/tasks/${id}/session-review`,{action:'report',...reviewer,review_id:order.review_id,review_token:order.review_token,report,...extra});

test('the implementer cannot reserve its own receipt; an independent Desktop session reserves read-only without an executor',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'});
  const path=`/api/tasks/${id}/session-review`;
  const self=await f.request(path,{action:'claim',session_id:'implementer',owner:'renamed-owner'});
  assert.equal(self.status,409);
  const claim=await f.request(path,{action:'claim',...reviewer,ttl_seconds:120});
  assert.equal(claim.status,201);
  const order=await claim.json();
  assert.equal(order.phase,'review');assert.equal(order.read_only,true);
  assert.equal(order.mission.id,id);assert.match(order.review_id,/^[a-f0-9-]{36}$/);
  assert.match(order.review_token,/^[a-f0-9]{64}$/);
  assert.equal(order.criteria.items.length,4);
  assert.match(order.instructions,/read.only|somente leitura/i);
  assert.equal(f.children.length,0);
  const task=(await f.state()).tasks.find(row=>row.id===id);
  assert.equal(task.desktop_review.status,'active');
  assert(!JSON.stringify(task).includes(order.review_token));
  const competing=await f.request(path,{action:'claim',session_id:'reviewer-3',owner:'devin'});
  assert.equal(competing.status,409);
});

test('a fully covered independent report verifies only the session receipt and replays without repeating effects',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'});
  const order=await(await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).json();
  const response=await submit(f,id,order);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.ok,true);assert.equal(result.completion.kind,'session_receipt_verified');
  assert.equal(result.completion.receipt_digest,order.receipt_digest);
  const task=(await f.state()).tasks.find(row=>row.id===id);
  assert.equal(task.status,'done');assert.equal(task.desktop_review.status,'approved');
  assert.equal(task.integration,undefined);
  assert.equal(task.completion.reviewer_session_id,'reviewer-2');
  assert.equal((await f.state()).comparison.proven_saved_usd,null);
  const replay=await submit(f,id,order);
  assert.equal(replay.status,200);assert.deepEqual(await replay.json(),result);
  assert.equal(f.events().filter(e=>e.kind==='desktop_receipt_verified'&&e.task_id===id).length,1);
  assert.equal(f.children.length,0);
});

test('only the lease holder can report or cancel and cancellation permits a new independent reviewer without completing work',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'}),path=`/api/tasks/${id}/session-review`;
  const order=await(await f.request(path,{action:'claim',...reviewer})).json();
  assert.equal((await submit(f,id,order,reportFor(order),{review_token:'0'.repeat(64)})).status,409);
  assert.equal((await submit(f,id,order,reportFor(order),{session_id:'foreign-reviewer'})).status,409);
  const cancel={action:'cancel',...reviewer,review_id:order.review_id,review_token:order.review_token};
  assert.equal((await f.request(path,{...cancel,owner:'foreign-owner'})).status,409);
  assert.equal((await f.request(path,cancel)).status,200);
  assert.equal((await f.request(path,cancel)).status,200);
  assert.equal((await submit(f,id,order)).status,409);
  const current=(await f.state()).tasks.find(task=>task.id===id);
  assert.equal(current.status,'review');assert.equal(current.completion,undefined);
  assert.equal(current.desktop_review.status,'cancelled');
  assert.equal((await f.request(path,{action:'claim',session_id:'reviewer-3',owner:'devin'})).status,201);
});

test('a Desktop review reserves canonical reads against session writers and native restarts of the same mission',async t=>{
  const id=randomUUID(),otherId=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id),w=>mission(w,{id:otherId})],mode:'supervised'});
  const path=`/api/tasks/${id}/session-review`,order=await(await f.request(path,{action:'claim',...reviewer})).json();
  const writer={action:'claim',phase:'implementation',session_id:'writer-3',owner:'devin',checklist:[{id:'edit',label:'Edit scoped code',done:false}]};
  assert.equal((await f.request(`/api/tasks/${otherId}/session-work`,writer)).status,409);
  assert.equal((await f.request(`/api/tasks/${id}/session-work`,writer)).status,409);
  assert.equal((await f.request(`/api/tasks/${id}/run`,{})).status,409);
  assert.equal((await f.request(`/api/tasks/${id}`,{acceptance:'A changed requirement'},'PATCH')).status,409);
  assert.equal((await f.state()).scheduler.running.review,1);
  assert.equal((await f.request(path,{action:'cancel',...reviewer,review_id:order.review_id,review_token:order.review_token})).status,200);
  assert.equal((await f.request(`/api/tasks/${otherId}/session-work`,writer)).status,200);
});

test('rejected and abstained Desktop reports never complete a mission or silently authorize another review',async t=>{
  for(const decision of ['rejected','abstained']){
    const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'}),path=`/api/tasks/${id}/session-review`;
    const order=await(await f.request(path,{action:'claim',...reviewer})).json();
    assert.equal((await submit(f,id,order,reportFor(order,{decision}))).status,200);
    const current=(await f.state()).tasks.find(task=>task.id===id);
    assert.equal(current.status,'blocked');assert.equal(current.completion,undefined);
    assert.equal(current.receipt_review.status,'rejected');
    assert.equal((await f.request(path,{action:'claim',session_id:'another-reviewer',owner:'devin'})).status,409);
  }
});

test('Desktop approval rejects incomplete, foreign, duplicated criteria and missing or private file evidence',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'});
  const order=await(await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).json();
  const contract=JSON.parse(reportFor(order).split('\n')[1]);
  const bad=[
    {criteria_hash:'0'.repeat(64)},
    {snapshot_digest:'0'.repeat(64)},
    {checks:contract.checks.slice(0,-1)},
    {checks:contract.checks.map((check,index)=>index===0?{...check,criterion_id:'foreign'}:check)},
    {checks:[...contract.checks,contract.checks[0]]},
    {checks:contract.checks.map(check=>({...check,status:'unknown',evidence:[]}))},
    {checks:contract.checks.map(check=>({...check,criterion:'Unrelated goal'}))},
    {checks:contract.checks.map(check=>({...check,evidence:['ghost.txt:1']}))},
    {checks:contract.checks.map(check=>({...check,evidence:['credentials.toml:1']}))},
  ];
  writeFileSync(join(f.workspace,'credentials.toml'),'test-private-value');
  for(const changes of bad){
    assert.equal((await submit(f,id,order,reportFor(order,changes))).status,400);
    assert.equal((await f.state()).tasks.find(task=>task.id===id).completion,undefined);
  }
  assert.equal((await submit(f,id,order)).status,200);
});

test('a changed workspace invalidates the Desktop report instead of inferring success',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'});
  const order=await(await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).json();
  writeFileSync(join(f.workspace,'file.txt'),'changed after reservation');
  assert.equal((await submit(f,id,order)).status,409);
  const current=(await f.state()).tasks.find(task=>task.id===id);
  assert.equal(current.status,'review');assert.equal(current.completion,undefined);
});

test('a Desktop review lease survives supervisor restart and an expired lease never accepts a report',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'}),path=`/api/tasks/${id}/session-review`;
  const order=await(await f.request(path,{action:'claim',...reviewer})).json();
  await f.app.close();
  const next=createMissionServer({dataDir:f.dataDir,codexPath:process.execPath});await next.listen(0);
  try{
    const request=body=>fetch(next.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await request({action:'claim',session_id:'foreign',owner:'devin'})).status,409);
    assert.equal((await request({action:'cancel',...reviewer,review_id:order.review_id,review_token:order.review_token})).status,200);
    const short=await(await request({action:'claim',...reviewer,ttl_seconds:1})).json();
    await sleep(1200);
    assert.equal((await request({action:'report',...reviewer,review_id:short.review_id,review_token:short.review_token,report:reportFor(short)})).status,409);
    assert.equal((await request({action:'claim',session_id:'reviewer-3',owner:'devin'})).status,201);
  }finally{await next.close();}
});

test('Desktop review uses the shared review capacity and mission launch allowance',async t=>{
  const first=randomUUID(),second=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,first),w=>receipt(w,second)],mode:'supervised',scheduler:{review_limit:1}});
  assert.equal((await f.request(`/api/tasks/${first}/session-review`,{action:'claim',...reviewer})).status,201);
  assert.equal((await f.request(`/api/tasks/${second}/session-review`,{action:'claim',...reviewer})).status,409);
  const limited=randomUUID(),g=await acceptance(t,{tasks:[w=>({...receipt(w,limited),launches:8})],mode:'supervised'});
  assert.equal((await g.request(`/api/tasks/${limited}/session-review`,{action:'claim',...reviewer})).status,409);
});

test('a Desktop review cannot override a depleted time budget even when auto implementation is disabled',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>({...receipt(w,id),max_minutes:1,pipeline:{auto_implement:false,budget_minutes:1,spent_ms:60000}})],mode:'supervised'});
  assert.equal((await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer,ttl_seconds:1})).status,400);
  assert.equal((await f.state()).tasks.find(task=>task.id===id).desktop_review,undefined);
});

test('an active Desktop review is visible as session work rather than a stalled receipt even while the CLI quota is paused',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],seed:raw=>raw.prepare('INSERT INTO entities VALUES(?,?,0)').run('meta/executor_pause',JSON.stringify({status:'paused',reason:'usage_limit',provider:'codex',probe_at_ms:Date.now()+600000,resume_at_ms:Date.now()+600000}))});
  assert.equal((await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).status,201);
  const flow=(await f.get('/api/flow'))[0];
  assert.equal(flow.health.counts.running,1);assert.equal(flow.health.counts.stalled,0);
  assert.equal((await f.state()).executor_pause.status,'paused');
  assert.equal(f.children.length,0);
});

test('Desktop review refuses acceptance that cannot be covered completely within the criterion contract limits',async t=>{
  for(const acceptanceText of ['A'.repeat(501),Array.from({length:41},(_,i)=>`Requirement ${i+1}`).join('\n')]){
    const id=randomUUID(),f=await acceptance(t,{tasks:[w=>({...receipt(w,id),acceptance:acceptanceText})],mode:'supervised'});
    assert.equal((await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).status,400);
    assert.equal((await f.state()).tasks.find(task=>task.id===id).desktop_review,undefined);
  }
});

test('concurrent identical Desktop reports return one durable result and produce one completion effect',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'});
  for(let i=0;i<100;i++)writeFileSync(join(f.workspace,`fixture-${i}.txt`),'independent fixture');
  const order=await(await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).json();
  const replies=await Promise.all([submit(f,id,order),submit(f,id,order)]);
  assert.deepEqual(replies.map(reply=>reply.status),[200,200]);
  const first=await replies[0].json(),second=await replies[1].json();
  assert.deepEqual(first,second);assert.equal(first.completion.receipt_digest,order.receipt_digest);
  assert.equal(f.events().filter(event=>event.kind==='desktop_receipt_verified').length,1);
});

test('local agent configurations remain outside the review snapshot and cannot serve as approval evidence',async t=>{
  const id=randomUUID(),f=await acceptance(t,{tasks:[w=>receipt(w,id)],mode:'supervised'});
  mkdirSync(join(f.workspace,'.devin'));
  writeFileSync(join(f.workspace,'.devin','mcp_config.local.json'),'{"private_fixture":"not-a-real-key"}');
  const order=await(await f.request(`/api/tasks/${id}/session-review`,{action:'claim',...reviewer})).json();
  assert.equal(Object.hasOwn(order.files,'.devin/mcp_config.local.json'),false);
  const checks=order.criteria.items.map(item=>({criterion_id:item.id,criterion:item.text,status:'passed',evidence:['.devin/mcp_config.local.json:1']}));
  assert.equal((await submit(f,id,order,reportFor(order,{checks}))).status,400);
});
