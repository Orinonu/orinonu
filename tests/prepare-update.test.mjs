import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareUpdate} from '../scripts/prepare-update.mjs';

const fakeRun=(calls,fail=false)=>(command,args,{cwd})=>{
 calls.push({command,args,cwd});
 if(args[0]==='clone'){const target=args.at(-1);mkdirSync(target);writeFileSync(join(target,'package.json'),JSON.stringify({version:'0.0.5'}));}
 if(args[0]==='rev-parse')return 'b'.repeat(40);
 if(fail&&args.includes('check:ui'))throw new Error('fixture failure');
 return '';
};
test('update preparation clones only official main, validates it and never promotes or increments the version',()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-preparation-')),calls=[];
 try{
  const result=prepareUpdate({parent:dir,npmCli:'fixture-npm-cli.mjs',run:fakeRun(calls)});
  assert.equal(result.version,'0.0.5');assert.equal(result.commit,'b'.repeat(40));assert.equal(result.applied,false);
  assert.ok(calls[0].args.includes('https://github.com/Orinonu/orinonu.git'));assert.ok(calls[0].args.includes('main'));
  for(const script of ['check:runtime','test','check:ui','test:ui','build:ui'])assert.ok(calls.some(call=>call.args.includes(script)),script);
  assert.ok(calls.some(call=>call.args.includes('tests/configure_test.py')));
  assert.ok(calls.every(call=>!call.args.some(arg=>/promote-autonomy|install\.ps1|reset|clean|push/.test(arg))));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed validation leaves the current installation untouched and does not declare preparation successful',()=>{
 const dir=mkdtempSync(join(tmpdir(),'orinonu-preparation-fail-')),calls=[];
 try{assert.throws(()=>prepareUpdate({parent:dir,npmCli:'fixture-npm-cli.mjs',run:fakeRun(calls,true)}),/fixture failure/);assert.ok(!calls.some(call=>call.args.includes('build:ui')));}
 finally{rmSync(dir,{recursive:true,force:true});}
});
