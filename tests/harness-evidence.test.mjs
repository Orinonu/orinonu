import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHarnessEvidence,evaluateHarness,researchRequest} from '../src/harness-evaluation.mjs';
import {observeMission} from '../src/mission-observation.mjs';
test('fila após tentativa anterior não é execução ativa nem acumula tempo de espera',()=>{
 const task={id:'x',started_at:'2026-10-04T00:00:00Z',status:'planning',queue:{status:'queued'},measurement:{execution_ms:400}};
 const row=observeMission(task,Date.parse('2026-10-04T03:00:00Z'));
 assert.equal(row.status,'waiting');assert.equal(row.execution_ms,400);
 assert.equal(observeMission({...task,status:'reviewing',queue:null},Date.parse(task.started_at)+100).status,'active');
});
test('êxito de processo e preço estimado não certificam qualidade ou custo real',()=>{
 const task={measurement:{duration_ms:1200,exit_code:0,usage:{input_tokens:40,output_tokens:10},estimated_usd:0.01}};
 const evidence=collectHarnessEvidence(task),result=evaluateHarness(evidence,{duration_ms:1000,total_tokens:100,cost_usd:1});
 assert.equal(evidence.total_tokens,50);assert.equal(result.time.score,83);assert.equal(result.tokens.score,100);
 assert.equal(result.quality.score,null);assert.equal(result.cost.score,null);assert.equal(result.overall,null);
 assert.equal(collectHarnessEvidence({measurement:{usage:{input_tokens:10},actual_cost:{source:'estimate',receipt_id:'r',usd:0.1}}}).cost_usd,null);
});
test('critérios com evidência medem falhas sem mascarar resultados ou habilitar execução',()=>{
 const result=evaluateHarness({acceptance:[{id:'a',passed:true,evidence:'test:a'},{id:'b',passed:false,evidence:'test:b'}]});
 assert.equal(result.quality.score,50);
 assert.equal(researchRequest({attempt:{id:'r',state:'outcome_unknown'}},result),null);
 assert.equal(researchRequest({queue:{status:'queued'},attempt:{id:'r',state:'terminal'}},result),null);
 assert.equal(researchRequest({id:'t',attempt:{id:'r',state:'terminal'}},result).supervisor.key,'harness-research:t:r');
});
