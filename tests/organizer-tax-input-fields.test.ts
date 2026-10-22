import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { ORGANIZER_TAX_INPUT_FIELDS } from '../lib/tax-rules/organizer-tax-inputs';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedBusinessLossFacts, reviewedOBBBADeductionFacts } from './fixtures/tier1-facts';

function organizerReads(organizer: Record<string, unknown>, profile: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const reads = new Set<string>();
  const proxy = new Proxy(organizer, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') reads.add(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  try {
    buildFederalTaxSnapshot({
      taxYear: 2026, profile, organizer: proxy, transactions: [], grossReceipts: [{ amount: 1000 }],
      forms1099: [], w2Entries: [], deductions: {}, assets: [], estimatedPayments: 0, ...extra,
    });
  } catch {
    // A review stop still counts the organizer fields read before it.
  }
  return reads;
}

describe('organizer fields the federal snapshot reads', () => {
  it('fails when the snapshot reads an organizer field that is not on the shared list', () => {
    const reads = new Set<string>();
    const add = (found: Set<string>) => { for (const field of found) reads.add(field); };
    add(organizerReads(reviewedPersonalDeductionOrganizer(2026, {}, {
      obbbaDeductionFacts: reviewedOBBBADeductionFacts(),
      amount1099INT: '10', amount1099DIV: '20', amountOtherIncome: '30',
      amountIRADistributions: '40', amountRentalIncome: '50',
      amountShortTermCapGains: '0', amountLongTermCapGains: '0', amountCapGains: '0', hasCapGains: 'no',
      healthInsurancePremium: '0', hsaAmount: '0', retirementAmount: '0', retirementType: '',
      filingStatus: 'single',
    }), { filing_status: 'single' }));
    add(organizerReads(
      reviewedPersonalDeductionOrganizer(2026, {}, { businessLossFacts: reviewedBusinessLossFacts() }),
      { filing_status: 'single' },
      { grossReceipts: [{ amount: 10 }], transactions: [{ amount: 100, date: '2026-02-01', iso_currency_code: 'USD', category: 'office_expense', is_deductible: true }] },
    ));
    add(organizerReads(reviewedPersonalDeductionOrganizer(2026, {}, {
      hasSocialSecurity: 'yes', filingStatus: 'single', socialSecurityResident: 'yes', socialSecurityLumpSum: 'no', socialSecuritySpecialIRA: 'no',
      socialSecurityForeignExclusion: 'no', socialSecurityIncomeComplete: 'yes', socialSecurityAdjustmentsComplete: 'yes',
      socialSecurityNetBenefits: '20000', socialSecurityTaxExemptInterest: '0', socialSecurityExcludedSavingsBondInterest: '0',
      socialSecurityAdoptionExclusion: '0', socialSecurityFederalWithheld: '0', socialSecurityRetirementReviewed: 'yes',
      socialSecurityLivedApartAllYear: 'yes', amountIRADistributions: '40', amountRentalIncome: '0',
      amountShortTermCapGains: '0', amountLongTermCapGains: '0', hasCapGains: 'no',
    }), { filing_status: 'single' }, { grossReceipts: [] }));
    add(organizerReads(reviewedPersonalDeductionOrganizer(2026), { filing_status: 'married_filing_jointly' }, { grossReceipts: [] }));
    const allowed = new Set<string>(ORGANIZER_TAX_INPUT_FIELDS);
    expect([...reads].filter(field => !allowed.has(field)).sort()).toEqual([]);
    for (const field of [
      'amountIRADistributions', 'amountRentalIncome', 'hsaAmount', 'healthInsurancePremium',
      'retirementAmount', 'retirementType', 'hasSocialSecurity', 'socialSecurityLivedApartAllYear', 'filingStatus', 'spouseDoB', 'businessLossFacts',
    ]) expect(reads.has(field), field).toBe(true);
  });

  it('includes organizer fields named in the wage-ownership and adjustment helpers', () => {
    const files = ['lib/tax-rules/calculation-scope.ts', 'lib/tax-rules/eligibility.ts'];
    const named = files.flatMap(file => organizerProperties(readFileSync(file, 'utf8')));
    expect(named).toContain('adjustmentEligibilityFacts');
    for (const field of named) expect(ORGANIZER_TAX_INPUT_FIELDS, field).toContain(field);
  });
});

/** Property names read from an organizer parameter, including branches the fixtures do not run. */
function organizerProperties(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/organizer\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(match[1]);
  for (const match of source.matchAll(/organizer\??\[(?:'([^']+)'|"([^"]+)")\]/g)) found.add(match[1] || match[2]);
  return [...found];
}
