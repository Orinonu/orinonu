import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProjectDirection} from '../src/project-direction.mjs';

test('project direction retains bounded requirements and canonical GitHub references',()=>{
 const body={objective:' Improve queue ',success_criteria:' Tests pass ',repositories:['https://github.com/OWNER/Repo.git','https://github.com/owner/repo/'],research_focus:' Parallel writers '};
 const before=structuredClone(body);
 assert.deepEqual(normalizeProjectDirection(body,'C:/project'),{workspace:'C:/project',objective:'Improve queue',success_criteria:'Tests pass',repositories:['https://github.com/owner/repo'],research_focus:'Parallel writers'});
 assert.deepEqual(body,before);
});

test('empty references can be saved without starting a research request',()=>{
 assert.deepEqual(normalizeProjectDirection({workspace:' C:/other '}),{workspace:'C:/other',objective:'',success_criteria:'',repositories:[],research_focus:''});
});

test('rejects arbitrary URLs and ambiguous GitHub URLs',()=>{
 for(const url of ['http://github.com/owner/repo','https://evil.test/owner/repo','https://github.com/owner/repo?token=secret','https://github.com/owner/repo/tree/main','https://user@github.com/owner/repo','https://github.com:443/owner/repo','https://github.com/owner/%2e%2e'])assert.throws(()=>normalizeProjectDirection({repositories:[url]},'C:/project'));
});

test('limits preserve bounded input and reject malformed settings',()=>{
 for(const [key,max] of [['objective',3000],['success_criteria',2000],['research_focus',800]]){
  assert.equal(normalizeProjectDirection({[key]:'x'.repeat(max)},'C:/project')[key].length,max);
  assert.throws(()=>normalizeProjectDirection({[key]:'x'.repeat(max+1)},'C:/project'));
  assert.throws(()=>normalizeProjectDirection({[key]:{}},'C:/project'));
 }
 for(const body of [[],null,{workspace:9},{workspace:'x\u0000y'},{objective:'x\u0000y'},{repositories:'https://github.com/o/r'},{repositories:Array(9).fill('https://github.com/o/r')}])assert.throws(()=>normalizeProjectDirection(body,'C:/project'));
 assert.throws(()=>normalizeProjectDirection({}));
 assert.equal('auto_implement' in normalizeProjectDirection({auto_implement:true},'C:/project'),false);
});

test('permanent charter is project-scoped and remains independent of research focus',()=>{
 const source={mission:' Build reliable specialists ',vision:' An autonomous ecosystem ',values:'Evidence and user preferences',principles:'Keep scope and quality',research_focus:'Review competitors'};
 const result=normalizeProjectDirection(source,'C:/project');
 assert.equal(result.mission,'Build reliable specialists');
 assert.equal(result.vision,'An autonomous ecosystem');
 assert.equal(result.values,source.values);
 assert.equal(result.principles,source.principles);
 assert.equal(result.research_focus,source.research_focus);
 for(const key of ['mission','vision','values','principles']){
  assert.throws(()=>normalizeProjectDirection({[key]:'x'.repeat(2001)},'C:/project'));
  assert.throws(()=>normalizeProjectDirection({[key]:{}},'C:/project'));
 }
 assert.equal('permission' in normalizeProjectDirection({...source,permission:'all'},'C:/project'),false);
});
