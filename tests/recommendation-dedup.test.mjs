import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecommendations,distinctRecommendations} from '../src/recommendations.mjs';
const proposal={title:'Reliable admission',goal:'Deduplicate identical proposals.',acceptance:'Admit each identity once.',recommendation:'Use the existing identity.',risk:'Preserve workspace scope.',evidence:['src/server.mjs addRecommendations']};
test('identical rows within a batch and subsequent batches are admitted once',()=>{
 const rows=normalizeRecommendations([proposal,proposal],'project-a','test');
 const first=distinctRecommendations(rows,[],3);
 assert.equal(first.length,1);
 assert.equal(distinctRecommendations(rows,first,3).length,0);
});
test('workspace identity remains distinct and capacity counts unique rows',()=>{
 const a=normalizeRecommendations([proposal,proposal,{...proposal,title:'Another improvement'}],'project-a','test');
 const b=normalizeRecommendations([proposal],'project-b','test');
 assert.equal(distinctRecommendations(a,[],2).length,2);
 assert.equal(distinctRecommendations(b,a,1).length,1);
 assert.equal(distinctRecommendations(a,[],0).length,0);
});
test('an invalid batch fails validation before admission',()=>{
 assert.throws(()=>normalizeRecommendations([proposal,{...proposal,evidence:[]}],'project-a','test'),/incompleta/);
});
