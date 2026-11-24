export const firstMonth = '2026-11';
export const lastMonth = '2026-12';
export const debt = { date: '2026-11-21', amount: 40000, fee: 10000 };
export const minDate = '1900-01-01';
export const maxDate = '9999-12-31';
export const maxAmount = 1_000_000_000;
export const debtIds = { pay: 'debt-pay', fee: 'debt-fee', extended: 'debt-extended' };

export const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format;

export function utc(date) {
  return new Date(date + 'T00:00:00Z');
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function dateIsValid(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (date < minDate || date > maxDate) return false;
  const value = utc(date);
  return Number.isFinite(value.getTime()) && iso(value) === date;
}

export function dateAt(month, day) {
  return month + '-' + String(day).padStart(2, '0');
}

export function shiftMonth(month, offset) {
  const date = utc(dateAt(month, 1));
  date.setUTCMonth(date.getUTCMonth() + offset);
  return iso(date).slice(0, 7);
}

export function nextDay(day) {
  if (day === maxDate) return '';
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + 1);
  return iso(date);
}

export function payday(month, day) {
  const date = utc(dateAt(month, day));
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) date.setUTCDate(day - (weekday === 0 ? 2 : 1));
  return iso(date);
}

export function daysInMonth(month) {
  const end = utc(dateAt(month, 1));
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return end.getUTCDate();
}

function regularSchedule(month) {
  const operations = [];
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = dateAt(month, day);
    operations.push({ date, title: 'Продукты', category: 'Еда', amount: -1000 });
    if (utc(date).getUTCDay() === 1) {
      operations.push({ date, title: 'Транспорт на неделю', category: 'Транспорт', amount: -2000 });
    }
  }
  for (const [date, title, amount] of [
    [payday(month, 10), 'Поступление 10-го числа', 40000],
    [dateAt(month, 18), 'Поступление около 18-го числа', 30000],
    [payday(month, 25), 'Поступление 25-го числа', 40000],
  ]) {
    operations.push({ date, title, category: 'Доход', amount });
  }
  for (const [day, amount] of [[5, 1500], [20, 1800], [22, 2400], [27, 9800], [30, 18500]]) {
    operations.push({ date: dateAt(month, day), title: 'Обязательный платёж', category: 'Долги', amount: -amount });
  }
  for (const [day, title, category, amount, mandatory = false] of [
    [11, 'Расходы на питомца', 'Повседневное', 5000],
    [12, 'Гигиена', 'Повседневное', 3000],
    [14, 'Отдых и развлечения', 'Отдых', 1500],
    [23, 'Коммунальные услуги', 'Повседневное', 3000, true],
    [28, 'Отдых и развлечения', 'Отдых', 1500],
  ]) {
    operations.push({ date: dateAt(month, day), title, category, amount: -amount, mandatory });
  }
  return operations.map((item, index) => ({ ...item, id: month + '/' + index }));
}

const regularOperations = [firstMonth, lastMonth].flatMap(regularSchedule);
export const cents = (amount) => Math.round(amount * 100);

export function amountIsValid(amount, minimum = -maxAmount) {
  return typeof amount === 'number' && amount >= minimum && amount <= maxAmount
    && amount === cents(amount) / 100;
}

export function debtTerms(state) {
  return { ...debt, ...state.debtTerms };
}

export function validExtensionDate(date, dueDate = debt.date) {
  return dateIsValid(date) && date > dueDate;
}

export function lockedScenario(state) {
  if (state.payments?.[debtIds.pay] || state.installments?.[debtIds.pay]?.length) return 'pay';
  if (state.payments?.[debtIds.fee] || state.payments?.[debtIds.extended] || state.installments?.[debtIds.extended]?.length) return 'extend';
  return '';
}

export function loanDueDate(loan) {
  return loan.extensions?.at(-1)?.newDate ?? loan.dueDate;
}

