import { backupCounts, createBackup, parseBackup, planData, writeRestoredPlan } from './backup.mjs?v=0.1.4';
import { canDeleteOperation, removeOperation, removeLoan } from './operations.mjs?v=0.1.4';
import {
  actualBalance, amountIsValid, dateAt, dateIsValid, daysInMonth, debtIds, debtTerms, firstMonth,
  forecast, localDate, lockedScenario, maxDate, minDate, money, nextDay, scheduleFor, shiftMonth,
  utc, validExtensionDate, cents, loanDueDate, budgetCategories, monthlyBudget, cashEntries, canCancelPurchase, setPurchaseCancelled, incomeCycleAllowance,
} from './model.mjs?v=0.1.4';

const byId = (id) => document.getElementById(id);
const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayName = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekdayName = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' });
const week = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const storageKey = 'money-calendar:v1';
const openingInput = byId('opening');
const actualInput = byId('actual-input');
const extensionInput = byId('extension-date');
const calendar = byId('calendar');
const dialog = byId('operation-dialog');
const operationForm = byId('operation-form');
const operationAmount = byId('operation-amount');
const operationDate = byId('operation-date');
const paidDate = byId('paid-date');
const includedInput = byId('included-in-balance');
const paidAmount = byId('paid-amount');
const expenseDialog = byId('expense-dialog');
const expenseForm = byId('expense-form');
const expenseName = byId('expense-name');
const expenseCategory = byId('expense-category');
const expenseAmount = byId('expense-amount');
const expenseDate = byId('expense-date');
const expenseStatus = byId('expense-status');
const expenseIncluded = byId('expense-included');
const expenseTemplate = byId('expense-template');
let editingExpense = null;
let extendingLoan = null;
let expenseKind = 'expense';
const operationKinds = {
  expense: { noun: 'трату', name: 'На что потратили', example: 'Например, зимняя куртка', category: 'Другое', fact: 'Уже потратил' },
  income: { noun: 'доход', name: 'Откуда поступление', example: 'Например, зарплата', category: 'Доход', fact: 'Уже получил' },
  payment: { noun: 'обязательный платёж', name: 'За что платёж', example: 'Например, аренда квартиры', category: 'Обязательный платёж', fact: 'Уже оплатил' },
};
let today = localDate();
let editing = null;
const fullDayName = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dailyDate = (date) => fullDayName.format(utc(date)).replace(/\sг\.$/, '');

function loadSavedPlan() {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey)) ?? {};
  } catch {
    return {};
  }
}

const state = {
  opening: 0, scenario: 'pay', extensionDate: '', edits: {}, payments: {}, debtTerms: {}, snapshot: null, customExpenses: [], expenseTemplates: [], showDemo: false, installments: {}, loans: [], budgets: {}, cancellations: {}, operationChanges: [], deletedOperations: {},
  ...loadSavedPlan(), month: today.slice(0, 7), selected: today, view: 'grid',
};

function persist(message = '') {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(planData(state)));
  } catch {
    message = 'Браузер не смог сохранить изменения. Они доступны до обновления страницы.';
  }
  const status = byId('save-status');
  status.textContent = message;
  status.hidden = !message;
  return message;
}

function titleCase(text) {
  return text[0].toUpperCase() + text.slice(1);
}

