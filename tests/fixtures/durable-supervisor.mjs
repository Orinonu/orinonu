import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createMissionServer} from '../../src/server.mjs';
const [dataDir,fault]=process.argv.slice(2);
const emit=value=>process.send?.(value);
const decisionEngine={call:async(_,input)=>{
 if(fault==='selection'){emit({kind:'selecting'});return new Promise(()=>{});}
 return {ok:true,action:'recommend',selected_id:input.options[0].id};
}};
const runner=()=>{
 if(fault==='before-spawn')process.exit(73);
 const child=spawn(process.execPath,[fileURLToPath(new URL('./durable-executor.mjs',import.meta.url))],{detached:true,windowsHide:true,stdio:['pipe','pipe','pipe','ipc']});
 emit({kind:'spawn',pid:child.pid});
 child.on('close',()=>emit({kind:'executor-closed',pid:child.pid}));
 child.on('message',message=>{if(message.kind==='ready'){emit({kind:'executor-ready',pid:child.pid});if(fault==='after-spawn')process.send({kind:'crashing'},()=>process.exit(74));}});
 return child;
};
const app=createMissionServer({dataDir,runner,decisionEngine,codexPath:process.execPath});
await app.listen(0);emit({kind:'ready',url:app.url});
process.on('message',async message=>{
 if(message==='close'){await app.close();process.exit(0);}
 if(message==='barrier')emit({kind:'barrier'});
});
