import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,statSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const JEV_MODELS=[{id:'jev-latest',label:'JEV — última versão estável (recomendado)'},{id:'jev-1.13.0',label:'JEV 1.13.0 — versão fixa'},{id:'jev-preview',label:'JEV — prévia oficial'}];
const invalid=()=>new Error('Configuração TypeSafe inválida. Informe uma chave não vazia e um modelo disponível.');
function dpapi(value,decrypt=false){
  if(process.platform!=='win32')throw new Error('Armazenamento seguro de credenciais indisponível nesta plataforma.');
  const operation=decrypt?'Unprotect':'Protect';
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::ReadLine()); $result=[System.Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($result))`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:decrypt?value:Buffer.from(value,'utf8').toString('base64'),encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:16384});
  if(result.error||result.status!==0||!result.stdout.trim())throw new Error('Não foi possível acessar o armazenamento seguro de credenciais.');
  return decrypt?Buffer.from(result.stdout.trim(),'base64').toString('utf8'):result.stdout.trim();
}

// The encrypted file belongs to this installation, outside the code checkout.
export function createTypesafeSettings({dataDir,repositoryRoot,environmentKey='',protect=value=>dpapi(value),unprotect=value=>dpapi(value,true)}={}){
  const directory=join(resolve(dataDir),'private');
  const rel=relative(resolve(repositoryRoot),directory);
  if(rel===''||(!(rel==='..'||rel.startsWith(`..${sep}`))&&!isAbsolute(rel)))throw new Error('Credenciais devem ficar fora do repositório.');
  const file=join(directory,'typesafe-settings.json');
  let stored={version:1,model:'jev-latest'},privateKey='',storageError=null;
  try{
    const parsed=JSON.parse(readFileSync(file,'utf8'));
    if(parsed.version!==1||!JEV_MODELS.some(row=>row.id===parsed.model)||typeof parsed.protected_api_key!=='string'&&parsed.protected_api_key!==undefined)throw invalid();
    stored={version:1,model:parsed.model,...(parsed.protected_api_key?{protected_api_key:parsed.protected_api_key}:{})};
    if(stored.protected_api_key)privateKey=unprotect(stored.protected_api_key);
  }catch(error){if(error.code!=='ENOENT')storageError='Credenciais privadas indisponíveis; revise a configuração.';}
  const credentials=()=>({model:stored.model,apiKey:privateKey||environmentKey});
  const metadata=()=>({configured:Boolean(credentials().apiKey.trim()),model:stored.model,models:JEV_MODELS,storage:'Windows DPAPI CurrentUser · pasta privada da instalação',key_source:privateKey?'private_store':environmentKey?'environment':'missing',restart_required:false,storage_error:storageError});
  function update(body){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['typesafe_api_key','jev_model'].includes(key))||!Object.keys(body).length)throw invalid();
    if(body.jev_model!==undefined&&!JEV_MODELS.some(row=>row.id===body.jev_model))throw invalid();
    if(body.typesafe_api_key!==undefined&&(typeof body.typesafe_api_key!=='string'||!body.typesafe_api_key.trim()||body.typesafe_api_key.length>4096||/[\x00-\x1f\x7f]/.test(body.typesafe_api_key)))throw invalid();
    if(storageError&&body.typesafe_api_key===undefined)throw new Error('Reconfigure a chave para reparar o armazenamento privado.');
    const next={...stored,model:body.jev_model??stored.model};
    const nextKey=body.typesafe_api_key===undefined?privateKey:body.typesafe_api_key.trim();
    if(body.typesafe_api_key!==undefined)next.protected_api_key=protect(nextKey);
    mkdirSync(directory,{recursive:true,mode:0o700});const temporary=join(directory,`.settings-${randomUUID()}.tmp`);
    try{writeFileSync(temporary,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,file);}catch{throw new Error('Não foi possível salvar a configuração privada.');}finally{rmSync(temporary,{force:true});}
    stored=next;privateKey=nextKey;storageError=null;return metadata();
  }
  return {credentials,metadata,update};
}

// MCP keeps a single engine/cache until the atomically replaced settings file changes.
export function createLiveTypesafeSettings(options){
  let signature,settings;
  return ()=>{
    let next='absent';try{const stat=statSync(join(options.dataDir,'private','typesafe-settings.json'));next=`${stat.mtimeMs}:${stat.size}:${stat.ino}`;}catch{}
    if(!settings||next!==signature){settings=createTypesafeSettings(options);signature=next;}
    return settings.credentials();
  };
}
