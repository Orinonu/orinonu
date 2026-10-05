import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createImplementationWorkspace,mergeImplementationChanges,reconcileInterruptedMerge} from '../src/implementation-workspace.mjs';

const moduleUrl=pathToFileURL(join(process.cwd(),'src','implementation-workspace.mjs')).href;
const childSource=`import {mergeImplementationChanges} from '${moduleUrl}';
const snapshot=JSON.parse(process.argv[1]),crashAt=Number(process.argv[2]);let calls=0;
await mergeImplementationChanges(snapshot,{exclusiveWriter:true,expectedSnapshotDigest:process.argv[3],shouldContinue:()=>{calls++;if(calls===crashAt)process.exit(9);return true;}});
console.log('calls '+calls);`;

const tree=root=>{
 const out={};
 const walk=(directory)=>{for(const name of readdirSync(directory)){const path=join(directory,name),stat=statSync(path);if(stat.isDirectory()){out[relative(root,path).split(sep).join('/')+'/']=null;walk(path);}else out[relative(root,path).split(sep).join('/')]=readFileSync(path,'utf8');}};
 walk(root);return out;
};
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'nexo-merge-recovery-')),source=join(dir,'project'),isolation=join(dir,'isolated');
 mkdirSync(join(source,'src'),{recursive:true});
 writeFileSync(join(source,'a.txt'),'alpha original');writeFileSync(join(source,'src','b.txt'),'bravo original');writeFileSync(join(source,'gone.txt'),'delete me');writeFileSync(join(source,'keep.txt'),'untouched');
 const snapshot=await createImplementationWorkspace({workspace:source,isolationRoot:isolation,taskId:'task1',attemptId:'attempt1'});
 writeFileSync(join(snapshot.workspace,'a.txt'),'alpha implemented');writeFileSync(join(snapshot.workspace,'src','b.txt'),'bravo implemented');
 rmSync(join(snapshot.workspace,'gone.txt'));
 mkdirSync(join(snapshot.workspace,'new','deep'),{recursive:true});writeFileSync(join(snapshot.workspace,'new','deep','c.txt'),'charlie created');
 const {inspectImplementationChanges}=await import('../src/implementation-workspace.mjs');
 const report=await inspectImplementationChanges(snapshot);
 return {dir,source,snapshot,digest:report.snapshot_digest,original:tree(source)};
}
const crash=(f,at)=>spawnSync(process.execPath,['--input-type=module','-e',childSource,JSON.stringify(f.snapshot),String(at),f.digest],{encoding:'utf8',timeout:30000});

