import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,statSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const SUPPORTED_PROVIDERS=[
  {id:'codex',name:'OpenAI Codex',category:'primary_subscription',models:['gpt-6.1-sol','gpt-6-luna','o3-mini','gpt-4o'],default_model:'gpt-6.1-sol'},
  {id:'antigravity',name:'Google Antigravity / Gemini',category:'google_ecosystem',models:['gemini-3.8-flash','gemini-2.5-pro','gemini-2.5-flash'],default_model:'gemini-3.8-flash'},
  {id:'devin',name:'Devin / Windsurf',category:'developer_assistant',models:['devin-2.0','windsurf-cascade'],default_model:'devin-2.0',plan_expiry:null},
  {id:'openrouter',name:'OpenRouter',category:'multi_model_api',models:['anthropic/claude-3.7-sonnet','google/gemini-2.5-flash','deepseek/deepseek-chat','openai/gpt-4o'],default_model:'anthropic/claude-3.7-sonnet'},
  {id:'anthropic',name:'Anthropic Claude',category:'direct_api',models:['claude-3-7-sonnet-20250219','claude-3-5-haiku-20241022'],default_model:'claude-3-7-sonnet-20250219'},
];

export const DEFAULT_FALLBACK_CHAIN=['codex','antigravity','devin','openrouter','anthropic'];

