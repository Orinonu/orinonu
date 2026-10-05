import test from 'node:test';
import assert from 'node:assert/strict';
import {startProgress,observeCodexProgress,completeMilestone,finishProgress} from '../src/progress.mjs';
test('session boundaries and tool events never invent task checklist progress',()=>{
 const progress=startProgress(true);
 assert.equal(progress.measurement_kind,'task_checklist');assert.equal(progress.items,null);
 for(let n=0;n<50;n++)observeCodexProgress(progress,{type:'item.completed',item:{type:'web_search'}});
 observeCodexProgress(progress,{type:'item.completed',item:{type:'agent_message',text:'100% complete'}});
 observeCodexProgress(progress,{type:'thread.started'});observeCodexProgress(progress,{type:'turn.completed'});
 finishProgress(progress,'review',true);completeMilestone(progress,'phase_validated');assert.equal(progress.items,null);
});
