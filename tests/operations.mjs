import assert from 'node:assert/strict';
import { actualBalance, forecast, incomeCycleAllowance, scheduleFor, setPurchaseCancelled } from '../model.mjs';
import { createBackup, parseBackup, planData, writeRestoredPlan } from '../backup.mjs';
import { canDeleteOperation, removeCustomOperation } from '../operations.mjs';

const today = '2026-11-24';
const make = () => planData({ showDemo: false,
  snapshot: { date: today, amount: 1000, paidIds: [] },
  customExpenses: [
    { id: 'bill', title: 'Аренда', category: 'Обязательный платёж', kind: 'payment', mandatory: true, date: '2026-11-26', amount: -500 },
    { id: 'salary', title: 'Доход', category: 'Доход', date: '2026-11-29', amount: 1000 },
  ], expenseTemplates: [{ id: 'food-template', title: 'Еда', category: 'Еда' }],
});
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const throws = (action) => { assert.throws(action); checks++; };

// Wrong-date mandatory payment: remove the obligation from every future calculation.
let before = make();
const original = JSON.stringify(before);
eq(incomeCycleAllowance(before, today).amount, 100);
let after = removeCustomOperation(before, 'bill');
eq(JSON.stringify(before), original);
eq(after.customExpenses.map(x => x.id), ['salary']);
eq(incomeCycleAllowance(after, today).amount, 200);
eq(actualBalance(after, today), 1000);
eq(forecast(after, '2026-11').ledger.get('2026-11-27').balance, 1000);
eq(after.expenseTemplates, before.expenseTemplates);
eq(parseBackup(JSON.stringify(createBackup(after))).data, after);
eq(canDeleteOperation(scheduleFor(before).find(x => x.id === 'bill')), true);

// A payment made since the cash checkpoint is reversed by deleting its mistaken record.
before = make(); before.payments.bill = today;
eq(actualBalance(before, today), 500);
after = removeCustomOperation(before, 'bill');
eq(actualBalance(after, today), 1000);
eq(after.payments, {});
// A manual cash entry is authoritative, including when it already included this payment.
before.snapshot = { date: today, amount: 500, paidIds: ['bill', 'unrelated'] };
after = removeCustomOperation(before, 'bill');
eq(actualBalance(after, today), 500);
eq(after.snapshot, { date: today, amount: 500, paidIds: ['unrelated'] });
before.payments.bill = '2026-11-23';
eq(actualBalance(removeCustomOperation(before, 'bill'), today), 500);

// Partial payment IDs and edits must not survive as dangling backup references.
before = make(); before.installments.bill = [
  { id: 'part-1', date: '2026-11-23', amount: 100 },
  { id: 'part-2', date: today, amount: 50 },
];
before.snapshot.paidIds = ['part-1'];
before.edits.bill = { date: '2026-11-27', amount: -600 };
after = removeCustomOperation(before, 'bill');
eq(after.installments, {}); eq(after.edits, {}); eq(after.snapshot.paidIds, []);
eq(actualBalance(before, today), 950); eq(actualBalance(after, today), 1000);

// Removing a cancelled paid purchase removes its refund history as well (net zero).
before = make(); before.customExpenses[0].mandatory = false; before.customExpenses[0].category = 'Еда';
before.payments.bill = today;
setPurchaseCancelled(before, scheduleFor(before).find(x => x.id === 'bill'), true, today, 'refund');
before.snapshot.paidIds = ['bill', 'refund'];
after = removeCustomOperation(before, 'bill');
eq(after.cancellations, {}); eq(after.operationChanges, []); eq(after.snapshot.paidIds, []);
eq(actualBalance(after, today), actualBalance(before, today));

// Income uses the same deletion rules; unaffected data is retained exactly.
before = make(); before.payments.salary = today;
after = removeCustomOperation(before, 'salary');
eq(actualBalance(before, today), 2000); eq(actualBalance(after, today), 1000);
eq(after.customExpenses, [before.customExpenses[0]]);
before = make(); before.snapshot = null;
eq(removeCustomOperation(before, 'bill').snapshot, null);
throws(() => removeCustomOperation(make(), 'missing'));
before = make(); before.customExpenses[0].repeat = 'daily';
throws(() => removeCustomOperation(before, 'bill'));
eq(canDeleteOperation(scheduleFor(before).find(x => x.id === 'bill')), false);
eq(canDeleteOperation({ id: 'loan/out', loanId: 'loan' }), false);
before = planData({ showDemo: true });
throws(() => removeCustomOperation(before, scheduleFor(before)[0].id));

// Deletion and undo survive reloading, and failed persistence leaves the saved plan intact.
before = make(); after = removeCustomOperation(before, 'bill');
const values = new Map([['plan', JSON.stringify(before)]]);
const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
writeRestoredPlan(storage, 'plan', 'undo', before, after);
eq(JSON.parse(storage.getItem('plan')), after);
const recovery = parseBackup(storage.getItem('undo')).data;
eq(recovery, before);
writeRestoredPlan(storage, 'plan', 'undo', after, recovery);
eq(JSON.parse(storage.getItem('plan')), before);
eq(parseBackup(storage.getItem('undo')).data, after);
const failed = { ...storage, setItem(k,v) { if (k === 'plan') throw new Error('Storage full'); values.set(k,v); } };
const saved = storage.getItem('plan'), undo = storage.getItem('undo');
throws(() => writeRestoredPlan(failed, 'plan', 'undo', before, after));
eq(storage.getItem('plan'), saved); eq(storage.getItem('undo'), undo);
console.log(checks + ' проверок удаления и восстановления пройдены.');
