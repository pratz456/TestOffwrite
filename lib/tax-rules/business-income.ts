import { resolveIncomeSources, type FeeExpenseCandidate, type IncomeReconciliationConflict, type IncomeSourceCandidate } from './income-reconciliation';

export type IncomeRecord = Record<string, unknown>;

export class IncomeReconciliationRequiredError extends Error {
  readonly code = 'INCOME_RECONCILIATION_REQUIRED';
  /** Conflicting records by reference, for the reconciliation workflow. Empty for malformed/unsupported records. */
  readonly conflicts: IncomeReconciliationConflict[];
  constructor(detail: string, conflicts: IncomeReconciliationConflict[] = []) {
    super(`Review income sources before calculating tax: ${detail} No tax total has been calculated. Use Income → Reconcile to record how overlapping records relate, or review imported documents against your records. WriteOff never merges or deletes records automatically.`);
    this.conflicts = conflicts;
  }
}

const money = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new IncomeReconciliationRequiredError('An income record has an invalid amount.');
  }
  return Math.round(value * 100);
};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const recordId = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** The reconcilable records of a tax year, labelled only with what the owner already sees. */
export function listIncomeSourceCandidates(taxYear: number, transactions: ReadonlyArray<IncomeRecord>, receipts: ReadonlyArray<IncomeRecord>, forms: ReadonlyArray<IncomeRecord>) {
  const candidates: IncomeSourceCandidate[] = [];
  const txById = new Set<string>();
  let unclassifiedCreditCount = 0;
  for (const tx of transactions) {
    if (tx.pending === true || typeof tx.date !== 'string' || Number(tx.date.slice(0, 4)) !== taxYear) continue;
    const category = typeof tx.category === 'string' ? tx.category.toLowerCase() : '';
    // Both transaction readers derive `type` from the amount sign, including
    // manual-account refunds. Require a recorded income category for every
    // account; otherwise an expense refund becomes receipts and nets expenses.
    const explicitIncome = category === 'income' || category === 'revenue';
    if (!explicitIncome) {
      if (typeof tx.amount === 'number' && tx.amount < 0) unclassifiedCreditCount++;
      continue;
    }
    if (typeof tx.amount !== 'number' || !Number.isFinite(tx.amount) || tx.amount >= 0) {
      throw new IncomeReconciliationRequiredError('A transaction classified as business income must be a posted receipt; reversals require review.');
    }
    const id = recordId(tx.trans_id ?? tx.id);
    const key = id ? `${recordId(tx.account_id)}:${id}` : undefined;
    if (key && txById.has(key)) continue;
    if (key) txById.add(key);
    const name = text(tx.merchant_name) || text(tx.name) || 'Bank deposit';
    candidates.push({ kind: 'transaction', id, amount: money(-tx.amount) / 100, label: `Bank income · ${name}`, date: tx.date.slice(0, 10) });
  }

  const receiptsById = new Map<string, number>();
  for (const receipt of receipts) {
    if (receipt.type === 'rental' || receipt.type === 'interest_dividends') {
      throw new IncomeReconciliationRequiredError('Rental or investment income cannot be treated automatically as Schedule C business receipts.');
    }
    const cents = money(receipt.amount);
    const id = recordId(receipt.id);
    if (id) receiptsById.set(id, cents);
    candidates.push({ kind: 'gross_receipt', id, amount: cents / 100, label: `Direct income · ${text(receipt.source) || 'Unnamed payer'}`, ...(typeof receipt.date === 'string' ? { date: receipt.date.slice(0, 10) } : {}) });
  }

  // Every NEC/K amount documents receipts whether it stands alone, is linked to its imported
  // gross receipt, or is reconciled to a bank deposit by an owner decision; never additive.
  let form1099Cents = 0;
  let linkedForms = 0;
  for (const form of forms) {
    if (form.formType !== '1099-NEC' && form.formType !== '1099-K') {
      throw new IncomeReconciliationRequiredError('Confirm the tax treatment of this 1099. Only business NEC/K income is included automatically; MISC, interest, dividends and securities require separate review.');
    }
    const cents = money(form.amount);
    form1099Cents += cents;
    const candidate: IncomeSourceCandidate = { kind: 'form_1099', id: recordId(form.id), amount: cents / 100, formType: form.formType, label: `${form.formType} · ${text(form.payerName) || text(form.payer) || 'Unknown payer'}` };
    if (form.grossReceiptId !== undefined) {
      const receiptAmount = typeof form.grossReceiptId === 'string' ? receiptsById.get(form.grossReceiptId) : undefined;
      if (form.source !== 'document_import' || receiptAmount === undefined || receiptAmount !== cents) {
        throw new IncomeReconciliationRequiredError('A linked 1099 does not match its original gross receipt. Confirm gross versus net amounts and the original document.');
      }
      linkedForms++;
      candidate.linkedImport = true;
    }
    candidates.push(candidate);
  }
  return { candidates, unclassifiedCreditCount, linkedForms, form1099Cents };
}

