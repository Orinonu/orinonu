import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, MODEL } from './engine.mjs';
const args = { goal: 'Corrigir o parser preservando zero; mudança local reversível.', category: 'technical', delegated: true,
  options: [{ id: 'nullish', text: 'Usar ?? para preservar zero' }, { id: 'or', text: 'Usar ||' }] };
test('delegated decisions select only supplied options, with a no-decision option', async () => {
  const engine = createEngine({ apiKey: 'test', fetcher: async (_, { body }) => {
    const q = JSON.parse(body).questions.q0;
    assert.equal(q.type, 'choice'); assert.ok('abstain' in q.criteria);
    return new Response(JSON.stringify({ model: MODEL, usage: { input_tokens: 100, output_tokens: 20 },
      answers: { q0: { type: 'choice', choice: 'nullish', confidence: 0.9, probabilities: { nullish: 0.95, or: 0.02, abstain: 0.03 } } } }));
  } });
  const result = await engine.call('resolve_decision', args);
  assert.equal(result.ok, true); assert.equal(result.selected_id, 'nullish'); assert.equal(result.action, 'recommend');
  assert.equal(result.executes_action, false);
});
test('missing delegation makes zero API calls', async () => {
  const engine=createEngine({fetcher:()=>assert.fail('network used')});
  const output=await engine.call('resolve_decision',{...args,delegated:false});
  assert.equal(output.action,'needs_user');assert.equal(output.selected_id,null);
});
test('invented choices and uncertain decisions do not authorize execution',async()=>{
  for(const choice of ['invented','nullish']){
    const engine=createEngine({apiKey:'test',fetcher:async()=>new Response(JSON.stringify({model:MODEL,usage:{input_tokens:100,output_tokens:20},
      answers:{q0:{type:'choice',choice,confidence:.2,probabilities:{nullish:.5,or:.3,abstain:.2}}}}))});
    const output=await engine.call('resolve_decision',args);
    assert.equal(output.selected_id,null);assert.equal(output.executes_action,false);
    assert.equal(output.action,choice==='invented'?'fallback':'abstain');
  }
});
test('profile confidence policy is isolated from general decisions',async()=>{
 const fetcher=async()=>new Response(JSON.stringify({model:MODEL,answers:{q0:{type:'choice',choice:'nullish',confidence:.79,probabilities:{nullish:.79,or:.11,abstain:.10}}},usage:{input_tokens:20,output_tokens:4}}));
 const general=await createEngine({apiKey:'test',fetcher}).call('resolve_decision',args);
 const profile=await createEngine({apiKey:'test',fetcher,profileSelection:true}).call('resolve_decision',args);
 assert.equal(general.action,'abstain');assert.equal(profile.action,'recommend');assert.equal(profile.executes_action,false);
});
