import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionServer } from '../src/server.mjs';

const delay = () => new Promise(resolve => setTimeout(resolve, 10));
async function fixture(run, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-transport-'));
  const children = [], decisions = [];
  const runner = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdin.resume();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kills = 0; child.kill = () => { child.kills++; child.emit('close', 0); return true; };
    children.push(child); return child;
  };
  const decisionEngine = {call: async (tool, input) => {
    decisions.push(input);
    return {ok:true,action:'recommend',selected_id:input.options?.[0]?.id};
  }};
  const app = createMissionServer({dataDir:dir,runner,codexPath:process.execPath,decisionEngine,...options});
  await app.listen(0);
  const request = async (path, body, method = 'POST') => fetch(app.url + path, {method,headers:{'Content-Type':'application/json'},body: typeof body === 'string' ? body : JSON.stringify(body)});
  const state = async () => (await fetch(app.url + '/api/state')).json();
  try { await run({dir,app,children,decisions,request,state}); }
  finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
}

test('HTTP endpoint preserves Unicode, enforces byte limits and reports malformed JSON without dispatch', async () => {
  await fixture(async ({dir,request,state,children}) => {
    const body = {workspace:dir,objective:'ação € 🐍 e\u0301',success_criteria:'🌈',repositories:[],research_focus:'Oxóssi'};
    for (const length of [39999,40000,40001]) {
      const withPadding = {...body,padding:''};
      withPadding.padding = 'x'.repeat(length - Buffer.byteLength(JSON.stringify(withPadding)));
      const raw = JSON.stringify(withPadding);
      assert.equal(Buffer.byteLength(raw), length);
      const response = await request('/api/project-direction', raw, 'PATCH');
      assert.equal(response.status, length > 40000 ? 413 : 200);
    }
    const response = await request('/api/project-direction', '{"private":"incomplete', 'PATCH');
    assert.equal(response.status,400); assert.deepEqual(await response.json(),{error:'JSON inválido.'});
    const snapshot = await state();
    assert.equal(snapshot.project_directions[0].objective,body.objective);
    assert.equal(snapshot.project_directions[0].success_criteria,body.success_criteria);
    assert.equal(children.length,0);
  });
});

test('NDJSON overflow invalidates earlier planner report, never queues implementation or recovery', async () => {
  await fixture(async ({dir,request,state,children,decisions}) => {
    const task = await (await request('/api/tasks',{title:'Transport regression',workspace:dir,goal:'Implement verified local changes',acceptance:'Tests pass',profile:'discovery',agent:'codex',max_minutes:1})).json();
    assert.equal((await request(`/api/tasks/${task.id}/prepare`,{auto_implement:true})).status,200);
    for(let n=0;n<100&&!children.length;n++)await delay();
    assert.equal(children.length,1);
    const child=children[0];
    child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Private earlier report'}})+'\n');
    assert.equal((await state()).tasks[0].plan_report,'Private earlier report');
    child.stdout.write(Buffer.from('x'.repeat(1025)));
    child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":999,"output_tokens":1}}\n');
    let snapshot;
    for(let n=0;n<100;n++){snapshot=await state();if(snapshot.tasks[0].status==='blocked')break;await delay();}
    const result=snapshot.tasks[0];
    assert.equal(result.status,'blocked');assert.equal(result.plan_report,null);
    assert.equal(result.structured_plan,null);assert.equal(result.review_contract,null);
    assert.equal(result.protocol_failure.code,'event_too_large');
    assert.equal(result.protocol_failure.attempt_id,result.attempt.id);
    assert.match(result.error,/protocolo/);assert.equal(child.kills,1);
    assert.equal(result.measurement.usage,null);assert.equal(result.queue,null);
    await delay();assert.equal(children.length,1);
    assert.ok(!decisions.some(row=>row.goal?.startsWith('Recuperação limitada')));
  },{maxEventBytes:1024});
});

test('NDJSON incomplete EOF and malformed event fail explicitly even when executor exits zero', async () => {
  for(const output of ['{"type":"turn.completed"','not-json\n']) {
    await fixture(async ({dir,request,state,children}) => {
      const task=await(await request('/api/tasks',{title:'EOF regression',workspace:dir,goal:'Research local transport',acceptance:'Complete report',profile:'discovery',agent:'codex',max_minutes:1})).json();
      await request(`/api/tasks/${task.id}/prepare`,{});
      for(let n=0;n<100&&!children.length;n++)await delay();
      children[0].stdout.write(output);children[0].emit('close',0);
      let result;for(let n=0;n<100;n++){result=(await state()).tasks[0];if(result.status==='blocked')break;await delay();}
      assert.equal(result.status,'blocked');assert.equal(result.protocol_failure.code,'invalid_json');
      assert.equal(result.integration.status,'blocked');assert.equal(result.plan_report,null);
    });
  }
});

test('invalid event limit fails before durable state is opened', () => {
  const dir=join(tmpdir(),'nexo-invalid-transport-'+Date.now());
  assert.throws(()=>createMissionServer({dataDir:dir,maxEventBytes:0}),RangeError);
  assert.equal(existsSync(dir),false);
});

test('recommendation endpoint deduplicates a validated batch without dispatching executors', async () => {
  await fixture(async ({dir,request,state,children}) => {
    const proposal={title:'Evidence based improvement',goal:'Improve the local transport',acceptance:'Regression passes',recommendation:'Use bounded framing',risk:'Compatibility must be verified',evidence:['src/server.mjs: existing transport']};
    const response=await request('/api/opportunities/propose',{workspace:dir,proposals:[proposal,proposal]});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{count:1});
    const repeat=await request('/api/opportunities/propose',{workspace:dir,proposals:[proposal]});
    assert.deepEqual(await repeat.json(),{count:0});
    const invalid=await request('/api/opportunities/propose',{workspace:dir,proposals:[{...proposal,title:'New entry'},{title:'Incomplete'}]});
    assert.equal(invalid.status,400);
    const snapshot=await state();
    assert.equal(snapshot.opportunities.filter(row=>row.source==='submitted_analysis').length,1);
    assert.equal(children.length,0);
  });
});
