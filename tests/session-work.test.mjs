import test from 'node:test';
import assert from 'node:assert/strict';
import {applySessionWork,hasActiveSessionWork,sessionWorkProgress,sessionWorkOccupants,assertSessionWorkspace} from '../src/session-work.mjs';
const task=()=>({id:'task',status:'backlog',goal:'Preservar objetivo',acceptance:'Testes',implementation_evidence:{unchanged:true},integration:{status:'pending'}});
const claim={action:'claim',session_id:'session-1',owner:'frontend',phase:'implementation',checklist:Array.from({length:10},(_,i)=>({id:'i'+i,label:'Item '+i,done:false}))};
test('claim is pure and rejects active attempts, queues and other session owners',()=>{
 const original=task(),reserved=applySessionWork(original,claim);
 assert.equal(original.external_work,undefined);assert.equal(hasActiveSessionWork(reserved),true);
 for(const row of [{...task(),queue:{}},{...task(),attempt:{state:'starting'}},{...task(),status:'planning'},{...task(),status:'running'},{...task(),status:'reviewing'}])assert.throws(()=>applySessionWork(row,claim),{status:409});
 assert.throws(()=>applySessionWork(reserved,{...claim,session_id:'session-2'}),{status:409});
 assert.throws(()=>applySessionWork(reserved,{...claim,owner:'backend'}),{status:409});
 assert.deepEqual(applySessionWork(reserved,claim),reserved);
});
test('real checklist updates yield 10% then 20% and cannot remove pending work',()=>{
 let reserved=applySessionWork(task(),claim);
 const update={...claim,action:'update',checklist:structuredClone(claim.checklist)};update.checklist[0].done=true;
 reserved=applySessionWork(reserved,update);assert.equal(sessionWorkProgress(reserved.external_work).percent,10);
 update.checklist[1].done=true;reserved=applySessionWork(reserved,update);assert.equal(sessionWorkProgress(reserved.external_work).percent,20);
 assert.throws(()=>applySessionWork(reserved,{...update,checklist:update.checklist.slice(0,2)}),{status:409});
 assert.throws(()=>applySessionWork(reserved,{...claim,action:'release',outcome:'completed'}),{status:409});
});
test('completed external work requires review and never claims integration or changes requirements',()=>{
 const original=task();let reserved=applySessionWork(original,claim);
 reserved=applySessionWork(reserved,{...claim,action:'update',checklist:claim.checklist.map(item=>({...item,done:true}))});
 const completed=applySessionWork(reserved,{...claim,action:'release',outcome:'completed'});
 assert.equal(completed.status,'review');assert.equal(completed.external_work.status,'ready_for_integration');assert.equal(hasActiveSessionWork(completed),false);
 for(const key of ['goal','acceptance','integration','implementation_evidence'])assert.deepEqual(completed[key],original[key]);
});
test('cancel releases reservation without completing task and empty checklist is indeterminate',()=>{
 const reserved=applySessionWork(task(),{...claim,checklist:[]});
 assert.equal(sessionWorkProgress(reserved.external_work).percent,null);
 assert.equal(applySessionWork(reserved,{...claim,action:'release',outcome:'cancelled'}).status,'backlog');
 assert.throws(()=>applySessionWork(reserved,{...claim,action:'release',outcome:'completed'}),{status:409});
});

test('session workspace conflicts reject writers in same/nested paths and allow readers or isolated work',()=>{
 const original={...task(),workspace:'C:/project'};
 const readers=[{task_id:'other',phase:'planning',workspace:'C:/project/src'}];
 assert.doesNotThrow(()=>assertSessionWorkspace(original,'planning',readers));
 assert.throws(()=>assertSessionWorkspace(original,'implementation',readers),{status:409});
 const writer=[{task_id:'other',phase:'implementation',workspace:'C:/project/src'}];
 assert.throws(()=>assertSessionWorkspace(original,'review',writer),{status:409});
 assert.doesNotThrow(()=>assertSessionWorkspace(original,'implementation',writer,'C:/isolated/task'));
 const reserved=applySessionWork(original,claim);
 assert.deepEqual(sessionWorkOccupants([reserved,original]),[{task_id:'task',phase:'implementation',workspace:'C:/project'}]);
});

test('opportunity audit cannot claim external writable or review execution',()=>{
 for(const phase of ['implementation','review'])assert.throws(()=>applySessionWork({...task(),opportunity_audit:true},{...claim,phase}),{status:409});
 assert.equal(applySessionWork({...task(),opportunity_audit:true},{...claim,phase:'planning'}).external_work.phase,'planning');
});

test('completed session receipt is idempotent, preserves host evidence and never reserves a workspace',()=>{
 const original=task(),record={...claim,action:'record',phase:'review',checklist:claim.checklist.map(item=>({...item,done:true}))};
 const result=applySessionWork(original,record);
 assert.equal(result.status,'review');assert.equal(result.external_work.status,'ready_for_integration');
 assert.deepEqual(sessionWorkOccupants([result]),[]);
 assert.deepEqual(applySessionWork(result,record),result);
 for(const key of ['goal','acceptance','integration','implementation_evidence'])assert.deepEqual(result[key],original[key]);
 for(const row of [{...original,queue:{}},{...original,attempt:{state:'outcome_unknown'}},{...original,status:'done'},{...original,archived_at:'now'},applySessionWork(original,claim)])assert.throws(()=>applySessionWork(row,record),{status:409});
 assert.throws(()=>applySessionWork(original,{...record,phase:'implementation'}),{status:400});
 assert.throws(()=>applySessionWork(original,{...record,checklist:claim.checklist}),{status:409});
});
