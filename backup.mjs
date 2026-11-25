import { amountIsValid, cents, dateIsValid, debt, debtIds, scheduleFor, utc, budgetCategories } from './model.mjs?v=0.1.3';

export const backupApp = 'kalendar-deneg';
export const backupVersion = 3;

export function planData(state) {
  return {
    opening: state.opening ?? 0,
    scenario: state.scenario ?? 'pay',
    extensionDate: state.extensionDate ?? '',
    edits: state.edits ?? {},
    payments: state.payments ?? {},
    debtTerms: state.debtTerms ?? {},
    snapshot: state.snapshot ?? null,
    customExpenses: state.customExpenses ?? [],
    expenseTemplates: state.expenseTemplates ?? [],
    showDemo: state.showDemo ?? true,
    installments: state.installments ?? {},
    loans: state.loans ?? [],
    budgets: state.budgets ?? {},
    cancellations: state.cancellations ?? {},
    operationChanges: state.operationChanges ?? [],
  };
}

function requireValue(condition, message = 'В файле есть некорректные данные.') {
  if (!condition) throw new Error(message);
}

function object(value) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}

function list(value) {
  requireValue(Array.isArray(value));
  return value;
}

function text(value) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 200);
}

function identifier(value) {
  text(value);
  requireValue(!['__proto__', 'constructor', 'prototype'].includes(value));
}

function date(value) {
  requireValue(dateIsValid(value), 'В файле есть некорректная дата.');
}

function money(value, minimum) {
  requireValue(amountIsValid(value, minimum), 'В файле есть некорректная сумма.');
}

function amount(value) {
  money(value);
  requireValue(value !== 0);
}

function unique(values) {
  requireValue(new Set(values).size === values.length, 'В файле повторяются идентификаторы записей.');
}

