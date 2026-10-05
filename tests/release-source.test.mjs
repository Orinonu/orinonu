import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectPublicSource,exportPublicSource,verifyPublicSnapshot} from '../scripts/release-source.mjs';

const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'orinonu-public-'));
 for(const dir of ['src','docs','public/ui','.devin','data','frontend/src','frontend/node_modules','tests'])mkdirSync(join(root,dir),{recursive:true});
 for(const file of ['LICENSE','NOTICE','README.md','AGENTS.md','GOVERNANCE.md','CLA.md','CONTRIBUTING.md','CODEOWNERS','THIRD_PARTY_NOTICES.md'])writeFileSync(join(root,file),'public fixture');
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'orinonu',version:'0.0.5'}));
 writeFileSync(join(root,'docs/community-context.md'),'# Public glossary');writeFileSync(join(root,'docs/community-harness-policy.md'),'# Public policy');
 writeFileSync(join(root,'CONTEXT.md'),'PRIVATE HISTORY');writeFileSync(join(root,'src/app.mjs'),'export const value=1;');writeFileSync(join(root,'frontend/src/app.tsx'),'export const App=()=>null;');writeFileSync(join(root,'public/brand.css'),':root{}');
 for(const file of ['.devin/mcp_config.local.json','data/state.sqlite','frontend/node_modules/private.txt','public/ui/index.html','.env','budget-test-results.txt'])writeFileSync(join(root,file),'PRIVATE FIXTURE');
 writeFileSync(join(root,'public/app.js'),'RETIRED UI');writeFileSync(join(root,'tests/kanban-scroll.test.mjs'),'RETIRED TEST');
 return root;
};

test('public source is allowlisted, excludes private and retired surfaces and replaces only the public context',()=>{
 const root=fixture();
 try{
  const entries=collectPublicSource(root),paths=entries.map(row=>row.path);
  assert.ok(paths.includes('src/app.mjs'));assert.ok(paths.includes('public/brand.css'));assert.ok(paths.includes('frontend/src/app.tsx'));
  for(const path of ['.env','.devin/mcp_config.local.json','data/state.sqlite','public/ui/index.html','public/app.js','tests/kanban-scroll.test.mjs','budget-test-results.txt'])assert.ok(!paths.includes(path),path);
  assert.equal(entries.find(row=>row.path==='CONTEXT.md').content.toString(),'# Public glossary');assert.ok(!entries.some(row=>row.content.includes('PRIVATE FIXTURE')));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a credential-shaped value blocks publication without printing the value',()=>{
 const root=fixture(),secret='ghp_'+'a'.repeat(36);
 try{writeFileSync(join(root,'src/leak.mjs'),`export const leak='${secret}';`);assert.throws(()=>collectPublicSource(root),error=>{assert.match(error.message,/src\/leak.mjs/);assert.ok(!error.message.includes(secret));return true;});}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('new source files invalidate a prepared snapshot instead of disappearing from publication',()=>{
 const root=fixture(),parent=mkdtempSync(join(tmpdir(),'orinonu-public-new-')),out=join(parent,'source');
 try{const manifest=exportPublicSource(root,out);writeFileSync(join(root,'src/new.mjs'),'export const added=true;');assert.equal(verifyPublicSnapshot(root,manifest).ok,false);}
 finally{rmSync(root,{recursive:true,force:true});rmSync(parent,{recursive:true,force:true});}
});

test('export never overwrites a destination and source drift invalidates its publication evidence',()=>{
 const root=fixture(),parent=mkdtempSync(join(tmpdir(),'orinonu-public-out-')),out=join(parent,'source');
 try{
  const manifest=exportPublicSource(root,out);assert.ok(readdirSync(out).includes('LICENSE'));assert.equal(verifyPublicSnapshot(root,manifest).ok,true);
  assert.throws(()=>exportPublicSource(root,out),/já existe/);writeFileSync(join(root,'src/app.mjs'),'export const value=2;');assert.equal(verifyPublicSnapshot(root,manifest).ok,false);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(parent,{recursive:true,force:true});}
});
