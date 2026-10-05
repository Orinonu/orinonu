import {recordInstallation} from '../src/installation-info.mjs';
import {verifyEvalManifest} from '../src/evolution.mjs';
import {join} from 'node:path';
const [source,destination]=process.argv.slice(2);
if(source==='--verify-evals'){
 if(!destination)throw new Error('Informe a raiz da instalação para verificar os benchmarks.');
 const result=verifyEvalManifest(join(destination,'evals'));
 if(!result.valid)throw new Error('Integridade dos benchmarks não verificada: '+result.error);
 console.log(JSON.stringify({valid:true,checked_files:result.checked_files.length}));
}else{
 if(!source||!destination)throw new Error('Informe origem e destino da instalação.');
 const result=recordInstallation(source,destination);
 console.log(JSON.stringify({version:result.version,commit:result.commit,branch:result.branch}));
}
