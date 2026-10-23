import { readOwnedTransactions } from './export-records';
import { chargeDay } from '@/lib/schedule-c/taxDate';
import { exportDate, selectExportYear, transactionAmount, ExportReviewRequiredError, type ExportRecord } from './transaction-export';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import type { ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { reviewEstimateDates, type EstimateDateReview, type QuarterlyTransactionLike } from '@/lib/tax-provider/quarterly-estimates';

/**
 * Complete owner-verified records; invalid dates/amounts cannot disappear from a
 * tax calculation. Superseded duplicates are dropped here as well as in the
 * reader, so no tax total can count them.
 */
export async function readTaxExportTransactions(uid: string, taxYear: number): Promise<ScheduleCTransactionLike[]> {
  const records = selectExportYear((await readOwnedTransactions(uid)).filter(record => !isSupersededRecord(record)), taxYear);
  const seen = new Set<string>();
  return records.map(record => {
    const identity = record.trans_id ?? record.id;
    if (typeof identity === 'string' && identity) {
      if (seen.has(identity)) throw new ExportReviewRequiredError('Duplicate transaction identifiers exist in saved records. Reconcile duplicate imports before creating a tax summary.');
      seen.add(identity);
    }
    const amount = transactionAmount(record);
    const currency = record.iso_currency_code;
    if (amount === null) throw new ExportReviewRequiredError('A saved transaction has an invalid amount. Correct it before creating a tax summary.');
    if (currency !== 'USD' || record.unofficial_currency_code) throw new ExportReviewRequiredError('Missing or non-USD transaction currencies require reviewed U.S. dollar amounts before creating a tax summary.');
    if ((record.is_deductible ?? record.deductible) === true && record.pending !== true) {
      const allocations = ['business_percent', 'business_use_percent', 'business_use_percentage', 'businessUsePercent']
        .filter(key => Object.prototype.hasOwnProperty.call(record, key)).map(key => record[key]);
      const equipment = record.equipment_details;
      if (equipment && typeof equipment === 'object' && 'business_use_percentage' in equipment) allocations.push(equipment.business_use_percentage);
      if (allocations.some(value => typeof value !== 'number' || !Number.isFinite(value) || value !== 100)) {
        throw new ExportReviewRequiredError('A confirmed expense has a mixed-use or invalid business-use percentage. Review and reconcile the allocation before creating a tax summary; the current calculation cannot apply that percentage safely.');
      }
      if (['deduction_override', 'deductible_amount', 'deduction_amount', 'deductible_amount_override', 'deduction_percentage']
        .some(key => record[key] !== undefined && record[key] !== null)) {
        throw new ExportReviewRequiredError('A confirmed expense has a recorded deduction override. Review and reconcile that adjustment before creating a tax summary; the current calculation cannot apply it safely.');
      }
    }
    return { ...record, id: String(record.trans_id ?? record.id ?? ''), trans_id: String(record.trans_id ?? record.id ?? ''), amount,
      type: amount < 0 ? 'income' : 'expense',
      date: exportDate(record)!,
      category: typeof record.category === 'string' ? record.category : '',
      merchant_name: String(record.merchant_name ?? record.merchant ?? record.name ?? ''),
      account_id: record.account_id ?? record.accountId,
      is_deductible: (record.is_deductible ?? record.deductible ?? null) as boolean | null,
      pending: record.pending as boolean | null | undefined,
    };
  });
}

function assertDatedYearRows(records: ExportRecord[], taxYear: number) {
  const inYear = records.filter(record => chargeDay(record)?.startsWith(`${taxYear}-`));
  const seen = new Set<string>();
  for (const record of inYear) {
    const identity = record.trans_id ?? record.id;
    if (typeof identity === 'string' && identity) {
      if (seen.has(identity)) throw new ExportReviewRequiredError('Duplicate transaction identifiers exist in saved records. Reconcile duplicate imports before creating a tax summary.');
      seen.add(identity);
    }
    const amount = transactionAmount(record);
    const currency = record.iso_currency_code;
    if (amount === null) throw new ExportReviewRequiredError('A saved transaction has an invalid amount. Correct it before creating a tax summary.');
    if (currency !== 'USD' || record.unofficial_currency_code) throw new ExportReviewRequiredError('Missing or non-USD transaction currencies require reviewed U.S. dollar amounts before creating a tax summary.');
    if ((record.is_deductible ?? record.deductible) === true && record.pending !== true) {
      const allocations = ['business_percent', 'business_use_percent', 'business_use_percentage', 'businessUsePercent']
        .filter(key => Object.prototype.hasOwnProperty.call(record, key)).map(key => record[key]);
      const equipment = record.equipment_details;
      if (equipment && typeof equipment === 'object' && 'business_use_percentage' in equipment) allocations.push(equipment.business_use_percentage);
      if (allocations.some(value => typeof value !== 'number' || !Number.isFinite(value) || value !== 100)) {
        throw new ExportReviewRequiredError('A confirmed expense has a mixed-use or invalid business-use percentage. Review and reconcile the allocation before creating a tax summary; the current calculation cannot apply that percentage safely.');
      }
      if (['deduction_override', 'deductible_amount', 'deduction_amount', 'deductible_amount_override', 'deduction_percentage']
        .some(key => record[key] !== undefined && record[key] !== null)) {
        throw new ExportReviewRequiredError('A confirmed expense has a recorded deduction override. Review and reconcile that adjustment before creating a tax summary; the current calculation cannot apply it safely.');
      }
    }
  }
}

/**
 * Rows for the annual estimate. A missing charge day does not throw.
 * Dated rows in other years stay out of this year's validation.
 * `selectExportYear` still throws when a chargeless row is not estimate-placed income for that year.
 */
export async function readTransactionsForEstimate(uid: string, taxYear: number): Promise<{ transactions: ExportRecord[]; chargesNeedingDate: EstimateDateReview }> {
  const records = (await readOwnedTransactions(uid)).filter(record => !isSupersededRecord(record));
  assertDatedYearRows(records, taxYear);
  const transactions = records.map(record => {
    const amount = transactionAmount(record);
    const charge = exportDate(record);
    return { ...record, id: String(record.trans_id ?? record.id ?? ''), trans_id: String(record.trans_id ?? record.id ?? ''),
      amount: amount ?? (typeof record.amount === 'number' ? record.amount : 0),
      type: typeof amount === 'number' && amount < 0 ? 'income' : 'expense',
      date: charge ?? record.date,
      category: typeof record.category === 'string' ? record.category : '',
      merchant_name: String(record.merchant_name ?? record.merchant ?? record.name ?? ''),
      account_id: record.account_id ?? record.accountId,
      is_deductible: (record.is_deductible ?? record.deductible ?? null) as boolean | null,
      pending: record.pending as boolean | null | undefined,
    };
  });
  return { transactions, chargesNeedingDate: reviewEstimateDates(records as QuarterlyTransactionLike[], 'UTC', taxYear) };
}
