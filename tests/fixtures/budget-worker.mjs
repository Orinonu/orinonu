import {createStore} from '../../src/store.mjs';
import {createBudgetLedger} from '../../src/budget-ledger.mjs';
const [dir,id]=process.argv.slice(2),store=createStore(dir,{tasks:[],opportunities:[]}),budget=createBudgetLedger(store);
process.send({ready:true});
process.on('message',()=>{try{budget.reserve({id,workspace:dir,task_id:id,phase:'planning',provider:'synthetic'});process.send({admitted:true});}catch(e){process.send({admitted:false,reason:e.code});}finally{store.close();process.disconnect();}});
