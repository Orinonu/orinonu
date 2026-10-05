import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {criteriaSet,assertCriteriaCoverage,criteriaCurrent,criteriaPrompt} from '../src/criteria.mjs';
import {readReviewContract,reviewContractPrompt} from '../src/review-contract.mjs';
import {technicalCompletion} from '../src/autonomy.mjs';
import {createMissionServer} from '../src/server.mjs';
import {coverage} from './helpers/review-coverage.mjs';

const ACCEPTANCE='Os testes passam; a interface permanece acessível. Nenhum arquivo privado é gravado.';
const DIGEST='a'.repeat(64);
const wrap=value=>'```nexo-review\n'+JSON.stringify(value)+'\n```';
const base=criteria=>({version:1,snapshot_digest:DIGEST,decision:'approved',reason:'ok',...coverage({criteria})});

test('acceptance text becomes a numbered criteria set whose hash changes with the text',()=>{
 const set=criteriaSet(ACCEPTANCE);
 assert.deepEqual(set.items.map(item=>item.id),['c1','c2','c3']);
 assert.equal(set.items[0].text,'Os testes passam');
 assert.equal(criteriaSet(ACCEPTANCE).hash,set.hash);
 assert.notEqual(criteriaSet(ACCEPTANCE+' Extra critério.').hash,set.hash);
 assert.equal(criteriaSet('').items.length,1);
 assert.throws(()=>criteriaSet(Array.from({length:41},(_,index)=>'Critério '+index).join('; ')),/excedem os limites/);
 assert.throws(()=>criteriaSet('A'.repeat(501)),/excedem os limites/);
 assert.equal(criteriaSet(Array.from({length:40},(_,index)=>'Critério '+index).join('; ')).items.length,40);
 assert.equal(criteriaSet('A'.repeat(500)).items[0].text.length,500);
 assert.equal(criteriaCurrent({criteria:set},ACCEPTANCE),true);
 assert.equal(criteriaCurrent({criteria:set},ACCEPTANCE+' Novo critério.'),false);
 assert.equal(criteriaCurrent({},'qualquer'),true);
 assert.match(criteriaPrompt(set),new RegExp(set.hash));
 assert.equal(criteriaPrompt(undefined),'');
 assert.match(reviewContractPrompt({snapshot_digest:DIGEST,criteria:set}),/Conjunto confirmado de critérios/);
});

test('an approval must cover exactly the confirmed criteria, once each, from this version',()=>{
 const criteria=criteriaSet(ACCEPTANCE);
 assert.doesNotThrow(()=>readReviewContract(wrap(base(criteria)),DIGEST,criteria));
 const reject=(mutate,pattern)=>assert.throws(()=>readReviewContract(wrap(mutate(base(criteria))),DIGEST,criteria),pattern);
 reject(value=>({...value,checks:value.checks.slice(0,1)}),/não cobertos: c2, c3/);
 reject(value=>({...value,checks:[value.checks[0],value.checks[0],...value.checks.slice(1)]}),/duplicado \(c1\)/);
 reject(value=>({...value,checks:[...value.checks.slice(0,2),{...value.checks[2],criterion_id:'c9'}]}),/desconhecido/);
 reject(value=>({...value,checks:[{criterion:'Critério alheio',status:'passed',evidence:['x'],criterion_id:'outro'}]}),/desconhecido/);
 reject(value=>({...value,criteria_hash:criteriaSet('Outra versão').hash}),/hash divergente/);
 reject(value=>{const {criteria_hash,...rest}=value;void criteria_hash;return rest;},/hash divergente ou ausente/);
 reject(value=>({...value,checks:value.checks.map(({criterion_id,...rest})=>{void criterion_id;return rest;})}),/criterion_id/);
 reject(value=>({...value,checks:value.checks.map((check,index)=>index===1?{...check,status:'unknown'}:check)}),/Aprovação exige/);
 // Non-approving verdicts stay useful without full coverage, but may not cite foreign criteria or another version.
 const rejected={...base(criteria),decision:'rejected',checks:[{criterion:'falha',status:'failed',evidence:['x']}]};
 assert.doesNotThrow(()=>readReviewContract(wrap(rejected),DIGEST,criteria));
 assert.throws(()=>readReviewContract(wrap({...rejected,checks:[{...rejected.checks[0],criterion_id:'zzz'}]}),DIGEST,criteria),/desconhecido/);
 assert.throws(()=>assertCriteriaCoverage(rejected,undefined),/conjunto confirmado ausente/);
 // Without a confirmed set (legacy snapshot) the previous contract is unchanged.
 assert.doesNotThrow(()=>readReviewContract(wrap({version:1,snapshot_digest:DIGEST,decision:'approved',reason:'ok',checks:[{criterion:'x',status:'passed',evidence:['y']}]}),DIGEST));
});

