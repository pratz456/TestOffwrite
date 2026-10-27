import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertToEnhancedContext, type UserContext } from '@/lib/ai/analyzeTransaction';
import { buildTaxpayerContext } from '@/lib/ai/taxpayer-context';
import {
  ITEMIZATION_ESTIMATE_WARNING,
  normalizeItemizationStatus,
} from '@/lib/profile/itemization-status';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import {
  NON_ITEMIZER_CHARITY_LIMIT,
  NON_ITEMIZER_CHARITY_LIMIT_JOINT,
} from '@/lib/tax-rules/obbba-deductions';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedOBBBADeductionFacts } from './fixtures/tier1-facts';

const profile: UserContext = {
  user_id: 'owner', profession: ['Photographer'], filing_state: 'TX', business_entity: 'sole_proprietor',
  office_location: 'Home Office', home_office_sqft: 150, vehicle_business_use_percentage: 60, w2_income: 20000, business_income: 80000,
};

function federal(profileFields: Record<string, unknown>, extra: {
  organizer?: Record<string, unknown>;
  deductions?: Record<string, unknown>;
  taxYear?: number;
  wages?: number;
} = {}) {
  const taxYear = extra.taxYear ?? 2026;
  const wages = extra.wages ?? 100_000;
  return buildFederalTaxSnapshot({
    taxYear,
    profile: { filing_status: 'single', ...profileFields },
    organizer: extra.organizer ?? reviewedPersonalDeductionOrganizer(taxYear),
    transactions: [],
    grossReceipts: [],
    forms1099: [],
    w2Entries: [{ wages, federalWithheld: 0, socialSecurityWages: wages, medicareWages: wages }],
    deductions: extra.deductions ?? {},
    assets: [],
    estimatedPayments: 0,
  });
}

const itemizeWarnings = (warnings: string[]) => warnings.filter(warning => warning === ITEMIZATION_ESTIMATE_WARNING);

function charityOrganizer(taxYear: number, amount: string) {
  return reviewedPersonalDeductionOrganizer(taxYear, {}, {
    obbbaDeductionFacts: reviewedOBBBADeductionFacts(taxYear, {
      hasNonItemizerCharity: 'yes',
      nonItemizerCashCharity: amount,
    }),
  });
}

describe('deduction choice normalizer', () => {
  it('maps the legacy spelling and the current spelling and leaves everything else unset', () => {
    expect(normalizeItemizationStatus('itemized')).toBe('itemize');
    expect(normalizeItemizationStatus('itemize')).toBe('itemize');
    expect(normalizeItemizationStatus('standard')).toBe('standard');
    expect(normalizeItemizationStatus('')).toBeUndefined();
    expect(normalizeItemizationStatus(undefined)).toBeUndefined();
    expect(normalizeItemizationStatus(null)).toBeUndefined();
    expect(normalizeItemizationStatus('Itemized')).toBeUndefined();
    expect(normalizeItemizationStatus('itemise')).toBeUndefined();
    expect(normalizeItemizationStatus(42)).toBeUndefined();
  });

  it('never returns the legacy spelling', () => {
    for (const value of ['itemized', 'itemize', 'standard', '', 'Itemized', 'itemise', 'ITEMIZED', ' itemized', null, undefined, 0, false, {}, []]) {
      expect(normalizeItemizationStatus(value)).not.toBe('itemized');
    }
  });
});

describe('deduction choice on analysis reads', () => {
  it('normalizes the legacy spelling in the transaction context', () => {
    const context = convertToEnhancedContext({ itemization_status: 'itemized', profession: 'Consultant', state: 'CA', itemized: true }, '2026-06-01');
    expect(context.itemization_status).toBe('itemize');
    expect(context.itemized).toBe(true);
  });

  it('normalizes the legacy spelling in the taxpayer context', () => {
    const context = buildTaxpayerContext({
      profile: { ...profile, itemization_status: 'itemized' } as UserContext,
      confirmed: [],
      merchant: 'Adobe',
    });
    expect(context.identity.itemizationStatus).toBe('itemize');
  });
});

describe('itemization estimate warning', () => {
  it('adds the placeholder warning once when the saved choice is itemize', () => {
    const built = federal({ itemization_status: 'itemize' });
    expect(itemizeWarnings(built.result.calculationWarnings)).toHaveLength(1);
    expect(built.result.scheduleAIncomplete).toBe(true);
  });

  it('stays quiet for standard and blank choices and still warns for a stored legacy spelling', () => {
    for (const itemization_status of ['standard', '']) {
      const built = federal({ itemization_status });
      expect(itemizeWarnings(built.result.calculationWarnings)).toHaveLength(0);
      expect(built.result.scheduleAIncomplete).toBe(false);
    }
    const missing = federal({});
    expect(itemizeWarnings(missing.result.calculationWarnings)).toHaveLength(0);
    expect(missing.result.scheduleAIncomplete).toBe(false);
    const legacy = federal({ itemization_status: 'itemized' });
    expect(itemizeWarnings(legacy.result.calculationWarnings)).toEqual([ITEMIZATION_ESTIMATE_WARNING]);
    expect(legacy.result.scheduleAIncomplete).toBe(true);
  });

  it('keeps deduction math identical for itemize, standard, and a blank choice', () => {
    const pinned = { deductionUsed: 16100, usingStandardDeduction: true, taxableIncome: 83900, totalTax: 13170, agi: 100000 };
    const choices = [
      federal({ itemization_status: 'itemize' }).result,
      federal({ itemization_status: 'standard' }).result,
      federal({ itemization_status: '' }).result,
      federal({}).result,
    ];
    for (const result of choices) expect(result).toMatchObject(pinned);
  });

  it('warns when a separate return cannot use the standard deduction and still uses the itemized amount', () => {
    const built = federal({ filing_status: 'married_filing_separately' }, {
      organizer: reviewedPersonalDeductionOrganizer(2026, { mfsSpouseItemizes: 'yes' }),
      deductions: { charitableCashDonations: 10000 },
    });
    expect(built.result.deductionUsed).toBe(9500);
    expect(built.result.usingStandardDeduction).toBe(false);
    expect(built.result.calculationWarnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Your spouse itemizes on a separate return, so your standard deduction is zero.'),
      ITEMIZATION_ESTIMATE_WARNING,
    ]));
    expect(built.result.scheduleAIncomplete).toBe(true);
  });
});

