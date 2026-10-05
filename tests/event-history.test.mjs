import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rename,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEventHistory} from '../src/event-history.mjs';

test('unchanged history is reused and concurrent external append refreshes are shared',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nexo-reader-')),path=join(dir,'events.ndjson');
 try{
  await writeFile(path,'{"value":1}\ninvalid\n');
  const reader=createEventHistory(path,{verification:'bytes'});
  assert.deepEqual((await reader.read()).events,[{value:1}]);
  const before=reader.diagnostics();
  await reader.read();
  assert.equal(reader.diagnostics().parsedLines,before.parsedLines);
  assert.equal(reader.diagnostics().bytesRead,before.bytesRead);
  await appendFile(path,'{"value":2}\n');
  const generations=await Promise.all(Array.from({length:20},()=>reader.read()));
  assert.ok(generations.every(g=>g===generations[0]));
  assert.deepEqual(generations[0].events,[{value:1},{value:2}]);
  assert.equal(reader.diagnostics().parsedLines-before.parsedLines,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

for(const verification of ['bytes','digest']){
 test(`${verification}: external overwrite, rotation, truncation and recreation invalidate history`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nexo-invalidate-')),path=join(dir,'events.ndjson');
  const reader=createEventHistory(path,{verification});
  try{
   await writeFile(path,'{"v":1}\n');assert.deepEqual((await reader.read()).events,[{v:1}]);
   await writeFile(path,'{"v":2}\n');assert.deepEqual((await reader.read()).events,[{v:2}]);
   await writeFile(path,'{"v":3}\n{"v":4}\n');assert.deepEqual((await reader.read()).events,[{v:3},{v:4}]);
   await writeFile(join(dir,'replacement'),'false\n');await rename(path,join(dir,'rotated'));await rename(join(dir,'replacement'),path);
   assert.deepEqual((await reader.read()).events,[false]);
   await writeFile(path,'');assert.deepEqual((await reader.read()).events,[]);
   await writeFile(path,'0\n');assert.deepEqual((await reader.read()).events,[0]);
   await rm(path);assert.deepEqual((await reader.read()).events,[]);
   await writeFile(path,'1\n');assert.deepEqual((await reader.read()).events,[1]);
   await rm(path);await mkdir(path);await assert.rejects(reader.read());
   await rm(path,{recursive:true});await writeFile(path,'2\n');assert.deepEqual((await reader.read()).events,[2]);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 test(`${verification}: provisional JSON, invalid lines and split UTF-8 preserve legacy decoding`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nexo-tail-')),path=join(dir,'events.ndjson');
  const reader=createEventHistory(path,{verification});
  try{
   await writeFile(path,'1');assert.deepEqual((await reader.read()).events,[1]);
   await appendFile(path,'2\ninvalid\n{"text":"');assert.deepEqual((await reader.read()).events,[12]);
   const encoded=Buffer.from('á🚀"}\n');
   await appendFile(path,encoded.subarray(0,3));assert.deepEqual((await reader.read()).events,[12]);
   await appendFile(path,encoded.subarray(3));assert.deepEqual((await reader.read()).events,[12,{text:'á🚀'}]);
   const before=reader.diagnostics();await appendFile(path,'{"v":2}');
   assert.deepEqual((await reader.read()).events,[12,{text:'á🚀'},{v:2}]);
   assert.equal(reader.diagnostics().parsedLines-before.parsedLines,1);
   await appendFile(path,'\n');assert.deepEqual((await reader.read()).events,[12,{text:'á🚀'},{v:2}]);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
}
