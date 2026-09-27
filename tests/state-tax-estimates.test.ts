import { describe, expect, it } from 'vitest';
import { businessTaxNotices, estimateStateTax, readProfileLocation, type StateTaxEstimateInput, type SupportedStateTaxEstimate } from '../lib/tax-rules/state';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { QBIReviewRequiredError } from '../lib/tax-rules/qbi';

const base: StateTaxEstimateInput = { stateCode: 'IL', taxYear: 2025, filingStatus: 'single', federalAGI: 100000, scheduleCNetProfit: 100000, w2Wages: 0 };
function supported(overrides: Partial<StateTaxEstimateInput>): SupportedStateTaxEstimate {
  const result = estimateStateTax({ ...base, ...overrides });
  if (!result.supported) throw new Error(`Expected a supported estimate: ${result.reason}`);
  return result;
}
const line = (lines: { label: string; amount: number }[], pattern: RegExp) => lines.find(candidate => pattern.test(candidate.label))?.amount;

describe('no-income-tax states', () => {
  it.each(['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WY'])('%s returns a $0 supported estimate for both years', state => {
    for (const taxYear of [2025, 2026]) {
      const result = supported({ stateCode: state, taxYear, federalAGI: 250000, scheduleCNetProfit: 250000 });
      expect(result).toMatchObject({ supported: true, noIncomeTax: true, estimate: 0, label: 'informational state planning estimate', taxYear });
      expect(result.components.taxableIncome).toBe(0);
      expect(result.sources.length).toBeGreaterThan(0);
    }
  });

  it('Washington is $0 with the B&O gross-receipts and 2028 income tax notes', () => {
    const result = supported({ stateCode: 'WA', taxYear: 2026 });
    expect(result.estimate).toBe(0); expect(result.noIncomeTax).toBe(true);
    expect(result.notes.join(' ')).toMatch(/B&O/);
    expect(result.notes.join(' ')).toMatch(/2028/);
    expect(result.warnings.join(' ')).toMatch(/B&O/);
  });
});