describe('section 170(p) alongside the saved deduction choice', () => {
  it('caps reviewed non-itemizer charity and subtracts it below AGI', () => {
    // CONFIRMED (Tax Watch, P.L. 119-21 §70424).
    expect([NON_ITEMIZER_CHARITY_LIMIT, NON_ITEMIZER_CHARITY_LIMIT_JOINT]).toEqual([1000, 2000]);
    const single = federal({}, { organizer: charityOrganizer(2026, '1500') }).result;
    expect(single.obbbaDeductions?.nonItemizerCharitable.deduction).toBe(NON_ITEMIZER_CHARITY_LIMIT);
    expect(single.scheduleOneADeductions).toBe(0);
    const singleBelow = single.deductionUsed + single.scheduleOneADeductions + single.nonItemizerCharitableDeduction;
    expect(single.taxableIncome).toBe(Math.max(0, single.agi - singleBelow - single.qbiDeduction));

    const joint = federal({ filing_status: 'married_filing_jointly' }, { organizer: charityOrganizer(2026, '2500') }).result;
    expect(joint.obbbaDeductions?.nonItemizerCharitable.deduction).toBe(NON_ITEMIZER_CHARITY_LIMIT_JOINT);
    expect(joint.scheduleOneADeductions).toBe(0);
    const jointBelow = joint.deductionUsed + joint.scheduleOneADeductions + joint.nonItemizerCharitableDeduction;
    expect(joint.taxableIncome).toBe(Math.max(0, joint.agi - jointBelow - joint.qbiDeduction));

    const priorYear = federal({}, { taxYear: 2025, organizer: charityOrganizer(2025, '1500') }).result;
    expect(priorYear.obbbaDeductions?.nonItemizerCharitable.deduction).toBe(0);
  });

  it('withholds the non-itemizer deduction when the engine itemizes', () => {
    const built = federal({}, {
      organizer: charityOrganizer(2026, '800'),
      deductions: { charitableCashDonations: 30000 },
    });
    expect(built.result.usingStandardDeduction).toBe(false);
    expect(built.result.obbbaDeductions?.nonItemizerCharitable.deduction).toBe(0);
    expect(built.result.obbbaDeductions?.nonItemizerCharitable.reason).toContain('You itemize, so charitable gifts belong on Schedule A');
    expect(built.result.obbbaDeductions?.nonItemizerCharitable.reason).toContain('section 170(p)');
  });

  it('still applies the non-itemizer deduction when settings say itemize but the engine uses the standard deduction', () => {
    const built = federal({ itemization_status: 'itemize' }, {
      organizer: charityOrganizer(2026, '800'),
      deductions: { charitableCashDonations: 100 },
    });
    expect(built.result.usingStandardDeduction).toBe(true);
    expect(built.result.obbbaDeductions?.nonItemizerCharitable.deduction).toBe(800);
    expect(itemizeWarnings(built.result.calculationWarnings)).toEqual([ITEMIZATION_ESTIMATE_WARNING]);
  });

  it('applies no non-itemizer deduction when charity is only on the deductions card and organizer intake is blank', () => {
    const built = federal({ itemization_status: 'standard' }, {
      deductions: { charitableCashDonations: 5000 },
    });
    expect(built.result.usingStandardDeduction).toBe(true);
    expect(built.result.nonItemizerCharitableDeduction).toBe(0);
    expect(built.result.obbbaDeductions?.nonItemizerCharitable.deduction).toBe(0);
    expect(itemizeWarnings(built.result.calculationWarnings)).toHaveLength(0);
  });
});

describe('legacy spelling stays out of product comparisons', () => {
  it('allows the legacy spelling only in the normalizer and the migration', () => {
    const files = execFileSync('git', ['ls-files', '--', 'app', 'components', 'lib', 'functions', 'functions-analysis/src', 'mobile', 'scripts'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const pattern = /itemization_status\s*(:|===?|!==?)\s*['"]itemized['"]|value:\s*['"]itemized['"]/g;
    const allowed = new Set([
      'functions-analysis/src/itemization-status.ts',
      'scripts/production-itemization-status-migration.mjs',
    ]);
    const hits = files.filter(file => {
      if (allowed.has(file)) return false;
      pattern.lastIndex = 0;
      return pattern.test(readFileSync(file, 'utf8'));
    });
    expect(hits).toEqual([]);
  });
});

describe('itemizing blog placeholder', () => {
  it('replaces the automatic comparison claim with the placeholder limitation', () => {
    const source = readFileSync('content/blog/standard-deduction-vs-itemizing-freelancers.mdx', 'utf8');
    expect(source).not.toContain('does this comparison automatically and picks the better option');
    expect(source).toContain('WriteOff\'s estimate does not yet include mortgage interest, state and local taxes or medical costs, so it is not a full standard vs. itemized comparison.');
  });
});
