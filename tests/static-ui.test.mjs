import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {uiAsset} from '../src/static-ui.mjs';

test('static UI requires a native export and never serves legacy surfaces or frames',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nexo-static-'));
 try {
  writeFileSync(join(dir,'index.html'),'classic');
  assert.equal(uiAsset(dir,'/'),null);
  mkdirSync(join(dir,'ui','_next','static'),{recursive:true});
  writeFileSync(join(dir,'ui','index.html'),'next');
  writeFileSync(join(dir,'ui','icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir,'ui','csp.json'),JSON.stringify({scriptHashes:["'sha256-YWJjZA=='"]}));
  writeFileSync(join(dir,'ui','_next','static','chunk.js'),'module');
  const main=uiAsset(dir,'/');
  assert.equal(main.body.toString(),'next');
  assert.match(main.headers['Content-Security-Policy'],/sha256-YWJjZA==/);
  assert.doesNotMatch(main.headers['Content-Security-Policy'],/script-src[^;]*unsafe-/);
  assert.equal(uiAsset(dir,'/_next/static/chunk.js').body.toString(),'module');
  assert.match(uiAsset(dir,'/icon.svg').headers['Content-Type'],/image\/svg\+xml/);
  assert.match(main.headers['Content-Security-Policy'],/frame-src 'none'; frame-ancestors 'none'/);
  for(const path of ['/classic','/classic/','/app.js','/style.css'])assert.equal(uiAsset(dir,path),null,path);
  for(const path of ['/../package.json','/%2e%2e/package.json','/_next/static/../../csp.json','/_next/static/%2e%2e/%2e%2e/csp.json','/ui/csp.json','/_next/static/%5c..%5csecret','/unknown'])assert.equal(uiAsset(dir,path),null,path);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
