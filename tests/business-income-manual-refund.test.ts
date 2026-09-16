import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/reports/export-records', () => ({ readOwnedTransactions: mock.read }));
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { reconcileBusinessIncome } from '@/lib/tax-rules/business-income';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';

const saved = { account_id: 'manual', source: 'manual', date: '2026-01-15', iso_currency_code: 'USD', pending: false };
beforeEach(() => vi.clearAllMocks());
describe('manual-account income and expense-refund reconciliation', () => {
  it('does not count the same current-year expense refund as receipts and a reduced expense', async () => {
    mock.read.mockResolvedValue([
      { ...saved, trans_id: 'client', category: 'INCOME', amount: -100000, type: 'income', is_deductible: false },
      { ...saved, trans_id: 'office', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', amount: 100, type: 'expense', is_deductible: true },
      { ...saved, trans_id: 'refund', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', amount: -20, type: 'expense', is_deductible: true },
    ]);
    const transactions = await readTaxExportTransactions('owner', 2026);
    // Exercise the actual reader that derives income from the negative sign.
    expect(transactions.find(tx => tx.id === 'refund')?.type).toBe('income');
    const income = reconcileBusinessIncome(2026, transactions, [], []);
    const expenses = aggregateScheduleC(transactions, '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(income.grossReceipts).toBe(100000); expect(expenses.totalDeductible).toBe(80);
    expect(income.grossReceipts - expenses.totalDeductible).toBe(99920);
    expect(income.unclassifiedCreditCount).toBe(1); expect(income.warnings[0]).toContain('refund');
  });
  it.each(['GENERAL_MERCHANDISE_OFFICE_SUPPLIES', 'transfer', 'consulting', ''])('does not infer receipts for manual category %s from normalized type alone', async category => {
    mock.read.mockResolvedValue([{ ...saved, trans_id: 'credit', amount: -20, category }]);
    const transactions = await readTaxExportTransactions('owner', 2026);
    expect(transactions[0].type).toBe('income');
    expect(reconcileBusinessIncome(2026, transactions, [], [])).toMatchObject({ grossReceipts: 0, source: 'none', unclassifiedCreditCount: 1 });
  });
  it.each(['INCOME', 'income', 'revenue', 'ReVeNuE'])('retains explicit manual business-income category %s', async category => {
    mock.read.mockResolvedValue([{ ...saved, trans_id: 'client', amount: -100000, category, is_deductible: false }]);
    const transactions = await readTaxExportTransactions('owner', 2026);
    expect(reconcileBusinessIncome(2026, transactions, [], [])).toMatchObject({ grossReceipts: 100000, unclassifiedCreditCount: 0 });
  });
  it('does not manufacture overlapping income sources from a refund plus recorded gross receipts', async () => {
    mock.read.mockResolvedValue([{ ...saved, trans_id: 'refund', amount: -20, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true }]);
    const transactions = await readTaxExportTransactions('owner', 2026);
    expect(reconcileBusinessIncome(2026, transactions, [{ id: 'gross', amount: 5000 }], [])).toMatchObject({ grossReceipts: 5000, source: 'gross_receipts', unclassifiedCreditCount: 1 });
  });
  it('continues excluding pending and other-year declared receipts', async () => {
    mock.read.mockResolvedValue([
      { ...saved, trans_id: 'pending', amount: -500, category: 'INCOME', pending: true },
      { ...saved, trans_id: 'prior', amount: -400, category: 'INCOME', date: '2025-12-31' },
    ]);
    expect(reconcileBusinessIncome(2026, await readTaxExportTransactions('owner', 2026), [], []).grossReceipts).toBe(0);
  });
});
