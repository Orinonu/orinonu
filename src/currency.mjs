// Public exchange-rate reference only: conversions are estimates, never invoices or quota values.
export const rateSource='https://economia.awesomeapi.com.br/json/last/USD-BRL';
const round=value=>value===null?null:Math.round(value*1e12)/1e12;
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
const parse=value=>positive(Number(value));

export function normalizeRate(payload,fetchedAt){
 const row=payload?.USDBRL??{};
 const bid=parse(row.bid),ask=parse(row.ask),direct=positive(Number(payload?.usd_brl??payload?.rate));
 // Mid-market is the reference when both sides exist; a single side is still explicit.
 const usd_brl=direct??(bid!==null&&ask!==null?round((bid+ask)/2):bid??ask);
 const age=Date.now()-Date.parse(fetchedAt);
 return {source:rateSource,fetched_at:fetchedAt??null,status:usd_brl===null?'unavailable':Number.isFinite(age)&&age>86400000?'stale':'available',
  usd_brl,bid,ask,observed_at:typeof row.create_date==='string'?row.create_date:null};
}

export function toBrl(usd,rate){
 const value=typeof usd==='number'&&Number.isFinite(usd)?usd:null,quote=positive(Number(rate));
 return value===null||quote===null?null:round(value*quote);
}

const sumKnown=values=>values.length&&values.every(value=>typeof value==='number'&&Number.isFinite(value))?values.reduce((a,b)=>a+b,0):null;
const money=(row,quote)=>row&&typeof row==='object'?{...row,
 ...('estimated_usd' in row?{estimated_brl:toBrl(row.estimated_usd,quote)}:{}),
 ...('jev_estimated_usd' in row?{jev_estimated_brl:toBrl(row.jev_estimated_usd,quote)}:{}),
 ...('difference_usd' in row?{difference_brl:toBrl(row.difference_usd,quote)}:{}),
}:row;

export function withBrl(analytics,rate){
 if(!analytics)return analytics;
 const quote=positive(Number(rate));
 const estimated_usd=sumKnown([analytics.executor?.estimated_usd,analytics.jev?.estimated_usd]);
 const tokens=key=>sumKnown([analytics.executor?.[key],analytics.jev?.[key]]);
 const unpriced=[analytics.executor?.unpriced_calls,analytics.jev?.unpriced_calls];
 return {...analytics,
  jev:money(analytics.jev,quote),executor:money(analytics.executor,quote),
  simulations:(analytics.simulations??[]).map(row=>money(row,quote)),
  tasks:(analytics.tasks??[]).map(row=>money(row,quote)),
  totals:{estimated_usd,estimated_brl:toBrl(estimated_usd,quote),input_tokens:tokens('input_tokens'),output_tokens:tokens('output_tokens'),
   seconds:sumKnown((analytics.tasks??[]).map(row=>row.seconds)),
   unpriced_calls:unpriced.every(Number.isSafeInteger)?unpriced.reduce((a,b)=>a+b,0):null}};
}
