import { readOwnedTransactions } from './export-records';
import { exportDate, selectExportYear, transactionAmount, ExportReviewRequiredError } from './transaction-export';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import type { ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';

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
      date: exportDate(record.date ?? record.datetime)!,
      category: typeof record.category === 'string' ? record.category : '',
      merchant_name: String(record.merchant_name ?? record.merchant ?? record.name ?? ''),
      account_id: record.account_id ?? record.accountId,
      is_deductible: (record.is_deductible ?? record.deductible ?? null) as boolean | null,
      pending: record.pending as boolean | null | undefined,
    };
  });
}
