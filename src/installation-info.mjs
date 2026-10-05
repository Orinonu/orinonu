import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyEvalManifest} from './evolution.mjs';

const parts=new Set(['src','public','scripts','docs','bundles','evals']);
const files=new Set(['package.json','CONTEXT.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','CLA.md','GOVERNANCE.md','CONTRIBUTING.md','CODEOWNERS']);
const excluded=new Set(['node_modules','.git','.devin','data','private','backups','__pycache__','.next','out']);
export function recordInstallation(sourceRoot,destination,{git}={}){
 const pkg=JSON.parse(readFileSync(join(sourceRoot,'package.json'),'utf8'));
 if(existsSync(join(sourceRoot,'evals'))){
  for(const root of [sourceRoot,destination]){const verification=verifyEvalManifest(join(root,'evals'));if(!verification.valid)throw new Error('Integridade dos benchmarks não verificada: '+verification.error);}
  if(!readFileSync(join(sourceRoot,'evals','MANIFEST.json')).equals(readFileSync(join(destination,'evals','MANIFEST.json'))))throw new Error('Manifesto de benchmarks instalado diverge da origem.');
 }
 let identity={commit:null,branch:'main'};
 try{
  if(git)identity=git(sourceRoot);
  else if(existsSync(join(sourceRoot,'.git'))){const command=args=>execFileSync('git',['-C',sourceRoot,...args],{encoding:'utf8',windowsHide:true,timeout:5000,stdio:['ignore','pipe','ignore']}).trim();identity={commit:command(['rev-parse','HEAD']),branch:command(['rev-parse','--abbrev-ref','HEAD'])};}
 }catch{}
 if(!/^[a-f0-9]{40}$/.test(identity.commit??''))identity.commit=null;
 const hashes={};
 const walk=(directory,prefix='')=>{
  for(const name of readdirSync(directory).sort()){
   if(excluded.has(name)||!prefix&&!parts.has(name)&&!files.has(name))continue;
   const path=join(directory,name),relative=prefix?prefix+'/'+name:name,stat=lstatSync(path);
   if(stat.isSymbolicLink())throw new Error('Links simbólicos não são aceitos no recibo de instalação.');
   if(stat.isDirectory())walk(path,relative);else if(stat.isFile())hashes[relative]=createHash('sha256').update(readFileSync(path)).digest('hex');
  }
 };
 walk(destination);
 const record={version:pkg.version,commit:identity.commit,branch:identity.branch,recorded_at:new Date().toISOString(),files:hashes};
 mkdirSync(destination,{recursive:true});
 const temporary=join(destination,'.installation-'+randomUUID()+'.tmp');
 writeFileSync(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx'});renameSync(temporary,join(destination,'installation.json'));
 return record;
}