function appendText(parent, tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = content;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function applyMoney(element, value, signed = false) {
  const sign = value < 0 ? '−' : value > 0 && signed ? '+' : '';
  element.textContent = sign + money(Math.abs(value));
  element.classList.toggle('negative', value < 0);
}

function operationButton(parent, label, action, item) {
  const button = appendText(parent, 'button', label, 'text-button');
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.operation = item.id;
  button.setAttribute('aria-label', label + ' — ' + item.title);
  return button;
}

function buildDayButton(record) {
  const date = utc(record.date);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'day';
  button.dataset.day = record.date;
  button.setAttribute('aria-pressed', String(state.selected === record.date));
  const { payment } = record;
  const paymentLabel = payment?.unpaid
    ? 'К оплате ' + money(payment.unpaid)
    : 'Оплачено ' + money(payment?.paid ?? 0);
  const dayLabel = dayName.format(date) + ', остаток ' + money(record.balance);
  button.setAttribute('aria-label', payment ? dayLabel + ', ' + paymentLabel : dayLabel);
  if (record.date === today) button.setAttribute('aria-current', 'date');
  const hasIncome = record.operations.some(({ amount }) => amount > 0);
  if (hasIncome) button.classList.add('has-income');
  if (record.balance < 0) button.classList.add('has-gap');
  const dayHeader = appendText(button, 'span', '', 'day-top');
  appendText(dayHeader, 'span', state.view === 'grid' ? date.getUTCDate() : dayName.format(date), 'day-number');
  if (hasIncome) appendText(dayHeader, 'i', '', 'green-dot');
  if (record.balance < 0) appendText(dayHeader, 'i', '', 'red-dot');
  if (state.view === 'list') {
    const shown = record.operations.filter(({ category, custom }) => custom || category !== 'Еда');
    const description = appendText(button, 'span', '', 'list-description');
    if (payment) {
      const label = payment.unpaid ? 'due' : 'paid';
      appendText(description, 'strong', paymentLabel, 'payment-list-label ' + label);
    }
    appendText(description, 'span', (shown.length ? shown : record.operations).map(({ title }) => title).join(', '));
  } else if (payment) {
    const status = payment.unpaid ? 'due' : 'paid';
    const marker = appendText(button, 'span', payment.unpaid ? '!' : '✓', 'payment-marker ' + status);
    marker.setAttribute('aria-hidden', 'true');
    button.title = paymentLabel;
  }
  applyMoney(appendText(button, 'span', '', 'calendar-value'), record.balance);
  return button;
}

function renderCalendar(ledger) {
  calendar.replaceChildren();
  calendar.className = state.view === 'grid' ? 'calendar-grid' : 'calendar-list';
  if (state.view === 'grid') {
    for (const weekday of week) appendText(calendar, 'span', weekday, 'weekday');
    const leading = (utc(dateAt(state.month, 1)).getUTCDay() + 6) % 7;
    for (let offset = 0; offset < leading; offset += 1) {
      appendText(calendar, 'span', '', 'empty-cell').setAttribute('aria-hidden', 'true');
    }
  }
  for (const record of ledger.values()) calendar.append(buildDayButton(record));
}

function renderDetails(record) {
  const date = utc(record.date);
  byId('day-label').textContent = dayName.format(date) + (record.date === today ? ' · сегодня' : '');
  byId('day-weekday').textContent = weekdayName.format(date);
  applyMoney(byId('day-balance'), record.balance);
  const unpaid = byId('day-payment-due');
  const paid = byId('day-payment-paid');
  unpaid.hidden = !record.payment?.unpaid;
  paid.hidden = !record.payment?.paid;
  if (!unpaid.hidden) unpaid.textContent = 'К оплате по срокам этого дня ' + money(record.payment.unpaid);
  if (!paid.hidden) paid.textContent = 'Оплачено по срокам этого дня ' + money(record.payment.paid);
  const operations = byId('day-operations');
  operations.replaceChildren();
  const openingRow = appendText(operations, 'div', '', 'operation opening-row');
  appendText(openingRow, 'dt', record.isSnapshotDay ? 'Введённый фактический остаток' : 'Остаток на начало дня');
  applyMoney(appendText(openingRow, 'dd', ''), record.start);
  const current = new Map(scheduleFor(state, undefined, record.date.slice(0, 7)).map((item) => [item.id, item]));
  const displayed = new Map([...record.references, ...record.operations].map((item) => [item.id, item]));
  for (const [id, flow] of displayed) {
    const item = current.get(id);
    if (!item) continue;
    const row = appendText(operations, 'div', '', 'operation');
    const name = appendText(row, 'dt', item.title);
    appendText(name, 'small', item.category);
    if (item.seriesId) appendText(name, 'small', item.repeat === 'daily' ? 'Каждый день' : 'Каждую неделю');
    if (item.cancelled) {
      row.classList.add('cancelled-operation');
      appendText(name, 'small', item.seriesId ? 'Покупка на эту дату отменена' : 'Покупка отменена', 'cancelled-label');
      appendText(name, 'small', 'Сумма отменённой покупки ' + money(Math.abs(item.amount)));
    }
    if (item.paidAmount && !item.cancelled) {
      const verb = item.amount > 0 ? 'Получено ' : 'Внесено ';
      appendText(name, 'small', verb + money(item.paidAmount) + ' · осталось ' + money(item.remaining), 'paid-label');
    }
    if (item.remaining && !item.cancelled) {
      const overdue = (item.category === 'Долги' || item.mandatory) && item.date < today;
      appendText(name, 'small', (overdue ? 'Просрочен · срок ' : 'По плану · ') + dayName.format(utc(item.date)), overdue ? 'overdue' : '');
    }
    const dayFlows = record.operations.filter((entry) => entry.id === item.id);
    const amount = dayFlows.length
      ? dayFlows.reduce((sum, entry) => sum + cents(entry.amount), 0) / 100
      : Math.sign(item.amount) * item.remaining;
    const value = appendText(row, 'dd', '', item.amount > 0 ? 'income' : '');
    applyMoney(value, amount, true);
    const actions = appendText(row, 'dd', '', 'operation-actions');
    if (canDeleteOperation(item)) operationButton(actions, 'Удалить', 'delete', item);
    if (item.cancelled) {
      operationButton(actions, 'Восстановить покупку', 'restore-purchase', item);
      continue;
    }
    if (item.loanFee) {
      appendText(name, 'small', 'Перенос записан в карточке займа');
      continue;
    }
    if (!item.loanId) operationButton(actions, 'Изменить', 'edit', item);
    if (item.remaining) {
      const label = canPayPart(item) ? 'Внести платёж' : item.amount > 0 ? 'Отметить поступление' : 'Отметить оплату';
      operationButton(actions, label, 'paid', item);
    }
    if (state.payments[item.id]) {
      operationButton(actions, 'Изменить дату факта', 'paid', item);
      operationButton(actions, 'Вернуть в план', 'undo', item);
    }
    if (canCancelPurchase(item)) operationButton(actions, 'Отменить покупку', 'cancel-purchase', item);
    for (const entry of state.installments[item.id] ?? []) {
      const history = appendText(row, 'dd', '', 'payment-history');
      appendText(history, 'span', dayName.format(utc(entry.date)) + ' · ' + money(entry.amount));
      const cancel = operationButton(history, 'Отменить взнос', 'undo-part', item);
      cancel.dataset.entry = entry.id;
    }
  }
}

function canPayPart(item) {
  return item.amount < 0 && (item.category === 'Долги' || item.mandatory) && item.id !== debtIds.fee && !item.loanFee;
}

function renderLoans() {
  const list = byId('loans-list');
  list.replaceChildren();
  byId('loans-empty').hidden = state.loans.length > 0;
  const schedule = scheduleFor(state, undefined, undefined, true);
  for (const loan of state.loans) {
    const repayment = schedule.find(({ id }) => id === loan.id + '/out');
    const repaymentDeleted = Boolean(state.deletedOperations[repayment.id]);
    const card = appendText(list, 'article', '', 'loan-card');
    appendText(card, 'h3', loan.title);
    appendText(card, 'p', 'Получено ' + money(loan.received) + ' · к возврату ' + money(loan.repay), 'subtle');
    appendText(card, 'p', repaymentDeleted ? 'Возврат удалён из календаря' : repayment.remaining ? 'Осталось ' + money(repayment.remaining) : 'Заём погашен', 'loan-remaining');
    if (state.deletedOperations[loan.id + '/in']) appendText(card, 'p', 'Поступление удалено из календаря', 'subtle');
    appendText(card, 'p', 'Срок ' + dayName.format(utc(loanDueDate(loan))) + ' ' + utc(loanDueDate(loan)).getUTCFullYear(), 'subtle');
    const buttons = appendText(card, 'div', '', 'form-actions');
    const jump = appendText(buttons, 'button', 'Открыть дату', 'text-button');
    jump.type = 'button';
    jump.addEventListener('click', () => selectDay(loanDueDate(loan), true));
    const remove = appendText(buttons, 'button', 'Удалить заём', 'text-button');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Удалить заём — ' + loan.title);
    remove.addEventListener('click', () => { syncToday(); openReplacement('delete-loan', loan); });
    if (repayment.remaining && !repaymentDeleted) {
      const pay = appendText(buttons, 'button', 'Внести платёж', 'text-button');
      pay.type = 'button';
      pay.addEventListener('click', () => openOperation(repayment, 'paid', pay));
      const extend = appendText(buttons, 'button', 'Перенести за ' + money(loan.fee), 'text-button');
      extend.type = 'button';
      extend.disabled = loan.receivedDate > today || loanDueDate(loan) === maxDate;
      extend.addEventListener('click', () => openLoanExtension(loan));
    }
    for (const extension of loan.extensions ?? []) {
      appendText(card, 'p', 'Перенос от ' + dayName.format(utc(extension.date)) + ' · ' + money(extension.fee) + (state.deletedOperations[extension.id] ? ' (плата удалена)' : '') + ' · новый срок ' + dayName.format(utc(extension.newDate)), 'subtle');
    }
    const last = loan.extensions?.at(-1);
    if (last) {
      const cancel = appendText(card, 'button', 'Отменить запись последнего переноса', 'text-button');
      cancel.type = 'button';
      cancel.addEventListener('click', () => {
        loan.extensions.pop();
        delete state.deletedOperations[last.id];
        updatePayment(last.id, '');
        persist('Запись переноса отменена, прежний срок восстановлен.');
        render();
      });
    }
  }
}

function buildBudgetCards() {
  const cards = byId('budget-cards');
  for (const { key, label } of budgetCategories) {
    const card = appendText(cards, 'div', '', 'budget-card');
    appendText(card, 'h3', label);
    const title = appendText(card, 'label', 'План на месяц, ₽');
    title.htmlFor = 'budget-' + key;
    const input = appendText(card, 'input', '');
    input.id = 'budget-' + key;
    input.type = 'number';
    input.min = '0';
    input.max = '1000000000';
    input.step = '0.01';
    input.inputMode = 'decimal';
    input.placeholder = 'Не задан';
    input.dataset.budget = key;
    input.setAttribute('aria-describedby', 'budget-error-' + key);
    const error = appendText(card, 'p', 'Укажи сумму от 0 до 1 000 000 000 ₽ с точностью до копейки.', 'input-error');
    error.id = 'budget-error-' + key;
    error.hidden = true;
    const details = appendText(card, 'dl', '', 'budget-values');
    for (const [field, name] of [['spent', 'Потрачено'], ['remaining', 'Осталось'], ['planned', 'Ещё по плану'], ['afterPlans', 'После плановых трат']]) {
      const row = appendText(details, 'div', '');
      appendText(row, 'dt', name);
      const value = appendText(row, 'dd', '');
      value.id = 'budget-' + key + '-' + field;
    }
  }
}

function renderBudget(closing) {
  byId('budget-month').textContent = titleCase(monthName.format(utc(dateAt(state.month, 1))));
  const limits = state.budgets[state.month] ?? {};
  for (const { key, spent, remaining, planned, afterPlans } of monthlyBudget(state, state.month)) {
    for (const [field, value] of Object.entries({ spent, remaining, planned, afterPlans })) {
      const element = byId('budget-' + key + '-' + field);
      if (value === null) {
        element.textContent = '—';
        element.classList.remove('negative');
      } else {
        applyMoney(element, value);
      }
    }
  }
  for (const input of document.querySelectorAll('[data-budget]')) {
    if (document.activeElement !== input) {
      input.value = limits[input.dataset.budget] ?? '';
      input.setAttribute('aria-invalid', 'false');
      const errorId = input.dataset.budget === 'reserve' ? 'reserve-error' : 'budget-error-' + input.dataset.budget;
      byId(errorId).hidden = true;
    }
  }
  const reserve = limits.reserve;
  const reserveStatus = byId('reserve-status');
  reserveStatus.textContent = reserve === undefined ? 'Укажи сумму, которую хочешь сохранить.'
    : closing >= reserve ? 'По текущему календарю резерв сохраняется.'
    : 'По текущему календарю до резерва не хватает ' + money((cents(reserve) - cents(closing)) / 100) + '.';
  reserveStatus.classList.toggle('negative', reserve !== undefined && closing < reserve);
}

buildBudgetCards();
byId('budget-cards').setAttribute('aria-live', 'polite');
document.querySelector('.budget-panel').addEventListener('input', (event) => {
  const input = event.target.closest('[data-budget]');
  if (!input) return;
  const key = input.dataset.budget;
  const empty = input.value === '' && !input.validity.badInput;
  const valid = empty || amountIsValid(input.valueAsNumber, 0);
  const errorId = key === 'reserve' ? 'reserve-error' : 'budget-error-' + key;
  byId(errorId).hidden = valid;
  input.setAttribute('aria-invalid', String(!valid));
  if (!valid) return;
  const limits = { ...(state.budgets[state.month] ?? {}) };
  if (empty) delete limits[key];
  else limits[key] = input.valueAsNumber;
  if (Object.keys(limits).length) state.budgets[state.month] = limits;
  else delete state.budgets[state.month];
  persist();
  renderBudget(forecast(state, state.month).summary.balance);
  renderDailyAllowance();
});

function renderDailyAllowance() {
  const limit = incomeCycleAllowance(state, today);
  const amount = byId('daily-amount');
  const message = byId('daily-message');
  const income = byId('daily-income');
  const jump = byId('daily-jump');
  const later = byId('daily-later');
  const breakdown = byId('daily-breakdown');
  const dayWord = (days) => {
    const n = days % 100;
    return n >= 11 && n <= 14 ? 'дней' : days % 10 === 1 ? 'день' : days % 10 >= 2 && days % 10 <= 4 ? 'дня' : 'дней';
  };
  byId('daily-range').textContent = limit.end
    ? dailyDate(limit.start) + ' — ' + dailyDate(limit.end) + ' · ' + limit.days + ' ' + dayWord(limit.days) + ', включая сегодня'
    : 'До следующего дохода';
  byId('daily-overdue').hidden = !limit.overdueIncome;
  byId('daily-overdue').textContent = 'Неполученные доходы с прошедшей датой (' + money(limit.overdueIncome) + ') в лимит не включены. Обнови дату или отметь получение.';
  jump.hidden = true;
  later.hidden = true;
  breakdown.hidden = true;
  message.classList.toggle('negative', limit.status === 'shortfall');
  amount.classList.toggle('negative', limit.status === 'shortfall');
  income.textContent = limit.nextIncome
    ? (limit.nextIncome.date === today ? 'Ожидается сегодня: ' : 'Ближайшее поступление: ' + dailyDate(limit.nextIncome.date) + ' · ')
      + money(limit.nextIncome.amount) + (limit.nextIncome.date === today ? '. Отметь получение — начнётся новый период.' : '.')
    : '';
  if (limit.amount === null) {
    amount.textContent = '—';
    message.textContent = limit.status === 'incomplete'
      ? 'Укажи новую дату возврата тестового долга, чтобы учесть все платежи.'
      : limit.status === 'needs-income'
        ? 'Добавь ближайшее поступление в календарь: его дату и сумму. Тогда рассчитаю, сколько можно тратить до него.'
        : 'Сначала сохрани, сколько денег у тебя сейчас, в блоке выше.';
    return;
  }
  amount.textContent = money(limit.amount);
  if (limit.shortfall) {
    message.textContent = 'До ближайшего поступления на запланированные расходы' + (limit.shortfall.reserve ? ' и резерв' : '')
      + ' не хватает ' + money(limit.shortfall.amount) + ' к ' + dailyDate(limit.shortfall.date)
      + '. Дополнительные траты пока не помещаются.';
    jump.dataset.date = limit.shortfall.date;
    jump.hidden = false;
  } else {
    message.textContent = limit.nextIncome.date === today
      ? 'До получения сегодняшнего дохода лимит учитывает текущие деньги и расходы на сегодня.'
      : 'Такую сумму можно дополнительно тратить каждый день до ближайшего поступления.';
    message.textContent += (limit.constraint < limit.end ? ' Лимит ограничен остатком на ' + dailyDate(limit.constraint) + '.' : '')
      + (limit.reserve ? ' Учтён резерв: ' + money(limit.reserve) + '.' : '');
    breakdown.hidden = false;
    breakdown.textContent = 'После платежей, запланированных трат и резерва до поступления остаётся ' + money(limit.available)
      + ' на ' + limit.days + ' ' + dayWord(limit.days) + '.';
  }
  if (limit.laterShortfall) {
    later.hidden = false;
    byId('daily-later-message').textContent = 'После ближайшего поступления есть риск нехватки: '
      + money(limit.laterShortfall.amount) + ' к ' + dailyDate(limit.laterShortfall.date)
      + '. Для этого будущего платежа потребуется сохранить больше денег или изменить план.';
    byId('daily-later-jump').dataset.date = limit.laterShortfall.date;
  }
}

byId('daily-jump').addEventListener('click', (event) => selectDay(event.currentTarget.dataset.date, true));
byId('daily-later-jump').addEventListener('click', (event) => selectDay(event.currentTarget.dataset.date, true));

function renderActual() {
  const actual = actualBalance(state, today);
  const amount = byId('actual-amount');
  const expected = state.snapshot?.date <= today
    ? 'Последний ввод · ' + dayName.format(utc(state.snapshot.date)) + ' ' + utc(state.snapshot.date).getUTCFullYear()
    : 'Рассчитано по начальной сумме и отмеченным поступлениям и оплатам';
  byId('actual-date').textContent = expected;
  byId('actual-input-label').textContent = 'Уточнить остаток на сегодня, ' + dayName.format(utc(today)) + ' · необязательно';
  if (actual === null) {
    amount.textContent = '—';
    amount.classList.remove('negative');
  } else {
    applyMoney(amount, actual);
  }
}

function renderDebt() {
  byId('demo-debt').hidden = !state.showDemo;
  byId('test-badge').hidden = !state.showDemo;
  if (!state.showDemo) {
    byId('incomplete').hidden = true;
    return;
  }
  const terms = debtTerms(state);
  const dueText = dayName.format(utc(terms.date));
  const dueMonth = terms.date.slice(0, 7);
  const lock = lockedScenario(state);
  const scenario = lock || state.scenario;
  const status = byId('debt-status');
  status.hidden = !lock;
  if (lock === 'pay' || state.payments[debtIds.extended] || state.installments[debtIds.extended]?.length) {
    const item = scheduleFor(state).find(({ id }) => id === (lock === 'pay' ? debtIds.pay : debtIds.extended));
    status.textContent = item?.remaining ? 'Внесено ' + money(item.paidAmount) + ' · осталось ' + money(item.remaining) : 'Долг погашен';
  } else if (lock === 'extend') {
    status.textContent = 'Перенос оплачен. К возврату ' + money(terms.amount) + '.';
  }
  byId('debt-title').textContent = 'Долг ' + money(terms.amount);
  byId('due-jump').textContent = dueText;
  byId('scenario-label').textContent = 'Сравни остаток на ' + dueText;
  byId('pay-caption').textContent = 'Платёж ' + money(terms.amount);
  byId('fee-caption').textContent = 'Плата за перенос ' + money(terms.fee);
  byId('scenario-options').hidden = Boolean(lock);
  for (const input of document.querySelectorAll('[name="scenario"]')) input.checked = input.value === scenario;
  if (!lock) {
    const { ledger: payDays } = forecast(state, dueMonth, 'pay');
    const { ledger: extendDays } = forecast(state, dueMonth, 'extend');
    applyMoney(byId('pay-result'), payDays.get(terms.date).balance);
    applyMoney(byId('extend-result'), extendDays.get(terms.date).balance);
  }
  const extensionIsValid = validExtensionDate(state.extensionDate, terms.date);
  byId('extension').hidden = scenario !== 'extend' || terms.date === maxDate;
  byId('extension-date').disabled = Boolean(state.payments[debtIds.extended] || state.installments[debtIds.extended]?.length);
  extensionInput.min = nextDay(terms.date);
  byId('extension-jump').hidden = !extensionIsValid;
  byId('incomplete').hidden = scenario !== 'extend' || extensionIsValid;
  byId('incomplete').textContent = 'Укажи новую дату возврата, чтобы учесть долг ' + money(terms.amount) + ' в прогнозе.';
  byId('extension').querySelector('label').textContent = 'Новая дата возврата ' + money(terms.amount);
}

function render(focusDay = false) {
  const { ledger, summary } = forecast(state, state.month);
  byId('month-label').textContent = titleCase(monthName.format(utc(dateAt(state.month, 1))).replace(/\sг\.$/, ''));
  applyMoney(byId('closing'), summary.balance);
  applyMoney(byId('income'), summary.income, true);
  applyMoney(byId('expenses'), summary.expenses);
  byId('prev-month').disabled = state.month === minDate.slice(0, 7);
  byId('next-month').disabled = state.month === maxDate.slice(0, 7);

  const firstGap = byId('first-gap');
  const records = [...ledger.values()].filter((record) => !state.snapshot || record.date >= state.snapshot.date);
  const gap = records.find((record) => record.balance < 0);
  let highlightedGap = gap;
  // Keep the original demo checkpoint when the shortfall persists until the first income.
  if (state.showDemo && !state.snapshot && state.month === firstMonth && gap) {
    const firstIncomeIndex = records.findIndex((record) => record.operations.some(({ amount }) => amount > 0));
    const beforeIncome = records[firstIncomeIndex - 1];
    if (beforeIncome?.balance < 0 && gap.date <= beforeIncome.date) highlightedGap = beforeIncome;
  }
  firstGap.hidden = !highlightedGap;
  firstGap.dataset.jump = highlightedGap?.date ?? '';
  if (highlightedGap) {
    firstGap.textContent = 'Не хватает ' + money(-highlightedGap.balance) + ' к ' + dayName.format(utc(highlightedGap.date));
  }
  renderActual();
  renderDailyAllowance();
  renderBudget(summary.balance);
  renderCalendar(ledger);
  renderDetails(ledger.get(state.selected));
  renderDebt();
  renderLoans();
  if (focusDay) calendar.querySelector('[data-day="' + state.selected + '"]')?.focus();
}

function selectDay(date, focusDay = false) {
  state.month = date.slice(0, 7);
  state.selected = date;
  render(focusDay);
}

function syncToday() {
  const date = localDate();
  if (date === today) return;
  const wasToday = state.selected === today;
  today = date;
  if (wasToday) selectDay(today);
  else render();
}

function navigateMonth(offset) {
  const month = shiftMonth(state.month, offset);
  let target = dateAt(month, 1);
  if (today.slice(0, 7) === month) target = today;
  if (state.showDemo && (lockedScenario(state) || state.scenario) === 'extend' && state.extensionDate.startsWith(month)) {
    target = state.extensionDate;
  }
  selectDay(target, true);
}

function updateIncludedOption() {
  const applies = Boolean(state.snapshot && paidDate.value === state.snapshot.date);
  byId('included-label').hidden = !applies;
}

function updatePayment(id, date, included = false) {
  if (date) state.payments[id] = date;
  else delete state.payments[id];
  if (state.snapshot) {
    const ids = state.snapshot.paidIds.filter((paidId) => paidId !== id);
    if (included && date === state.snapshot.date) ids.push(id);
    state.snapshot.paidIds = ids;
  }
}

function updateExpenseStatus() {
  const isFuture = expenseDate.value > today;
  expenseStatus.options[0].disabled = isFuture;
  if (isFuture) expenseStatus.value = 'planned';
  const includedApplies = expenseStatus.value === 'paid' && state.snapshot?.date === expenseDate.value;
  byId('expense-included-label').hidden = !includedApplies;
  if (!includedApplies) expenseIncluded.checked = false;
}

function renderExpenseTemplates(selected = '') {
  expenseTemplate.replaceChildren();
  const placeholder = appendText(expenseTemplate, 'option', 'Без шаблона');
  placeholder.value = '';
  for (const template of state.expenseTemplates) {
    const option = appendText(expenseTemplate, 'option', template.title + ' · ' + template.category);
    option.value = template.id;
  }
  expenseTemplate.value = selected;
}

function openExpense(item, kind = 'expense') {
  syncToday();
  editingExpense = item;
  expenseKind = item?.kind ?? kind;
  const config = operationKinds[expenseKind];
  expenseForm.reset();
  byId('expense-template-fields').hidden = expenseKind !== 'expense';
  byId('expense-category-fields').hidden = expenseKind !== 'expense';
  byId('expense-name-label').textContent = config.name;
  byId('expense-date-label').textContent = expenseKind === 'payment' ? 'Срок платежа' : 'Дата';
  expenseName.placeholder = config.example;
  const hasParts = Boolean(item && state.installments[item.id]?.length);
  expenseStatus.disabled = hasParts;
  expenseIncluded.disabled = hasParts;
  expenseAmount.min = Math.max(0.01, item && state.installments[item.id]?.length ? item.paidAmount : 0);
  byId('repeat-fields').hidden = Boolean(item) || expenseKind !== 'expense';
  byId('expense-repeat').disabled = Boolean(item) || expenseKind !== 'expense';
  byId('expense-repeat-end').disabled = Boolean(item) || expenseKind !== 'expense';
  byId('repeat-end-fields').hidden = true;
  expenseStatus.options[0].textContent = config.fact;
  byId('expense-included-label').lastChild.textContent = ' Эта операция уже учтена в сохранённом остатке';
  renderExpenseTemplates();
  byId('template-message').hidden = true;
  byId('expense-heading').textContent = (item ? 'Изменить ' : 'Добавить ') + config.noun;
  expenseName.setCustomValidity('');
  expenseDate.value = hasParts ? item.date : item?.paidOn || item?.date || state.selected;
  expenseStatus.value = item ? (item.paidOn ? 'paid' : 'planned') : expenseKind === 'expense' ? 'paid' : 'planned';
  if (item) {
    expenseName.value = item.title;
    expenseCategory.value = item.category;
    expenseAmount.value = Math.abs(item.amount);
    expenseIncluded.checked = state.snapshot?.paidIds.includes(item.id) ?? false;
  }
  updateExpenseStatus();
  expenseDialog.showModal();
}

function openOperation(item, mode, trigger) {
  syncToday();
  const partial = mode === 'paid' && canPayPart(item) && item.remaining > 0;
  editing = { item, mode, trigger, partial };
  const editingPlan = mode === 'edit';
  byId('partial-fields').hidden = !partial;
  paidAmount.disabled = !partial;
  paidAmount.required = partial;
  paidAmount.value = item.remaining;
  paidAmount.max = item.remaining;
  paidAmount.setCustomValidity('');
  operationAmount.min = Math.max(0.01, state.installments[item.id]?.length ? item.paidAmount : 0);
  byId('paid-remainder').textContent = 'Осталось к сроку ' + money(item.remaining) + ' из ' + money(Math.abs(item.amount));
  const terms = debtTerms(state);
  let title = item.amount > 0 ? 'Отметить поступление' : 'Отметить оплату';
  if (item.paidOn) title = 'Изменить дату факта';
  if (partial) title = 'Внести платёж';
  if (editingPlan) title = 'Изменить операцию';
  byId('operation-title').textContent = title;
  byId('operation-caption').textContent = item.title + ' · ' + money(Math.abs(item.amount));
  byId('edit-fields').hidden = !editingPlan;
  byId('paid-fields').hidden = editingPlan;
  operationAmount.disabled = operationDate.disabled = !editingPlan;
  paidDate.disabled = includedInput.disabled = editingPlan;
  operationAmount.required = operationDate.required = editingPlan;
  paidDate.required = !editingPlan;
  operationAmount.value = Math.abs(item.amount);
  operationDate.min = item.id === debtIds.extended ? nextDay(terms.date) : minDate;
  operationDate.value = item.date;
  operationDate.setCustomValidity('');
  byId('operation-date-label').textContent = item.category === 'Долги' ? 'Срок платежа' : 'Дата по плану';
  paidDate.max = today;
  paidDate.min = item.loanId ? state.loans.find(({ id }) => id === item.loanId).receivedDate : minDate;
  paidDate.value = item.paidOn || today;
  includedInput.checked = state.snapshot?.paidIds.includes(item.id) ?? false;
  updateIncludedOption();
  dialog.showModal();
}

function focusOperation(id, action) {
  const button = [...byId('day-operations').querySelectorAll('[data-operation]')].find(
    (option) => option.dataset.operation === id && option.dataset.action === action,
  );
  if (button) button.focus({ preventScroll: true });
  else calendar.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
}

function savePlan(item, date, amount) {
  const terms = debtTerms(state);
  if (item.id === debtIds.extended) {
    if (!validExtensionDate(date, terms.date)) return false;
    state.extensionDate = date;
    extensionInput.value = date;
    state.debtTerms.amount = amount;
  } else if (item.id === debtIds.pay || item.id === debtIds.fee) {
    if ((item.id === debtIds.fee && date === maxDate)
        || (state.extensionDate && !validExtensionDate(state.extensionDate, date))) {
      operationDate.setCustomValidity('Срок платежа должен быть раньше новой даты возврата.');
      operationDate.reportValidity();
      return false;
    }
    state.debtTerms = { ...state.debtTerms, date, [item.id === debtIds.pay ? 'amount' : 'fee']: amount };
  } else {
    state.edits[item.id] = { date, amount: item.amount < 0 ? -amount : amount };
  }
  return true;
}

openingInput.value = state.opening;
extensionInput.value = state.extensionDate;
openingInput.addEventListener('input', () => {
  const value = openingInput.valueAsNumber;
  const valid = amountIsValid(value);
  byId('opening-error').hidden = valid;
  openingInput.setAttribute('aria-invalid', String(!valid));
  if (valid) {
    state.opening = value;
    persist();
    render();
  }
});

byId('balance-form').addEventListener('submit', (event) => {
  event.preventDefault();
  syncToday();
  const amount = actualInput.valueAsNumber;
  if (!amountIsValid(amount)) return;
  state.snapshot = {
    date: today, amount,
    paidIds: scheduleFor(state).flatMap(cashEntries).filter(({ date }) => date === today).map(({ id }) => id),
  };
  actualInput.value = '';
  persist('Остаток сохранён. Прогноз пересчитан.');
  selectDay(today);
});

calendar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (button) {
    selectDay(button.dataset.day, true);
    if (window.matchMedia('(max-width: 850px)').matches) byId('day-label').scrollIntoView({ block: 'nearest' });
  }
});