describe('flat-rate states', () => {
  it('Illinois: 4.95% of federal AGI less the year-specific exemption allowance, disallowed above the AGI limit', () => {
    expect(supported({ stateCode: 'IL', taxYear: 2025 }).estimate).toBe(4808.93); // (100,000 - 2,850) x 4.95% = 4,808.925, rounded to cents
    expect(supported({ stateCode: 'IL', taxYear: 2026 }).estimate).toBeCloseTo((100000 - 2925) * 0.0495, 2);
    expect(supported({ stateCode: 'IL', taxYear: 2025, federalAGI: 300000, scheduleCNetProfit: 300000 }).estimate).toBeCloseTo(300000 * 0.0495, 2);
    expect(supported({ stateCode: 'IL', taxYear: 2025, filingStatus: 'married_filing_jointly', federalAGI: 300000, scheduleCNetProfit: 300000 }).estimate).toBeCloseTo((300000 - 2 * 2850) * 0.0495, 2);
    const withChild = supported({ stateCode: 'IL', taxYear: 2025, dependents: 1 });
    expect(withChild.estimate).toBeCloseTo((100000 - 2 * 2850) * 0.0495, 2);
    expect(withChild.components.marginalRate).toBe(4.95);
  });

  it('Illinois subtracts federally taxed Social Security before the rate', () => {
    const result = supported({ stateCode: 'IL', taxYear: 2025, federalAGI: 50000, scheduleCNetProfit: 0, w2Wages: 40000, otherIncome: 10000, taxableSocialSecurityBenefits: 10000 });
    expect(line(result.components.modifications, /Social Security/)).toBe(-10000);
    expect(result.components.stateAGI).toBe(40000);
    expect(result.estimate).toBeCloseTo((40000 - 2850) * 0.0495, 2);
  });

  it('Pennsylvania: 3.07% of positive income classes, while a business loss requires review', () => {
    const result = supported({ stateCode: 'PA', taxYear: 2026, federalAGI: 85000, scheduleCNetProfit: 30000, w2Wages: 50000, otherIncome: 5000 });
    expect(result.components.stateAGI).toBe(85000); expect(result.components.deductions).toEqual([]);
    expect(result.estimate).toBeCloseTo(85000 * 0.0307, 2);
    const loss = estimateStateTax({ ...base, stateCode: 'PA', taxYear: 2025, federalAGI: 40000, scheduleCNetProfit: -10000, w2Wages: 50000 });
    expect(loss).toMatchObject({ supported: false, reason: expect.stringContaining('business losses') });
    const hsa = supported({ stateCode: 'PA', taxYear: 2025, federalAGI: 47000, scheduleCNetProfit: 50000, w2Wages: 0, hsaContribution: 3000 });
    expect(line(hsa.components.deductions, /Health savings/)).toBe(3000);
    expect(hsa.estimate).toBeCloseTo(47000 * 0.0307, 2);
  });

  it('Georgia: 5.19% with $12,000/$24,000 standard deduction in 2025; 4.99% with $15,000/$30,000 in 2026', () => {
    expect(supported({ stateCode: 'GA', taxYear: 2025 }).estimate).toBeCloseTo((100000 - 12000) * 0.0519, 2);
    expect(supported({ stateCode: 'GA', taxYear: 2025, dependents: 2 }).estimate).toBeCloseTo((100000 - 12000 - 8000) * 0.0519, 2);
    expect(supported({ stateCode: 'GA', taxYear: 2025, filingStatus: 'married_filing_jointly' }).estimate).toBeCloseTo((100000 - 24000) * 0.0519, 2);
    expect(supported({ stateCode: 'GA', taxYear: 2026 }).estimate).toBeCloseTo((100000 - 15000) * 0.0499, 2);
    expect(supported({ stateCode: 'GA', taxYear: 2026, filingStatus: 'married_filing_jointly' }).estimate).toBeCloseTo((100000 - 30000) * 0.0499, 2);
    const dependents2026 = supported({ stateCode: 'GA', taxYear: 2026, dependents: 2 });
    expect(dependents2026.estimate).toBeCloseTo((100000 - 15000 - 10000) * 0.0499, 2);
    expect(supported({ stateCode: 'GA', taxYear: 2026, dependents: 1 }).estimate - dependents2026.estimate).toBeCloseTo(249.50, 2);
    expect(dependents2026.warnings.join(' ')).not.toMatch(/dependent exemption has not been published/);
  });

  it('North Carolina: 4.25% in 2025 and 3.99% in 2026 after the standard deduction and AGI-stepped child deduction', () => {
    expect(supported({ stateCode: 'NC', taxYear: 2025 }).estimate).toBeCloseTo((100000 - 12750) * 0.0425, 1);
    expect(supported({ stateCode: 'NC', taxYear: 2026 }).estimate).toBeCloseTo((100000 - 12750) * 0.0399, 1);
    expect(supported({ stateCode: 'NC', taxYear: 2026, filingStatus: 'head_of_household' }).estimate).toBeCloseTo((100000 - 19125) * 0.0399, 1);
    const family = supported({ stateCode: 'NC', taxYear: 2025, filingStatus: 'married_filing_jointly', federalAGI: 50000, scheduleCNetProfit: 50000, dependents: 2 });
    expect(line(family.components.deductions, /Child deduction/)).toBe(5000);
    expect(family.estimate).toBeCloseTo((50000 - 25500 - 5000) * 0.0425, 2);
    const highIncome = supported({ stateCode: 'NC', taxYear: 2025, filingStatus: 'married_filing_jointly', federalAGI: 150000, scheduleCNetProfit: 150000, dependents: 2 });
    expect(line(highIncome.components.deductions, /Child deduction/)).toBe(0);
  });
});

