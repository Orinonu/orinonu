import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createImplementationWorkspace,inspectImplementationChanges,mergeImplementationChanges,archiveAttemptEvidence,readAttemptEvidence} from '../src/implementation-workspace.mjs';
import {reviewContractPrompt} from '../src/review-contract.mjs';

async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'nexo-evidence-')),source=join(dir,'project'),evidenceRoot=join(dir,'evidence');
 mkdirSync(join(source,'src'),{recursive:true});
 writeFileSync(join(source,'src','a.txt'),'linha 1\nação — 日本語 😀\nlinha 3\n');writeFileSync(join(source,'gone.txt'),'to be deleted');writeFileSync(join(source,'logo.bin'),Buffer.from([0,1,2,3,255,254]));writeFileSync(join(source,'big.txt'),'x'.repeat(2000));
 const snapshot=await createImplementationWorkspace({workspace:source,isolationRoot:join(dir,'isolated'),taskId:'taskA',attemptId:'attemptA'});
 writeFileSync(join(snapshot.workspace,'src','a.txt'),'linha 1\nação — editada 😀\nlinha 3\n');
 rmSync(join(snapshot.workspace,'gone.txt'));
 writeFileSync(join(snapshot.workspace,'created.txt'),'novo arquivo');
 writeFileSync(join(snapshot.workspace,'logo.bin'),Buffer.from([9,9,0,0]));
 writeFileSync(join(snapshot.workspace,'big.txt'),'y'.repeat(3000));
 return {dir,source,evidenceRoot,snapshot,report:await inspectImplementationChanges(snapshot)};
}

test('creation, update and deletion are archived with exact before/after text and survive the merge and later missions',async()=>{
 const f=await fixture();
 try{
  const evidence=await archiveAttemptEvidence(f.snapshot,f.report,{evidenceRoot:f.evidenceRoot,maxTextBytes:2500});
  assert.equal(evidence.change_count,5);
  assert.equal(evidence.snapshot_digest,f.report.snapshot_digest);
  assert.ok(evidence.directory.endsWith(join('taskA','attemptA')));
  await mergeImplementationChanges(f.snapshot,{exclusiveWriter:true,expectedSnapshotDigest:f.report.snapshot_digest});
  // A later mission rewrites the same file; the archived attempt must not move.
  writeFileSync(join(f.source,'src','a.txt'),'completely different later');
  const updated=await readAttemptEvidence(evidence.directory,'src/a.txt');
  assert.equal(updated.kind,'update');
  assert.equal(updated.before,'linha 1\nação — 日本語 😀\nlinha 3\n');
  assert.equal(updated.after,'linha 1\nação — editada 😀\nlinha 3\n');
  const created=await readAttemptEvidence(evidence.directory,'created.txt');
  assert.deepEqual([created.kind,created.before,created.after],['create',null,'novo arquivo']);
  const deleted=await readAttemptEvidence(evidence.directory,'gone.txt');
  assert.deepEqual([deleted.kind,deleted.before,deleted.after],['delete','to be deleted',null]);
  const binary=await readAttemptEvidence(evidence.directory,'logo.bin');
  assert.equal(binary.content,'binary');assert.equal(binary.before,undefined);assert.equal(binary.after,undefined);assert.ok(binary.before_sha256&&binary.after_sha256);
  const big=await readAttemptEvidence(evidence.directory,'big.txt');
  assert.equal(big.content,'too_large');assert.equal(big.after,undefined);
  await assert.rejects(()=>readAttemptEvidence(evidence.directory,'unknown.txt'),/not part/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('archiving is idempotent for the same snapshot, immutable, and refuses a different snapshot for the same attempt',async()=>{
 const f=await fixture();
 try{
  const first=await archiveAttemptEvidence(f.snapshot,f.report,{evidenceRoot:f.evidenceRoot});
  const again=await archiveAttemptEvidence(f.snapshot,f.report,{evidenceRoot:f.evidenceRoot});
  assert.deepEqual(again,first);
  writeFileSync(join(f.snapshot.workspace,'created.txt'),'edited after review');
  const changed=await inspectImplementationChanges(f.snapshot);
  await assert.rejects(()=>archiveAttemptEvidence(f.snapshot,changed,{evidenceRoot:f.evidenceRoot}),/different snapshot/);
  assert.equal((await readAttemptEvidence(first.directory,'created.txt')).after,'novo arquivo');
  const blob=join(first.directory,'blobs',readdirSync(join(first.directory,'blobs'))[0]);
  writeFileSync(blob,'tampered');
  await assert.rejects(async()=>{for(const path of ['src/a.txt','created.txt','gone.txt','big.txt'])await readAttemptEvidence(first.directory,path);},/does not match/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('a before-text that cannot be recovered is declared instead of invented, and invalid input fails closed',async()=>{
 const f=await fixture();
 try{
  writeFileSync(join(f.source,'src','a.txt'),'canonical moved on before archiving');
  const evidence=await archiveAttemptEvidence(f.snapshot,f.report,{evidenceRoot:f.evidenceRoot});
  const moved=await readAttemptEvidence(evidence.directory,'src/a.txt');
  assert.equal(moved.content,'before_unavailable');
  assert.equal(moved.before,undefined);
  assert.equal(moved.after,'linha 1\nação — editada 😀\nlinha 3\n');
  await assert.rejects(()=>archiveAttemptEvidence(f.snapshot,f.report,{evidenceRoot:'relative'}),/Absolute evidence root/);
  await assert.rejects(()=>archiveAttemptEvidence({...f.snapshot,taskId:'../escape'},f.report,{evidenceRoot:f.evidenceRoot}),/identity/);
  await assert.rejects(()=>archiveAttemptEvidence(f.snapshot,{changes:[]},{evidenceRoot:f.evidenceRoot}),/Invalid change report/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('private files never reach the evidence and the review prompt references it with its checksum',async()=>{
 const f=await fixture();
 try{
  const evidence=await archiveAttemptEvidence(f.snapshot,f.report,{evidenceRoot:f.evidenceRoot});
  const manifest=readFileSync(evidence.manifest_path,'utf8');
  assert.doesNotMatch(manifest,/\.env|credentials|\.pem/);
  writeFileSync(join(f.snapshot.workspace,'.env'),'TOKEN=abc');
  await assert.rejects(()=>inspectImplementationChanges(f.snapshot),/Excluded private path/);
  const prompt=reviewContractPrompt({snapshot_digest:'a'.repeat(64),evidence});
  assert.ok(prompt.includes(evidence.manifest_path));assert.ok(prompt.includes(evidence.manifest_sha256));assert.match(prompt,/nexo-review/);
  assert.doesNotMatch(reviewContractPrompt({snapshot_digest:'a'.repeat(64)}),/Evidência imutável/);
  assert.doesNotMatch(reviewContractPrompt({snapshot_digest:'a'.repeat(64),evidence:{status:'unavailable'}}),/Evidência imutável/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