test('technical completion also needs the approval to match the criteria the mission has now',()=>{
 const criteria=criteriaSet(ACCEPTANCE),snapshotDigest='b'.repeat(64);
 const done={acceptance:ACCEPTANCE,implementation_run:{attempt_id:'impl'},implementation_evidence:{implementation_attempt_id:'impl',changes:[{path:'a'}]},
  review_snapshot:{snapshot_digest:snapshotDigest,review_attempt_id:'rev',implementation_attempt_id:'impl',criteria},review_contract:{decision:'approved',snapshot_digest:snapshotDigest,criteria_hash:criteria.hash},
  integration:{status:'merged',snapshot_digest:snapshotDigest,review_attempt_id:'rev'}};
 assert.equal(technicalCompletion(done),true);
 assert.equal(technicalCompletion({...done,acceptance:ACCEPTANCE+' Novo critério.'}),false);
 assert.equal(technicalCompletion({...done,review_contract:{...done.review_contract,criteria_hash:criteriaSet('Outra').hash}}),false);
 assert.equal(technicalCompletion({...done,review_contract:{decision:'approved',snapshot_digest:snapshotDigest}}),false);
 const {criteria:omitted,...legacySnapshot}=done.review_snapshot;void omitted;
 assert.equal(technicalCompletion({...done,review_snapshot:legacySnapshot,review_contract:{decision:'approved',snapshot_digest:snapshotDigest}}),true);
});

async function reviewFlow(report){
 const root=mkdtempSync(join(tmpdir(),'nexo-criteria-')),source=join(root,'project'),children=[];mkdirSync(source);writeFileSync(join(source,'file.txt'),'original');
 const runner=(_,args,options)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdin.setEncoding('utf8');child.stdinText='';child.stdin.on('data',chunk=>{child.stdinText+=chunk;});child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',null);children.push({child,args,cwd:options.cwd});return child;};
 const decisionEngine={call:async(_,input)=>({ok:true,action:'recommend',selected_id:input.options[0].id})};
 const app=createMissionServer({dataDir:join(root,'state'),isolationRoot:join(root,'isolated'),runner,decisionEngine,codexPath:process.execPath});await app.listen(0);
 const post=(path,body)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const state=async()=>(await(await fetch(app.url+'/api/state')).json()).tasks[0];
 const wait=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');};
 try{
  const task=await(await post('/api/tasks',{title:'Gate',workspace:source,goal:'Defined change',acceptance:ACCEPTANCE,agent:'codex',profile:'implementation',max_minutes:1})).json();
  await post(`/api/tasks/${task.id}/run`,{});await wait(()=>children.length===1);writeFileSync(join(children[0].cwd,'file.txt'),'implementation');children[0].child.emit('close',0);
  await wait(()=>children.length===2);
  const current=await state();
  assert.equal(current.review_snapshot.criteria.items.length,3);
  assert.match(children[1].child.stdinText,/Conjunto confirmado de critérios/);
  const text=report(current.review_snapshot);
  children[1].child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})+'\n');await state();children[1].child.emit('close',0);
  await wait(async()=>['merged','blocked','revision_required'].includes((await state()).integration?.status));
  return {current:await state(),canonical:readFileSync(join(source,'file.txt'),'utf8'),children:children.length};
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
}

test('an approved report whose only check belongs to a foreign criterion neither integrates nor completes the mission',async()=>{
 const foreign=await reviewFlow(snapshot=>wrap({version:1,snapshot_digest:snapshot.snapshot_digest,decision:'approved',criteria_hash:snapshot.criteria.hash,reason:'Looks fine',checks:[{criterion_id:'alheio-9',criterion:'Outro critério',status:'passed',evidence:['file.txt:1']}]}));
 assert.equal(foreign.current.integration.status,'blocked');
 assert.match(foreign.current.integration.reason,/Cobertura de critérios inválida/);
 assert.notEqual(foreign.current.status,'done');
 assert.equal(foreign.canonical,'original');
 assert.equal(foreign.current.review_contract??null,null);
 const partial=await reviewFlow(snapshot=>wrap({version:1,snapshot_digest:snapshot.snapshot_digest,decision:'approved',reason:'Only one',...(({checks,...rest})=>({...rest,checks:checks.slice(0,1)}))(coverage(snapshot))}));
 assert.equal(partial.current.integration.status,'blocked');
 assert.equal(partial.canonical,'original');
 assert.notEqual(partial.current.status,'done');
});

test('a report covering every confirmed criterion integrates and completes through the same flow',async()=>{
 const ok=await reviewFlow(snapshot=>wrap({version:1,snapshot_digest:snapshot.snapshot_digest,decision:'approved',reason:'Verified',...coverage(snapshot,'passed',['file.txt:1; fixture'])}));
 assert.equal(ok.current.integration.status,'merged');
 assert.equal(ok.current.status,'done');
 assert.equal(ok.canonical,'implementation');
 assert.equal(ok.current.review_contract.criteria_hash,ok.current.review_snapshot.criteria.hash);
});
