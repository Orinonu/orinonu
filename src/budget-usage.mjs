import {checkedAdd} from './budget-policy.mjs';
// Provider totals already include cache and reasoning. Missing data stays null.
export function normalizeBudgetUsage(value,{source='provider',observed_at=new Date().toISOString()}={}){
 const v=value??{},valid=n=>Number.isSafeInteger(n)&&n>=0;
 const input=v.input_tokens??v.input,output=v.output_tokens??v.output;
 const usage={input_tokens:valid(input)?input:null,output_tokens:valid(output)?output:null,total_tokens:null,billed_usd_micro:null,estimated_usd_micro:null};
 if(valid(v.total_tokens??v.total))usage.total_tokens=v.total_tokens??v.total;
 else if(valid(input)&&valid(output))usage.total_tokens=checkedAdd(input,output);
 // Only explicit accounting evidence can label a charge as billed.
 if(valid(v.billed_usd_micro)&&typeof v.billing_evidence==='string'&&v.billing_evidence.trim())usage.billed_usd_micro=v.billed_usd_micro;
 if(valid(v.estimated_usd_micro)&&v.estimate_provenance&&typeof v.estimate_provenance==='object'&&['model','source','date','currency'].every(k=>typeof v.estimate_provenance[k]==='string')&&v.estimate_provenance.currency==='USD')usage.estimated_usd_micro=v.estimated_usd_micro;
 return {usage,source,observed_at,metadata:{cache_read_tokens:v.cached_input_tokens??v.cache_read_tokens??null,reasoning_tokens:v.reasoning_tokens??null,billing_evidence:v.billing_evidence??null,estimate_provenance:v.estimate_provenance??null,quota:v.quota??null}};
}