export function validatePlan(input) {
  object(input);
  // Inspect every supplied key before any object is copied into application state.
  const queue = [input];
  while (queue.length) {
    const node = queue.pop();
    if (!node || typeof node !== 'object') continue;
    for (const key of Object.keys(node)) {
      requireValue(!['__proto__', 'constructor', 'prototype'].includes(key));
      queue.push(node[key]);
    }
  }
  for (const key of Object.keys(planData({}))) {
    requireValue(input[key] !== null || key === 'snapshot');
  }
  const data = planData(input);
  for (const [month, limits] of Object.entries(object(data.budgets))) {
    requireValue(/^\d{4}-\d{2}$/.test(month) && dateIsValid(month + '-01'), 'В бюджете указан некорректный месяц.');
    object(limits);
    const allowed = [...budgetCategories.map(({ key }) => key), 'reserve'];
    for (const [key, value] of Object.entries(limits)) {
      requireValue(allowed.includes(key));
      money(value, 0);
    }
  }
  money(data.opening);
  requireValue(['pay', 'extend'].includes(data.scenario));
  requireValue(typeof data.showDemo === 'boolean');
  requireValue(typeof data.extensionDate === 'string');
  if (data.extensionDate) date(data.extensionDate);
  object(data.debtTerms);
  if (data.debtTerms.date !== undefined) date(data.debtTerms.date);
  if (data.debtTerms.amount !== undefined) money(data.debtTerms.amount, 0.01);
  if (data.debtTerms.fee !== undefined) money(data.debtTerms.fee, 0.01);
  const terms = { ...debt, ...data.debtTerms };
  if (data.extensionDate) requireValue(data.extensionDate > terms.date);

  for (const item of list(data.customExpenses)) {
    object(item);
    identifier(item.id);
    text(item.title);
    text(item.category);
    amount(item.amount);
    date(item.date);
    if (item.kind !== undefined) requireValue(['expense', 'income', 'payment'].includes(item.kind));
    if (item.mandatory !== undefined) requireValue(typeof item.mandatory === 'boolean');
    if (item.repeat !== undefined) requireValue(['once', 'daily', 'weekly'].includes(item.repeat));
    if (item.repeatEnd) {
      date(item.repeatEnd);
      requireValue(item.repeatEnd >= item.date);
    }
  }
  for (const template of list(data.expenseTemplates)) {
    object(template);
    identifier(template.id);
    text(template.title);
    text(template.category);
  }
  unique(data.expenseTemplates.map(({ id }) => id));

  const operationIds = data.customExpenses.map(({ id }) => id);
  for (const loan of list(data.loans)) {
    object(loan);
    identifier(loan.id);
    text(loan.title);
    money(loan.received, 0.01);
    money(loan.repay, 0.01);
    money(loan.fee, 0);
    date(loan.receivedDate);
    date(loan.dueDate);
    requireValue(loan.dueDate >= loan.receivedDate);
    operationIds.push(loan.id + '/in', loan.id + '/out');
    let previousDue = loan.dueDate;
    let previousDate = loan.receivedDate;
    for (const extension of list(loan.extensions)) {
      object(extension);
      identifier(extension.id);
      date(extension.date);
      date(extension.newDate);
      money(extension.fee, 0);
      requireValue(extension.date >= previousDate && extension.newDate > previousDue && extension.newDate > extension.date);
      previousDue = extension.newDate;
      previousDate = extension.date;
      operationIds.push(extension.id);
    }
  }
  unique(data.loans.map(({ id }) => id));
  const baseState = { ...data, customExpenses: [], loans: [], edits: {}, payments: {}, installments: {}, showDemo: true };
  const definitions = new Map(scheduleFor(baseState, 'pay', '2026-12').map((item) => [item.id, item]));
  definitions.set(debtIds.extended, { id: debtIds.extended, amount: -terms.amount, date: data.extensionDate });
  definitions.set(debtIds.fee, { id: debtIds.fee, amount: -terms.fee, date: terms.date });
  unique([...definitions.keys(), ...operationIds]);

  for (const item of data.customExpenses) definitions.set(item.id, item);
  for (const loan of data.loans) {
    definitions.set(loan.id + '/in', { amount: loan.received });
    definitions.set(loan.id + '/out', { amount: -loan.repay });
    for (const extension of loan.extensions ?? []) definitions.set(extension.id, { amount: -extension.fee });
  }

  function operation(id) {
    identifier(id);
    if (definitions.has(id)) return definitions.get(id);
    const separator = id.lastIndexOf('@');
    const source = definitions.get(id.slice(0, separator));
    const occurrence = id.slice(separator + 1);
    requireValue(source && ['daily', 'weekly'].includes(source.repeat) && dateIsValid(occurrence));
    const days = Math.round((utc(occurrence) - utc(source.date)) / 86400000);
    requireValue(days > 0 && (source.repeat !== 'weekly' || days % 7 === 0));
    requireValue(!source.repeatEnd || occurrence <= source.repeatEnd);
    return source;
  }

  for (const [id, edit] of Object.entries(object(data.edits))) {
    const source = operation(id);
    object(edit);
    date(edit.date);
    amount(edit.amount);
    requireValue(Math.sign(edit.amount) === Math.sign(source.amount));
  }
  for (const [id, paidOn] of Object.entries(object(data.payments))) {
    operation(id);
    date(paidOn);
  }
  const receiptIds = [...definitions.keys(), ...Object.keys(data.payments)];
  const partIds = [];
  for (const [id, entries] of Object.entries(object(data.installments))) {
    const source = operation(id);
    list(entries);
    requireValue(!entries.length || !data.payments[id], 'В файле одновременно указаны полная оплата и частичные взносы.');
    let total = 0;
    for (const entry of entries) {
      object(entry);
      identifier(entry.id);
      date(entry.date);
      money(entry.amount, 0.01);
      partIds.push(entry.id);
      total += cents(entry.amount);
    }
    const editedAmount = data.edits[id]?.amount ?? source.amount;
    requireValue(total <= cents(Math.abs(editedAmount)), 'Сумма взносов превышает сумму платежа.');
  }
  unique(partIds);
  requireValue(partIds.every((id) => !receiptIds.includes(id)));
  const changes = new Map();
  const changeIds = [];
  function cancellable(id) {
    const source = operation(id);
    requireValue(source.amount < 0 && !source.mandatory && source.category !== 'Долги'
      && !Object.values(debtIds).includes(id)
      && !data.loans.some((loan) => id.startsWith(loan.id + '/') || loan.extensions.some((entry) => entry.id === id)));
    return source;
  }
  for (const [id, cancelled] of Object.entries(object(data.cancellations))) {
    cancellable(id);
    requireValue(cancelled === true);
  }
  for (const entry of list(data.operationChanges)) {
    object(entry);
    identifier(entry.id);
    cancellable(entry.operationId);
    date(entry.date);
    amount(entry.amount);
    changeIds.push(entry.id);
    changes.set(entry.operationId, (changes.get(entry.operationId) ?? 0) + cents(entry.amount));
  }
  unique([...partIds, ...changeIds]);
  requireValue(changeIds.every((id) => !receiptIds.includes(id)));
  for (const id of new Set([...changes.keys(), ...Object.keys(data.cancellations)])) {
    const source = operation(id);
    const operationAmount = data.edits[id]?.amount ?? source.amount;
    const paid = data.payments[id] ? cents(Math.abs(operationAmount))
      : (data.installments[id] ?? []).reduce((sum, entry) => sum + cents(entry.amount), 0);
    requireValue((changes.get(id) ?? 0) === (data.cancellations[id] ? paid : 0),
      'В файле не сходятся суммы отменённых покупок.');
  }
  const fullOrParts = (id) => data.payments[id] || data.installments[id]?.length;
  requireValue(!(fullOrParts(debtIds.pay) && (fullOrParts(debtIds.fee) || fullOrParts(debtIds.extended))));
  if (fullOrParts(debtIds.extended)) requireValue(dateIsValid(data.extensionDate) && data.extensionDate > terms.date);
  if (data.snapshot !== null) {
    object(data.snapshot);
    date(data.snapshot.date);
    money(data.snapshot.amount);
    list(data.snapshot.paidIds).forEach(identifier);
    unique(data.snapshot.paidIds);
  }
  return JSON.parse(JSON.stringify(data));
}

