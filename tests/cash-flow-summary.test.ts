import { describe, expect, it } from 'vitest';
import { summarizeRecordedCashFlow } from '@/lib/dashboard/cash-flow-summary';
const record = (facts: Record<string, unknown> = {}) => ({ date: '2026-12-31T23:59:00-08:00', amount: 10.01, iso_currency_code: 'USD', ...facts });
describe('posted USD cash flow display', () => {
  it('nets cents by bank amount sign, independent of a tax classification or legacy type', () => {
    const result = summarizeRecordedCashFlow([record({ type: 'income' }), record({ amount: -5.01, type: 'expense' }), record({ amount: 0.02 })], 2026);
    expect(result.reviewMessage).toBeNull();
    expect(result.months[11]).toEqual({ expenses: 10.03, income: 5.01, net: -5.02 });
  });
  it('excludes pending, removed and superseded copies and uses the recorded calendar year', () => {
    const result = summarizeRecordedCashFlow([record(), record({ pending: true }), record({ bank_removed: true }), record({ superseded_by: 'original' }), record({ date: '2027-01-01' })], 2026);
    expect(result.months[11].net).toBe(-10.01);
  });
  it.each([{ amount: Infinity }, { amount: '100' }, { date: '2026-02-30' }, { iso_currency_code: undefined }, { iso_currency_code: 'EUR' }])('blocks ambiguous cash-flow totals %j', facts => {
    const result = summarizeRecordedCashFlow([record(facts)], 2026);
    expect(result.reviewMessage).toBeTruthy(); expect(result.months).toEqual([]);
  });
  it('blocks duplicate logical records instead of summing both copies', () => {
    expect(summarizeRecordedCashFlow([record({ id: 'same' }), record({ id: 'same' })], 2026).reviewMessage).toContain('duplicate');
  });
});