export interface BusinessIncomeReconciliation {
  grossReceipts: number;
  source: 'transactions' | 'gross_receipts' | 'income_1099' | 'reconciled' | 'none';
  /** Receipts documented on NEC/K forms (standalone, linked or reconciled); a subset view, never added to grossReceipts. */
  form1099Receipts: number;
  linkedDocumentCount: number;
  unclassifiedCreditCount: number;
  reconciledDecisionCount: number;
  /** Platform fees recorded with a 1099-K decision: review candidates, not recorded expenses. */
  feeExpenseCandidates: FeeExpenseCandidate[];
  warnings: string[];
}

/**
 * Receipts, bank entries and information returns are alternative evidence of
 * receipts, not automatically additive income. Existing records have no shared
 * payment ID. Never deduplicate by payer/amount or choose a source silently.
 * Only a server-created grossReceiptId or an owner-recorded reconciliation
 * decision can establish that two records describe the same payments.
 */
export function reconcileBusinessIncome(taxYear: number, transactions: ReadonlyArray<IncomeRecord>, receipts: ReadonlyArray<IncomeRecord>, forms: ReadonlyArray<IncomeRecord>, decisions: ReadonlyArray<IncomeRecord> = []): BusinessIncomeReconciliation {
  const { candidates, unclassifiedCreditCount, linkedForms, form1099Cents } = listIncomeSourceCandidates(taxYear, transactions, receipts, forms);
  const resolution = resolveIncomeSources(taxYear, candidates, decisions);
  if (resolution.conflicts.length) {
    throw new IncomeReconciliationRequiredError(resolution.conflicts[0].message, resolution.conflicts);
  }
  const { unclaimedCents } = resolution;
  const warnings = unclassifiedCreditCount
    ? [`${unclassifiedCreditCount} posted inflow(s) are excluded from business receipts until classified as income/revenue. A bank credit alone may be a transfer, loan or refund.`]
    : [];
  for (const fee of resolution.feeExpenseCandidates) {
    warnings.push(`Platform fees of $${fee.amount.toFixed(2)} recorded with ${fee.label} are an expense candidate for your review. Gross receipts use the 1099-K gross amount; the fee is not recorded as a deductible expense until you add and confirm it.`);
  }
  const unclaimedTotal = unclaimedCents.transaction + unclaimedCents.gross_receipt + unclaimedCents.form_1099;
  return {
    grossReceipts: (resolution.reconciledCents + unclaimedTotal) / 100,
    source: resolution.appliedDecisionIds.length ? 'reconciled'
      : unclaimedCents.transaction > 0 ? 'transactions' : unclaimedCents.gross_receipt > 0 ? 'gross_receipts' : unclaimedCents.form_1099 > 0 ? 'income_1099' : 'none',
    form1099Receipts: form1099Cents / 100,
    linkedDocumentCount: linkedForms,
    unclassifiedCreditCount,
    reconciledDecisionCount: resolution.appliedDecisionIds.length,
    feeExpenseCandidates: resolution.feeExpenseCandidates,
    warnings,
  };
}
