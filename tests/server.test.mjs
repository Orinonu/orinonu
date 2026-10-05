import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionServer } from '../src/server.mjs';
test('Codex-only missions expose JEV abstention without launching or silently picking a plan',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nexo-plan-'));
  const app=createMissionServer({dataDir:dir,apiKey:'',codexPath:process.execPath,hermesPath:process.execPath});await app.listen(0);
  try{
    const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const input={title:'API',workspace:dir,goal:'Correct API',acceptance:'Tests pass',profile:'implementation',specialist:'generalist',max_minutes:10,agent:'codex',plan:true};
    assert.equal((await post('/api/tasks',{...input,agent:'hermes'})).status,400);
    const task=await(await post('/api/tasks',input)).json();
    assert.equal(task.planning.status,'needs_review');assert.equal(task.status,'backlog');
    const state=await(await fetch(app.url+'/api/state')).json();
    assert.deepEqual(state.integrations.filter(i=>i.status==='ready').map(i=>i.id),['codex']);
    assert.equal(state.policy.executor,'codex');
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('Kanban survives restart and metrics have no invented savings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-mission-'));
  let app = createMissionServer({ dataDir: dir }); await app.listen(0);
  const request = (path, options) => fetch(app.url + path, options);
  const created = await request('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:'Parser', workspace:dir, goal:'Preservar zero', acceptance:'npm test', agent:'codex', profile:'implementation', max_minutes:10}) });
  assert.equal(created.status,201); const task = await created.json();
  await app.close(); app=createMissionServer({dataDir:dir}); await app.listen(0);
  const state=await (await request('/api/state')).json();
  assert.equal(state.tasks[0].id,task.id); assert.equal(state.tasks[0].status,'backlog');
  assert.equal(state.metrics.saved_usd,null); assert.equal(state.metrics.saved_seconds,null);
  await app.close(); rmSync(dir,{recursive:true,force:true});
});
