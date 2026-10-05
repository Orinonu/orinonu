import {existsSync,lstatSync,realpathSync,readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,relative,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const roots=new Set(['src','scripts','tests','evals','bundles','frontend','.github']);
const rootFiles=new Set(['package.json','README.md','AGENTS.md','LICENSE','NOTICE','CLA.md','CONTRIBUTING.md','GOVERNANCE.md','CODEOWNERS','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes']);
const docs=new Set(['brand-and-design.md','community-context.md','community-harness-policy.md','distribution-and-community.md','evaluation.md','project-charter-and-autonomy.md','versioning.md','interface-mission-control.md']);
const excludedDirectories=new Set(['node_modules','.git','.devin','.playwright-mcp','data','private','backups','workspaces','integration-staging','__pycache__','.next','out','releases']);
const retired=new Set(['scripts/preview-local.mjs','scripts/integrate-evals-ui.mjs','tests/profiles-accessibility-ui.test.mjs','tests/missions-layout.test.mjs','tests/investigation-activity-ui.test.mjs','tests/session-work-ui.test.mjs','tests/refresh-sequencing-ui.test.mjs','tests/opportunity-capacity-ui.test.mjs','tests/kanban-progress-ui.test.mjs','tests/direction-assistance-ui.test.mjs','tests/kanban-scroll.test.mjs']);
const extensions=new Set(['.mjs','.js','.ts','.tsx','.css','.json','.py','.ps1','.md','.yaml','.yml','.svg','.map']);
const hash=content=>createHash('sha256').update(content).digest('hex');
const blockedName=name=>/^\.env(?:\.|$)|\.(?:sqlite(?:-wal|-shm)?|db|log|pem|key|p12|pfx|pyc|tsbuildinfo)$/i.test(name);
const issues=(path,text)=>{
 const found=[];
 const credential=/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{15,})\b/g;
 for(const match of text.matchAll(credential))if(!/^(?:tests|frontend\/tests|bundles\/[^/]+\/tests)\//.test(path)||!/FAKE|SENTINEL/i.test(match[0]))found.push('credential_shape');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]/.test(text))found.push('private_key');
 for(const match of text.replaceAll('\\','/').matchAll(/C:\/+Users\/+([^\s\/"']+)/gi))if(!/^(?:USER|x|example|test|runneradmin)$/i.test(match[1]))found.push('personal_path');
 return [...new Set(found)];
};

export function collectPublicSource(root){
 const entries=[],base=realpathSync(root);
 const add=(path,source=path)=>{
  const absolute=join(root,source),stat=lstatSync(absolute);
  if(stat.isSymbolicLink()||!stat.isFile()||!realpathSync(absolute).startsWith(base+sep))throw new Error('Arquivo público inválido: '+source);
  const content=readFileSync(absolute),findings=issues(path,content.toString('utf8'));
  if(findings.length)throw new Error(`Publicação bloqueada: ${path} (${findings.join(', ')}). Revise o arquivo sem publicar valores sensíveis.`);
  entries.push({path,source,sha256:hash(content),bytes:content.length,content});
 };
 const walk=(directory,prefix)=>{
  if(lstatSync(directory).isSymbolicLink())throw new Error('Link simbólico não permitido na distribuição: '+prefix);
  for(const name of readdirSync(directory).sort()){
   if(excludedDirectories.has(name)||blockedName(name))continue;
   const path=prefix+'/'+name,absolute=join(directory,name),stat=lstatSync(absolute);
   if(retired.has(path))continue;
   if(stat.isSymbolicLink())throw new Error('Link simbólico não permitido na distribuição: '+path);
   if(stat.isDirectory())walk(absolute,path);
   else if(stat.isFile()&&(extensions.has(extname(name))||/^LICENSE|^NOTICE|^COPYING/i.test(name)))add(path);
  }
 };
 for(const name of readdirSync(root).sort()){
  if(rootFiles.has(name))add(name);
  else if(roots.has(name)){
   const directory=join(root,name);
   if(lstatSync(directory).isSymbolicLink())throw new Error('Diretório público é um link simbólico: '+name);
   if(name==='frontend'){
    for(const part of ['src','tests','scripts','e2e'])if(existsSync(join(directory,part)))walk(join(directory,part),'frontend/'+part);
    for(const file of ['package.json','package-lock.json','next.config.ts','next-env.d.ts','tsconfig.json','postcss.config.mjs','components.json'])if(existsSync(join(directory,file)))add('frontend/'+file);
   }else walk(directory,name);
  }
 }
 for(const name of docs)if(existsSync(join(root,'docs',name)))add('docs/'+name);
 if(existsSync(join(root,'public','brand.css')))add('public/brand.css');
 add('CONTEXT.md','docs/community-context.md');add('docs/harness-policy.md','docs/community-harness-policy.md');
 return entries.sort((a,b)=>a.path.localeCompare(b.path));
}

export function verifyPublicSnapshot(root,manifest){
 const current=new Map(collectPublicSource(root).map(row=>[row.path,row])),changed=[];
 for(const row of manifest.files){const actual=current.get(row.path);if(!actual||actual.source!==row.source||actual.sha256!==row.sha256)changed.push(row.path);current.delete(row.path);}
 changed.push(...current.keys());
 return {ok:changed.length===0,changed};
}

export function exportPublicSource(root,destination){
 root=resolve(root);destination=resolve(destination);
 if(existsSync(destination))throw new Error('O destino já existe; nenhuma pasta será sobrescrita.');
 const relativeDestination=relative(root,destination).split(sep)[0];
 if(destination===root||roots.has(relativeDestination)||['public','docs'].includes(relativeDestination))throw new Error('Destino deve ser uma nova pasta fora das raízes de código.');
 const entries=collectPublicSource(root);
 for(const path of ['package.json','README.md','AGENTS.md','LICENSE','NOTICE','GOVERNANCE.md','CLA.md','CONTRIBUTING.md','CODEOWNERS','THIRD_PARTY_NOTICES.md'])if(!entries.some(row=>row.path===path))throw new Error('Arquivo obrigatório ausente: '+path);
 const manifest={version:JSON.parse(entries.find(row=>row.path==='package.json').content.toString()).version,created_at:new Date().toISOString(),policy:'source-only-allowlist-v1',files:entries.map(({path,source,sha256,bytes})=>({path,source,sha256,bytes}))};
 if(!verifyPublicSnapshot(root,manifest).ok)throw new Error('O código mudou durante a coleta; publicação abortada.');
 mkdirSync(destination,{recursive:true});
 for(const row of entries){const path=join(destination,row.path);mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,row.content,{flag:'wx'});}
 if(!verifyPublicSnapshot(root,manifest).ok)throw new Error('O código mudou durante a exportação; não publique este snapshot.');
 writeFileSync(join(destination,'SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));
 const [mode,destination]=process.argv.slice(2);
 if(mode==='--verify'){
  if(!destination)throw new Error('Informe o snapshot a verificar.');
  const manifest=JSON.parse(readFileSync(join(resolve(destination),'SOURCE_MANIFEST.json'),'utf8'));
  const result=verifyPublicSnapshot(root,manifest);console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
 }else if(mode==='--check'){
  const entries=collectPublicSource(root);console.log(JSON.stringify({ok:true,files:entries.length,bytes:entries.reduce((n,row)=>n+row.bytes,0)}));
 }else{
  const target=mode?resolve(mode):join(root,'releases','orinonu-source-'+Date.now());
  const manifest=exportPublicSource(root,target);console.log(JSON.stringify({path:target,version:manifest.version,files:manifest.files.length,policy:manifest.policy},null,2));
 }
}