describe('California 2025', () => {
  it('applies the standard deduction, Schedule X, and the personal exemption credit', () => {
    const result = supported({ stateCode: 'CA', taxYear: 2025 });
    expect(result.components.taxableIncome).toBe(100000 - 5706);
    expect(result.components.taxBeforeCredits).toBeCloseTo(3201.97 + 0.093 * (94294 - 72724), 2);
    expect(line(result.components.credits, /Personal exemption credit/)).toBe(153);
    expect(result.estimate).toBeCloseTo(5207.98 - 153, 2);
    expect(result.components.marginalRate).toBe(9.3);
    expect(result.components.additionalTaxes).toEqual([]);
  });

  it('uses Schedule Y for joint filers with two personal exemption credits and the dependent credit', () => {
    const result = supported({ stateCode: 'CA', taxYear: 2025, filingStatus: 'married_filing_jointly', federalAGI: 200000, scheduleCNetProfit: 200000, dependents: 1 });
    expect(result.components.taxableIncome).toBe(200000 - 11412);
    expect(result.components.taxBeforeCredits).toBeCloseTo(6403.94 + 0.093 * (188588 - 145448), 2);
    expect(line(result.components.credits, /Personal exemption credit/)).toBe(306);
    expect(line(result.components.credits, /Dependent exemption credit/)).toBe(475);
    expect(result.estimate).toBeCloseTo(10415.96 - 306 - 475, 2);
  });

  it('adds back the HSA deduction, phases out exemption credits and adds the Behavioral Health Services Tax over $1,000,000', () => {
    const hsa = supported({ stateCode: 'CA', taxYear: 2025, hsaContribution: 4000 });
    expect(line(hsa.components.modifications, /HSA/)).toBe(4000);
    expect(hsa.components.stateAGI).toBe(104000);
    const millionaire = supported({ stateCode: 'CA', taxYear: 2025, federalAGI: 1200000, scheduleCNetProfit: 1200000 });
    expect(millionaire.components.taxableIncome).toBe(1194294);
    expect(line(millionaire.components.credits, /Personal exemption credit/)).toBe(0);
    expect(millionaire.warnings.join(' ')).toMatch(/exemption credits are reduced/);
    expect(line(millionaire.components.additionalTaxes, /Behavioral Health Services Tax/)).toBeCloseTo(1942.94, 2);
    expect(millionaire.estimate).toBeCloseTo(72219.84 + 0.123 * (1194294 - 742953) + 1942.94, 2);
    expect(millionaire.components.marginalRate).toBeCloseTo(13.3, 5);
  });

  it('is unsupported for 2026 until the FTB publishes the schedules', () => {
    const result = estimateStateTax({ ...base, stateCode: 'CA', taxYear: 2026 });
    expect(result.supported).toBe(false);
    if (!result.supported) { expect(result.reason).toMatch(/2026/); expect(result.stateName).toBe('California'); expect(result.label).toBe('informational state planning estimate'); }
  });
});

describe('New York', () => {
  it('uses the printed rate schedule below the recapture threshold', () => {
    const result = supported({ stateCode: 'NY', taxYear: 2025, federalAGI: 60000, scheduleCNetProfit: 60000 });
    expect(result.components.taxableIncome).toBe(52000);
    expect(result.estimate).toBeCloseTo(600 + 0.055 * (52000 - 13900), 2);
    expect(result.components.marginalRate).toBe(5.5);
    expect(result.components.detail.some(item => /recapture/.test(item.label))).toBe(false);
    const dependents = supported({ stateCode: 'NY', taxYear: 2025, federalAGI: 60000, scheduleCNetProfit: 60000, dependents: 2 });
    expect(dependents.components.taxableIncome).toBe(50000);
  });

  it('phases the flat-rate worksheet in over $50,000 of NYAGI above $107,650 and applies it fully at $157,650', () => {
    const partial = supported({ stateCode: 'NY', taxYear: 2025, federalAGI: 130000, scheduleCNetProfit: 130000 });
    const schedule = 4271 + 0.06 * (122000 - 80650);
    expect(partial.estimate).toBeCloseTo(schedule + (122000 * 0.06 - schedule) * 0.447, 2);
    const full2025 = supported({ stateCode: 'NY', taxYear: 2025, federalAGI: 200000, scheduleCNetProfit: 200000 });
    expect(full2025.estimate).toBeCloseTo(192000 * 0.06, 2);
    expect(line(full2025.components.detail, /recapture/)).toBeCloseTo(192000 * 0.06 - (4271 + 0.06 * (192000 - 80650)), 2);
    const full2026 = supported({ stateCode: 'NY', taxYear: 2026, federalAGI: 200000, scheduleCNetProfit: 200000 });
    expect(full2026.estimate).toBeCloseTo(192000 * 0.059, 2);
  });

  it('adds the printed recapture base and incremental benefit for higher brackets', () => {
    const joint = supported({ stateCode: 'NY', taxYear: 2025, filingStatus: 'married_filing_jointly', federalAGI: 400000, scheduleCNetProfit: 400000 });
    const schedule = 18252 + 0.0685 * (383950 - 323200); // 22,413.375 from the schedule
    expect(joint.estimate).toBe(26300.38); // schedule + $1,140 base + $2,747 incremental benefit, rounded to cents
    expect(joint.estimate).toBeCloseTo(schedule + 1140 + 2747, 1);
    const joint2026 = supported({ stateCode: 'NY', taxYear: 2026, filingStatus: 'married_filing_jointly', federalAGI: 400000, scheduleCNetProfit: 400000 });
    expect(joint2026.estimate).toBe(26300.38); // 2026: $17,928 base + 6.85% over $323,200 = $22,089.375, plus $1,140 + $3,071, rounded to cents
    expect(joint2026.estimate).toBeCloseTo(17928 + 0.0685 * (383950 - 323200) + 1140 + 3071, 1);
  });

  it('lists the NYC, Yonkers, MCTMT and UBT taxes as unmodeled', () => {
    expect(supported({ stateCode: 'NY', taxYear: 2026 }).warnings.join(' ')).toMatch(/New York City resident income tax.*MCTMT.*unincorporated business tax/);
  });
});

