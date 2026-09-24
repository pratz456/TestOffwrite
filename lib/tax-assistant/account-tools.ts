import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import type { AccountResult } from './account-contract';
import { exportDate } from '@/lib/reports/transaction-export';

export const ACCOUNT_SCAN_LIMIT = 500;
export const ACCOUNT_FIELDS = ['merchant_name', 'merchant', 'name', 'amount', 'date', 'type', 'transaction_kind', 'category',
  'iso_currency_code', 'currency', 'expense_type', 'pending', 'is_deductible', 'review_status', 'review_source', 'review_suggestion_id',
  'reviewed_at', 'user_classification_reason', 'tax_review_required', 'ai_suggestion', 'receipt_url', 'business_purpose',
  'analysisStatus', 'analysis_status', 'superseded_by', 'bank_removed', 'unofficial_currency_code'];
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const text = (value: unknown, limit = 120) => typeof value === 'string' ? value.slice(0, limit).trim() : '';

export function transactionAccountResult(options: {
  intent: 'review_transactions' | 'missing_receipts'; rows: Record<string, any>[]; uid: string; taxYear: number; now: Date;
}): { reply: string; account: AccountResult } {
  const { intent, uid, taxYear, now } = options;
  const rows: Array<Record<string, any> & { date: string }> = options.rows.slice(0, ACCOUNT_SCAN_LIMIT).flatMap(row => {
    const date = exportDate(row.date);
    const owners = [row.userId, row.user_id].filter(value => value != null);
    return owners.length > 0 && owners.every(value => value === uid) && !isSupersededRecord(row) && row.bank_removed !== true &&
      date?.startsWith(`${taxYear}-`) ? [{ ...row, date }] : [];
  });
  const needsReceipt = (row: Record<string, any>) => !row.pending && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0 &&
    !['income', 'transfer', 'refund', 'personal'].includes(row.transaction_kind) && row.type !== 'income' && row.expense_type !== 'personal' && row.is_deductible !== false &&
    !text(row.receipt_url);
  const matching = rows.filter(row => intent === 'missing_receipts' ? needsReceipt(row) :
    !row.pending && (transactionNeedsCategoryReview(row) || transactionNeedsTaxReview(row)));
  matching.sort((a, b) => Number(Boolean(b.tax_review_required)) - Number(Boolean(a.tax_review_required)) || String(b.date).localeCompare(String(a.date)));
  const items = matching.slice(0, 8).flatMap(row => {
    const id = text(row.trans_id || row.id, 200);
    if (!id) return [];
    const currency = text(row.iso_currency_code || row.currency).toUpperCase();
    const amount = currency === 'USD' && !row.unofficial_currency_code && typeof row.amount === 'number' && Number.isFinite(row.amount) ? money(row.amount) : 'Amount needs currency review';
    const question = row.ai_suggestion?.questions?.find((value: unknown) => typeof value === 'string' && value.trim());
    return [{ label: text(row.merchant_name || row.merchant || row.name, 100) || 'Transaction',
      detail: `${row.date} · ${amount} · ${intent === 'missing_receipts' ? 'No receipt attached' : text(question, 240) || 'Review the saved category and tax treatment'}`,
      href: `/protected?screen=transaction-detail&transactionId=${encodeURIComponent(id).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}&from=tax-assistant` }];
  });
  return {
    reply: matching.length ? `${matching.length} ${intent === 'missing_receipts' ? 'purchases have no receipt attached' : 'transactions need your review'} in the records checked.` :
      `No ${intent === 'missing_receipts' ? 'missing receipt attachments' : 'open transaction reviews'} were found in the records checked.`,
    account: {
      title: intent === 'missing_receipts' ? 'Collect supporting records' : 'Your next reviews', asOf: now.toISOString(),
      scope: `Checked ${rows.length} records dated ${taxYear} in a scan of up to ${ACCOUNT_SCAN_LIMIT} dated records with owner metadata. Older records and legacy records without owner metadata are outside this scan.`,
      metrics: [{ label: intent === 'missing_receipts' ? 'Without attached receipt' : 'Need review', value: String(matching.length) }], items,
      actions: [{ label: 'Open transaction review', href: '/protected?screen=review-transactions' }],
      notes: [intent === 'missing_receipts' ? 'An absent attachment does not establish whether a receipt is legally required or a purchase is deductible. Personal, pending and known non-expense records are excluded.' :
        'Your confirmations are unchanged. Open a record to answer its questions or confirm the suggestion.'],
    },
  };
}