export function createBackup(state, now = new Date()) {
  return { app: backupApp, schemaVersion: backupVersion, createdAt: now.toISOString(), data: validatePlan(planData(state)) };
}

export function parseBackup(contents) {
  let backup;
  try {
    backup = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Не удалось прочитать файл. Выбери резервную копию в формате JSON.');
  }
  object(backup);
  requireValue(backup.app === backupApp, 'Это не резервная копия «Календаря денег».');
  requireValue([1, 2, backupVersion].includes(backup.schemaVersion), 'Версия резервной копии пока не поддерживается.');
  requireValue(typeof backup.createdAt === 'string' && Number.isFinite(Date.parse(backup.createdAt)));
  object(backup.data);
  requireValue(Object.keys(planData({})).filter((key) => (backup.schemaVersion !== 1 || key !== 'budgets') && (backup.schemaVersion >= 3 || !['cancellations', 'operationChanges'].includes(key))).every((key) => Object.hasOwn(backup.data, key)), 'В копии отсутствует часть данных.');
  return { ...backup, data: validatePlan(backup.data) };
}

export function backupCounts(data) {
  return {
    operations: data.customExpenses.length,
    repeats: data.customExpenses.filter(({ repeat }) => repeat && repeat !== 'once').length,
    loans: data.loans.length,
    templates: data.expenseTemplates.length,
    payments: Object.keys(data.payments).length + Object.values(data.installments).reduce((sum, entries) => sum + entries.length, 0),
  };
}

export function writeRestoredPlan(storage, storageKey, rollbackKey, current, imported) {
  const previous = JSON.stringify(createBackup(current));
  const replacement = JSON.stringify(planData(imported));
  const priorRollback = storage.getItem(rollbackKey);
  storage.setItem(rollbackKey, previous);
  try {
    storage.setItem(storageKey, replacement);
  } catch (error) {
    try {
      if (priorRollback === null) storage.removeItem(rollbackKey);
      else storage.setItem(rollbackKey, priorRollback);
    } catch {
      // The previous current plan remains intact if the replacement could not be written.
    }
    throw error;
  }
}