export function paymentInfo(state, item) {
  const settlements = [...(state.installments?.[item.id] ?? [])];
  const legacyDate = state.payments?.[item.id];
  if (legacyDate) settlements.unshift({ id: item.id, date: legacyDate, amount: Math.abs(item.amount) });
  const paidCents = settlements.reduce((sum, entry) => sum + cents(entry.amount), 0);
  const remaining = Math.max(0, cents(Math.abs(item.amount)) - paidCents) / 100;
  const paidOn = remaining === 0 && settlements.length
    ? settlements.map(({ date }) => date).sort().at(-1) : '';
  return { settlements, paidAmount: paidCents / 100, remaining, paidOn };
}

export function scheduleFor(state, scenario = lockedScenario(state) || state.scenario, throughMonth = state.month ?? localDate().slice(0, 7)) {
  const terms = debtTerms(state);
  const records = state.showDemo === false ? []
    : regularOperations.map((item) => ({ ...item, ...state.edits?.[item.id] }));
  const through = dateAt(throughMonth, daysInMonth(throughMonth));
  for (const item of state.customExpenses ?? []) {
    if (!item.repeat || item.repeat === 'once') {
      records.push({ ...item, ...state.edits?.[item.id], custom: true });
      continue;
    }
    const end = item.repeatEnd && item.repeatEnd < through ? item.repeatEnd : through;
    const cursor = utc(item.date);
    const step = item.repeat === 'weekly' ? 7 : 1;
    const generated = new Set();
    while (cursor.getUTCFullYear() <= 9999 && iso(cursor) <= end) {
      const date = iso(cursor);
      const id = date === item.date ? item.id : item.id + '@' + date;
      records.push({ ...item, date, id, ...state.edits?.[id], custom: true, seriesId: item.id });
      generated.add(id);
      cursor.setUTCDate(cursor.getUTCDate() + step);
    }
    // A future occurrence may already have an actual payment or a cancellation.
    const recordedIds = new Set([
      ...Object.keys(state.payments ?? {}), ...Object.keys(state.installments ?? {}),
      ...Object.keys(state.cancellations ?? {}), ...(state.operationChanges ?? []).map(({ operationId }) => operationId),
    ]);
    for (const id of recordedIds) {
      if (generated.has(id) || !id.startsWith(item.id + '@')) continue;
      const date = id.slice(item.id.length + 1);
      if (!dateIsValid(date) || date <= item.date || (item.repeatEnd && date > item.repeatEnd)) continue;
      const days = Math.round((utc(date) - utc(item.date)) / 86400000);
      if (days % step) continue;
      records.push({ ...item, date, id, ...state.edits?.[id], custom: true, seriesId: item.id });
    }
  }
  for (const loan of state.loans ?? []) {
    records.push(
      { id: loan.id + '/in', loanId: loan.id, date: loan.receivedDate, title: loan.title + ' · получено', category: 'Заём', amount: loan.received },
      { id: loan.id + '/out', loanId: loan.id, date: loanDueDate(loan), title: loan.title + ' · возврат', category: 'Долги', amount: -loan.repay },
    );
    for (const extension of loan.extensions ?? []) {
      if (extension.fee) records.push({
        id: extension.id, loanId: loan.id, loanFee: true, date: extension.date,
        title: loan.title + ' · перенос', category: 'Плата за перенос', amount: -extension.fee,
      });
    }
  }
  if (state.showDemo !== false) {
    if (scenario === 'pay') {
      records.push({ id: debtIds.pay, date: terms.date, title: 'Возврат долга', category: 'Долги', amount: -terms.amount });
    } else {
      records.push({ id: debtIds.fee, date: terms.date, title: 'Плата за перенос долга', category: 'Долги', amount: -terms.fee });
      if (validExtensionDate(state.extensionDate, terms.date) || state.payments?.[debtIds.extended]) {
        records.push({
          id: debtIds.extended, date: state.extensionDate, title: 'Возврат перенесённого долга',
          category: 'Долги', amount: -terms.amount,
        });
      }
    }
  }
  return records.map((item) => ({
    ...item, ...paymentInfo(state, item), cancelled: Boolean(state.cancellations?.[item.id]),
    corrections: (state.operationChanges ?? []).filter(({ operationId }) => operationId === item.id),
  }));
}

