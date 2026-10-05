import {existsSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export const UPDATE_REPOSITORY='Orinonu/orinonu';
export const UPDATE_BRANCH='main';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);

export function readInstallation(root){
 const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 const base={version:version(pkg.version)?pkg.version:null,commit:null,branch:UPDATE_BRANCH,dirty:false};
 try{
  const record=JSON.parse(readFileSync(join(root,'installation.json'),'utf8'));
  if(record.version===base.version&&sha(record.commit)&&record.branch===UPDATE_BRANCH){
   const files=record.files&&typeof record.files==='object'&&!Array.isArray(record.files)?record.files:{};
   const directory=realpathSync(root);
   const dirty=Object.entries(files).some(([path,hash])=>{
    const target=resolve(root,path);
    return !target.startsWith(directory+sep)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||!existsSync(target)||lstatSync(target).isSymbolicLink()||!realpathSync(target).startsWith(directory+sep)||createHash('sha256').update(readFileSync(target)).digest('hex')!==hash;
   });
   return {...base,commit:record.commit,dirty};
  }
 }catch{}
 if(!existsSync(join(root,'.git')))return base;
 try{
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:5000,stdio:['ignore','pipe','ignore']}).trim();
  const commit=git(['rev-parse','HEAD']);
  return {...base,commit:sha(commit)?commit:null,branch:git(['rev-parse','--abbrev-ref','HEAD']),dirty:git(['status','--porcelain']).length>0};
 }catch{return base;}
}

export function createUpdateChecker({getInstallation,fetcher=fetch,now=Date.now}={}){
 let result={repository:UPDATE_REPOSITORY,channel:UPDATE_BRANCH,installed:getInstallation(),latest:null,status:'not_checked',behind:null,ahead:null,checked_at:null,error:null};
 let pending;
 const request=async path=>{
  const response=await fetcher(`https://api.github.com/repos/${UPDATE_REPOSITORY}/${path}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'Orinonu'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(response.status===404?'repository_unavailable':response.status===403||response.status===429?'rate_limited':'remote_unavailable');
  return response.json();
 };
 const status=()=>{
  const installed=getInstallation();
  const changed=installed.commit!==result.installed.commit||installed.version!==result.installed.version||installed.branch!==result.installed.branch||installed.dirty!==result.installed.dirty;
  return changed?{...result,installed,status:installed.dirty?'local_changes':'not_checked',behind:null,ahead:null}:{...result,installed};
 };
 function check(){
  if(pending)return pending;
  pending=(async()=>{
   const installed=getInstallation();
   try{
    const head=await request('commits/'+UPDATE_BRANCH);
    if(!sha(head.sha))throw new Error('invalid_remote');
    const contents=await request('contents/package.json?ref='+head.sha);
    if(contents.encoding!=='base64'||typeof contents.content!=='string'||contents.content.length>65536)throw new Error('invalid_remote');
    const pkg=JSON.parse(Buffer.from(contents.content,'base64').toString('utf8'));
    if(!version(pkg.version))throw new Error('invalid_remote');
    const latest={commit:head.sha,version:pkg.version};
    let behind=null,ahead=null,state='untracked';
    if(sha(installed.commit)){
     const compare=await request(`compare/${installed.commit}...${head.sha}`);
     if(!['ahead','behind','identical','diverged'].includes(compare.status)||!Number.isSafeInteger(compare.ahead_by)||compare.ahead_by<0||!Number.isSafeInteger(compare.behind_by)||compare.behind_by<0)throw new Error('invalid_remote');
     behind=compare.ahead_by;ahead=compare.behind_by;
     state=behind&&ahead?'diverged':ahead?'ahead':behind?'update_available':'up_to_date';
    }
    if(installed.dirty)state='local_changes';
    result={...result,installed,latest,status:state,behind,ahead,checked_at:new Date(now()).toISOString(),error:null};
   }catch(error){
    const known=['repository_unavailable','rate_limited','remote_unavailable','invalid_remote'];
    result={...result,installed,status:'unavailable',behind:null,ahead:null,checked_at:new Date(now()).toISOString(),error:known.includes(error.message)?error.message:'remote_unavailable'};
   }
   return status();
  })().finally(()=>{pending=null;});
  return pending;
 }
 return {status,check};
}
