import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function prepareUpdate({parent=join(homedir(),'.codex','mission-control','updates'),npmCli=process.env.npm_execpath,run=(command,args,{cwd,capture=false})=>execFileSync(command,args,{cwd,windowsHide:true,encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit'})}={}){
 if(!npmCli)throw new Error('Use npm run update:prepare para preparar uma atualização.');
 mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'orinonu-')),workspace=join(directory,'source');
 run('git',['clone','--depth','1','--branch','main','--single-branch','https://github.com/Orinonu/orinonu.git',workspace],{cwd:directory});
 const commit=String(run('git',['rev-parse','HEAD'],{cwd:workspace,capture:true})).trim();
 if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Commit remoto inválido. Nada foi aplicado.');
 const pkg=JSON.parse(readFileSync(join(workspace,'package.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version))throw new Error('Versão remota inválida. Nada foi aplicado.');
 const npm=args=>run(process.execPath,[npmCli,...args],{cwd:workspace});
 npm(['run','check:runtime']);npm(['--prefix','frontend','ci']);
 for(const script of ['test','check:ui','test:ui','build:ui'])npm(['run',script]);
 run('python',['tests/configure_test.py'],{cwd:workspace});
 return {path:workspace,version:pkg.version,commit,branch:'main',applied:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=prepareUpdate();
 console.log(JSON.stringify(result,null,2));
 const script=join(result.path,'scripts','promote-autonomy.ps1').replaceAll("'","''");
 console.log(`Atualização preparada, não aplicada. Revise o snapshot e aguarde o encerramento das missões e reservas.\nNo PowerShell: & '${script}' -DryRun\nApós confirmar o destino, execute o mesmo comando sem -DryRun para promover com backup e verificações.`);
}