export function cashEntries(item) {
  const paid = item.settlements.map((entry) => ({ ...entry, amount: Math.sign(item.amount) * entry.amount }));
  return [...paid, ...item.corrections.map((entry) => ({ ...entry, correction: true }))];
}

export function canCancelPurchase(item) {
  return item.amount < 0 && !item.loanId && !item.mandatory && item.category !== 'Долги'
    && !Object.values(debtIds).includes(item.id);
}

export function setPurchaseCancelled(state, item, cancelled, date, adjustmentId) {
  if (!canCancelPurchase(item) || item.cancelled === cancelled) return false;
  state.cancellations ??= {};
  state.operationChanges ??= [];
  if (item.paidAmount) {
    state.operationChanges.push({
      id: adjustmentId, operationId: item.id, date,
      amount: cancelled ? item.paidAmount : -item.paidAmount,
    });
  }
  if (cancelled) state.cancellations[item.id] = true;
  else delete state.cancellations[item.id];
  return true;
}

function includedInSnapshot(entry, snapshot) {
  return entry.date < snapshot.date
    || (entry.date === snapshot.date && snapshot.paidIds.includes(entry.id));
}

export function actualBalance(state, today) {
  const { snapshot } = state;
  if (!snapshot || snapshot.date > today) return null;
  let balance = cents(snapshot.amount);
  for (const item of scheduleFor(state, undefined, today.slice(0, 7))) {
    for (const entry of cashEntries(item)) {
      if (entry.date <= today && !includedInSnapshot(entry, snapshot)) {
        balance += cents(entry.amount);
      }
    }
  }
  return balance / 100;
}

// The same daily amount must fit before every payment date, not only at the end.
// Start with actual cash: overdue/unconfirmed income must never fund today's spending.
export function dailyAllowance(state, today, requestedDays = 30, projection = {}) {
  if (!dateIsValid(today) || !Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 3_000_000) {
    throw new RangeError('Некорректный период расчёта.');
  }
  const endDate = utc(today);
  endDate.setUTCDate(endDate.getUTCDate() + requestedDays - 1);
  const end = endDate > utc(maxDate) ? maxDate : iso(endDate);
  const days = Math.round((utc(end) - utc(today)) / 86400000) + 1;
  const current = actualBalance(state, today);
  const result = { start: today, end, days, current, amount: null, nextIncome: null,
    overdueIncome: 0, shortfall: null, reserve: 0, constraint: null };
  if (current === null) return { ...result, status: 'needs-balance' };
  if (state.showDemo !== false && (lockedScenario(state) || state.scenario) === 'extend'
    && !validExtensionDate(state.extensionDate, debtTerms(state).date)) {
    return { ...result, status: 'incomplete' };
  }

  const events = new Map();
  const incomes = new Map();
  function add(date, amount) {
    if (date >= today && date <= end) events.set(date, (events.get(date) ?? 0) + cents(amount));
  }
  function income(date, amount) {
    if (date >= today && date <= end) incomes.set(date, (incomes.get(date) ?? 0) + cents(amount));
  }
  for (const item of scheduleFor(state, undefined, end.slice(0, 7))) {
    for (const entry of cashEntries(item)) {
      if (entry.date > today) {
        add(entry.date, entry.amount);
        if (entry.amount > 0 && !entry.correction) income(entry.date, entry.amount);
      }
    }
    if (item.cancelled || !item.remaining) continue;
    const amount = Math.sign(item.amount) * item.remaining;
    if (amount > 0) {
      income(item.date, amount);
      if (item.date < today) result.overdueIncome += cents(amount);
      // Today's income becomes spendable only after the user marks it received.
      if (item.date > today) add(item.date, amount);
    } else if (item.date >= today) add(item.date, amount);
    else if (item.mandatory || item.category === 'Долги') add(today, amount);
  }
  const nextIncomeDate = [...incomes.keys()].sort()[0];
  if (nextIncomeDate) result.nextIncome = { date: nextIncomeDate, amount: incomes.get(nextIncomeDate) / 100 };
  result.overdueIncome /= 100;

  let balance = cents(current);
  let dailyCents = Infinity;
  for (let day = today, elapsed = 1; day && day <= end; day = nextDay(day), elapsed += 1) {
    balance += events.get(day) ?? 0;
    if (projection.spendThrough && day <= projection.spendThrough) balance -= cents(projection.dailySpend ?? 0);
    const month = day.slice(0, 7);
    const monthEnd = dateAt(month, daysInMonth(month));
    // A monthly reserve is a target balance, not another expense to subtract each month.
    // At the horizon end, protect that month's reserve even if its last day is later.
    const reserve = day === monthEnd || day === end ? cents(state.budgets?.[month]?.reserve ?? 0) : 0;
    const available = balance - reserve;
    if (available < 0 && !result.shortfall) {
      result.shortfall = { date: day, amount: -available / 100, reserve: reserve / 100 };
    }
    const permitted = Math.floor(available / elapsed);
    if (permitted < dailyCents) {
      dailyCents = permitted;
      result.constraint = day;
    }
    if (day === end) {
      result.reserve = reserve / 100;
      result.closing = balance / 100;
    }
  }
  return { ...result, amount: Math.max(0, dailyCents) / 100,
    status: result.shortfall ? 'shortfall' : 'ready' };
}

