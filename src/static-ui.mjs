import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {extname,join,resolve,sep} from 'node:path';

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain'};
export function uiAsset(publicDir,pathname){
 let path;try{path=decodeURIComponent(pathname);}catch{return null;}
 if(path.includes('\\')||path.includes('\0')||path.split('/').includes('..'))return null;
 const modern=existsSync(join(publicDir,'ui','index.html'));
 const relative=modern?(path==='/'?'ui/index.html':path==='/icon.svg'||path.startsWith('/_next/static/')?'ui'+path:null):null;
 if(!relative)return null;
 const base=realpathSync(publicDir),target=resolve(base,relative);
 if(!target.startsWith(base+sep)||!existsSync(target)||!statSync(target).isFile()||!realpathSync(target).startsWith(base+sep))return null;
 const extension=extname(target);if(!mime[extension])return null;
 let hashes=[];
 if(modern){try{hashes=JSON.parse(readFileSync(join(base,'ui','csp.json'),'utf8')).scriptHashes.filter(hash=>/^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(hash));}catch{return null;}}
 return {body:readFileSync(target),headers:{
  'Content-Type':mime[extension]+(extension==='.woff2'||extension==='.png'||extension==='.ico'?'':'; charset=utf-8'),
  'Content-Security-Policy':`default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none'`,
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
  'Cache-Control':path.startsWith('/_next/static/')?'public, max-age=31536000, immutable':'no-store',
 }};
}
