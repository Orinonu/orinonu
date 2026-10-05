import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBudgetPolicy} from '../src/budget-policy.mjs';
const policy=()=>({version:1,enabled:true,activation:'from_configuration',unknown_policy:'retain_reservation',limits:{total_tokens:10},envelopes:Object.fromEntries(['planning','implementation','review','recovery','jev'].map(p=>[p,{total_tokens:5}]))});
test('budget activation requires explicit unknown policy and envelopes; zero is a valid ceiling',()=>{
 const p=policy();p.limits.total_tokens=0;assert.equal(validateBudgetPolicy(p).limits.total_tokens,0);
 delete p.unknown_policy;assert.throws(()=>validateBudgetPolicy(p),/unknown_policy/);
});

test('negative, fractional, unsafe and incomplete limits fail closed; disabled is inert',()=>{
 for(const value of [-1,0.1,Number.MAX_SAFE_INTEGER+1,Infinity,null]){const p=policy();p.limits.total_tokens=value;assert.throws(()=>validateBudgetPolicy(p));}
 const p=policy();delete p.envelopes.recovery;assert.throws(()=>validateBudgetPolicy(p));assert.deepEqual(validateBudgetPolicy({version:1,enabled:false}),{version:1,enabled:false});
});
