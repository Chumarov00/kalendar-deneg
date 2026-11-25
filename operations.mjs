import { scheduleFor } from './model.mjs?v=0.1.3';
import { planData, validatePlan } from './backup.mjs?v=0.1.3';

export function canDeleteOperation(item) {
  return Boolean(item?.custom && !item.seriesId && !item.loanId);
}

// Delete a mistaken standalone record, including its dependent payment history.
// A manually entered cash balance is a checkpoint, not a sum of past records:
// deleting history must never rewrite the amount the user actually entered.
export function removeCustomOperation(state, operationId) {
  const item = scheduleFor(state).find(({ id }) => id === operationId);
  if (!canDeleteOperation(item)) throw new Error('Можно удалить только свою отдельную операцию.');
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
    for (const key of ['edits', 'payments', 'installments', 'cancellations']) delete data[key][id];
  }
  data.operationChanges = data.operationChanges.filter((entry) => {
    if (!operationIds.has(entry.operationId)) return true;
    receipts.add(entry.id);
    return false;
  });
  if (data.snapshot) data.snapshot.paidIds = data.snapshot.paidIds.filter((id) => !receipts.has(id));
}