describe('Ohio 2025 business income deduction', () => {
  const ohio = (overrides: Partial<StateTaxEstimateInput>) => supported({ stateCode: 'OH', taxYear: 2025, ...overrides });

  it('deducts the first $250,000 of Schedule C profit so $250,000 of business income owes nothing', () => {
    const atLimit = ohio({ federalAGI: 250000, scheduleCNetProfit: 250000 });
    expect(line(atLimit.components.modifications, /Business income deduction/)).toBe(-250000);
    expect(atLimit.components.stateAGI).toBe(0); expect(atLimit.estimate).toBe(0);
    const justOver = ohio({ federalAGI: 250001, scheduleCNetProfit: 250001 });
    expect(line(justOver.components.modifications, /Business income deduction/)).toBe(-250000);
    expect(justOver.estimate).toBe(0); // the $1,900 exemption absorbs the $1 of remaining business income
  });

  it('taxes business income above the deduction at a flat 3% after exemptions', () => {
    const result = ohio({ federalAGI: 300000, scheduleCNetProfit: 300000 });
    expect(result.components.stateAGI).toBe(50000);
    expect(line(result.components.deductions, /exemptions/)).toBe(1900);
    expect(result.components.taxableIncome).toBe(48100);
    expect(line(result.components.detail, /Taxable business income/)).toBe(48100);
    expect(line(result.components.detail, /Nonbusiness income tax/)).toBe(0);
    expect(result.estimate).toBeCloseTo(48100 * 0.03, 2);
    expect(result.components.marginalRate).toBe(3);
  });

  it('limits married filing separately to $125,000 of business income deduction', () => {
    const result = ohio({ filingStatus: 'married_filing_separately', federalAGI: 200000, scheduleCNetProfit: 200000 });
    expect(line(result.components.modifications, /Business income deduction/)).toBe(-125000);
    expect(result.estimate).toBeCloseTo((75000 - 1900) * 0.03, 2);
  });

  it('splits mixed wages and profit into the graduated nonbusiness schedule and the 3% business rate', () => {
    const result = ohio({ federalAGI: 340000, scheduleCNetProfit: 280000, w2Wages: 60000 });
    expect(result.components.stateAGI).toBe(90000);
    expect(result.components.taxableIncome).toBe(88100);
    expect(line(result.components.detail, /Taxable business income/)).toBe(30000);
    expect(line(result.components.detail, /Taxable nonbusiness income/)).toBe(58100);
    expect(result.estimate).toBeCloseTo(30000 * 0.03 + 342 + 0.0275 * (58100 - 26050), 1);
    expect(result.components.marginalRate).toBe(2.75);
  });

  it('applies the $20 exemption credit for low modified AGI and the higher exemption amounts', () => {
    const result = ohio({ federalAGI: 30000, scheduleCNetProfit: 0, w2Wages: 30000 });
    expect(line(result.components.deductions, /exemptions/)).toBe(2400);
    expect(line(result.components.credits, /Exemption credit/)).toBe(20);
    expect(result.estimate).toBeCloseTo(342 + 0.0275 * (27600 - 26050) - 20, 1);
  });

  it('is unsupported for 2026 and flags municipal taxes as unmodeled', () => {
    expect(ohio({}).warnings.join(' ')).toMatch(/municipal income taxes/);
    const result = estimateStateTax({ ...base, stateCode: 'OH', taxYear: 2026 });
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reason).toMatch(/2025 only/);
  });
});

