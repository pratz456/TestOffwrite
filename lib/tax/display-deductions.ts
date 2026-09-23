import { aggregateScheduleC, CATEGORY_MAP, isConfirmedScheduleCExpense, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { exportDate } from '@/lib/reports/transaction-export';
import { isCountableRecord } from '@/lib/transactions/record-scope';
import { isServerConfirmedDeduction } from '@/lib/transactions/confirmed-deduction';

/**
 * Confirmed transaction contributions before profile-specific vehicle, asset and
 * home-office adjustments. This is not a tax-savings or final-return estimate.
 * Matches the Schedule C export's signed, per-record cent rounding and meals rule.
 * Unknown currency/allocation or an unapplied override blocks totals, never turns
 * an unreviewed amount into a full deduction or silently drops it from a total.
 */
export function summarizeConfirmedDeductions<T extends object>(records: readonly T[], taxYear?: number) {
  const transactions: T[] = [];
  const contributions = new Map<T, number>();
  const seen = new Set<string>();
  let deductionCents = 0;
  let recordedCents = 0;
  let reviewMessage: string | null = null;
  for (const original of records) {
    const record = original as Record<string, unknown>;
    if (!isConfirmedScheduleCExpense(record as unknown as ScheduleCTransactionLike)) continue;
    const date = exportDate(record.date ?? record.datetime);
    if (!date) {
      reviewMessage = 'Review missing or invalid transaction dates before showing confirmed deduction totals.';
      continue;
    }
    if (taxYear !== undefined && Number(date.slice(0, 4)) !== taxYear) continue;
    transactions.push(original);
    const identity = record.trans_id ?? record.id;
    if (typeof identity === 'string' && identity) {
      if (seen.has(identity)) reviewMessage = 'Reconcile duplicate transaction identifiers before showing confirmed deduction totals.';
      seen.add(identity);
    }
    const amount = record.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) {
      reviewMessage = 'Review invalid transaction amounts before showing confirmed deduction totals.';
      continue;
    }
    if (record.iso_currency_code !== 'USD' || record.unofficial_currency_code) {
      reviewMessage = 'Review missing or non-USD currencies before showing confirmed deduction totals.';
      continue;
    }
    const allocations = ['business_percent', 'business_use_percent', 'business_use_percentage', 'businessUsePercent']
      .filter(key => Object.prototype.hasOwnProperty.call(record, key)).map(key => record[key]);
    const equipment = record.equipment_details;
    if (equipment && typeof equipment === 'object' && 'business_use_percentage' in equipment) allocations.push(equipment.business_use_percentage);
    if (allocations.some(value => typeof value !== 'number' || !Number.isFinite(value) || value !== 100)) {
      reviewMessage = 'Review mixed-use allocations before showing confirmed deduction totals. These percentages have not been applied.';
      continue;
    }
    if (['deduction_override', 'deductible_amount', 'deduction_amount', 'deductible_amount_override', 'deduction_percentage']
      .some(key => record[key] !== undefined && record[key] !== null)) {
      reviewMessage = 'Review recorded deduction overrides before showing confirmed deduction totals. These adjustments have not been applied.';
      continue;
    }
    const normalized = { ...record, amount, date, category: typeof record.category === 'string' ? record.category : '' } as ScheduleCTransactionLike;
    const contribution = aggregateScheduleC([normalized], date.slice(0, 4), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible;
    contributions.set(original, contribution);
    deductionCents += Math.round(contribution * 100);
    recordedCents += Math.round(amount * 100);
    if (!Number.isSafeInteger(deductionCents) || !Number.isSafeInteger(recordedCents)) reviewMessage = 'Review transaction amounts before showing confirmed deduction totals.';
  }
  return {
    transactions,
    totalDeductible: reviewMessage ? null : deductionCents / 100,
    totalRecordedAmount: reviewMessage ? null : recordedCents / 100,
    contributions: reviewMessage ? new Map<T, number>() : contributions,
    reviewMessage,
  };
}

/** Posted positive USD outflows still awaiting a decision, not confirmed personal spending or inflows. */
export function isReviewableBusinessOutflow(record: object): boolean {
  const value = record as Record<string, unknown>;
  return isCountableRecord(value) && !isServerConfirmedDeduction(value)
    && value.is_deductible !== false
    && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0
    && Number.isSafeInteger(Math.round(value.amount * 100))
    && value.iso_currency_code === 'USD' && !value.unofficial_currency_code
    && exportDate(value.date ?? value.datetime) !== null;
}
