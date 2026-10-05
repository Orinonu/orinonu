import test from 'node:test';
import assert from 'node:assert/strict';
import {formBudgetPolicy} from '../src/lib/budget.ts';
test('blank values and missing unknown choice cannot enable budget; exact zero is explicit',()=>{
 for(const input of [{limit:'',envelope:'1',unknown:'block'},{limit:'1',envelope:'',unknown:'block'},{limit:'1',envelope:'1',unknown:''},{limit:'0.2',envelope:'1',unknown:'block'}])assert.throws(()=>formBudgetPolicy({enabled:true,metric:'total_tokens',...input}));
 const p=formBudgetPolicy({enabled:true,metric:'total_tokens',limit:'0',envelope:'1',unknown:'retain_reservation'});assert.equal(p.limits?.total_tokens,0);assert.equal(p.envelopes?.recovery.total_tokens,1);
 assert.deepEqual(formBudgetPolicy({enabled:false,metric:'',limit:'',envelope:'',unknown:''}),{version:1,enabled:false});
});