describe('unsupported results and input handling', () => {
  it('returns supported:false with a reason for 2027, unencoded states, missing and unknown states', () => {
    for (const [stateCode, taxYear, pattern] of [['NY', 2027, /2027/], ['NJ', 2026, /New Jersey/], ['', 2026, /No state is saved/], ['Narnia', 2026, /not a recognized/]] as const) {
      const result = estimateStateTax({ ...base, stateCode, taxYear });
      expect(result.supported).toBe(false);
      if (!result.supported) { expect(result.reason).toMatch(pattern); expect(result.label).toBe('informational state planning estimate'); }
    }
    const unknown = estimateStateTax({ ...base, stateCode: 'Narnia' });
    if (!unknown.supported) expect(unknown.stateName).toBe('Narnia');
  });

  it('resolves a saved full state name to the right registry entry', () => {
    const result = supported({ stateCode: 'New York', taxYear: 2026, federalAGI: 60000, scheduleCNetProfit: 60000 });
    expect(result.stateCode).toBe('NY'); expect(result.stateName).toBe('New York');
  });

  it('withholds a state dollar estimate when Schedule C has a loss', () => {
    const result = estimateStateTax({ ...base, stateCode: 'GA', taxYear: 2025, federalAGI: 5000, scheduleCNetProfit: -20000, w2Wages: 25000 });
    expect(result).toMatchObject({ supported: false, reason: expect.stringContaining('business losses') });
  });
});

describe('separate business tax notices', () => {
  it('surfaces state-level notices for Washington B&O and the Ohio CAT exclusion without a city', () => {
    expect(businessTaxNotices({ stateCode: 'WA' }).map(notice => notice.id)).toEqual(['wa-bo']);
    const ohio = businessTaxNotices({ stateCode: 'Ohio', taxYear: 2026 });
    expect(ohio.map(notice => notice.id)).toEqual(['oh-cat']);
    expect(ohio[0].summary).toMatch(/\$6 million/);
    expect(ohio[0].basis).toBe('state');
  });

  it('needs the saved city for New York City, Portland/Multnomah and Philadelphia and never infers a locality', () => {
    expect(businessTaxNotices({ stateCode: 'NY' })).toEqual([]);
    expect(businessTaxNotices({ stateCode: 'NY', city: 'Albany' })).toEqual([]);
    for (const city of ['Brooklyn', 'New York', 'NYC', 'Staten Island', 'the Bronx']) {
      const notices = businessTaxNotices({ stateCode: 'New York', city });
      expect(notices.map(notice => notice.id)).toEqual(['nyc-ubt']);
      expect(notices[0].summary).toMatch(/\$95,000/); expect(notices[0].summary).toMatch(/MCTMT/); expect(notices[0].basis).toBe('city');
    }
    expect(businessTaxNotices({ stateCode: 'OR', city: 'Salem' })).toEqual([]);
    expect(businessTaxNotices({ stateCode: 'ME', city: 'Portland' })).toEqual([]);
    const portland2026 = businessTaxNotices({ stateCode: 'OR', city: 'Portland', taxYear: 2026 });
    expect(portland2026.map(notice => notice.id)).toEqual(['portland-multnomah']);
    expect(portland2026[0].summary).toMatch(/\$75,000 for tax year 2026/); expect(portland2026[0].summary).toMatch(/2\.6%/); expect(portland2026[0].summary).toMatch(/\$100,000/);
    expect(businessTaxNotices({ stateCode: 'OR', city: 'Portland', taxYear: 2025 })[0].summary).toMatch(/\$50,000 for tax year 2025/);
    expect(businessTaxNotices({ stateCode: 'OR', city: 'Gresham', taxYear: 2026 })[0].jurisdiction).toBe('Multnomah County');
    expect(businessTaxNotices({ stateCode: 'PA', city: 'Pittsburgh' })).toEqual([]);
    const philadelphia = businessTaxNotices({ stateCode: 'PA', city: 'Philadelphia' });
    expect(philadelphia.map(notice => notice.id)).toEqual(['philadelphia-birt-npt']);
    expect(philadelphia[0].summary).toMatch(/BIRT/); expect(philadelphia[0].summary).toMatch(/NPT/);
    expect(businessTaxNotices({ stateCode: 'TX', city: 'Austin' })).toEqual([]);
    expect(businessTaxNotices({ stateCode: '' })).toEqual([]);
  });

  it('cites an administering-agency source for every notice', () => {
    const all = [
      ...businessTaxNotices({ stateCode: 'WA' }), ...businessTaxNotices({ stateCode: 'OH' }), ...businessTaxNotices({ stateCode: 'NY', city: 'Queens' }),
      ...businessTaxNotices({ stateCode: 'OR', city: 'Portland' }), ...businessTaxNotices({ stateCode: 'PA', city: 'Philadelphia' }),
    ];
    expect(all).toHaveLength(5);
    for (const notice of all) {
      expect(notice.sources.length).toBeGreaterThan(0);
      for (const source of notice.sources) expect(new URL(source.url).hostname).toMatch(/\.gov$/);
    }
  });

  it('reads the mailing address before the onboarding state field', () => {
    expect(readProfileLocation({ state: 'Texas', mailing_address: { state: 'NY', city: ' Brooklyn ' } })).toEqual({ state: 'NY', city: 'Brooklyn' });
    expect(readProfileLocation({ state: 'Texas' })).toEqual({ state: 'Texas', city: '' });
    expect(readProfileLocation({ mailing_address: 'not an object' })).toEqual({ state: '', city: '' });
    expect(readProfileLocation(null)).toEqual({ state: '', city: '' });
  });
});

