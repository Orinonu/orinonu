type Input={enabled:boolean;metric:string;limit:string;envelope:string;unknown:string};
type Policy={version:1;enabled:boolean;activation?:string;unknown_policy?:string;limits?:Record<string,number>;envelopes?:Record<string,Record<string,number>>};
export function formBudgetPolicy(input:Input):Policy{
 if(!input.enabled)return {version:1,enabled:false};
 const limit=Number(input.limit),envelope=Number(input.envelope);
 if(!['total_tokens','billed_usd_micro','estimated_usd_micro'].includes(input.metric)||!['block','retain_reservation'].includes(input.unknown)||!input.limit.trim()||!input.envelope.trim()||![limit,envelope].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Informe teto e reserva inteiros e politica de uso desconhecido.');
 return {version:1,enabled:true,activation:'from_configuration',unknown_policy:input.unknown,limits:{[input.metric]:limit},envelopes:Object.fromEntries(['planning','implementation','review','recovery','jev'].map(phase=>[phase,{[input.metric]:envelope}]))};
}
