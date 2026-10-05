export const metrics=['input_tokens','output_tokens','total_tokens','billed_usd_micro','estimated_usd_micro'];
export const budgetPhases=['planning','implementation','review','recovery','jev'];
export const budgetError=(code,scope=null)=>Object.assign(new Error(code),{status:409,code,scope});
export function amounts(value,{partial=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw budgetError('budget_configuration_required');
 const result={};
 for(const [key,n] of Object.entries(value)){
  if(!metrics.includes(key)||!(partial&&n===null)&&(!Number.isSafeInteger(n)||n<0))throw budgetError('budget_configuration_required');
  result[key]=n;
 }
 return result;
}
export function validateBudgetPolicy(value){
 if(!value||value.version!==1||typeof value.enabled!=='boolean')throw budgetError('budget_configuration_required');
 if(!value.enabled)return {version:1,enabled:false};
 if(!['block','retain_reservation'].includes(value.unknown_policy))throw new Error('unknown_policy obrigatório: block ou retain_reservation');
 if(value.activation!=='from_configuration')throw budgetError('budget_configuration_required');
 const limits=amounts(value.limits);if(!Object.keys(limits).length)throw budgetError('budget_configuration_required');
 const envelopes={};
 for(const phase of budgetPhases){envelopes[phase]=amounts(value.envelopes?.[phase]);for(const metric of Object.keys(limits))if(envelopes[phase][metric]===undefined)throw budgetError('budget_configuration_required');}
 return {version:1,enabled:true,activation:value.activation,unknown_policy:value.unknown_policy,limits,envelopes};
}
export function checkedAdd(a,b){const n=a+b;if(!Number.isSafeInteger(n)||n<0)throw budgetError('budget_overflow');return n;}
