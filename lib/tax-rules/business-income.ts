export type IncomeRecord = Record<string, unknown>;

export class IncomeReconciliationRequiredError extends Error {
  readonly code = 'INCOME_RECONCILIATION_REQUIRED';
  constructor(detail: string) {
    super(`Review income sources before calculating tax: ${detail} No tax total has been calculated. Check Income Tracking and imported documents with your records to resolve overlapping or unsupported income.`);
  }
}

const money = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new IncomeReconciliationRequiredError('An income record has an invalid amount.');
  }
  return Math.round(value * 100);
};

/**
 * Receipts, bank entries and information returns are alternative evidence of
 * receipts, not automatically additive income. Existing records have no shared
 * payment ID. Never deduplicate by payer/amount or choose a source silently.
 * Only a server-created grossReceiptId can establish a documentary 1099 link.
 */
export function reconcileBusinessIncome(taxYear: number, transactions: ReadonlyArray<IncomeRecord>, receipts: ReadonlyArray<IncomeRecord>, forms: ReadonlyArray<IncomeRecord>) {
  const txById = new Set<string>();
  let transactionCents = 0;
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
    const id = tx.trans_id ?? tx.id;
    const key = id ? `${tx.account_id ?? ''}:${id}` : undefined;
    if (key && txById.has(key)) continue;
    if (key) txById.add(key);
    transactionCents += money(-tx.amount);
  }

  const receiptsById = new Map<string, number>();
  let receiptCents = 0;
  for (const receipt of receipts) {
    if (receipt.type === 'rental' || receipt.type === 'interest_dividends') {
      throw new IncomeReconciliationRequiredError('Rental or investment income cannot be treated automatically as Schedule C business receipts.');
    }
    const cents = money(receipt.amount);
    if (typeof receipt.id === 'string') receiptsById.set(receipt.id, cents);
    receiptCents += cents;
  }

  let formCents = 0;
  let linkedFormCents = 0;
  let unlinkedForms = 0;
  let linkedForms = 0;
  for (const form of forms) {
    if (form.formType !== '1099-NEC' && form.formType !== '1099-K') {
      throw new IncomeReconciliationRequiredError('Confirm the tax treatment of this 1099. Only business NEC/K income is included automatically; MISC, interest, dividends and securities require separate review.');
    }
    const cents = money(form.amount);
    if (form.grossReceiptId !== undefined) {
      const receiptAmount = typeof form.grossReceiptId === 'string' ? receiptsById.get(form.grossReceiptId) : undefined;
      if (form.source !== 'document_import' || receiptAmount === undefined || receiptAmount !== cents) {
        throw new IncomeReconciliationRequiredError('A linked 1099 does not match its original gross receipt. Confirm gross versus net amounts and the original document.');
      }
      linkedForms++;
      linkedFormCents += cents;
    } else {
      unlinkedForms++;
      formCents += cents;
    }
  }
  // A K and NEC (even from different named payers) can describe the same receipts.
  // The current form schema has no fields to certify that multiple forms are distinct.
  const sourceCount = Number(transactionCents > 0) + Number(receiptCents > 0) + Number(formCents > 0);
  if (sourceCount > 1 || unlinkedForms > 1) {
    throw new IncomeReconciliationRequiredError('Transactions, gross receipts or 1099 forms may describe the same payments. They have no verified matching link and cannot be added safely.');
  }
  const warnings = unclassifiedCreditCount
    ? [`${unclassifiedCreditCount} posted inflow(s) are excluded from business receipts until classified as income/revenue. A bank credit alone may be a transfer, loan or refund.`]
    : [];
  return {
    grossReceipts: (transactionCents + receiptCents + formCents) / 100,
    source: transactionCents > 0 ? 'transactions' : receiptCents > 0 ? 'gross_receipts' : formCents > 0 ? 'income_1099' : 'none',
    // Receipts documented by NEC/K forms: standalone forms count directly, linked
    // forms through their matching gross receipt. Never additive to grossReceipts.
    form1099Receipts: (formCents + linkedFormCents) / 100,
    linkedDocumentCount: linkedForms,
    unclassifiedCreditCount,
    warnings,
  };
}
