import test from 'node:test';
import assert from 'node:assert/strict';
import {recordIntervention,summarizeInterventions,countTaskInterventions,decisionCategory,INTERVENTION_CATEGORIES,INTERVENTION_LIMIT} from '../src/interventions.mjs';

const rec=(extra={})=>({origin:'decision_inbox',action:'budget_exhausted:extend_budget',project:'/p',task_id:'t1',attempt_id:'a1',category:'planned_approval',evidence:'decision:abc',at:'2026-10-05T03:00:00Z',...extra});

test('records project, task, attempt, origin, category, timestamp and evidence',()=>{
  const list=[];const {record,added}=recordIntervention(list,rec());
  assert.equal(added,true);assert.equal(list.length,1);
  assert.equal(record.project,'/p');assert.equal(record.task_id,'t1');assert.equal(record.attempt_id,'a1');
  assert.equal(record.origin,'decision_inbox');assert.equal(record.category,'planned_approval');
  assert.equal(record.at,'2026-10-05T03:00:00.000Z');assert.equal(record.evidence,'decision:abc');
  assert.ok(record.id&&record.key);
});

test('deduplicates by key: an explicit key or the derived identity never double-counts',()=>{
  const list=[];
  recordIntervention(list,rec({key:'k1'}));
  const second=recordIntervention(list,rec({key:'k1'}));
  assert.equal(second.added,false);assert.equal(list.length,1);
  // Same identity at the same instant without a key collapses too; a distinct act does not.
  assert.equal(recordIntervention(list,rec()).added,true);
  assert.equal(recordIntervention(list,rec()).added,false);
  assert.equal(recordIntervention(list,rec({at:'2026-10-05T04:00:00Z'})).added,true);
  assert.equal(list.length,3);
});

test('unclassifiable actions and unattributable acts keep unknown instead of being guessed',()=>{
  const list=[];
  const {record}=recordIntervention(list,rec({category:'not_a_category',task_id:undefined,attempt_id:undefined}));
  assert.equal(record.category,null);assert.equal(record.task_id,null);assert.equal(record.attempt_id,null);
  const s=summarizeInterventions(list);
  assert.equal(s.unclassified,1);assert.equal(s.by_category.planned_approval,0);
});

test('summary counts moments by category and never converts waiting into active human time',()=>{
  const list=[];
  recordIntervention(list,rec({key:'a',category:'planned_approval',at:'2026-10-05T00:00:00Z'}));
  recordIntervention(list,rec({key:'b',category:'clarification',at:'2026-10-05T06:00:00Z'}));
  recordIntervention(list,rec({key:'c',category:'correction',task_id:'t2',at:'2026-10-05T09:00:00Z'}));
  const s=summarizeInterventions(list);
  assert.equal(s.total,3);assert.deepEqual(s.by_category,{planned_approval:1,clarification:1,correction:1});
  assert.equal(s.active_seconds,null); // six idle hours between records are not six hours of effort.
  assert.equal(s.first_at,'2026-10-05T00:00:00.000Z');assert.equal(s.last_at,'2026-10-05T09:00:00.000Z');
  assert.equal(summarizeInterventions(list,{task_id:'t2'}).total,1);
  assert.equal(summarizeInterventions(list,{project:'/other'}).total,0);
  assert.equal(countTaskInterventions(list,'t1'),2);
});

test('decision options map to the approved categories only; anything else stays unknown',()=>{
  for(const id of ['extend_budget','extend_launches','allow_diagnosis','reauthorize','resume','resume_probe','resume_full','approve_opportunity','proceed_by_charter','release_confirmed','operator_cleared'])assert.equal(decisionCategory(id),'planned_approval',id);
  assert.equal(decisionCategory('answer'),'clarification');assert.equal(decisionCategory('choose__paid'),'clarification');
  for(const id of ['replan','archive','reverify','dismiss_opportunity','keep_paused','cancel'])assert.equal(decisionCategory(id),'correction',id);
  assert.equal(decisionCategory('something_new'),null);assert.equal(decisionCategory(null),null);
});

test('the registry is bounded',()=>{
  const list=[];
  for(let i=0;i<INTERVENTION_LIMIT+10;i++)recordIntervention(list,rec({key:'k'+i}));
  assert.equal(list.length,INTERVENTION_LIMIT);
  assert.equal(list[0].key,'k10'); // oldest trimmed first
});

test('categories are exactly the approved set',()=>{
  assert.deepEqual(INTERVENTION_CATEGORIES,['planned_approval','clarification','correction']);
});
