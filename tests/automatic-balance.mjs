import assert from 'node:assert/strict';
import { actualBalance, forecast, incomeCycleAllowance, scheduleFor, setPurchaseCancelled } from '../model.mjs';
import { planData, createBackup, parseBackup } from '../backup.mjs';
import { removeCustomOperation, removeLoan } from '../operations.mjs';

const today = '2026-11-24';
const make = () => planData({ showDemo: false, opening: 100, customExpenses: [
  { id: 'salary', title: 'Зарплата', category: 'Доход', amount: 1000, date: '2026-11-23' },
  { id: 'food', title: 'Еда', category: 'Еда', amount: -100, date: today },
  { id: 'bill', title: 'Платёж', category: 'Долги', amount: -500, date: '2026-11-26', mandatory: true },
  { id: 'next', title: 'Следующий доход', category: 'Доход', amount: 1000, date: '2026-11-29' },
], payments: { salary: '2026-11-23', food: today } });
let checks = 0;
const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
let s = make();
// No snapshot: both current cash and the spending limit work straight from the calendar.
eq(s.snapshot, null); eq(actualBalance(s, today), 1000);
eq(incomeCycleAllowance(s, today).amount, 100);
eq(incomeCycleAllowance(s, today).current, 1000);
eq(forecast(s, '2026-11').ledger.get(today).balance, 1000);
eq(actualBalance(planData({ showDemo: false }), today), 0);
eq(actualBalance(planData({ showDemo: false, opening: 500 }), today), 500);
eq(actualBalance(planData({ showDemo: false, opening: -50 }), today), -50);
// Deletion and cancellation update automatic cash without requiring a manual entry.
eq(actualBalance(removeCustomOperation(s, 'food'), today), 1100);
setPurchaseCancelled(s, scheduleFor(s).find(x => x.id === 'food'), true, today, 'refund');
eq(actualBalance(s, today), 1100); eq(incomeCycleAllowance(s, today).amount, 120);
setPurchaseCancelled(s, scheduleFor(s).find(x => x.id === 'food'), false, today, 'restore');
eq(actualBalance(s, today), 1000);
s.installments.bill = [{ id: 'part', date: today, amount: 100 }];
eq(actualBalance(s, today), 900); eq(incomeCycleAllowance(s, today).amount, 100);
eq(actualBalance(parseBackup(JSON.stringify(createBackup(s))).data, today), 900);
// A manual entry optionally reconciles cash; old or same-day embedded payments are not repeated.
s = make(); s.snapshot = { date: today, amount: 900, paidIds: ['food'] };
eq(actualBalance(s, today), 900); eq(incomeCycleAllowance(s, today).amount, 80);
s.installments.bill = [{ id: 'part', date: today, amount: 100 }];
eq(actualBalance(s, today), 800); eq(incomeCycleAllowance(s, today).amount, 80);
s.snapshot = { date: '2026-11-23', amount: 1100, paidIds: ['salary'] };
eq(actualBalance(s, today), 900);
// Future manual entries and future receipts do not create spendable money today.
s = make(); s.snapshot = { date: '2026-11-25', amount: 9999, paidIds: [] };
eq(actualBalance(s, today), 1000);
s = planData({ showDemo: false, customExpenses: [
  { id: 'today', title: 'Сегодняшний доход', category: 'Доход', amount: 1000, date: today },
  { id: 'next', title: 'Следующий доход', category: 'Доход', amount: 1000, date: '2026-11-29' },
] });
eq(actualBalance(s, today), 0); eq(incomeCycleAllowance(s, today).amount, 0);
s.payments.today = today;
eq(actualBalance(s, today), 1000); eq(incomeCycleAllowance(s, today).amount, 200);
s.payments.next = '2026-11-29';
eq(actualBalance(s, today), 1000);
// Loan cash is also inferred automatically, and deleting a mistaken loan removes it.
s = make(); s.loans = [{ id: 'loan', title: 'Заём', received: 1000, repay: 1200, fee: 0,
  receivedDate: today, dueDate: '2026-11-28', extensions: [] }];
s.payments['loan/in'] = today;
eq(actualBalance(s, today), 2000); eq(actualBalance(removeLoan(s, 'loan'), today), 1000);
eq(actualBalance(parseBackup(JSON.stringify(createBackup(s))).data, today), 2000);
console.log(checks + ' проверок автоматического остатка пройдены.');