export function incomeCycleAllowance(state, today) {
  if (!dateIsValid(today)) throw new RangeError('Некорректная дата расчёта.');
  // Daily/weekly repeats need only a short look ahead to find their next occurrence.
  // One-off operations and loans are included by scheduleFor regardless of their date.
  const searchDate = utc(today);
  searchDate.setUTCDate(searchDate.getUTCDate() + 31);
  const through = searchDate > utc(maxDate) ? maxDate : iso(searchDate);
  const records = scheduleFor(state, undefined, through.slice(0, 7));
  const known = new Set(records.map(({ id }) => id));
  for (const source of state.customExpenses ?? []) {
    if (known.has(source.id) || source.amount <= 0) continue;
    // A repeating income may start farther in the future than the search window.
    const item = { ...source, ...state.edits?.[source.id] };
    records.push({ ...item, ...paymentInfo(state, item), corrections: [] });
  }
  const incomeDates = new Map();
  function add(date, amount) {
    if (date >= today) incomeDates.set(date, (incomeDates.get(date) ?? 0) + cents(amount));
  }
  for (const item of records) {
    if (item.amount <= 0) continue;
    if (item.remaining) add(item.date, item.remaining);
    for (const entry of item.settlements) if (entry.date > today) add(entry.date, entry.amount);
  }
  const date = [...incomeDates.keys()].sort()[0];
  if (!date) {
    const result = dailyAllowance(state, today, 1);
    return { ...result, status: result.status === 'ready' || result.status === 'shortfall' ? 'needs-income' : result.status,
      amount: null, end: null, days: null, shortfall: null, nextIncome: null, laterShortfall: null };
  }
  // The income day starts the NEXT cycle: five days away means five spending days, not six.
  const days = Math.max(1, Math.round((utc(date) - utc(today)) / 86400000));
  const result = dailyAllowance(state, today, days);
  result.nextIncome = { date, amount: incomeDates.get(date) / 100 };
  result.available = result.closing === undefined ? null : Math.max(0, cents(result.closing) - cents(result.reserve)) / 100;
  result.laterShortfall = null;
  if (result.status === 'ready' && date > today) {
    // Check later obligations separately, assuming the current daily allowance is spent
    // only until payday. A new daily allowance will be calculated after receipt.
    const later = dailyAllowance(state, today, days + 30, { dailySpend: result.amount, spendThrough: result.end });
    if (later.shortfall && later.shortfall.date > result.end) result.laterShortfall = later.shortfall;
  }
  return result;
}

