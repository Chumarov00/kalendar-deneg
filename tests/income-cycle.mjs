import assert from 'node:assert/strict';
import { incomeCycleAllowance, scheduleFor, setPurchaseCancelled, utc } from '../model.mjs';
import { planData, createBackup, parseBackup } from '../backup.mjs';
const today='2026-11-24';
const shift=n=>{const d=utc(today); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10)};
const op=(id,amount,offset,extra={})=>({id,title:id,category:amount>0?'Доход':'Еда',amount,date:shift(offset),...extra});
const make=(amount=1000,items=[op('bill',-500,2,{mandatory:true}),op('salary',1000,5)])=>planData({showDemo:false,snapshot:{date:today,amount,paidIds:[]},customExpenses:items});
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
let s=make(),r=incomeCycleAllowance(s,today);
eq(r.amount,100);eq(r.days,5);eq(r.end,shift(4));eq(r.available,500);eq(r.nextIncome,{date:shift(5),amount:1000});eq(r.laterShortfall,null);
// Spending, the payment itself, and a fresh manual checkpoint must preserve the same cycle budget.
s.snapshot={date:shift(2),amount:800,paidIds:[]};eq(incomeCycleAllowance(s,shift(2)).amount,100);
s.payments.bill=shift(2);s.snapshot.amount=300;s.snapshot.paidIds=['bill'];eq(incomeCycleAllowance(s,shift(2)).amount,100);
// Receiving income ends the old cycle; unspent cash carries forward into the new one.
s.customExpenses.push(op('bill-next',-300,8,{mandatory:true}),op('salary-next',1000,12));
s.snapshot={date:shift(5),amount:100,paidIds:[]};s.payments.salary=shift(5);
r=incomeCycleAllowance(s,shift(5));eq(r.amount,114.28);eq(r.days,7);eq(r.nextIncome.date,shift(12));eq(r.current,1100);
s.snapshot={date:shift(5),amount:1100,paidIds:['salary']};eq(incomeCycleAllowance(s,shift(5)).amount,114.28);
// On payday the expected money is not yet spendable until marked received.
s=make();s.snapshot={date:shift(5),amount:100,paidIds:[]};s.payments.bill=shift(2);
r=incomeCycleAllowance(s,shift(5));eq(r.days,1);eq(r.amount,100);eq(r.nextIncome.date,shift(5));
s.payments.salary=shift(5);eq(incomeCycleAllowance(s,shift(5)).status,'needs-income');
s.customExpenses.push(op('salary-next',1000,12));eq(incomeCycleAllowance(s,shift(5)).days,7);
delete s.payments.salary;r=incomeCycleAllowance(s,shift(6));eq(r.overdueIncome,1000);eq(r.current,100);eq(r.nextIncome.date,shift(12));
// Partial prepayment does not deduct the same money twice.
s=make();s.installments.bill=[{id:'part',amount:100,date:today}];eq(incomeCycleAllowance(s,today).amount,100);
s.snapshot={date:today,amount:900,paidIds:['part']};eq(incomeCycleAllowance(s,today).amount,100);
// A day-of-income bill belongs to the next cycle, and insufficient income triggers a separate warning.
s=make(1000,[op('salary',1000,5),op('large-bill',-1800,6,{mandatory:true})]);
r=incomeCycleAllowance(s,today);eq(r.amount,200);eq(r.laterShortfall,{date:shift(6),amount:800,reserve:0});
s.customExpenses[1].date=shift(5);eq(incomeCycleAllowance(s,today).laterShortfall.date,shift(5));
// Missing income never silently falls back to a fixed 30-day horizon.
eq(incomeCycleAllowance(make(1000,[]),today).status,'needs-income');eq(incomeCycleAllowance(make(1000,[]),today).amount,null);
eq(incomeCycleAllowance(planData({showDemo:false}),today).status,'needs-balance');
s=make();s.customExpenses[0].amount=-1200;r=incomeCycleAllowance(s,today);eq(r.amount,0);eq(r.shortfall,{date:shift(2),amount:200,reserve:0});
s=make();s.customExpenses[1].date=shift(7);eq(incomeCycleAllowance(s,today).amount,71.42);
s=make();s.budgets={'2026-11':{reserve:100}};eq(incomeCycleAllowance(s,today).amount,80);
// Cancellation and restoration update the amount available for this cycle.
s=make();s.customExpenses[0].mandatory=false;
setPurchaseCancelled(s,scheduleFor(s).find(x=>x.id==='bill'),true,today,'cancel');eq(incomeCycleAllowance(s,today).amount,200);
setPurchaseCancelled(s,scheduleFor(s).find(x=>x.id==='bill'),false,today,'restore');eq(incomeCycleAllowance(s,today).amount,100);
eq(incomeCycleAllowance(parseBackup(JSON.stringify(createBackup(s))).data,today).amount,100);
// Sum income on the same date, respect recurring income and future series starts.
s=make(1000,[op('salary',1000,5),op('bonus',500,5)]);eq(incomeCycleAllowance(s,today).nextIncome.amount,1500);
s=make(1000,[op('salary',1000,-6,{repeat:'weekly'})]);eq(incomeCycleAllowance(s,today).days,1);eq(incomeCycleAllowance(s,today).nextIncome.date,shift(1));
s=make(1000,[op('salary',1000,70,{repeat:'weekly'})]);eq(incomeCycleAllowance(s,today).days,70);eq(incomeCycleAllowance(s,today).amount,14.28);
s=make(1000,[op('salary',1000,400,{repeat:'weekly'})]);eq(incomeCycleAllowance(s,today).days,400);eq(incomeCycleAllowance(s,today).amount,2.5);
// Fully received future income must not be counted as another upcoming receipt.
s=make();s.payments.salary=today;eq(incomeCycleAllowance(s,today).status,'needs-income');
s.customExpenses.push(op('salary-next',1000,12));eq(incomeCycleAllowance(s,today).days,12);eq(incomeCycleAllowance(s,today).current,2000);
console.log(checks+' проверок лимита до ближайшего поступления пройдены.');
