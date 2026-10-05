import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComparisons,summarizeComparisons } from '../src/comparisons.mjs';
const pair={id:'one',benchmark_id:'fixed-tests-v1',controlled:false,baseline:{config:'medium',accepted:true,seconds:20,cost_usd:null,evidence:'baseline-tests.log'},candidate:{config:'medium+jev',accepted:true,seconds:23,cost_usd:null,evidence:'candidate-tests.log'}};
test('paired metrics expose slowdown and missing prices without granting promotion',()=>{
  const rows=validateComparisons({pairs:[pair]});const summary=summarizeComparisons(rows);
  assert.equal(summary.saved_seconds,-3);assert.equal(summary.saved_usd,null);assert.equal(summary.assessment.status,'improve');
  assert.equal(summary.controlled_pairs,0);
  assert.throws(()=>validateComparisons({pairs:[pair,pair]}));
  assert.throws(()=>validateComparisons({pairs:[{...pair,candidate:{...pair.candidate,seconds:-1}}]}));
  const regression=summarizeComparisons([{...pair,candidate:{...pair.candidate,accepted:false}}]);assert.equal(regression.regressions,1);assert.equal(regression.saved_seconds,null);
});
test('uncontrolled comparisons cannot become proven savings',()=>{
  const row={...pair,baseline:{...pair.baseline,cost_usd:0.4},candidate:{...pair.candidate,seconds:10,cost_usd:0.1}};
  const result=summarizeComparisons([row]);
  assert.equal(result.proven_saved_usd,null);assert.equal(result.proven_saved_seconds,null);
  const controlled=summarizeComparisons([{...row,controlled:true}]);
  assert.equal(controlled.proven_saved_usd,0.30000000000000004);assert.equal(controlled.proven_saved_seconds,10);
});
test('token deltas require accepted controlled pairs with complete measured tokens',()=>{
 const row={...pair,controlled:true,baseline:{...pair.baseline,tokens:100},candidate:{...pair.candidate,tokens:120}};
 assert.equal(summarizeComparisons(validateComparisons({pairs:[row]})).proven_saved_tokens,-20);
 assert.equal(summarizeComparisons(validateComparisons({pairs:[{...row,controlled:false}]})).proven_saved_tokens,null);
 assert.equal(summarizeComparisons(validateComparisons({pairs:[{...row,candidate:pair.candidate}]})).proven_saved_tokens,null);
 assert.throws(()=>validateComparisons({pairs:[{...row,candidate:{...row.candidate,tokens:-1}}]}));
});

test('an uncontrolled favourable pair cannot make a set eligible whose controlled pairs lose time and cost',()=>{
 const controlledLoss=index=>({...pair,id:'c'+index,controlled:true,baseline:{...pair.baseline,seconds:20,cost_usd:0.1},candidate:{...pair.candidate,seconds:25,cost_usd:0.2}});
 const losses=Array.from({length:10},(_,index)=>controlledLoss(index));
 const uncontrolledWin={...pair,id:'u',controlled:false,baseline:{...pair.baseline,seconds:100,cost_usd:5},candidate:{...pair.candidate,seconds:1,cost_usd:0.01}};
 const result=summarizeComparisons([...losses,uncontrolledWin]);
 assert.equal(result.controlled_pairs,10);
 assert.ok(result.saved_seconds>0,'the display total still includes the uncontrolled pair');
 assert.equal(result.assessment.status,'improve');
 assert.ok(result.assessment.reasons.includes('sem ganho de tempo controlado'));
 assert.ok(result.assessment.reasons.includes('sem ganho de custo controlado'));
 assert.ok(result.proven_saved_seconds<0&&result.proven_saved_usd<0);
 // Unknown controlled cost stays unknown even when uncontrolled pairs are priced.
 const unknownCost=Array.from({length:10},(_,index)=>({...pair,id:'k'+index,controlled:true,baseline:{...pair.baseline,seconds:30,cost_usd:null},candidate:{...pair.candidate,seconds:20,cost_usd:null}}));
 const unknown=summarizeComparisons([...unknownCost,uncontrolledWin]);
 assert.equal(unknown.proven_saved_usd,null);
 assert.equal(unknown.assessment.status,'improve');
 assert.ok(unknown.assessment.reasons.includes('sem ganho de custo controlado'));
 // Ten controlled wins remain eligible.
 const wins=Array.from({length:10},(_,index)=>({...pair,id:'w'+index,controlled:true,baseline:{...pair.baseline,seconds:30,cost_usd:0.3},candidate:{...pair.candidate,seconds:20,cost_usd:0.1}}));
 assert.equal(summarizeComparisons(wins).assessment.status,'eligible');
 // Review and acceptance-regression blocks are preserved.
 assert.equal(summarizeComparisons([...wins,{...wins[0],id:'r',candidate:{...wins[0].candidate,accepted:false}}]).assessment.status,'improve');
});

