import { cashEntries, scheduleFor } from './model.mjs';
import { planData, validatePlan } from './backup.mjs';

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
  const receipts = new Set(cashEntries(item).map(({ id }) => id));
  receipts.add(operationId);
  data.customExpenses = data.customExpenses.filter(({ id }) => id !== operationId);
  for (const key of ['edits', 'payments', 'installments', 'cancellations']) delete data[key][operationId];
  data.operationChanges = data.operationChanges.filter((entry) => entry.operationId !== operationId);
  if (data.snapshot) data.snapshot.paidIds = data.snapshot.paidIds.filter((id) => !receipts.has(id));
  return validatePlan(data);
}
