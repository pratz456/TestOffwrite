import { describe, expect, it } from 'vitest';
import { reconcileBusinessIncome, IncomeReconciliationRequiredError } from '../lib/tax-rules/business-income';

const income = { id: 'income-1', account_id: 'bank-1', amount: -100000, category: 'income', date: '2026-02-01', type: 'income' };
const receipt = { id: 'receipt-1', amount: 100000, type: 'platform_income' };
const linkedForm = { formType: '1099-K', amount: 100000, source: 'document_import', grossReceiptId: 'receipt-1' };
describe('conservative business-income reconciliation', () => {
  it('counts posted, selected-year explicitly classified receipts, not every normalized bank credit', () => {
    const result = reconcileBusinessIncome(2026, [income, income,
      { ...income, id: 'pending', pending: true }, { ...income, id: 'previous', date: '2025-12-31' },
      { ...income, id: 'transfer', category: 'TRANSFER_IN' }, { ...income, id: 'refund', category: 'GENERAL_MERCHANDISE_OTHER' },
    ], [], []);
    expect(result.grossReceipts).toBe(100000);
    expect(result.unclassifiedCreditCount).toBe(2);
    expect(result.warnings[0]).toContain('excluded');
  });
  it('supports a manual account’s explicitly recorded income category', () => {
    expect(reconcileBusinessIncome(2026, [{ ...income, account_id: 'manual', category: 'INCOME' }], [], []).grossReceipts).toBe(100000);
  });
  it('counts an explicitly linked imported receipt and information return only once', () => {
    expect(reconcileBusinessIncome(2026, [], [receipt], [linkedForm])).toMatchObject({ grossReceipts: 100000, linkedDocumentCount: 1, form1099Receipts: 100000 });
  });
  it('accepts a standalone business information return', () => {
    expect(reconcileBusinessIncome(2026, [], [], [{ formType: '1099-NEC', amount: 100000 }])).toMatchObject({ grossReceipts: 100000, source: 'income_1099', form1099Receipts: 100000 });
  });
  it('reports zero 1099-documented receipts when income comes only from transactions or receipts', () => {
    expect(reconcileBusinessIncome(2026, [income], [], []).form1099Receipts).toBe(0);
    expect(reconcileBusinessIncome(2026, [], [receipt], []).form1099Receipts).toBe(0);
  });
  it.each([
    [[income], [receipt], []],
    [[], [receipt], [{ formType: '1099-K', amount: 100000 }]],
    [[], [], [{ formType: '1099-K', amount: 100000 }, { formType: '1099-NEC', amount: 100000 }]],
    [[], [receipt], [{ ...linkedForm, amount: 90000 }]],
    [[], [receipt], [{ ...linkedForm, grossReceiptId: 'missing' }]],
    [[], [receipt], [{ ...linkedForm, source: 'manual' }]],
    [[], [], [{ formType: '1099-INT', amount: 500 }]],
    [[], [{ amount: 500, type: 'rental' }], []],
    [[], [{ amount: Infinity }], []],
    [[{ ...income, amount: 1000 }], [], []],
  ])('requires review for ambiguous, unsupported or malformed evidence %j', (transactions, receipts, forms) => {
    expect(() => reconcileBusinessIncome(2026, transactions, receipts, forms)).toThrow(IncomeReconciliationRequiredError);
  });
});