export interface SavedTaxPosition {
  version: 1; userId: string; taxYear: number; checkedAt: string; totalTax: number; balanceDue: number; refund: number;
  income: number; deductions: number;
}
/** Reuse the supported federal endpoint; a partial or wrong-year response cannot become a zero estimate. */
export function extractTaxPosition(raw: any, uid: string, taxYear: number, now: Date): SavedTaxPosition | null {
  const values = [raw?.form1040?.totalTax, raw?.form1040?.balanceDue, raw?.form1040?.refund, raw?.income?.grossReceipts, raw?.income?.totalDeductible];
  if (raw?.taxYear !== taxYear || !values.every(value => typeof value === 'number' && Number.isFinite(value)) || values.slice(0, 3).some(value => value < 0)) return null;
  return { version: 1, userId: uid, taxYear, checkedAt: now.toISOString(), totalTax: values[0], balanceDue: values[1], refund: values[2], income: values[3], deductions: values[4] };
}

export function taxPositionResult(current: SavedTaxPosition, previous: SavedTaxPosition | null, changes: boolean, warnings: string[] = []) {
  const comparable = previous?.version === 1 && previous.userId === current.userId && previous.taxYear === current.taxYear &&
    previous.checkedAt < current.checkedAt && ['totalTax', 'balanceDue', 'refund', 'income', 'deductions'].every(key => Number.isFinite(previous[key as keyof SavedTaxPosition]));
  const notes: string[] = [];
  if (changes && comparable && previous) {
    notes.push(`Compared with your assistant check on ${previous.checkedAt.slice(0, 10)}: estimated federal tax ${money(current.totalTax - previous.totalTax)}, recorded business receipts ${money(current.income - previous.income)}, confirmed transaction deductions ${money(current.deductions - previous.deductions)}. These are changes in saved estimates, not proof that any one purchase caused the tax change.`);
  } else if (changes) notes.push('This is your first comparable assistant check for this year. A private baseline is saved for your next comparison.');
  notes.push('Federal estimate from your saved records, not an annual income forecast or a filed return. Unconfirmed deductions are excluded. Missing income or facts can change the result.');
  notes.push(...warnings.slice(0, 5).map(item => item.slice(0, 2000)));
  const delta = comparable && previous ? current.totalTax - previous.totalTax : null;
  const reply = changes && delta !== null && previous
    ? `Your federal tax estimate is ${delta === 0 ? 'unchanged' : `${money(Math.abs(delta))} ${delta > 0 ? 'higher' : 'lower'}`} since your assistant check on ${previous.checkedAt.slice(0, 10)}. It is now ${money(current.totalTax)} for ${current.taxYear}.`
    : `${changes ? 'This is your first comparable check. ' : ''}Your saved records produce an estimated federal tax of ${money(current.totalTax)} for ${current.taxYear}.`;
  return { reply, account: {
    title: changes ? 'What changed in your tax estimate' : 'Your tax position', asOf: current.checkedAt,
    scope: 'Computed from the same validated federal calculation used by Tax Preview, including its eligibility and reconciliation checks.',
    metrics: [{ label: 'Estimated federal tax', value: money(current.totalTax) }, { label: current.refund > 0 ? 'Estimated refund' : 'Balance after recorded payments', value: money(current.refund > 0 ? current.refund : current.balanceDue) },
      { label: 'Recorded business receipts', value: money(current.income) }, { label: 'Confirmed transaction deductions', value: money(current.deductions) }],
    items: [], actions: [{ label: 'See calculation and inputs', href: '/protected?screen=tax-preview' }], notes,
  } satisfies AccountResult };
}
