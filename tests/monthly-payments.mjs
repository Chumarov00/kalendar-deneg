import assert from 'node:assert/strict';
import { actualBalance, dailyAllowance, forecast, incomeCycleAllowance, scheduleFor } from '../model.mjs';
import { createBackup, parseBackup, planData, validatePlan } from '../backup.mjs';
import { removeOperation } from '../operations.mjs';
const make = (date='2027-01-31', repeatEnd='2027-04-30') => planData({showDemo:false,opening:10000,customExpenses:[
  {id:'rent',title:'Аренда',category:'Обязательный платёж',kind:'payment',mandatory:true,amount:-1000,date,repeat:'monthly',repeatEnd},
]});
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const dates=(s,month='2027-04')=>scheduleFor(s,undefined,month).map(x=>x.date);
let s=make();
eq(dates(s),['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
eq(scheduleFor(s,undefined,'2027-04').map(x=>x.id),['rent','rent@2027-02-28','rent@2027-03-31','rent@2027-04-30']);
eq(dates(make('2028-01-31','2028-03-31'),'2028-03'),['2028-01-31','2028-02-29','2028-03-31']);
eq(dates(make('2027-01-30','2027-03-31'),'2027-03'),['2027-01-30','2027-02-28','2027-03-30']);
eq(dates(make('2027-01-15','2027-03-14'),'2027-03'),['2027-01-15','2027-02-15']);
eq(dates(make('2026-12-31','2027-02-28'),'2027-02'),['2026-12-31','2027-01-31','2027-02-28']);
eq(dates(make('9999-11-30','9999-12-31'),'9999-12'),['9999-11-30','9999-12-30']);
eq(scheduleFor(s,undefined,'2026-12').length,0);
// Every date remains mandatory and is paid independently; later prepayments are retained.
s.installments['rent@2027-02-28']=[{id:'part',date:'2027-01-24',amount:200}];
s.payments.rent='2027-01-24';
eq(scheduleFor(s,undefined,'2027-01').find(x=>x.id==='rent@2027-02-28').remaining,800);
eq(actualBalance(s,'2027-01-24'),8800);
const roundtrip=parseBackup(JSON.stringify(createBackup(s))).data;
eq(roundtrip,s);eq(dates(roundtrip),dates(s));
const items=scheduleFor(s,undefined,'2027-03');
eq(items.find(x=>x.id==='rent').remaining,0);
eq(items.find(x=>x.id==='rent@2027-03-31').remaining,1000);
eq(items.every(x=>x.mandatory&&x.seriesId==='rent'),true);
eq(forecast(s,'2027-02').ledger.get('2027-02-28').payment.unpaid,800);
s.edits['rent@2027-02-28']={date:'2027-03-02',amount:-1200};
eq(validatePlan(s).edits['rent@2027-02-28'].date,'2027-03-02');
eq(forecast(s,'2027-03').ledger.get('2027-03-02').operations.some(x=>x.id==='rent@2027-02-28'),true);
assert.throws(()=>validatePlan({...s,payments:{'rent@2027-02-27':'2027-01-24'}}));checks++;
// One date and the whole monthly series use the same removal and backup flows.
let after=removeOperation(s,'rent@2027-02-28');
eq(scheduleFor(after,undefined,'2027-03').some(x=>x.id==='rent@2027-02-28'),false);
eq(scheduleFor(after,undefined,'2027-03').some(x=>x.id==='rent@2027-03-31'),true);
eq(parseBackup(JSON.stringify(createBackup(after))).data,after);
after=removeOperation(after,'rent@2027-03-31','series');
eq(after.customExpenses,[]);eq(after.installments,{});eq(after.payments,{});eq(after.deletedOperations,{});
// The chosen daily horizon includes ALL monthly obligations in its dates.
s=make('2026-11-30','2027-02-28');s.customExpenses[0].amount=-3000;
eq(dailyAllowance(s,'2026-11-24',30).amount,233.33);
eq(dailyAllowance(s,'2026-11-24',60).amount,66.66);
eq(dailyAllowance(s,'2026-11-24',90).amount,11.11);
s=make('2027-01-31','2027-04-30');s.customExpenses[0].amount=1000;
after=removeOperation(s,'rent');
eq(incomeCycleAllowance(after,'2026-11-24').nextIncome.date,'2027-02-28');
console.log(checks+' проверок ежемесячных платежей пройдены.');