byId('day-operations').addEventListener('click', (event) => {
  const button = event.target.closest('[data-operation]');
  if (!button) return;
  const item = scheduleFor(state).find(({ id }) => id === button.dataset.operation);
  if (!item) return;
  const action = button.dataset.action;
  if (action === 'delete') {
    syncToday();
    openReplacement('delete', item);
    return;
  }
  if (action === 'cancel-purchase' || action === 'restore-purchase') {
    syncToday();
    const cancelled = action === 'cancel-purchase';
    if (setPurchaseCancelled(state, item, cancelled, today, 'change-' + crypto.randomUUID())) {
      persist(cancelled ? 'Покупка отменена. Остатки и прогноз пересчитаны.' : 'Покупка восстановлена. Остатки и прогноз пересчитаны.');
      render();
      focusOperation(item.id, cancelled ? 'restore-purchase' : 'cancel-purchase');
    }
    return;
  }
  if (item.cancelled) return;
  if (button.dataset.action === 'undo-part') {
    state.installments[item.id] = state.installments[item.id].filter(({ id }) => id !== button.dataset.entry);
    if (state.snapshot) state.snapshot.paidIds = state.snapshot.paidIds.filter((id) => id !== button.dataset.entry);
    persist('Взнос отменён.');
    render();
    return;
  }
  if (button.dataset.action === 'undo') {
    updatePayment(item.id, '');
    persist('Операция возвращена в план. Прогноз учитывает её как предстоящую.');
    render();
    focusOperation(item.id, 'paid');
  } else if (button.dataset.action === 'edit' && item.custom && !item.seriesId) {
    openExpense(item);
  } else {
    openOperation(item, button.dataset.action, button);
  }
});

