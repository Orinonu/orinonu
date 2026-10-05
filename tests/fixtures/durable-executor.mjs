process.stdin.resume();
process.stdin.once('end',()=>process.send?.({kind:'ready'}));
// Harmless, long-lived executor: no tools, files, network or inference.
setInterval(()=>{},1000);