test('comparisons keep their logical project: evidence from another project never satisfies this one, old records are unknown',()=>{
 const make=(id,project,controlled=true)=>({...pair,id,controlled,...(project?{project}:{}),baseline:{...pair.baseline,seconds:30,cost_usd:0.3},candidate:{...pair.candidate,seconds:20,cost_usd:0.1}});
 const rows=validateComparisons({pairs:[...Array.from({length:10},(_,index)=>make('a'+index,'/work/alpha')),make('legacy',null)]});
 assert.equal(rows.find(row=>row.id==='legacy').project,undefined);
 assert.equal(rows.find(row=>row.id==='a0').project,'/work/alpha');
 const global=summarizeComparisons(rows);
 assert.deepEqual([global.scope,global.controlled_pairs,global.unscoped_pairs],['global',11,1]);
 const alpha=summarizeComparisons(rows,{project:'/work/alpha/'});
 assert.deepEqual([alpha.scope,alpha.controlled_pairs,alpha.unscoped_pairs,alpha.assessment.status],['project',10,1,'eligible']);
 const beta=summarizeComparisons(rows,{project:'/work/beta'});
 assert.equal(beta.controlled_pairs,0);
 assert.equal(beta.total,0);
 assert.ok(beta.assessment.reasons.includes('menos de 10 pares controlados'));
 assert.equal(summarizeComparisons(rows,{project:undefined}).scope,'global');
 assert.equal(summarizeComparisons(rows,{project:''}).total,0);
 for(const bad of ['',' ',5,'x'.repeat(1001),'a\0b'])assert.throws(()=>validateComparisons({pairs:[{...pair,id:'bad',project:bad}]}),/Projeto de origem/);
});

test('the scan for one project still asks for measurement when only another project has controlled pairs',async t=>{
 const {mkdtempSync,mkdirSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createStore}=await import('../src/store.mjs'),{createMissionServer}=await import('../src/server.mjs');
 const dir=mkdtempSync(join(tmpdir(),'nexo-scope-')),a=join(dir,'alpha'),b=join(dir,'beta'),dataDir=join(dir,'state');mkdirSync(a);mkdirSync(b);
 const store=createStore(dataDir,{tasks:[],profiles:{}}),db=store.load();
 db.comparisons=validateComparisons({pairs:Array.from({length:10},(_,index)=>({...pair,id:'a'+index,controlled:true,project:a,baseline:{...pair.baseline,seconds:30,cost_usd:0.3},candidate:{...pair.candidate,seconds:20,cost_usd:0.1}}))});
 store.save(db);store.close();
 const app=createMissionServer({dataDir,codexPath:process.execPath});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const scan=async workspace=>(await(await fetch(app.url+'/api/opportunities/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace})})).json());
 const forA=await scan(a),forB=await scan(b);
 assert.equal(forA.some(row=>row.key==='measurement'),false);
 assert.equal(forB.some(row=>row.key==='measurement'),true);
 const state=await(await fetch(app.url+'/api/state')).json();
 assert.equal(state.comparison.scope,'global');
});
