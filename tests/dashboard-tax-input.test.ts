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

  it('refreshes when a dependent goes from no identifier to an ITIN, and from an ITIN to an SSN', () => {
    const child = { name: 'Child', relationship: 'daughter', dateOfBirth: '2018-03-15', monthsLived: 12 };
    const none = facts({ dependents: [child] });
    const itin = facts({ dependents: [{ ...child, dependentITIN: '900700111' }] });
    const ssn = facts({ dependents: [{ ...child, dependentSSN: '900700111' }] });
    expect(taxFactsEqual(none, itin)).toBe(false);
    expect(taxFactsEqual(itin, ssn)).toBe(false);
    expect(String(itin.dependents)).toContain('"identifierKind":"itin"');
    expect(String(ssn.dependents)).toContain('"identifierKind":"ssn"');
    const stated = facts({ dependents: [{ ...child, identifierType: 'itin', dependentSSN: '900700111' }] });
    expect(String(stated.dependents)).toContain('"identifierKind":"itin"');
    expect(JSON.stringify(stated)).not.toContain('900700111');
  });

  it('does not refresh when only the SSN digits change, and the key omits those digits', () => {
    const child = { relationship: 'daughter', dateOfBirth: '2018-03-15', monthsLived: 12, name: 'Child' };
    const first = facts({ dependents: [{ ...child, dependentSSN: '900700111' }] });
    const second = facts({ dependents: [{ dependentSSN: '900700222', name: 'Child', monthsLived: 12, dateOfBirth: '2018-03-15', relationship: 'daughter' }] });
    expect(taxFactsEqual(first, second)).toBe(true);
    const key = JSON.stringify(first);
    expect(String(first.dependents)).toContain('"identifierKind":"ssn"');
    expect(key).not.toContain('900700111');
    expect(key).not.toContain('900700222');
    expect(JSON.stringify(second)).not.toContain('900700222');
  });

  it('refreshes when date of birth, relationship, or months lived changes', () => {
    const child = { name: 'Child', relationship: 'daughter', dateOfBirth: '2018-03-15', monthsLived: 12, dependentSSN: '900700111' };
    const start = facts({ dependents: [child] });
    expect(taxFactsEqual(start, facts({ dependents: [{ ...child, dateOfBirth: '2019-01-02' }] }))).toBe(false);
    expect(taxFactsEqual(start, facts({ dependents: [{ ...child, relationship: 'son' }] }))).toBe(false);
    expect(taxFactsEqual(start, facts({ dependents: [{ ...child, monthsLived: 6 }] }))).toBe(false);
  });

  it('uses one key when the same dependent facts are stored with different key order', () => {
    const first = facts({ dependents: [{ relationship: 'daughter', dateOfBirth: '2018-03-15', monthsLived: 12, residence: { zip: '78701', city: 'Austin' }, dependentSSN: '900700111' }] });
    const second = facts({ dependents: [{ dependentSSN: '900700111', residence: { city: 'Austin', zip: '78701' }, monthsLived: 12, dateOfBirth: '2018-03-15', relationship: 'daughter' }] });
    expect(taxFactsEqual(first, second)).toBe(true);
    expect(String(first.dependents)).toContain('"relationship":"daughter"');
    expect(JSON.stringify(first)).not.toContain('900700111');
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