operationDate.addEventListener('input', () => operationDate.setCustomValidity(''));
paidDate.addEventListener('input', updateIncludedOption);
paidAmount.addEventListener('input', () => paidAmount.setCustomValidity(''));
byId('cancel-operation').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  editing?.trigger?.focus({ preventScroll: true });
  editing = null;
});

operationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const pagePosition = { top: window.scrollY, left: window.scrollX };
  if (!editing) return;
  const { item, mode, partial } = editing;
  let target;
  if (mode === 'edit') {
    const amount = operationAmount.valueAsNumber;
    const date = operationDate.value;
    if (!amountIsValid(amount, 0.01) || !dateIsValid(date) || !savePlan(item, date, amount)) return;
    target = item.paidOn || date;
    persist('Изменения сохранены.');
  } else {
    syncToday();
    const date = paidDate.value;
    if (!dateIsValid(date) || date > today) return;
    if (partial) {
      const amount = paidAmount.valueAsNumber;
      const current = scheduleFor(state).find(({ id }) => id === item.id);
      if (!amountIsValid(amount, 0.01) || !current || cents(amount) > cents(current.remaining)) {
        paidAmount.setCustomValidity('Сумма должна быть не больше остатка платежа.');
        paidAmount.reportValidity();
        return;
      }
      const entry = { id: crypto.randomUUID(), date, amount };
      state.installments[item.id] ??= [];
      state.installments[item.id].push(entry);
      if (state.snapshot && date === state.snapshot.date && includedInput.checked) state.snapshot.paidIds.push(entry.id);
    } else {
      updatePayment(item.id, date, includedInput.checked);
    }
    target = date;
    persist(item.amount > 0 ? 'Поступление отмечено.' : 'Оплата отмечена.');
  }
  editing = null;
  dialog.close();
  selectDay(target);
  focusOperation(item.id, mode);
  window.scrollTo({ ...pagePosition, behavior: 'instant' });
});

