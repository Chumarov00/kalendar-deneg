import assert from 'node:assert/strict';
import { actualBalance, debtIds, forecast, incomeCycleAllowance, scheduleFor } from '../model.mjs';
import { createBackup, parseBackup, planData, validatePlan, writeRestoredPlan } from '../backup.mjs';
import { canDeleteOperation, removeLoan, removeOperation } from '../operations.mjs';
const today = '2026-11-24';
let checks = 0;
const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
const throws = f => { assert.throws(f); checks++; };
const make = () => planData({ showDemo:false, opening:1000, customExpenses:[
  { id:'food',title:'Еда',category:'Еда',amount:-100,date:today,repeat:'daily',repeatEnd:'2026-12-10' },
  { id:'salary',title:'Доход',category:'Доход',amount:1000,date:'2026-11-29' },
] });
const has = (s,id,month='2026-12') => scheduleFor(s,undefined,month).some(x=>x.id===id);
let before=make(), original=JSON.stringify(before);
let after=removeOperation(before,'food');
eq(has(after,'food'),false); eq(has(after,'food@2026-11-25'),true);
eq(after.deletedOperations,{food:true}); eq(JSON.stringify(before),original);
eq(forecast(after,'2026-11').ledger.get(today).balance,1000);
eq(incomeCycleAllowance(after,today).amount,120);
eq(has(parseBackup(JSON.stringify(createBackup(after))).data,'food'),false);
// Deleting later/edited/paid/cancelled dates, including an occurrence in another month.
before=make(); before.month='2026-12';
before.payments['food@2026-12-01']=today;
before.edits['food@2026-12-01']={date:'2026-12-02',amount:-150};
after=removeOperation(before,'food@2026-12-01');
eq(actualBalance(after,today),1000); eq(after.payments,{}); eq(after.edits,{});
eq(has(after,'food@2026-12-01'),false); eq(has(after,'food@2026-12-02'),true);
// Whole series deletion cleans old single-date deletions and every dependent payment.
before=make(); before.month='2026-12';
before.deletedOperations.food=true;
before.installments['food@2026-12-02']=[{id:'part',amount:25,date:today}];
before.snapshot={date:today,amount:975,paidIds:['part','other']};
after=removeOperation(before,'food@2026-11-25','series');
eq(after.customExpenses.map(x=>x.id),['salary']); eq(after.deletedOperations,{});
eq(after.installments,{}); eq(after.snapshot,{date:today,amount:975,paidIds:['other']});
eq(parseBackup(JSON.stringify(createBackup(after))).data,after);
throws(()=>removeOperation(make(),'salary','series'));
// Every demo operation, including mandatory debt and planned income, can be deleted.
before=planData({showDemo:true,opening:1000});
for(const item of scheduleFor(before,'pay','2026-12')) {
  eq(canDeleteOperation(item),true);
  const removed=removeOperation(before,item.id);
  eq(has(removed,item.id),false);
  eq(parseBackup(JSON.stringify(createBackup(removed))).data,removed);
}
after=removeOperation(before,debtIds.pay);
eq(has(after,debtIds.pay),false);
after.showDemo=false; after.showDemo=true;
eq(has(after,debtIds.pay),false);
before=planData({showDemo:true,scenario:'extend',extensionDate:'2026-12-21'});
after=removeOperation(before,debtIds.fee);eq(has(after,debtIds.fee),false);eq(has(after,debtIds.extended),true);
after=removeOperation(after,debtIds.extended);eq(has(after,debtIds.extended),false);
// Loan receipt, repayment and extension fee may each be removed independently.
const loanState=()=>planData({showDemo:false,opening:1000,loans:[{id:'loan',title:'Заём',received:1000,repay:1200,fee:200,
  receivedDate:today,dueDate:'2026-11-26',extensions:[{id:'fee',date:today,newDate:'2026-12-10',fee:200}]}],
  payments:{'loan/in':today,fee:today},installments:{'loan/out':[{id:'part',amount:100,date:today}]} });
before=loanState();eq(actualBalance(before,today),1700);
for(const [id,balance] of [['loan/in',700],['loan/out',1800],['fee',1900]]) {
  after=removeOperation(before,id);
  eq(actualBalance(after,today),balance);eq(has(after,id),false);
  eq(after.loans,before.loans);eq(parseBackup(JSON.stringify(createBackup(after))).data,after);
}
after=removeOperation(loanState(),'loan/out');
after=removeOperation(after,'fee'); after=removeOperation(after,'loan/in');
eq(scheduleFor(after).length,0);eq(actualBalance(after,today),1000);
after=removeLoan(after,'loan');eq(after.deletedOperations,{});eq(after.loans,[]);
// Hidden future income must not reappear via the next-income search fallback.
before=planData({showDemo:false,opening:1000,customExpenses:[{id:'weekly',title:'Доход',category:'Доход',amount:1000,date:'2027-02-01',repeat:'weekly'}]});
before.month='2027-02';after=removeOperation(before,'weekly');
eq(incomeCycleAllowance(after,today).nextIncome.date,'2027-02-08');
before=planData({showDemo:false,opening:1000,customExpenses:[{id:'weekly',title:'Доход',category:'Доход',amount:1000,date:today,repeat:'weekly'}]});
before.month='2027-02';
for(const item of scheduleFor(before,undefined,'2027-01')) before=removeOperation(before,item.id);
eq(incomeCycleAllowance(before,today).nextIncome.date,'2027-02-02');
// Old v1-v3 copies remain readable and get an empty deletion map.
for(const version of [1,2,3]) {
  const copy=createBackup(make());copy.schemaVersion=version;delete copy.data.deletedOperations;
  if(version<3){delete copy.data.cancellations;delete copy.data.operationChanges;}
  if(version===1)delete copy.data.budgets;
  eq(parseBackup(JSON.stringify(copy)).data.deletedOperations,{});
}
after=removeOperation(make(),'food');
throws(()=>validatePlan({...after,deletedOperations:{missing:true}}));
throws(()=>validatePlan({...after,deletedOperations:{food:false}}));
throws(()=>validatePlan({...after,payments:{food:today}}));
throws(()=>removeOperation(after,'food'));
// Full-calendar undo restores removed records and series even after a reload.
const values=new Map(); const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
before=make();after=removeOperation(before,'food','series');
writeRestoredPlan(storage,'plan','undo',before,after);
const restored=parseBackup(storage.getItem('undo')).data;
eq(restored,before);eq(has(restored,'food'),true);eq(has(JSON.parse(storage.getItem('plan')),'food'),false);
console.log(checks+' проверок удаления любых операций пройдены.');