export function forecast(state, month = firstMonth, scenario) {
  const { snapshot } = state;
  const first = dateAt(month, 1);
  const last = dateAt(month, daysInMonth(month));
  const events = new Map();
  const references = new Map();
  const paymentDays = new Map();
  for (const item of scheduleFor(state, scenario, month)) {
    const mandatory = item.category === 'Долги' || item.mandatory;
    if (mandatory) {
      const payment = paymentDays.get(item.date) ?? { unpaid: 0, paid: 0 };
      payment.unpaid += cents(item.remaining);
      payment.paid += cents(item.paidAmount);
      paymentDays.set(item.date, payment);
    }
    const flows = cashEntries(item).map((entry) => ({
      ...item, date: entry.date, amount: entry.amount, settlement: entry, correction: Boolean(entry.correction),
    }));
    if (item.cancelled) flows.push({ ...item, date: item.date, amount: 0 });
    if (item.remaining && !item.cancelled) {
      const day = snapshot && mandatory && item.date < snapshot.date ? snapshot.date : item.date;
      flows.push({ ...item, date: day, amount: Math.sign(item.amount) * item.remaining });
    }
    for (const flow of flows) {
      if (flow.date !== item.date) {
        if (!references.has(item.date)) references.set(item.date, []);
        const refs = references.get(item.date);
        if (!refs.some(({ id }) => id === item.id)) {
          refs.push({ ...item, amount: Math.sign(item.amount) * item.remaining, countedOn: flow.date });
        }
      }
      if (!events.has(flow.date)) events.set(flow.date, []);
      events.get(flow.date).push(flow);
    }
  }

  let balance = cents(state.opening ?? 0);
  let income = 0;
  let expenses = 0;
  const ledger = new Map();
  const days = new Set([...events.keys()].filter((day) => day < first));
  if (snapshot && snapshot.date <= last) days.add(snapshot.date);
  for (let day = 1; day <= daysInMonth(month); day += 1) days.add(dateAt(month, day));

  for (const date of [...days].sort()) {
    const isSnapshotDay = date === snapshot?.date;
    if (isSnapshotDay) balance = cents(snapshot.amount);
    const start = balance;
    const operations = events.get(date) ?? [];
    for (const item of operations) {
      const amount = cents(item.amount);
      if (date >= first) {
        if (amount > 0 && !item.correction) income += amount;
        else expenses -= amount;
      }
      if (!snapshot || date < snapshot.date || !item.settlement || !includedInSnapshot(item.settlement, snapshot)) {
        balance += amount;
      }
    }
    if (date >= first) {
      const payment = paymentDays.get(date);
      ledger.set(date, {
        date, start: start / 100, balance: balance / 100, operations,
        references: references.get(date) ?? [], isSnapshotDay,
        payment: payment && { unpaid: payment.unpaid / 100, paid: payment.paid / 100 },
      });
    }
  }
  return { ledger, summary: { income: income / 100, expenses: expenses / 100, balance: balance / 100 } };
}

export const budgetCategories = [
  { key: 'food', category: 'Еда', label: 'Еда' },
  { key: 'transport', category: 'Транспорт', label: 'Транспорт' },
  { key: 'leisure', category: 'Отдых', label: 'Отдых и развлечения' },
];

export function monthlyBudget(state, month) {
  const limits = state.budgets?.[month] ?? {};
  const totals = new Map(budgetCategories.map(({ category }) => [category, { spent: 0, planned: 0 }]));
  for (const item of scheduleFor(state, undefined, month)) {
    if (item.amount >= 0 || !totals.has(item.category)) continue;
    const total = totals.get(item.category);
    for (const payment of cashEntries(item)) {
      if (payment.date.slice(0, 7) === month) total.spent -= cents(payment.amount);
    }
    if (!item.cancelled && item.date.slice(0, 7) === month) total.planned += cents(item.remaining);
  }
  return budgetCategories.map((category) => {
    const total = totals.get(category.category);
    const limit = limits[category.key] ?? null;
    return {
      ...category, limit, spent: total.spent / 100, planned: total.planned / 100,
      remaining: limit === null ? null : (cents(limit) - total.spent) / 100,
      afterPlans: limit === null ? null : (cents(limit) - total.spent - total.planned) / 100,
    };
  });
}
