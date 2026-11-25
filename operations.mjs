import { dateIsValid, scheduleFor } from './model.mjs?v=0.1.5';
import { planData, validatePlan } from './backup.mjs?v=0.1.5';

export function canDeleteOperation(item) {
  return typeof item?.id === 'string' && Boolean(item.id);
}

export function removeOperation(state, operationId, scope = 'once') {
  const source = state.customExpenses?.find(({ id }) => id === operationId);
  const occurrenceDate = source?.date ?? operationId.slice(operationId.lastIndexOf('@') + 1);
  const month = dateIsValid(occurrenceDate) ? occurrenceDate.slice(0, 7) : undefined;
  const item = scheduleFor(state, undefined, month).find(({ id }) => id === operationId);
  if (!item) throw new Error('Операция не найдена.');
  if (!['once', 'series'].includes(scope) || (scope === 'series' && !item.seriesId)) throw new Error('Некорректный выбор удаления.');
  if (item.custom && !item.seriesId) return removeCustomOperation(state, operationId);
  const data = JSON.parse(JSON.stringify(planData(state)));
  if (scope === 'series') {
    const root = item.seriesId;
    const ids = new Set([root, ...Object.keys(data.edits), ...Object.keys(data.payments),
      ...Object.keys(data.installments), ...Object.keys(data.cancellations), ...Object.keys(data.deletedOperations),
      ...data.operationChanges.map((entry) => entry.operationId)]
      .filter((id) => id === root || id.startsWith(root + '@')));
    data.customExpenses = data.customExpenses.filter(({ id }) => id !== root);
    removeOperationRecords(data, ids);
  } else {
    removeOperationRecords(data, new Set([operationId]));
    data.deletedOperations[operationId] = true;
  }
  return validatePlan(data);
}

// Delete a mistaken standalone record, including its dependent payment history.
// A manually entered cash balance is a checkpoint, not a sum of past records:
// deleting history must never rewrite the amount the user actually entered.
export function removeCustomOperation(state, operationId) {
  const item = scheduleFor(state).find(({ id }) => id === operationId);
  if (!item?.custom || item.seriesId || item.loanId) throw new Error('Можно удалить только свою отдельную операцию.');
  const data = JSON.parse(JSON.stringify(planData(state)));
  data.customExpenses = data.customExpenses.filter(({ id }) => id !== operationId);
  removeOperationRecords(data, new Set([operationId]));
  return validatePlan(data);
}

export function removeLoan(state, loanId) {
  const loan = state.loans?.find(({ id }) => id === loanId);
  if (!loan) throw new Error('Заём не найден.');
  const data = JSON.parse(JSON.stringify(planData(state)));
  const operationIds = new Set([loanId + '/in', loanId + '/out', ...(loan.extensions ?? []).map(({ id }) => id)]);
  data.loans = data.loans.filter(({ id }) => id !== loanId);
  removeOperationRecords(data, operationIds);
  return validatePlan(data);
}

function removeOperationRecords(data, operationIds) {
  const receipts = new Set(operationIds);
  for (const id of operationIds) {
    for (const entry of data.installments[id] ?? []) receipts.add(entry.id);
    for (const key of ['edits', 'payments', 'installments', 'cancellations', 'deletedOperations']) delete data[key][id];
  }
  data.operationChanges = data.operationChanges.filter((entry) => {
    if (!operationIds.has(entry.operationId)) return true;
    receipts.add(entry.id);
    return false;
  });
  if (data.snapshot) data.snapshot.paidIds = data.snapshot.paidIds.filter((id) => !receipts.has(id));
}
