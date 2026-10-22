import { describe, expect, it } from 'vitest';
import { dashboardTaxFactsFromReads, taxFactsEqual } from '../lib/tax/dashboard-tax-input';
import { organizerTaxInputResponse, organizerTaxInputValues } from '../lib/tax-rules/organizer-tax-inputs';
import { encryptSensitive } from '../lib/security/utils';

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
    expect(taxFactsEqual(start, facts({ dependents: [{ ...child, relationship: 'parent' }] }))).toBe(false);
    expect(taxFactsEqual(start, facts({ dependents: [{ ...child, monthsLived: 6 }] }))).toBe(false);
  });

  it('uses one key when the same dependent facts are stored with different key order', () => {
    const first = facts({ dependents: [{ relationship: 'daughter', dateOfBirth: '2018-03-15', monthsLived: 12, residence: { zip: '78701', city: 'Austin' }, dependentSSN: '900700111' }] });
    const second = facts({ dependents: [{ dependentSSN: '900700111', residence: { city: 'Austin', zip: '78701' }, monthsLived: 12, dateOfBirth: '2018-03-15', relationship: 'daughter' }] });
    expect(taxFactsEqual(first, second)).toBe(true);
    expect(String(first.dependents)).toContain('"relationship":"child"');
    expect(JSON.stringify(first)).not.toContain('900700111');
  });

  it('drops unknown dependent keys from the key and the tax-input read', () => {
    const dependents = [{
      name: 'Child', dateOfBirth: '2018-03-15', age: 8, relationship: 'daughter', monthsLived: 12,
      fullTimeStudent: 'yes', permanentlyAndTotallyDisabled: 'no',
      tin: '111223333', taxId: '222334444', socialSecurityNumber: '333445555', notes: '444556666',
    }];
    const saved = facts({ dependents });
    const key = JSON.stringify(saved);
    const listed = String(saved.dependents);
    const read = JSON.stringify(organizerTaxInputResponse({ dependents }));
    for (const digits of ['111223333', '222334444', '333445555', '444556666']) {
      expect(key, digits).not.toContain(digits);
      expect(read, digits).not.toContain(digits);
    }
    expect(listed).not.toContain('"tin"');
    expect(read).not.toContain('"notes"');
    expect(read).not.toContain('fullTimeStudent');
    expect(read).not.toContain('permanentlyAndTotallyDisabled');
    expect(read).toContain('"age":8');
    expect(listed).toContain('"relationship":"child"');
  });

  it('uses atin when an ATIN field is filled, and prefers ssn then atin then itin', () => {
    const atin = facts({ dependents: [{ dependentATIN: '222334444', relationship: 'daughter' }] });
    expect(String(atin.dependents)).toContain('"identifierKind":"atin"');
    expect(JSON.stringify(atin)).not.toContain('222334444');
    expect(JSON.stringify(organizerTaxInputResponse({ dependents: [{ atin: '222334444' }] }))).not.toContain('222334444');
    const ranked = facts({ dependents: [{ dependentATIN: '222334444', dependentITIN: '333445555' }] });
    expect(String(ranked.dependents)).toContain('"identifierKind":"atin"');
    const ssn = facts({ dependents: [{ dependentSSN: '111223333', dependentATIN: '222334444', itin: '333445555' }] });
    expect(String(ssn.dependents)).toContain('"identifierKind":"ssn"');
    expect(JSON.stringify(ssn)).not.toContain('111223333');
    expect(JSON.stringify(ssn)).not.toContain('333445555');
  });

  it('prefers a stored idKind over the field name and an explicit type', () => {
    const stored = facts({ dependents: [{ dependentSSN: '111223333', idKind: 'itin', relationship: 'son' }] });
    expect(String(stored.dependents)).toContain('"identifierKind":"itin"');
    expect(JSON.stringify(stored)).not.toContain('111223333');
    const overType = facts({ dependents: [{ idKind: 'atin', identifierType: 'ssn', dependentSSN: '111223333' }] });
    expect(String(overType.dependents)).toContain('"identifierKind":"atin"');
    const none = facts({ dependents: [{ dependentSSN: '111223333', idKind: 'none' }] });
    expect(String(none.dependents)).toContain('"identifierKind":"none"');
    expect(JSON.stringify(none)).not.toContain('111223333');
  });

  it('keeps the field kind when the value is already in the current format and leaves that value out', () => {
    const itinValue = encryptSensitive('900708888');
    const ssnValue = encryptSensitive('111223333');
    const itin = organizerTaxInputValues({ dependents: [{ dependentITIN: itinValue, dateOfBirth: '2018-03-15' }] });
    const ssn = organizerTaxInputValues({ dependents: [{ dependentSSN: ssnValue, relationship: 'daughter' }] });
    const stated = organizerTaxInputValues({ dependents: [{ dependentITIN: itinValue, identifierKind: 'atin' }] });
    const read = organizerTaxInputResponse({
      dependents: [
        { dependentITIN: itinValue, dateOfBirth: '2018-03-15' },
        { dependentSSN: ssnValue, identifierKind: 'atin' },
      ],
    });
    expect(String(itin.dependents)).toContain('"identifierKind":"itin"');
    expect(String(ssn.dependents)).toContain('"identifierKind":"ssn"');
    expect(String(stated.dependents)).toContain('"identifierKind":"atin"');
    const packed = JSON.stringify({ itin, ssn, stated, read });
    expect(packed).not.toContain(itinValue);
    expect(packed).not.toContain(ssnValue);
    expect(packed).not.toContain('900708888');
    expect(packed).not.toContain('111223333');
  });

  it('leaves other dependent text out of the key and the tax-input read, and keeps a short count', () => {
    const note = 'Emma, 123-45-6789, daughter';
    expect(organizerTaxInputValues({ dependents: note }).dependents).toBeNull();
    expect(organizerTaxInputResponse({ dependents: note }).dependents).toBeNull();
    const packed = JSON.stringify({
      key: organizerTaxInputValues({ dependents: note }),
      read: organizerTaxInputResponse({ dependents: note }),
    });
    expect(packed).not.toContain('Emma');
    expect(packed).not.toContain('123-45-6789');
    expect(packed).not.toContain('123456789');
    expect(organizerTaxInputValues({ dependents: '2' }).dependents).toBe('2');
    expect(organizerTaxInputResponse({ dependents: '2' }).dependents).toBe('2');
    expect(facts({ dependents: '2' }).dependents).toBe('2');
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