function dpapi(value,decrypt=false){
  if(process.platform!=='win32')throw new Error('Armazenamento seguro de credenciais indisponível nesta plataforma.');
  const operation=decrypt?'Unprotect':'Protect';
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::ReadLine()); $result=[System.Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($result))`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:decrypt?value:Buffer.from(value,'utf8').toString('base64'),encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:16384});
  if(result.error||result.status!==0||!result.stdout.trim())throw new Error('Não foi possível acessar o armazenamento seguro de credenciais.');
  return decrypt?Buffer.from(result.stdout.trim(),'base64').toString('utf8'):result.stdout.trim();
}

const invalid=msg=>new Error(msg||'Configuração de provedores inválida.');

export function createProviderSettings({dataDir,repositoryRoot,protect=value=>dpapi(value),unprotect=value=>dpapi(value,true),env=process.env}={}){
  const directory=join(resolve(dataDir),'private');
  const rel=relative(resolve(repositoryRoot),directory);
  if(rel===''||(!(rel==='..'||rel.startsWith(`..${sep}`))&&!isAbsolute(rel)))throw new Error('Credenciais devem ficar fora do repositório.');
  const file=join(directory,'provider-settings.json');

  let stored={
    version:1,
    fallback_chain:[...DEFAULT_FALLBACK_CHAIN],
    auto_fallback:true,
    providers:{
      codex:{enabled:true,model:'gpt-6.1-sol',mode:'subscription'},
      antigravity:{enabled:false,model:'gemini-3.8-flash',auth_type:'antigravity_cli'},
      devin:{enabled:true,model:'devin-2.0',auth_type:'devin_desktop',expires_at:null},
      openrouter:{enabled:false,model:'anthropic/claude-3.7-sonnet'},
      anthropic:{enabled:false,model:'claude-3-7-sonnet-20250219'},
    },
    keys:{},
  };
  let decryptedKeys={};
  let storageError=null;

  function loadStored(){
    try{
      const parsed=JSON.parse(readFileSync(file,'utf8'));
      if(parsed.version===1&&Array.isArray(parsed.fallback_chain)){
        stored={
          version:1,
          fallback_chain:parsed.fallback_chain.filter(id=>SUPPORTED_PROVIDERS.some(p=>p.id===id)),
          auto_fallback:typeof parsed.auto_fallback==='boolean'?parsed.auto_fallback:true,
          providers:{...stored.providers,...(parsed.providers??{})},
          keys:{...(parsed.keys??{})},
        };
        decryptedKeys={};
        for(const [providerId,encKey] of Object.entries(stored.keys)){
          if(typeof encKey==='string'&&encKey.trim()){
            try{decryptedKeys[providerId]=unprotect(encKey);}catch{/* corrupted or machine change */}
          }
        }
      }
    }catch(error){
      if(error.code!=='ENOENT')storageError='Credenciais de provedores indisponíveis; revise a configuração.';
    }
  }

  loadStored();

  function getDecryptedKey(providerId){
    if(decryptedKeys[providerId])return decryptedKeys[providerId];
    if(providerId==='openrouter'&&env.OPENROUTER_API_KEY)return env.OPENROUTER_API_KEY;
    if(providerId==='antigravity'&&(env.GOOGLE_API_KEY||env.GEMINI_API_KEY))return env.GOOGLE_API_KEY||env.GEMINI_API_KEY;
    if(providerId==='anthropic'&&env.ANTHROPIC_API_KEY)return env.ANTHROPIC_API_KEY;
    if(providerId==='devin'&&env.DEVIN_API_KEY)return env.DEVIN_API_KEY;
    return '';
  }

  function getKeySource(providerId){
    if(decryptedKeys[providerId])return 'private_store';
    if(providerId==='openrouter'&&env.OPENROUTER_API_KEY)return 'environment';
    if(providerId==='antigravity'&&(env.GOOGLE_API_KEY||env.GEMINI_API_KEY))return 'environment';
    if(providerId==='anthropic'&&env.ANTHROPIC_API_KEY)return 'environment';
    if(providerId==='devin'&&env.DEVIN_API_KEY)return 'environment';
    return 'none';
  }

  function metadata(){
    const providerList=SUPPORTED_PROVIDERS.map(p=>{
      const config=stored.providers[p.id]??{enabled:false,model:p.default_model};
      const keySource=getKeySource(p.id);
      const configured=p.id==='codex'||p.id==='antigravity'||p.id==='devin'||keySource!=='none';
      return {
        id:p.id,
        name:p.name,
        category:p.category,
        enabled:Boolean(config.enabled),
        model:config.model??p.default_model,
        models:p.models,
        configured,
        key_source:keySource,
        expires_at:p.id==='devin'?(config.expires_at??p.plan_expiry):undefined,
        expires_at_source:p.id==='devin'?(config.expires_at?'local_declaration':p.plan_expiry?'local_policy':'unknown'):'unknown',
      };
    });

    return {
      providers:providerList,
      fallback_chain:stored.fallback_chain,
      auto_fallback:stored.auto_fallback,
      storage:'Windows DPAPI CurrentUser · pasta privada da instalação',
      storage_error:storageError,
    };
  }

  function credentials(providerId){
    const pMeta=SUPPORTED_PROVIDERS.find(p=>p.id===providerId);
    if(!pMeta)return null;
    const config=stored.providers[providerId]??{enabled:false,model:pMeta.default_model};
    return {
      id:providerId,
      name:pMeta.name,
      enabled:Boolean(config.enabled),
      model:config.model??pMeta.default_model,
      key:getDecryptedKey(providerId),
      auth_type:config.auth_type,
      expires_at:config.expires_at??pMeta.plan_expiry,
    };
  }

  function update(body){
    if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();
    const nextStored={...stored,providers:{...stored.providers},keys:{...stored.keys}};
    const nextDecrypted={...decryptedKeys};

    if(body.fallback_chain!==undefined){
      if(!Array.isArray(body.fallback_chain)||body.fallback_chain.some(id=>!SUPPORTED_PROVIDERS.some(p=>p.id===id)))throw invalid('Cadeia de fallback com provedor desconhecido.');
      nextStored.fallback_chain=[...new Set(body.fallback_chain)];
    }

    if(body.auto_fallback!==undefined){
      if(typeof body.auto_fallback!=='boolean')throw invalid('auto_fallback deve ser booleano.');
      nextStored.auto_fallback=body.auto_fallback;
    }

    if(body.providers&&typeof body.providers==='object'&&!Array.isArray(body.providers)){
      for(const [pId,pConf] of Object.entries(body.providers)){
        const supported=SUPPORTED_PROVIDERS.find(p=>p.id===pId);
        if(!supported)continue;
        if(!pConf||typeof pConf!=='object'||Array.isArray(pConf))throw invalid('Configuração de provedor inválida.');
        if(pConf.key!==undefined&&pConf.api_key!==undefined&&pConf.key!==pConf.api_key)throw invalid('Campos de credencial conflitantes.');
        const credential=pConf.key!==undefined?pConf.key:pConf.api_key;
        if(credential!==undefined&&typeof credential!=='string')throw invalid('Credencial deve ser texto.');
        const current=nextStored.providers[pId]??{enabled:true,model:supported.default_model};
        const nextConf={...current};
        if(typeof pConf.enabled==='boolean')nextConf.enabled=pConf.enabled;
        if(typeof pConf.model==='string'&&pConf.model.trim())nextConf.model=pConf.model.trim();
        if(typeof pConf.auth_type==='string')nextConf.auth_type=pConf.auth_type.trim();
        if(pId==='devin'&&typeof pConf.expires_at==='string')nextConf.expires_at=pConf.expires_at.trim();
        nextStored.providers[pId]=nextConf;

        if(credential!==undefined){
          if(credential.trim()){
            if(credential.length>4096||/[\x00-\x1f\x7f]/.test(credential))throw invalid('Chave de API com caracteres inválidos.');
            const trimmed=credential.trim();
            nextStored.keys[pId]=protect(trimmed);
            nextDecrypted[pId]=trimmed;
          }else if(credential===''){
            delete nextStored.keys[pId];
            delete nextDecrypted[pId];
          }
        }
      }
    }

    mkdirSync(directory,{recursive:true,mode:0o700});
    const temporary=join(directory,`.provider-settings-${randomUUID()}.tmp`);
    try{
      writeFileSync(temporary,JSON.stringify(nextStored)+'\n',{mode:0o600,flag:'wx'});
      renameSync(temporary,file);
    }catch{
      throw new Error('Não foi possível salvar a configuração privada de provedores.');
    }finally{
      rmSync(temporary,{force:true});
    }

    stored=nextStored;
    decryptedKeys=nextDecrypted;
    storageError=null;
    return metadata();
  }

  return {credentials,metadata,update,supportedProviders:SUPPORTED_PROVIDERS};
}