expenseTemplate.addEventListener('change', () => {
  const template = state.expenseTemplates.find(({ id }) => id === expenseTemplate.value);
  if (!template) return;
  expenseName.value = template.title;
  expenseName.setCustomValidity('');
  expenseCategory.value = template.category;
  byId('template-message').hidden = true;
  expenseAmount.focus();
});

byId('save-expense-template').addEventListener('click', () => {
  const title = expenseName.value.trim();
  if (!title) {
    expenseName.setCustomValidity('Введи название для шаблона.');
    expenseName.reportValidity();
    return;
  }
  const category = expenseCategory.value;
  const existing = state.expenseTemplates.find((template) => (
    template.title.toLocaleLowerCase('ru-RU') === title.toLocaleLowerCase('ru-RU')
    && template.category === category
  ));
  const template = existing ?? { id: crypto.randomUUID(), title, category };
  if (!existing) state.expenseTemplates.push(template);
  renderExpenseTemplates(template.id);
  const message = persist(existing ? 'Такой шаблон уже сохранён.' : 'Шаблон сохранён.');
  byId('template-message').textContent = message;
  byId('template-message').hidden = false;
});

byId('add-expense').addEventListener('click', () => openExpense(null));
byId('add-income').addEventListener('click', () => openExpense(null, 'income'));
byId('add-payment').addEventListener('click', () => openExpense(null, 'payment'));
byId('show-demo').checked = state.showDemo;
byId('show-demo').addEventListener('change', (event) => {
  state.showDemo = event.target.checked;
  persist('Календарь пересчитан.');
  render();
});
byId('cancel-expense').addEventListener('click', () => expenseDialog.close());
expenseName.addEventListener('input', () => expenseName.setCustomValidity(''));
expenseDate.addEventListener('input', () => { updateExpenseStatus(); byId('expense-repeat-end').setCustomValidity(''); });
byId('expense-repeat-end').addEventListener('input', (event) => event.target.setCustomValidity(''));
byId('expense-repeat').addEventListener('change', (event) => {
  byId('expense-repeat-end').setCustomValidity('');
  byId('repeat-end-fields').hidden = event.target.value === 'once';
  if (event.target.value !== 'once') expenseStatus.value = 'planned';
});
expenseStatus.addEventListener('change', updateExpenseStatus);

expenseForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const pagePosition = { top: window.scrollY, left: window.scrollX };
  syncToday();
  updateExpenseStatus();
  const title = expenseName.value.trim();
  if (!title) {
    expenseName.setCustomValidity('Введи название операции.');
    expenseName.reportValidity();
    return;
  }
  const date = expenseDate.value;
  const repeatEnd = byId('expense-repeat-end').value;
  if (!byId('expense-repeat').disabled && byId('expense-repeat').value !== 'once' && repeatEnd && repeatEnd < date) {
    byId('expense-repeat-end').setCustomValidity('Последняя дата должна быть не раньше первой.');
    byId('expense-repeat-end').reportValidity();
    return;
  }
  const amount = expenseAmount.valueAsNumber;
  if (!dateIsValid(date) || !amountIsValid(amount, 0.01)) return;

  const id = editingExpense?.id ?? 'expense-' + crypto.randomUUID();
  const paid = expenseStatus.value === 'paid';
  const previous = editingExpense;
  const planDate = state.installments[id]?.length ? date : paid && previous?.paidOn && previous.paidOn !== previous.date ? previous.date : date;
  const config = operationKinds[expenseKind];
  const category = expenseKind === 'expense' ? expenseCategory.value : config.category;
  const signedAmount = expenseKind === 'income' ? amount : -amount;
  const expense = { id, title, category, amount: signedAmount, date: planDate, kind: expenseKind, mandatory: expenseKind === 'payment',
    repeat: !editingExpense && expenseKind === 'expense' ? byId('expense-repeat').value : editingExpense?.repeat ?? 'once',
    repeatEnd: !editingExpense ? byId('expense-repeat-end').value : editingExpense.repeatEnd ?? '',
  };
  const index = state.customExpenses.findIndex((item) => item.id === id);
  if (index === -1) state.customExpenses.push(expense);
  else state.customExpenses[index] = expense;
  if (!editingExpense || !state.installments[id]?.length) {
    updatePayment(id, paid ? date : '', expenseIncluded.checked);
  }
  persist(editingExpense ? 'Изменения сохранены.' : 'Операция добавлена.');
  expenseDialog.close();
  selectDay(date);
  focusOperation(id, 'edit');
  window.scrollTo({ ...pagePosition, behavior: 'instant' });
});

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    for (const option of document.querySelectorAll('[data-view]')) option.setAttribute('aria-pressed', String(option === button));
    render();
  });
}

byId('prev-month').addEventListener('click', () => navigateMonth(-1));
byId('next-month').addEventListener('click', () => navigateMonth(1));
byId('today').addEventListener('click', () => {
  syncToday();
  selectDay(today, true);
});
byId('first-gap').addEventListener('click', (event) => selectDay(event.currentTarget.dataset.jump, true));
byId('due-jump').addEventListener('click', () => selectDay(debtTerms(state).date, true));
byId('extension-jump').addEventListener('click', () => selectDay(state.extensionDate, true));

for (const input of document.querySelectorAll('[name="scenario"]')) {
  input.addEventListener('change', () => {
    if (lockedScenario(state)) return;
    state.scenario = input.value;
    persist();
    selectDay(debtTerms(state).date);
  });
}

extensionInput.addEventListener('change', () => {
  const date = extensionInput.value;
  const valid = !date || validExtensionDate(date, debtTerms(state).date);
  byId('date-error').hidden = valid;
  extensionInput.setAttribute('aria-invalid', String(!valid));
  if (valid) {
    state.extensionDate = date;
    persist();
    render();
  }
});

const loanDialog = byId('loan-dialog');
const loanForm = byId('loan-form');
const transferDialog = byId('extension-dialog');
const transferForm = byId('loan-extension-form');

function updateLoanReceipt() {
  const receivedDate = byId('loan-received-date').value;
  const future = receivedDate > today;
  byId('loan-received-paid').disabled = future;
  if (future) byId('loan-received-paid').checked = false;
  const showIncluded = byId('loan-received-paid').checked && receivedDate === state.snapshot?.date;
  byId('loan-included-label').hidden = !showIncluded;
  if (!showIncluded) byId('loan-included').checked = false;
  byId('loan-due-date').setCustomValidity('');
}

byId('add-loan').addEventListener('click', () => {
  syncToday();
  loanForm.reset();
  byId('loan-received-date').value = state.selected;
  const due = utc(state.selected);
  due.setUTCDate(due.getUTCDate() + 21);
  byId('loan-due-date').value = due.getUTCFullYear() <= 9999 ? due.toISOString().slice(0, 10) : maxDate;
  byId('loan-received-paid').checked = state.selected <= today;
  updateLoanReceipt();
  byId('loan-name').setCustomValidity('');
  loanDialog.showModal();
});
byId('cancel-loan').addEventListener('click', () => loanDialog.close());
byId('loan-name').addEventListener('input', (event) => event.target.setCustomValidity(''));
byId('loan-received-date').addEventListener('input', updateLoanReceipt);
byId('loan-received-paid').addEventListener('change', updateLoanReceipt);
byId('loan-due-date').addEventListener('input', (event) => event.target.setCustomValidity(''));

