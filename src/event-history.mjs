import {open,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const signature=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.birthtimeNs].join(':');
const identity=s=>[s.dev,s.ino,s.birthtimeNs].join(':');

// Metadata is checked on every read; watch notifications are never authoritative.
// A changed file is read through a descriptor and checked again before publication.
export function createEventHistory(path,{verification}={}){
 if(!['bytes','digest'].includes(verification))throw new Error('Explicit prefix verification policy required.');
 const generation=(events,revision,appendFrom)=>Object.freeze({events:Object.freeze(events),revision,appendFrom});
 let published=generation([],0,null),previous=null,inflight=null;
 const stats={updates:0,bytesRead:0,parsedLines:0,rebuilds:0};
 function decode(buffer){
  const events=[];let tailValid=false;
  for(const line of buffer.toString('utf8').split('\n')){
   tailValid=false;
   if(!line)continue;stats.parsedLines++;
   try{events.push(JSON.parse(line));tailValid=true;}catch{/* Preserve legacy invalid-line behavior. */}
  }
  return {events,tailValid};
 }
 async function update(){
  for(let attempt=0;attempt<3;attempt++){
   let handle;
   try{
    handle=await open(path,'r');
    const before=await handle.stat({bigint:true}),sig=signature(before);
    if(previous?.signature===sig){
     const current=await stat(path,{bigint:true});
     if(signature(current)===sig)return published;
     continue;
    }
    const size=Number(before.size);
    if(!Number.isSafeInteger(size))throw new Error('History exceeds supported byte offsets.');
    const mayAppend=previous&&identity(before)===previous.identity&&size>previous.size;
    const bytes=await handle.readFile();stats.bytesRead+=bytes.length;
    const after=await handle.stat({bigint:true}),current=await stat(path,{bigint:true});
    if(bytes.length!==size||signature(after)!==sig||signature(current)!==sig)continue;
    const prefix=mayAppend?bytes.subarray(0,previous.size):null;
    const append=mayAppend&&(verification==='bytes'?prefix.equals(previous.bytes):createHash('sha256').update(prefix).digest('hex')===previous.digest);
    let events,appendFrom,decoded;
    if(append){
     // A valid unterminated last line was already visible in the old generation.
     // Replace it when more bytes arrive, including fragmented UTF-8 characters.
     appendFrom=published.events.length-(previous.tailValid?1:0);
     decoded=decode(Buffer.concat([previous.tail,bytes.subarray(previous.size)]));
     events=[...published.events.slice(0,appendFrom),...decoded.events];
    }else{decoded=decode(bytes);events=decoded.events;appendFrom=null;}
    const tail=Buffer.from(bytes.subarray(bytes.lastIndexOf(10)+1));
    // Parsing a large rebuild can itself overlap an external writer.
    if(signature(await handle.stat({bigint:true}))!==sig||signature(await stat(path,{bigint:true}))!==sig)continue;
    if(!append)stats.rebuilds++;
    previous={signature:sig,identity:identity(before),size,tail,tailValid:decoded.tailValid,
     ...(verification==='bytes'?{bytes}:{digest:createHash('sha256').update(bytes).digest('hex')})};
    published=generation(events,published.revision+1,appendFrom);stats.updates++;
    return published;
   }catch(error){
    if(error.code!=='ENOENT')throw error;
    // Missing authoritative file has the same empty-history semantics as before.
    previous=null;
    if(published.events.length){published=generation([],published.revision+1,null);stats.updates++;}
    return published;
   }finally{await handle?.close();}
  }
  throw new Error('History changed during all refresh attempts; retry the request.');
 }
 return {
  read(){
   if(!inflight)inflight=update().finally(()=>{inflight=null;});
   return inflight;
  },
  diagnostics(){return {...stats};}
 };
}