describe('compute1040 state contract', () => {
  const input: Form1040Input = {
    taxYear: 2026, filingStatus: 'single', scheduleCNetProfit: 0, w2Wages: 100000, w2MedicareWages: 100000, w2FederalWithheld: 0, estimatedPayments: 0,
    selfEmploymentTax: 0, halfSEDeduction: 0, healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0, simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0,
  };

  it('returns the supported estimate beside the federal figures without adding it to total tax or a generic warning', () => {
    const federalOnly = compute1040(input);
    const withState = compute1040({ ...input, stateCode: 'New York' });
    expect(federalOnly.stateTax).toBeNull(); expect(federalOnly.stateCode).toBeUndefined();
    expect(withState.totalTax).toBe(federalOnly.totalTax);
    expect(withState.balanceDue).toBe(federalOnly.balanceDue);
    expect(withState).not.toHaveProperty('totalTaxWithState');
    expect(withState).not.toHaveProperty('stateTaxEstimate');
    expect(withState.stateCode).toBe('NY');
    expect(withState.stateTax).toMatchObject({ supported: true, label: 'informational state planning estimate', stateCode: 'NY', taxYear: 2026, filingStatus: 'single' });
    if (withState.stateTax?.supported) {
      expect(withState.stateTax.estimate).toBeCloseTo(4191 + 0.059 * (92000 - 80650), 2);
      expect(withState.stateTax.sources[0]).toMatch(/^https:\/\/www\.tax\.ny\.gov/);
    }
    expect(withState.calculationWarnings.some(note => /state estimate/i.test(note))).toBe(false);
  });

  it('keeps the not-validated warning only for unsupported state-years', () => {
    const result = compute1040({ ...input, stateCode: 'CA' });
    expect(result.stateTax).toMatchObject({ supported: false, stateCode: 'CA', taxYear: 2026 });
    expect(result.calculationWarnings.some(note => /California state estimate has not been validated for tax year 2026/.test(note))).toBe(true);
    const texas = compute1040({ ...input, stateCode: 'TX' });
    expect(texas.stateTax).toMatchObject({ supported: true, noIncomeTax: true, estimate: 0 });
    expect(texas.calculationWarnings.some(note => /state estimate/i.test(note))).toBe(false);
  });

  it('withholds the combined snapshot when high business income requires federal QBI review', () => {
    expect(() => compute1040({
      ...input, taxYear: 2025, stateCode: 'OH', w2Wages: 0, w2MedicareWages: 0, scheduleCNetProfit: 320000, depreciationDeduction: 20000,
      selfEmploymentTax: 30000, halfSEDeduction: 15000,
    })).toThrow(QBIReviewRequiredError);
  });
});
