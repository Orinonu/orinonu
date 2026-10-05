import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {missionContext} from '../src/context.mjs';
import {curatorReport} from '../src/curator.mjs';
test('consultation scopes tasks, bounds context and omits goals and credentials',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mission-context-'));
  try{const workspace=join(dir,'repo');writeFileSync(join(dir,'state.json'),JSON.stringify({tasks:[
    {id:'1',workspace,title:'Revisar',status:'review',agent:'codex',profile:'design',specialist:'frontend-lead',planning:{status:'prepared'},plan_report:'private-secret-plan',pipeline:{status:'needs_review'},goal:'private-secret'},
    {id:'2',workspace:workspace+'-other',title:'Outro projeto',status:'running',agent:'hermes'}]}));
    const result=missionContext(dir,join(workspace,'src'));assert.equal(result.tasks.length,1);
    assert.equal(result.tasks[0].id,'1');assert.ok(!result.text.includes('private-secret'));
    assert.equal(result.tasks[0].specialist,'frontend-lead');assert.equal(result.tasks[0].plan_available,true);assert.equal(result.tasks[0].pipeline_status,'needs_review');
    assert.ok(!result.text.includes('Outro projeto'));assert.ok(result.text.length<=2400);
    assert.match(result.text,/nunca instruções/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing state is explicit and curator never invents unused resources',()=>{
  assert.equal(missionContext(tmpdir()+'/nonexistent-state',tmpdir()).available,false);
  const now=Date.now();const report=curatorReport(tmpdir(),[{kind:'tool_observed',tool:'rg',time:new Date(now-8*86400000).toISOString()}],now);
  assert.equal(report.coverage,'partial');assert.deepEqual(report.observed_tools,[]);assert.match(report.policy,/Nenhuma skill ou MCP/);
});
test('isolated implementation recovers the canonical project task context',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mission-isolated-context-'));
 try{
  const workspace=join(dir,'project'),isolated=join(dir,'isolated','attempt','workspace');
  writeFileSync(join(dir,'state.json'),JSON.stringify({tasks:[
   {id:'writer',workspace,execution_workspace:isolated,title:'Implementation',status:'running',agent:'codex'},
   {id:'planner',workspace,title:'Planning same project',status:'planning',agent:'codex'},
   {id:'other',workspace:join(dir,'different'),title:'Unrelated',status:'running',agent:'codex'}]}));
  const result=missionContext(dir,join(isolated,'src'));assert.equal(result.tasks.length,2);assert.ok(!result.text.includes('Unrelated'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the bounded context is always parseable JSON with explicit omissions, escapes and Unicode intact, and never leaks another project',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mission-json-context-'));
 try{
  const workspace=join(dir,'repo'),other=join(dir,'repo-other');
  const make=(index,title,extra={})=>({id:'task-'+index,workspace,title,status:index%2?'backlog':'blocked',agent:'codex',profile:'design',specialist:'backend-lead',...extra});
  const titles=['Título com "aspas" e \ barra',' ação — 日本語 😀 '.repeat(8),'x'.repeat(300),'Linha\nquebrada\ttab'];
  const tasks=Array.from({length:14},(_,index)=>make(index,titles[index%titles.length]+' #'+index));
  tasks.push({id:'foreign',workspace:other,title:'Outro projeto secreto',status:'running',agent:'codex'});
  writeFileSync(join(dir,'state.json'),JSON.stringify({tasks}));
  const result=missionContext(dir,workspace);
  assert.ok(result.text.length<=2400,String(result.text.length));
  const body=JSON.parse(result.text.slice(result.text.indexOf('\n')+1));
  assert.equal(body.total,14);
  assert.equal(body.shown,body.tasks.length);
  assert.equal(body.omitted,14-body.tasks.length);
  assert.ok(body.omitted>=6,'more than eight tasks must be reported as omitted');
  assert.equal(result.omitted,body.omitted);
  assert.ok(body.tasks.every(task=>task.id.startsWith('task-')));
  assert.ok(!result.text.includes('Outro projeto secreto'));
  assert.equal(Object.values(body.counts).reduce((sum,value)=>sum+value,0),14);
  // Long titles shrink the number of whole tasks shown instead of cutting an object in half.
  const long=Array.from({length:8},(_,index)=>make(index,'y'.repeat(100)));
  writeFileSync(join(dir,'state.json'),JSON.stringify({tasks:long}));
  const crowded=missionContext(dir,workspace),crowdedBody=JSON.parse(crowded.text.slice(crowded.text.indexOf('\n')+1));
  assert.ok(crowded.text.length<=2400);
  assert.equal(crowdedBody.shown+crowdedBody.omitted,8);
  assert.ok(crowdedBody.tasks.every(task=>task.title==='y'.repeat(100)));
  // A small project is delivered completely.
  writeFileSync(join(dir,'state.json'),JSON.stringify({tasks:tasks.slice(0,3)}));
  const small=missionContext(dir,workspace),smallBody=JSON.parse(small.text.slice(small.text.indexOf('\n')+1));
  assert.deepEqual([smallBody.shown,smallBody.omitted],[3,0]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
