// The server stores everything in node:sqlite and requires SQLite >= 3.51.3. This check never imports the store, so a runtime
// that cannot even load the module still gets an actionable diagnosis instead of a stack trace.
// Verified combinations (full suite plus this check): Node 24.21.0 and Node 26.9.0, both with SQLite 3.53.4.
// Older Node lines are not claimed: whether they bundle a new enough SQLite is decided by the check, not by the version number.
const NL=String.fromCharCode(10);
export const MIN_SQLITE='3.51.3';
export const MIN_NODE_MAJOR=24;
export const VERIFIED_RUNTIMES=[{node:'24.21.0',sqlite:'3.53.4'},{node:'26.9.0',sqlite:'3.53.4'}];
const parts=version=>String(version).split('.').map(part=>Number.parseInt(part,10));
export function atLeast(version,minimum){
 const a=parts(version),b=parts(minimum);
 for(let index=0;index<3;index++){const left=Number.isFinite(a[index])?a[index]:0,right=b[index]??0;if(left!==right)return left>right;}
 return true;
}
export async function checkRuntime({nodeVersion=process.versions.node,loadSqlite=()=>import('node:sqlite')}={}){
 const problems=[],warnings=[];
 if(parts(nodeVersion)[0]<MIN_NODE_MAJOR)warnings.push({code:'node_not_verified',message:`Node ${nodeVersion} não foi verificado com este projeto (verificados: ${VERIFIED_RUNTIMES.map(row=>row.node).join(', ')}).`,action:`Prefira Node ${MIN_NODE_MAJOR} LTS ou superior; esta versão só funciona se o SQLite embutido passar na verificação.`});
 let sqlite=null;
 try{
  const {DatabaseSync}=await loadSqlite();
  const db=new DatabaseSync(':memory:');
  try{sqlite=db.prepare('SELECT sqlite_version() AS version').get().version;}finally{db.close();}
  if(!atLeast(sqlite,MIN_SQLITE))problems.push({code:'sqlite_too_old',message:`O Node ${nodeVersion} embute SQLite ${sqlite}; o projeto exige SQLite >= ${MIN_SQLITE}.`,action:`Atualize para uma versão do Node que embuta SQLite >= ${MIN_SQLITE} (por exemplo ${VERIFIED_RUNTIMES.map(row=>row.node).join(' ou ')}).`});
 }catch(error){
  const missing=error?.code==='ERR_UNKNOWN_BUILTIN_MODULE'||/node:sqlite/.test(String(error?.message));
  problems.push(missing
   ?{code:'sqlite_module_missing',message:`O Node ${nodeVersion} não oferece o módulo node:sqlite.`,action:`Use Node ${MIN_NODE_MAJOR} LTS ou superior.`}
   :{code:'sqlite_unusable',message:'O SQLite embutido no Node não pôde ser inicializado: '+String(error?.message??error).slice(0,200),action:'Reinstale o Node a partir da distribuição oficial e execute npm run check:runtime novamente.'});
 }
 return {ok:problems.length===0,node:nodeVersion,sqlite,problems,warnings};
}
export const formatRuntime=result=>result.ok?[`Runtime ready: Node ${result.node}, SQLite ${result.sqlite}`,...result.warnings.map(warning=>`Aviso: ${warning.message} ${warning.action}`)].join(NL):['Runtime incompatível:',...result.problems.map(problem=>`- ${problem.message}\n  Ação: ${problem.action}`)].join('\n');
