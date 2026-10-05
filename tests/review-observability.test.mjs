import test from 'node:test';
import assert from 'node:assert/strict';
import {observeMission} from '../src/mission-observation.mjs';
import {usageAnalytics} from '../src/pricing.mjs';

const base={id:'t1',title:'Review me',workspace:'/p',started_at:'2026-10-05T10:00:00.000Z',progress:{phase:'review'}};
const at=minutes=>Date.parse('2026-10-05T10:00:00.000Z')+minutes*60000;

test('a review in execution is active with a growing current duration; queued waits; finished awaits verification; failure stays explicit',()=>{
 const queued=observeMission({...base,status:'reviewing',queue:{status:'queued',phase:'review'}},at(1));
 assert.deepEqual([queued.status,queued.reasons[0],queued.execution_ms],['waiting','awaiting_executor',null]);
 const early=observeMission({...base,status:'reviewing'},at(2)),later=observeMission({...base,status:'reviewing'},at(7));
 assert.deepEqual([early.status,early.phase,early.reasons[0]],['active','review','execution_in_progress']);
 assert.equal(early.execution_ms,120000);
 assert.equal(later.execution_ms,420000);
 assert.ok(later.execution_ms>early.execution_ms);
 const finished=observeMission({...base,status:'review',ended_at:'2026-10-05T10:09:00.000Z',measurement:{execution_ms:540000}},at(30));
 assert.deepEqual([finished.status,finished.reasons[0],finished.execution_ms],['awaiting_verification','acceptance_evidence_pending',540000]);
 assert.equal(finished.delivery_quality,'unverified');
 const failed=observeMission({...base,status:'blocked',ended_at:'2026-10-05T10:09:00.000Z',measurement:{execution_ms:540000}},at(30));
 assert.deepEqual([failed.status,failed.reasons[0]],['failed','execution_failed']);
 for(const phase of ['planning','running']){const row=observeMission({...base,status:phase,progress:{phase}},at(3));assert.deepEqual([row.status,row.execution_ms],['active',180000]);}
});

test('analytics marks planning, implementation and review runs as active, and nothing else',()=>{
 const rows=['planning','running','reviewing','queued','review','blocked','done','backlog'].map(status=>({id:status,title:status,status,measurement:{model:'gpt-6-sol',usage:{input_tokens:10,output_tokens:5}}}));
 const result=usageAnalytics([],rows);
 const active=Object.fromEntries(result.tasks.map(row=>[row.task_id,row.active]));
 assert.deepEqual(active,{planning:true,running:true,reviewing:true,queued:false,review:false,blocked:false,done:false,backlog:false});
});
