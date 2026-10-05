import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {queryTasks,projectOf,MAX_LIMIT,FIELDS} from '../src/task-query.mjs';
import {createStore} from '../src/store.mjs';
import {createMissionServer} from '../src/server.mjs';

const row=(workspace,index,extra={})=>({id:'t'+String(index).padStart(3,'0'),workspace,title:'Mission '+index,goal:'Goal '+index+' '+'g'.repeat(900),acceptance:'Accept '+index,status:['backlog','blocked','review','done'][index%4],agent:'codex',profile:'design',specialist:'generalist',created_at:new Date(Date.UTC(2026,9,4,10,0,index)).toISOString(),plan_report:index%2?'SECRET-REPORT-'+index:undefined,revision:index,...extra});

test('pages cover exactly the expected set, in a stable order, with total and an explicit incomplete flag',()=>{
 const tasks=Array.from({length:23},(_,index)=>row('/p',index)).concat(Array.from({length:5},(_,index)=>row('/other',100+index)));
 const seen=[];let cursor,pages=0,first;
 do{
  const page=queryTasks(tasks,{workspace:'/p',limit:'10',cursor});
  first??=page;pages++;seen.push(...page.items.map(item=>item.id));
  assert.equal(page.total,23);
  assert.equal(page.incomplete,page.next_cursor!==null);
  cursor=page.next_cursor??undefined;
 }while(cursor);
 assert.equal(pages,3);
 assert.deepEqual(seen,tasks.filter(t=>t.workspace==='/p').map(t=>t.id));
 assert.equal(new Set(seen).size,23);
 assert.equal(first.returned,10);
 assert.equal(first.incomplete,true);
});

test('filters by state, allows only listed fields and omits reports and full requirements unless asked',()=>{
 const tasks=Array.from({length:12},(_,index)=>row('/p',index));
 const page=queryTasks(tasks,{workspace:'/p',status:'blocked,review'});
 assert.deepEqual([...new Set(page.items.map(item=>item.status))].sort(),['blocked','review']);
 assert.equal(page.total,tasks.filter(t=>['blocked','review'].includes(t.status)).length);
 const serialized=JSON.stringify(queryTasks(tasks,{workspace:'/p'}));
 assert.doesNotMatch(serialized,/SECRET-REPORT|Goal 1 |Accept/);
 const asked=queryTasks(tasks,{workspace:'/p',fields:'id,goal,plan_available'});
 assert.deepEqual(Object.keys(asked.items[0]),['id','goal','plan_available']);
 assert.ok(asked.items[0].goal.length<=600);
 assert.doesNotMatch(JSON.stringify(asked),/SECRET-REPORT/);
 assert.ok(!FIELDS.includes('plan_report'));
 for(const bad of [{fields:'plan_report'},{fields:'id,secret'},{status:'nonsense'},{limit:'0'},{limit:String(MAX_LIMIT+1)},{limit:'2.5'},{limit:'abc'},{cursor:'not-a-cursor'}])assert.throws(()=>queryTasks(tasks,{workspace:'/p',...bad}),error=>error.status===400,JSON.stringify(bad));
 assert.throws(()=>queryTasks(tasks,{}),error=>error.status===400);
});

test('another project is never visible and an unknown project is explicitly unknown, not empty-by-accident',()=>{
 const tasks=[row('/p',1),row('/other',2,{title:'Foreign mission'})];
 const page=queryTasks(tasks,{workspace:'/p'});
 assert.doesNotMatch(JSON.stringify(page),/Foreign/);
 const unknown=queryTasks(tasks,{workspace:'/nowhere'});
 assert.deepEqual([unknown.total,unknown.items.length,unknown.scope.known_project],[0,0,false]);
});

test('a folder inside the project and the isolated copy of a writer resolve to the same project',()=>{
 const tasks=[row('/p',1,{execution_workspace:'/iso/attempt/workspace'}),row('/other',2)];
 assert.equal(projectOf(tasks,'/p/src/deep'),'/p');
 assert.equal(projectOf(tasks,'/iso/attempt/workspace/src'),'/p');
 assert.equal(projectOf(tasks,'/elsewhere'),null);
 assert.equal(queryTasks(tasks,{workspace:'/iso/attempt/workspace/src'}).items[0].id,'t001');
});

test('a cursor is refused once the scoped set changed, and keeps working while it did not',()=>{
 const tasks=Array.from({length:6},(_,index)=>row('/p',index));
 const first=queryTasks(tasks,{workspace:'/p',limit:'2'});
 assert.equal(queryTasks(tasks,{workspace:'/p',limit:'2',cursor:first.next_cursor}).returned,2);
 const changed=tasks.map(t=>t.id==='t003'?{...t,revision:99}:t);
 assert.throws(()=>queryTasks(changed,{workspace:'/p',limit:'2',cursor:first.next_cursor}),error=>error.status===409&&error.code==='cursor_invalidated');
 assert.throws(()=>queryTasks(tasks.concat(row('/p',9)),{workspace:'/p',limit:'2',cursor:first.next_cursor}),error=>error.status===409);
 assert.equal(queryTasks(tasks.concat(row('/other',9)),{workspace:'/p',limit:'2',cursor:first.next_cursor}).returned,2);
 assert.throws(()=>queryTasks(tasks,{workspace:'/p',status:'done',limit:'2',cursor:first.next_cursor}),error=>error.status===409);
});

test('the HTTP query is read-only: it persists nothing, appends no event and agrees with the paginated expectation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-query-')),workspace=join(dir,'project'),other=join(dir,'other'),dataDir=join(dir,'state');mkdirSync(workspace);mkdirSync(other);
 const store=createStore(dataDir,{tasks:[],profiles:{}}),db=store.load();
 db.tasks=[...Array.from({length:7},(_,index)=>row(workspace,index)),row(other,50,{title:'Foreign mission'})];
 store.save(db);store.close();
 const app=createMissionServer({dataDir,codexPath:process.execPath});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const eventsFile=join(dataDir,'events.ndjson');
 const size=()=>existsSync(eventsFile)?readFileSync(eventsFile,'utf8').length:0;
 const before=JSON.stringify((await(await fetch(app.url+'/api/state')).json()).tasks.map(task=>[task.id,task.revision]));
 const eventsBefore=size();
 const ids=[];let cursor,calls=0;
 do{
  const response=await fetch(app.url+'/api/tasks?workspace='+encodeURIComponent(workspace)+'&limit=3'+(cursor?'&cursor='+cursor:''));
  assert.equal(response.status,200);
  const page=await response.json();calls++;ids.push(...page.items.map(item=>item.id));cursor=page.next_cursor??undefined;
  assert.doesNotMatch(JSON.stringify(page),/Foreign|SECRET-REPORT/);
 }while(cursor);
 assert.equal(calls,3);
 assert.equal(ids.length,7);
 assert.equal((await fetch(app.url+'/api/tasks?workspace='+encodeURIComponent(workspace)+'&limit=0')).status,400);
 assert.equal((await fetch(app.url+'/api/tasks')).status,400);
 assert.equal(size(),eventsBefore);
 assert.equal(JSON.stringify((await(await fetch(app.url+'/api/state')).json()).tasks.map(task=>[task.id,task.revision])),before);
});
