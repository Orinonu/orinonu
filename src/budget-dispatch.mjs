import {randomUUID} from 'node:crypto';
import {normalizeBudgetUsage} from './budget-usage.mjs';
export function budgetDecisionEngine(ledger,target,context){
  return {async call(name,input,...rest){
  if(!context?.workspace){if(ledger.enabled())throw Object.assign(new Error('budget_configuration_required'),{status:409,code:'budget_configuration_required'});return target.call(name,input,...rest);}
  const id=randomUUID(),scope={workspace:context.workspace,task_id:context.task_id??context.id??null};
  const op=ledger.reserve({...scope,id,phase:'jev',provider:'typesafe',attempt_id:context.attempt?.id??null});
  const operation=op?.id??null;ledger.authorizeStart(operation);
  try{
   const output=await target.call(name,input,...rest);
   if(operation){
    const normalized=normalizeBudgetUsage(output?.cached?{input_tokens:0,output_tokens:0}:output?.usage,{source:'typesafe_response'});
    ledger.observe(operation,{...normalized,event_id:'response',revision:1,mode:'snapshot'});
    ledger.settle(operation,{complete:Object.keys(normalized.usage).filter(k=>normalized.usage[k]!==null)});
   }
   return output;
  }catch(error){if(operation)ledger.settle(operation);throw error;}
 }};
}
