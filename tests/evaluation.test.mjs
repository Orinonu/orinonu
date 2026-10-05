import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEvaluation } from '../src/evaluation.mjs';
test('promotion requires quality, coverage, sample size and comparable measurements',()=>{
  assert.deepEqual(assessEvaluation({correct:8,total:10,answered:10,unsafe:0,paired_samples:10},
    {min_accuracy:.9,min_coverage:.5,min_pairs:10}),{status:'improve',reasons:['accuracy']});
  assert.equal(assessEvaluation({correct:10,total:10,answered:0,unsafe:0,paired_samples:0},
    {min_accuracy:.9,min_coverage:.5,min_pairs:10}).status,'improve');
});
