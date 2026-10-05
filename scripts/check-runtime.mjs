import {checkRuntime,formatRuntime} from '../src/runtime-check.mjs';
const result=await checkRuntime();
(result.ok?console.log:console.error)(formatRuntime(result));
process.exitCode=result.ok?0:1;
