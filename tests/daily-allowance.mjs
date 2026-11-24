import assert from 'node:assert/strict';
import { dailyAllowance, dateAt, daysInMonth, forecast, nextDay, scheduleFor, setPurchaseCancelled, utc } from '../model.mjs';
import { planData } from '../backup.mjs';

const today = '2026-11-24';
const shift = (days) => { const date = utc(today); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const state = (amount = 1000, operations = []) => planData({ showDemo: false,
  snapshot: { date: today, amount, paidIds: [] }, customExpenses: operations });
const op = (id, amount, offset, extra = {}) => ({ id, title: id, category: amount > 0 ? 'Доход' : 'Еда', amount, date: shift(offset), ...extra });
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

// Equal spending across all 30 days; never round the allowance upwards.
eq(dailyAllowance(state(), today).amount, 33.33);
eq(dailyAllowance(state(), today).end, '2026-12-23');
eq(dailyAllowance(state(), today).days, 30);
eq(dailyAllowance(planData({ showDemo: false }), today).status, 'needs-balance');
eq(dailyAllowance(state(0), today).amount, 0);
eq(dailyAllowance(state(-1), today).shortfall, { date: today, amount: 1, reserve: 0 });

// A payment before payday is the limiting date even when the total month is positive.
let s = state(1000, [op('bill', -900, 4, { mandatory: true }), op('salary', 3000, 9)]);
eq(dailyAllowance(s, today).amount, 11.11);
eq(dailyAllowance(s, today).constraint, shift(8));
eq(dailyAllowance(s, today).nextIncome, { date: shift(9), amount: 3000 });
s.customExpenses[0].amount = -1200;
eq(dailyAllowance(s, today).amount, 0);
eq(dailyAllowance(s, today).shortfall, { date: shift(4), amount: 200, reserve: 0 });
s.customExpenses[1].date = shift(2);
eq(dailyAllowance(s, today).amount, 93.33);

// Today's income must first be marked received; overdue income never counts as cash.
s = state(0, [op('salary', 3000, 0)]);
eq(dailyAllowance(s, today).amount, 0);
eq(dailyAllowance(s, today).nextIncome, { date: today, amount: 3000 });
s.payments.salary = today;
eq(dailyAllowance(s, today).amount, 100);
s = state(1000, [op('late-salary', 9000, -1), op('rent', -800, 1, { mandatory: true })]);
eq(dailyAllowance(s, today).amount, 6.66);
eq(dailyAllowance(s, today).overdueIncome, 9000);
s.customExpenses[1].date = shift(-5);
eq(dailyAllowance(s, today).amount, 6.66);
s.customExpenses[1].amount = -1100;
eq(dailyAllowance(s, today).shortfall, { date: today, amount: 100, reserve: 0 });

// Paid and partial payments are counted once, including those already in a manual checkpoint.
s = state(1000, [op('bill', -300, 7, { mandatory: true })]);
eq(dailyAllowance(s, today).amount, 23.33);
s.installments.bill = [{ id: 'partial', amount: 100, date: today }];
eq(dailyAllowance(s, today).amount, 23.33);
s.snapshot = { date: today, amount: 900, paidIds: ['partial'] };
eq(dailyAllowance(s, today).amount, 23.33);
s.payments.bill = today; s.installments = {}; s.snapshot = { date: today, amount: 1000, paidIds: [] };
eq(dailyAllowance(s, today).amount, 23.33);

// Daily and weekly repeats survive a month boundary and reflect single-purchase cancellation.
s = state(6000, [op('food', -100, 0, { repeat: 'daily' })]);
eq(dailyAllowance(s, today).amount, 100);
setPurchaseCancelled(s, scheduleFor(s).find(item => item.id === 'food'), true, today, 'cancel-food');
eq(dailyAllowance(s, today).amount, 103.33);
setPurchaseCancelled(s, scheduleFor(s).find(item => item.id === 'food'), false, today, 'restore-food');
eq(dailyAllowance(s, today).amount, 100);
s = state(1000, [op('bus', -100, 0, { repeat: 'weekly' })]);
eq(dailyAllowance(s, today).amount, 16.66);

// Reserves constrain balances at month ends and at the selected horizon, without duplicate charges.
s = state(1000, [op('salary', 3000, 7)]);
s.budgets = { '2026-11': { reserve: 500 }, '2026-12': { reserve: 1000 } };
eq(dailyAllowance(s, today).amount, 71.42);
eq(dailyAllowance(s, today).reserve, 1000);
s.budgets['2026-11'].reserve = 1100;
eq(dailyAllowance(s, today).shortfall, { date: '2026-11-30', amount: 100, reserve: 1100 });

// Loan extensions reserve the fee separately and move the outstanding principal.
s = state(2000);
s.loans = [{ id: 'loan', title: 'Заём', received: 1000, repay: 1200, fee: 200,
  receivedDate: shift(-2), dueDate: shift(2), extensions: [] }];
s.payments['loan/in'] = shift(-2);
eq(dailyAllowance(s, today).amount, 26.66);
s.loans[0].extensions.push({ id: 'fee', date: today, fee: 200, newDate: shift(31) });
eq(dailyAllowance(s, today).amount, 60);
eq(dailyAllowance(s, today, 60).amount, 10);
s = state(3000, [op('later-bill', -3000, 30, { mandatory: true })]);
eq(dailyAllowance(s, today, 30).amount, 100);
eq(dailyAllowance(s, today, 60).amount, 0);

s = state(); s.showDemo = true; s.scenario = 'extend';
eq(dailyAllowance(s, today).status, 'incomplete');
eq(dailyAllowance({ ...state(), snapshot: { date: shift(1), amount: 1000, paidIds: [] } }, today).status, 'needs-balance');
eq(dailyAllowance({ ...state(), snapshot: { date: '9999-12-31', amount: 10, paidIds: [] } }, '9999-12-31').amount, 10);
assert.throws(() => dailyAllowance(state(), today, 0)); checks++;

// Independent cash-calendar invariant: the suggested amount fits EVERY day, and one kopeck more fails.
// These plans have no overdue or same-day unreceived income, so the calendar is also a reference.
let seed = 17;
const random = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
for (let sample = 0; sample < 80; sample++) {
  const length = [30, 60, 90][sample % 3];
  const operations = Array.from({ length: 10 }, (_, index) => op('op-' + index,
    (index % 3 === 0 ? 1 : -1) * (random(30000) + 1) / 100, random(length - 1) + 1));
  s = state((random(500000) + 50000) / 100, operations);
  s.budgets = { '2026-11': { reserve: random(5000) / 100 }, '2026-12': { reserve: random(5000) / 100 } };
  const result = dailyAllowance(s, today, length);
  const months = new Map(); let exceeded = false; let deficit = false;
  for (let day = today, elapsed = 1; day <= result.end; day = nextDay(day), elapsed++) {
    const month = day.slice(0, 7);
    if (!months.has(month)) months.set(month, forecast(s, month).ledger);
    const baseline = Math.round(months.get(month).get(day).balance * 100);
    const floor = day === result.end || day === dateAt(month, daysInMonth(month))
      ? Math.round((s.budgets[month]?.reserve ?? 0) * 100) : 0;
    const budget = baseline - floor;
    if (budget < 0) deficit = true;
    if (result.status === 'ready') assert.ok(budget - Math.round(result.amount * 100) * elapsed >= 0, sample + ': ' + day);
    if (budget - (Math.round(result.amount * 100) + 1) * elapsed < 0) exceeded = true;
  }
  eq(result.status, deficit ? 'shortfall' : 'ready');
  if (!deficit) eq(exceeded, true);
}
console.log(checks + ' проверок дневного лимита пройдены.');