loanForm.addEventListener('submit', (event) => {
  event.preventDefault();
  syncToday();
  updateLoanReceipt();
  const title = byId('loan-name').value.trim();
  if (!title) {
    byId('loan-name').setCustomValidity('Введи название займа.');
    byId('loan-name').reportValidity();
    return;
  }
  const received = byId('loan-received').valueAsNumber;
  const repay = byId('loan-repay').valueAsNumber;
  const fee = byId('loan-fee').valueAsNumber;
  const receivedDate = byId('loan-received-date').value;
  const dueDate = byId('loan-due-date').value;
  if (!amountIsValid(received, 0.01) || !amountIsValid(repay, 0.01) || !amountIsValid(fee, 0)
      || !dateIsValid(receivedDate) || !dateIsValid(dueDate)) return;
  if (dueDate < receivedDate) {
    byId('loan-due-date').setCustomValidity('Срок возврата должен быть не раньше получения.');
    byId('loan-due-date').reportValidity();
    return;
  }
  const loan = { id: 'loan-' + crypto.randomUUID(), title, received, repay, fee, receivedDate, dueDate, extensions: [] };
  state.loans.push(loan);
  if (byId('loan-received-paid').checked) updatePayment(loan.id + '/in', receivedDate, byId('loan-included').checked);
  persist('Заём добавлен.');
  loanDialog.close();
  selectDay(dueDate);
});

function updateExtensionFields() {
  const date = byId('loan-extension-date').value;
  byId('extension-included-label').hidden = date !== state.snapshot?.date;
  if (date !== state.snapshot?.date) byId('extension-included').checked = false;
  byId('loan-new-date').setCustomValidity('');
}

function openLoanExtension(loan) {
  syncToday();
  extendingLoan = loan;
  transferForm.reset();
  const repayment = scheduleFor(state).find(({ id }) => id === loan.id + '/out');
  byId('loan-extension-description').textContent = loan.title + ' · после переноса останется вернуть ' + money(repayment.remaining);
  byId('loan-extension-date').value = today;
  byId('loan-extension-date').min = loan.extensions?.at(-1)?.date ?? loan.receivedDate;
  byId('loan-extension-date').max = today;
  byId('loan-extension-fee').value = loan.fee;
  const minimumDate = nextDay(loanDueDate(loan));
  byId('loan-new-date').min = minimumDate || maxDate;
  byId('loan-new-date').value = minimumDate;
  updateExtensionFields();
  transferDialog.showModal();
}
byId('cancel-extension').addEventListener('click', () => transferDialog.close());
byId('loan-extension-date').addEventListener('input', updateExtensionFields);
byId('loan-new-date').addEventListener('input', (event) => event.target.setCustomValidity(''));
transferForm.addEventListener('submit', (event) => {
  event.preventDefault();
  syncToday();
  const loan = extendingLoan;
  if (!loan) return;
  const date = byId('loan-extension-date').value;
  const newDate = byId('loan-new-date').value;
  const fee = byId('loan-extension-fee').valueAsNumber;
  if (!dateIsValid(date) || date > today || date < (loan.extensions.at(-1)?.date ?? loan.receivedDate)
      || !dateIsValid(newDate) || !amountIsValid(fee, 0)) return;
  if (newDate <= loanDueDate(loan) || newDate <= date) {
    byId('loan-new-date').setCustomValidity('Новый срок должен быть позже прежнего срока и даты оплаты переноса.');
    byId('loan-new-date').reportValidity();
    return;
  }
  const repayment = scheduleFor(state).find(({ id }) => id === loan.id + '/out');
  if (!repayment.remaining) return;
  const extension = { id: 'extension-' + crypto.randomUUID(), date, newDate, fee };
  loan.extensions.push(extension);
  if (fee) updatePayment(extension.id, date, byId('extension-included').checked);
  persist('Перенос записан. Плата учтена отдельно, остаток займа перенесён на новый срок.');
  transferDialog.close();
  extendingLoan = null;
  selectDay(newDate);
});

const restoreDialog = byId('restore-dialog');
const resetDialog = byId('reset-dialog');
const backupFileInput = byId('backup-file');
const rollbackKey = 'money-calendar:before-restore:v1';
let pendingRestore = null;
let readingBackup = false;
let pendingReplacement = null;

function backupError(message = '') {
  byId('backup-error').textContent = message;
  byId('backup-error').hidden = !message;
}

function updateUndoRestore() {
  try {
    byId('undo-import').hidden = !window.localStorage.getItem(rollbackKey);
  } catch {
    byId('undo-import').hidden = true;
  }
}

function showLoadedPlan(data, message) {
  Object.assign(state, data);
  actualInput.value = '';
  openingInput.value = state.opening;
  extensionInput.value = state.extensionDate;
  byId('show-demo').checked = state.showDemo;
  byId('opening-error').hidden = true;
  openingInput.setAttribute('aria-invalid', 'false');
  byId('date-error').hidden = true;
  extensionInput.setAttribute('aria-invalid', 'false');
  byId('save-status').textContent = message;
  byId('save-status').hidden = false;
  updateUndoRestore();
  selectDay(today);
}

byId('export-backup').addEventListener('click', () => {
  backupError();
  try {
    const backup = createBackup(state);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Kalendar_deneg_' + localDate() + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    backupError('Не удалось подготовить копию. ' + error.message);
  }
});

byId('import-backup').addEventListener('click', () => {
  if (readingBackup) return;
  backupError();
  backupFileInput.click();
});

backupFileInput.addEventListener('change', async () => {
  const file = backupFileInput.files[0];
  if (!file) return;
  readingBackup = true;
  byId('import-backup').disabled = true;
  pendingRestore = null;
  backupError();
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Файл слишком большой. Допустимый размер — до 20 МБ.');
    const backup = parseBackup(await file.text());
    const savedRaw = window.localStorage.getItem(storageKey);
    pendingRestore = { backup, savedRaw };
    byId('restore-file-name').textContent = file.name;
    const counts = backupCounts(backup.data);
    const details = byId('restore-details');
    details.replaceChildren();
    const created = new Date(backup.createdAt).toLocaleString('ru-RU');
    const rows = [
      ['Копия создана', created],
      ['Свои операции', counts.operations],
      ['В том числе повторяющиеся', counts.repeats],
      ['Займы', counts.loans],
      ['Шаблоны', counts.templates],
      ['Месяцы с бюджетом', Object.keys(backup.data.budgets).length],
      ['Оплаты и поступления', counts.payments],
      ['Фактический остаток при последнем вводе', backup.data.snapshot ? money(backup.data.snapshot.amount) : 'Не указан'],
    ];
    for (const [label, value] of rows) {
      const row = appendText(details, 'div', '');
      appendText(row, 'dt', label);
      appendText(row, 'dd', value);
    }
    restoreDialog.showModal();
  } catch (error) {
    pendingRestore = null;
    backupError(error.message || 'Не удалось прочитать резервную копию.');
  } finally {
    backupFileInput.value = '';
    readingBackup = false;
    byId('import-backup').disabled = false;
  }
});