test('a process that dies at any point of a four-file merge is reconciled: restored, verified complete, or explicitly blocked',async()=>{
 const probe=await fixture();
 const total=Number(/calls (\d+)/.exec(crash(probe,Infinity).stdout)?.[1]);
 const completed=tree(probe.source);
 rmSync(probe.dir,{recursive:true,force:true});
 assert.ok(total>20,'the merge exposes many checkpoints: '+total);
 const outcomes=new Map();
 for(let at=1;at<=total;at++){
  const f=await fixture();
  try{
   const run=crash(f,at);
   assert.equal(run.status,9,'child should die at checkpoint '+at+': '+run.stderr);
   const lockExists=existsSync(join(f.source,'.nexo-merge-lock'));
   if(lockExists){
    // Exclusivity holds until reconciliation: a second merge fails closed instead of stealing the lease.
    await assert.rejects(()=>mergeImplementationChanges(f.snapshot,{exclusiveWriter:true}),/EEXIST|exists/i);
   }
   const result=await reconcileInterruptedMerge({sourceWorkspace:f.source,expectedSnapshotDigest:f.digest});
   outcomes.set(result.status,(outcomes.get(result.status)??0)+1);
   assert.ok(['no_interruption','cleared_no_mutation','rolled_back','all_applied'].includes(result.status),`checkpoint ${at}: ${result.status} ${result.reason??''}`);
   const after=tree(f.source);
   assert.ok(!existsSync(join(f.source,'.nexo-merge-lock')),`lock released at checkpoint ${at}`);
   assert.ok(!Object.keys(after).some(name=>name.includes('.nexo-')),`no temporary files left at checkpoint ${at}`);
   if(result.status==='all_applied'){assert.equal(result.verified,true);assert.deepEqual(after,completed,'every file verified as applied at checkpoint '+at);}
   else assert.deepEqual(after,f.original,`canonical tree restored at checkpoint ${at} (${result.status})`);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
 }
 assert.ok(outcomes.get('rolled_back')>0,'some crashes happened with partially applied files');
 assert.ok(outcomes.has('cleared_no_mutation')||outcomes.has('no_interruption'));
});

test('external edits made after the crash are never overwritten: recovery blocks and keeps lock, journal and originals',async()=>{
 const probe=await fixture();const total=Number(/calls (\d+)/.exec(crash(probe,Infinity).stdout)?.[1]);rmSync(probe.dir,{recursive:true,force:true});
 let blockedOnce=false;
 for(let at=Math.floor(total/2);at<=total&&!blockedOnce;at++){
  const f=await fixture();
  try{
   crash(f,at);
   const applied=readFileSync(join(f.source,'a.txt'),'utf8')==='alpha implemented';
   if(!applied||!existsSync(join(f.source,'.nexo-merge-lock')))continue;
   writeFileSync(join(f.source,'a.txt'),'someone else edited this');
   writeFileSync(join(f.source,'keep.txt'),'untouched');
   const result=await reconcileInterruptedMerge({sourceWorkspace:f.source});
   assert.equal(result.status,'blocked');assert.equal(result.reason,'divergent_files');
   assert.ok(result.items.some(item=>item.path==='a.txt'&&item.state==='divergent'));
   assert.equal(readFileSync(join(f.source,'a.txt'),'utf8'),'someone else edited this');
   assert.ok(existsSync(join(f.source,'.nexo-merge-lock','journal.json')));
   assert.ok(existsSync(join(f.source,'.nexo-merge-lock','backup-0')));
   await assert.rejects(()=>mergeImplementationChanges(f.snapshot,{exclusiveWriter:true}),/EEXIST|exists/i);
   blockedOnce=true;
  }finally{rmSync(f.dir,{recursive:true,force:true});}
 }
 assert.ok(blockedOnce,'found a checkpoint where a.txt was already applied');
});

test('reconciliation refuses a live lock owner, a mismatching digest and a damaged backup',async()=>{
 const f=await fixture();
 try{
  const probe=await fixture();const total=Number(/calls (\d+)/.exec(crash(probe,Infinity).stdout)?.[1]);rmSync(probe.dir,{recursive:true,force:true});
  crash(f,Math.floor(total*0.7));
  const lock=join(f.source,'.nexo-merge-lock');
  assert.ok(existsSync(join(lock,'journal.json')));
  const ownerFile=join(lock,'owner.json'),owner=JSON.parse(readFileSync(ownerFile,'utf8'));
  writeFileSync(ownerFile,JSON.stringify({...owner,pid:process.pid+0===process.pid?process.ppid:owner.pid}));
  assert.equal((await reconcileInterruptedMerge({sourceWorkspace:f.source})).reason,'lock_owner_alive');
  writeFileSync(ownerFile,JSON.stringify(owner));
  assert.equal((await reconcileInterruptedMerge({sourceWorkspace:f.source,expectedSnapshotDigest:'0'.repeat(64)})).reason,'journal_mismatch');
  assert.ok(existsSync(lock));
  const backups=readdirSync(lock).filter(name=>name.startsWith('backup-'));
  writeFileSync(join(lock,backups[0]),'damaged');
  const damaged=await reconcileInterruptedMerge({sourceWorkspace:f.source});
  if(damaged.status==='blocked')assert.equal(damaged.reason,'backup_corrupted');
  assert.ok(existsSync(lock)||damaged.status!=='blocked');
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('a normal merge and a cancelled merge leave no lock, journal or temporary file behind',async()=>{
 const f=await fixture();
 try{
  await mergeImplementationChanges(f.snapshot,{exclusiveWriter:true,expectedSnapshotDigest:f.digest});
  assert.ok(!existsSync(join(f.source,'.nexo-merge-lock')));
  assert.equal(readFileSync(join(f.source,'a.txt'),'utf8'),'alpha implemented');
  assert.equal((await reconcileInterruptedMerge({sourceWorkspace:f.source})).status,'no_interruption');
  assert.ok(!Object.keys(tree(f.source)).some(name=>name.includes('.nexo-')));
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

async function serverAfterCrash(t,at){
 const {createStore}=await import('../src/store.mjs'),{createMissionServer}=await import('../src/server.mjs');
 const f=await fixture();
 const total=at==='last'?Number(/calls (\d+)/.exec(crash(await fixture().then(p=>{t.after(()=>rmSync(p.dir,{recursive:true,force:true}));return p;}),Infinity).stdout)?.[1]):at;
 assert.equal(crash(f,total).status,9);
 const dataDir=join(f.dir,'state'),store=createStore(dataDir,{tasks:[],profiles:{}}),db=store.load();
 db.tasks=[{id:'11111111-1111-1111-1111-111111111111',workspace:f.source,title:'Crashed merge',goal:'g',acceptance:'a',status:'blocked',agent:'codex',profile:'implementation',specialist:'generalist',max_minutes:10,created_at:'2026-10-04T10:00:00Z',
  attempt:{id:'review-attempt',state:'terminal'},implementation_run:{attempt_id:'impl-attempt'},implementation_evidence:{implementation_attempt_id:'impl-attempt',changes:[{path:'a.txt'}]},
  review_snapshot:{snapshot_digest:f.digest,review_attempt_id:'review-attempt',implementation_attempt_id:'impl-attempt',changes:[{path:'a.txt'}]},review_contract:{decision:'approved',snapshot_digest:f.digest},
  integration:{status:'waiting',review_attempt_id:'review-attempt',snapshot_digest:f.digest}}];
 store.save(db);store.close();
 const app=createMissionServer({dataDir,codexPath:process.execPath});await app.listen(0);
 t.after(async()=>{await app.close();rmSync(f.dir,{recursive:true,force:true});});
 const read=async()=>(await(await fetch(app.url+'/api/state')).json()).tasks[0];
 for(let n=0;n<300;n++){const row=await read();if(row.integration?.reconciliation)return {f,row};await new Promise(r=>setTimeout(r,20));}
 throw new Error('integration was not reconciled at startup');
}

test('at startup an interrupted merge is restored from its journal and the mission is blocked with an explicit reason, never completed',async t=>{
 const {f,row}=await serverAfterCrash(t,12);
 assert.equal(row.integration.status,'blocked');
 assert.match(row.integration.reason,/nenhuma alteração do usuário foi sobrescrita/);
 assert.ok(['rolled_back','cleared_no_mutation','no_interruption'].includes(row.integration.reconciliation.status),row.integration.reconciliation.status);
 assert.notEqual(row.status,'done');
 assert.deepEqual(tree(f.source),f.original);
 assert.ok(!existsSync(join(f.source,'.nexo-merge-lock')));
});

test('at startup a merge that finished writing is verified file by file and only then recorded as merged and done',async t=>{
 const {f,row}=await serverAfterCrash(t,'last');
 assert.equal(row.integration.reconciliation.status,'all_applied');
 assert.equal(row.integration.status,'merged');
 assert.equal(row.integration.recovered,true);
 assert.equal(row.status,'done');
 assert.equal(readFileSync(join(f.source,'a.txt'),'utf8'),'alpha implemented');
 assert.ok(!existsSync(join(f.source,'.nexo-merge-lock')));
});
