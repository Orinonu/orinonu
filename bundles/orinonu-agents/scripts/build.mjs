import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'out');
const result=await build({
 absWorkingDir:root,entryPoints:['src/main.ts'],outfile:'out/index.mjs',bundle:true,
 platform:'node',format:'esm',target:'node24',metafile:true,legalComments:'external',
 banner:{js:"import { createRequire as orinonuCreateRequire } from 'node:module'; const require = orinonuCreateRequire(import.meta.url);"},
});
const dependencies=new Set(Object.keys(result.metafile.inputs).flatMap(path=>{
 const match=path.replaceAll('\\','/').match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
 return match?[match[1]]:[];
}));
const notices=[],packages=[];
for(const name of [...dependencies].sort()){
 const directory=join(root,'node_modules',name),metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
 packages.push({name:metadata.name,version:metadata.version,license:metadata.license??null});
 const files=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name));
 if(!files.length)throw new Error('Bundled dependency license missing: '+name);
 for(const file of files.sort((a,b)=>a.name.localeCompare(b.name)))notices.push(`## ${metadata.name} ${metadata.version}\n\n${await readFile(join(directory,file.name),'utf8')}`);
}
await mkdir(out,{recursive:true});
await writeFile(join(out,'THIRD_PARTY_NOTICES.md'),notices.join('\n\n')+'\n');
const digest=createHash('sha256').update(await readFile(join(out,'index.mjs'))).digest('hex');
await writeFile(join(out,'runtime-manifest.json'),JSON.stringify({protocol_version:1,entry:'index.mjs',sha256:digest,packages},null,2)+'\n');
process.stdout.write(JSON.stringify({entry:'out/index.mjs',sha256:digest,dependency_count:packages.length})+'\n');
