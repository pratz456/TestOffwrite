import { describe, expect, it } from 'vitest';
import { dashboardTaxFactsFromReads, taxFactsEqual } from '../lib/tax/dashboard-tax-input';

const quarters = [1, 2, 3, 4].map(quarter => ({ quarter, paidAmount: 0, notes: 'blank', updatedAt: 'stamp' }));

function facts(overrides: { amountOtherIncome?: unknown; dependents?: unknown; paidAmount?: number; notes?: string } = {}) {
  return dashboardTaxFactsFromReads(
    { amountOtherIncome: overrides.amountOtherIncome ?? null, dependents: overrides.dependents ?? null, notes: overrides.notes ?? 'a', hasW2: 'yes', updatedAt: 'stamp' },
    { payments: quarters.map(row => row.quarter === 1 && overrides.paidAmount ? { ...row, paidAmount: overrides.paidAmount, notes: 'paid' } : row) },
  );
}

describe('dashboard tax input key', () => {
  it('changes for other income, a quarterly payment, and dependents, and ignores an unrelated field', () => {
    const baseline = facts();
    expect(taxFactsEqual(baseline, facts({ notes: 'different note' }))).toBe(true);
    expect(taxFactsEqual(baseline, facts({ amountOtherIncome: '1500' }))).toBe(false);
    expect(taxFactsEqual(baseline, facts({ dependents: '1' }))).toBe(false);
    expect(taxFactsEqual(baseline, facts({ paidAmount: 400 }))).toBe(false);
    expect(baseline.payments.map(row => row.paidAmount)).toEqual([0, 0, 0, 0]);
    expect(facts({ paidAmount: 400 }).payments).toEqual([
      { quarter: 1, paidAmount: 400 },
      { quarter: 2, paidAmount: 0 },
      { quarter: 3, paidAmount: 0 },
      { quarter: 4, paidAmount: 0 },
    ]);
  });

  it('treats a missing organizer and four zero payments as the empty key', () => {
    const empty = dashboardTaxFactsFromReads({ data: {} }, { data: {} });
    expect(empty).toEqual(facts());
    expect(taxFactsEqual(empty, dashboardTaxFactsFromReads(
      { organizer: { amountOtherIncome: '', dependents: '  ', notes: 'still unrelated' } },
      { payments: quarters },
    ))).toBe(true);
  });
});