byId('cancel-restore').addEventListener('click', () => restoreDialog.close());
restoreDialog.addEventListener('close', () => { pendingRestore = null; });
byId('confirm-restore').addEventListener('click', () => {
  if (!pendingRestore) return;
  backupError();
  const { backup, savedRaw } = pendingRestore;
  try {
    if (window.localStorage.getItem(storageKey) !== savedRaw) {
      throw new Error('Данные изменились в другой вкладке. Выбери файл заново, чтобы проверить восстановление.');
    }
    writeRestoredPlan(window.localStorage, storageKey, rollbackKey, state, backup.data);
  } catch (error) {
    restoreDialog.close();
    updateUndoRestore();
    backupError('Восстановление не выполнено. ' + (error.name === 'QuotaExceededError' ? 'Браузеру не хватает места для сохранения.' : error.message));
    return;
  }
  restoreDialog.close();
  syncToday();
  showLoadedPlan(backup.data, 'Данные восстановлены из файла.');
});

function openReplacement(mode, item = null, scope = 'once') {
  if (readingBackup) return;
  backupError();
  try {
    const savedRaw = window.localStorage.getItem(storageKey);
    const current = JSON.stringify(planData(state));
    if (savedRaw && JSON.stringify(planData(JSON.parse(savedRaw))) !== current) {
      throw new Error('Календарь изменился в другой вкладке. Обнови страницу перед заменой данных.');
    }
    const emptyPlan = planData({ showDemo: false });
    if (mode === 'reset' && current === JSON.stringify(emptyPlan)) {
      byId('save-status').textContent = 'Календарь уже пуст. Предыдущие данные сохранены, если они были до сброса.';
      byId('save-status').hidden = false;
      return;
    }
    const previous = window.localStorage.getItem(rollbackKey);
    if (mode === 'undo' && !previous) return;
    const deletingLoan = mode === 'delete-loan';
    const data = deletingLoan ? removeLoan(state, item.id) : mode === 'delete' ? removeOperation(state, item.id, scope)
      : mode === 'reset' ? emptyPlan : parseBackup(previous).data;
    // Capture both browser and in-memory data so a pending confirmation cannot overwrite newer edits.
    pendingReplacement = {
      mode, item, savedRaw, current, previous,
      data,
    };
    byId('delete-scope-fields').hidden = mode !== 'delete' || !item?.seriesId;
    byId('delete-scope').value = scope;
    byId('reset-title').textContent = deletingLoan ? 'Удалить заём?' : mode === 'delete' ? 'Удалить операцию?'
      : mode === 'reset' ? 'Сбросить все данные?' : 'Вернуть предыдущие данные?';
    let description = mode === 'reset'
      ? 'Очистятся операции за все даты, займы, оплаты, шаблоны, бюджеты и введённый остаток. Откроется пустой календарь на сегодня с нулевым прогнозом. Тестовый пример будет выключен.'
      : 'Текущий календарь будет заменён набором записей, который был до последнего удаления операции или займа, сброса или восстановления из файла. Изменения, внесённые после этого, тоже будут отменены.';
    if (mode === 'delete') {
      description = '«' + item.title + '» · ' + dailyDate(item.date) + ' · ' + money(Math.abs(item.amount))
        + '. Запись исчезнет из календаря. Прогноз и дневной лимит пересчитаются.';
      if (item.seriesId) description += scope === 'series'
        ? ' Удалятся все даты этой серии, включая прошлые записи и оплаты.'
        : ' Удалится только эта дата. Остальные повторы сохранятся.';
      if (item.loanId) description += item.loanFee
        ? ' Удалится только плата за перенос. Новый срок займа сохранится; сам перенос можно отменить в карточке займа.'
        : ' Удалится только эта операция. Карточка займа и остальные записи сохранятся. Это не погашение долга.';
      if (item.paidAmount) {
        description += ' Отметки оплаты или получения тоже удалятся.';
        const before = actualBalance(state, today);
        const after = actualBalance(data, today);
        if (before !== null && before !== after) description += ' Расчётный остаток: ' + money(before) + ' → ' + money(after) + '.';
        else description += ' Оплата уже учтена во введённом остатке. Если отметка была ошибочной, проверь «Сколько сейчас есть».';
      }
      if (scope === 'series') {
        const before = actualBalance(state, today);
        const after = actualBalance(data, today);
        description += ' Расчётный остаток: ' + money(before) + ' → ' + money(after) + '.';
      }
    }
    if (deletingLoan) {
      description = '«' + item.title + '» · получено ' + money(item.received) + ' · к возврату ' + money(item.repay)
        + '. Удалятся карточка займа, поступление денег, обязательство возврата, внесённые платежи и все переносы. Прогноз и дневной лимит пересчитаются.';
      const before = actualBalance(state, today);
      const after = actualBalance(data, today);
      if (before !== null && before !== after) description += ' Расчётный остаток: ' + money(before) + ' → ' + money(after) + '.';
      description += ' Это удаление ошибочной записи, а не погашение займа. Если деньги действительно получены или потрачены, проверь «Сколько сейчас есть».';
    }
    byId('reset-description').textContent = description;
    byId('confirm-reset').textContent = deletingLoan ? 'Удалить заём' : mode === 'delete' ? scope === 'series' ? 'Удалить всю серию' : 'Удалить операцию' : mode === 'reset' ? 'Сбросить данные' : 'Вернуть данные';
    byId('confirm-reset').classList.toggle('danger-button', mode !== 'undo');
    byId('reset-error').hidden = true;
    if (!resetDialog.open) resetDialog.showModal();
  } catch (error) {
    pendingReplacement = null;
    backupError('Не удалось подготовить замену данных. ' + error.message);
  }
}

byId('reset-data').addEventListener('click', () => openReplacement('reset'));
byId('delete-scope').addEventListener('change', (event) => {
  if (pendingReplacement?.mode === 'delete') openReplacement('delete', pendingReplacement.item, event.target.value);
});
byId('undo-import').addEventListener('click', () => openReplacement('undo'));
byId('cancel-reset').addEventListener('click', () => resetDialog.close());
resetDialog.addEventListener('close', () => {
  pendingReplacement = null;
  byId('reset-error').hidden = true;
});
byId('confirm-reset').addEventListener('click', () => {
  if (!pendingReplacement) return;
  const { mode, data, savedRaw, current, previous } = pendingReplacement;
  try {
    if (window.localStorage.getItem(storageKey) !== savedRaw
      || JSON.stringify(planData(state)) !== current
      || window.localStorage.getItem(rollbackKey) !== previous) {
      throw new Error('Данные изменились. Закрой это окно и обнови страницу, затем повтори действие.');
    }
    // Save recovery data before deletion/reset/undo; a failed write leaves the plan intact.
    writeRestoredPlan(window.localStorage, storageKey, rollbackKey, state, data);
  } catch (error) {
    byId('reset-error').textContent = 'Замена не выполнена. ' + (error.name === 'QuotaExceededError'
      ? 'Браузеру не хватает места для сохранения предыдущих данных.' : error.message);
    byId('reset-error').hidden = false;
    return;
  }
  resetDialog.close();
  syncToday();
  showLoadedPlan(data, mode === 'delete-loan'
    ? 'Заём удалён вместе с платежами и переносами. Расчёты обновлены. Можно нажать «Вернуть предыдущие данные».'
    : mode === 'delete'
    ? 'Операция удалена. Прогноз и дневной лимит пересчитаны. Можно нажать «Вернуть предыдущие данные».'
    : mode === 'reset'
    ? 'Данные сброшены. Можно начать новый тест или нажать «Вернуть предыдущие данные».'
    : 'Предыдущие данные возвращены. Заменённый набор тоже можно вернуть этой кнопкой.');
  byId(mode === 'reset' ? 'reset-data' : 'undo-import').focus({ preventScroll: true });
});
updateUndoRestore();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncToday();
});
window.setInterval(syncToday, 30_000);
render();
