import { describe, expect, it } from 'vitest';
import { calculateEligibleHSA, calculateEligibleHealth, calculateEligibleRetirement, calculateEligibleAdjustments, resolveJointWageOwnership, readEligibilityFacts } from '@/lib/tax-rules/eligibility';
import { TaxCalculationScopeReviewRequiredError } from '@/lib/tax-rules/calculation-scope';
import { hsaFacts, healthFacts, retirementFacts, jointFacts, eligibilityOrganizer } from './fixtures/eligibility';

describe('Form 8889 supported monthly worksheet', () => {
  it('uses the 2026 self-only limit and subtracts payroll/employer contributions before the personal deduction', () => {
    expect(calculateEligibleHSA(2026, 'single', 3400, hsaFacts({ employerContributions: '1000' })))
      .toEqual({ deduction: 3400, limit: 4400, availableAfterEmployer: 3400, eligibleMonths: 12 });
    expect(() => calculateEligibleHSA(2026, 'single', 3400.01, hsaFacts({ employerContributions: '1000' }))).toThrow(/exceed/);
  });
  it('prorates changing self/family coverage and the age55 catch-up, excluding Medicare months', () => {
    const months = hsaFacts().months!.map((m, index) => ({ ...m, coverage: index < 6 ? 'self' as const : 'family' as const, medicare: index >= 9 ? 'yes' as const : 'no' as const }));
    // Six months at (4,400+1,000)/12, three at (8,750+1,000)/12; Medicare months add zero.
    expect(calculateEligibleHSA(2026, 'single', 5137.5, hsaFacts({ age55: 'yes', months })))
      .toMatchObject({ deduction: 5137.5, limit: 5137.5, eligibleMonths: 9 });
  });
  it('uses the coverage limit, not filing status, and only the contributing holder catch-up', () => {
    expect(calculateEligibleHSA(2025, 'married_filing_jointly', 5300, hsaFacts({ age55: 'yes' })).limit).toBe(5300);
    const family = hsaFacts({ age55: 'yes', owner: 'spouse', months: hsaFacts().months!.map(m => ({ ...m, coverage: 'family' })) });
    expect(calculateEligibleHSA(2026, 'married_filing_jointly', 9750, family).limit).toBe(9750);
    expect(() => calculateEligibleHSA(2026, 'married_filing_jointly', 1000, { ...family, familyAllocationAgreed: '' })).toThrow(/allocated/);
  });
  it.each([
    { notDependent: 'no' }, { age55: '' }, { onlyOneHolder: 'no' }, { monthlyMethod: 'no' },
    { noDistributionsOrPriorExcess: 'no' }, { eligibleCoverageConfirmed: 'no' }, { employerContributions: '' }, { otherReductions: '1' },
  ] as const)('withholds unsupported or unanswered HSA facts %j', patch => {
    expect(() => calculateEligibleHSA(2026, 'single', 1000, hsaFacts(patch))).toThrow(TaxCalculationScopeReviewRequiredError);
  });
});

describe('Form 7206 non-Marketplace premiums', () => {
  it('excludes access months even when coverage was declined and then applies earned-income limits', () => {
    const facts = healthFacts({ months: healthFacts().months!.map((m, index) => ({ ...m, employerAccess: index < 3 ? 'yes' : 'no' })) });
    // 9 x $600 = $5,400 eligible; $6,000 profit - $400 halfSE - $1,000 retirement = $4,600.
    expect(calculateEligibleHealth({ premiums: 7200, netProfit: 6000, halfSE: 400, retirement: 1000 }, facts))
      .toEqual({ deduction: 4600, eligiblePremiums: 5400, excludedEmployerMonths: 1800, incomeLimit: 4600 });
  });
  it('allows no earned-income deduction when the business loses money', () => {
    expect(calculateEligibleHealth({ premiums: 7200, netProfit: -100, halfSE: 0, retirement: 0 }, healthFacts()).deduction).toBe(0);
  });
  it.each(['nonMarketplace', 'noLongTermCare', 'noReimbursement', 'policyUnderBusiness', 'soleProprietor', 'coveredPeopleEligible', 'oneBusiness', 'noForeignIncomeExclusion'] as const)('requires %s before applying premiums', key => {
    expect(() => calculateEligibleHealth({ premiums: 7200, netProfit: 50000, halfSE: 3500, retirement: 0 }, healthFacts({ [key]: '' }))).toThrow(TaxCalculationScopeReviewRequiredError);
  });
  it('refuses unreconciled totals or unanswered employer access instead of silently excluding records', () => {
    expect(() => calculateEligibleHealth({ premiums: 7000, netProfit: 50000, halfSE: 3500, retirement: 0 }, healthFacts())).toThrow(/reconcile/);
    expect(() => calculateEligibleHealth({ premiums: 7200, netProfit: 50000, halfSE: 3500, retirement: 0 }, healthFacts({ months: healthFacts().months!.map(m => ({ ...m, employerAccess: '' })) }))).toThrow(/month 1/);
  });
});

describe('Publication560 owner-only plan worksheets', () => {
  const input = { taxYear: 2026, netProfit: 100000, halfSE: 7064.78, sep: 10000, solo: 0, simple: 0 };
  it('applies the reduced SEP rate to net profit less half of SE tax', () => {
    expect(calculateEligibleRetirement(input, retirementFacts())).toEqual({ deduction: 10000, employeeLimit: 0, employerLimit: 18587.04, method: 'sep_ira' });
    expect(() => calculateEligibleRetirement({ ...input, sep: 18587.05 }, retirementFacts({ employerContribution: '18587.05' }))).toThrow(/exceed/);
  });
  it('implements the low-earned-income Solo401k worksheet half-remainder limit', () => {
    // Pub560 steps3=30,000;9=24,500;12=(30,000-24,500)/2=2,750, below the 20% employer limit.
    expect(calculateEligibleRetirement({ ...input, netProfit: 32000, halfSE: 2000, sep: 0, solo: 27250 }, retirementFacts({ plan: 'solo_401k', employeeContribution: '24500', employerContribution: '2750' })))
      .toEqual({ deduction: 27250, employeeLimit: 24500, employerLimit: 2750, method: 'solo_401k' });
    expect(() => calculateEligibleRetirement({ ...input, netProfit: 32000, halfSE: 2000, sep: 0, solo: 27500 }, retirementFacts({ plan: 'solo_401k', employeeContribution: '24500', employerContribution: '3000' }))).toThrow(/exceed/);
  });
  it('uses ScheduleSE line4 earnings for standard SIMPLE matching and nonelective contributions', () => {
    // $50,000 x .9235 = $46,175; 3% match=$1,385.25 and 2% nonelective=$923.50.
    for (const [simpleMethod, employer] of [['match3', '1385.25'], ['nonelective2', '923.50']] as const) {
      const total = 10000 + Number(employer);
      expect(calculateEligibleRetirement({ ...input, netProfit: 50000, halfSE: 3532.39, sep: 0, simple: total }, retirementFacts({ plan: 'simple_ira', simpleMethod, employeeContribution: '10000', employerContribution: employer })).deduction).toBe(total);
    }
  });
  it.each(['soleProprietor', 'establishedAndTimely', 'onlyPlan', 'noEmployees', 'noOtherDeferrals', 'traditionalOnly', 'noCatchUp', 'earnedFromServices'] as const)('keeps %s as an explicit review fact', key => {
    expect(() => calculateEligibleRetirement(input, retirementFacts({ [key]: 'no' }))).toThrow(TaxCalculationScopeReviewRequiredError);
  });
  it('keeps mismatched plan components and enhanced SIMPLE amounts out of supported deductions', () => {
    expect(() => calculateEligibleRetirement(input, retirementFacts({ employeeContribution: '10000', employerContribution: '0' }))).toThrow(/employer contribution/);
    expect(() => calculateEligibleRetirement({ ...input, sep: 0, simple: 18770.57 }, retirementFacts({ plan: 'simple_ira', simpleMethod: 'match3', employeeContribution: '18000', employerContribution: '770.57' }))).toThrow(TaxCalculationScopeReviewRequiredError);
  });
});

describe('saved intake and spouse wage ownership', () => {
  const zeroClaims = { taxYear: 2026, filingStatus: 'single', netProfit: 50000, halfSE: 3000,
    hsaContribution: 0, healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0, simpleIraContribution: 0 };
  it('validates employer HSA funding even with no personal deduction claim', () => {
    expect(calculateEligibleAdjustments({ ...zeroClaims, organizer: eligibilityOrganizer({ hsa: hsaFacts({ employerContributions: '4400' }) }) }))
      .toMatchObject({ hsaDeduction: 0, hsa: { limit: 4400, availableAfterEmployer: 0 } });
    expect(() => calculateEligibleAdjustments({ ...zeroClaims, organizer: eligibilityOrganizer({ hsa: hsaFacts({ employerContributions: '4400.01' }) }) }))
      .toThrow(/HSA contributions exceed/);
    expect(() => calculateEligibleAdjustments({ ...zeroClaims, organizer: eligibilityOrganizer({ hsa: hsaFacts({ noDistributionsOrPriorExcess: 'no' }) }) }))
      .toThrow(/Forms 8889\/5329/);
  });
  it('does not silently drop positive declared retirement or monthly health payments with zero saved claims', () => {
    expect(() => calculateEligibleAdjustments({ ...zeroClaims, organizer: eligibilityOrganizer({ retirement: retirementFacts() }) })).toThrow(/Reconcile/);
    expect(() => calculateEligibleAdjustments({ ...zeroClaims, organizer: eligibilityOrganizer({ health: healthFacts() }) })).toThrow(/reconcile/);
    expect(calculateEligibleAdjustments(zeroClaims)).toMatchObject({ hsaDeduction: 0, healthInsuranceDeduction: 0, retirementDeduction: 0 });
  });
  it('requires a matching year and rejects malformed or additional fields', () => {
    expect(() => readEligibilityFacts('{"version":1,"taxYear":2026,"approved":true}')).toThrow(TaxCalculationScopeReviewRequiredError);
    expect(() => calculateEligibleAdjustments({ taxYear: 2026, filingStatus: 'single', netProfit: 50000, halfSE: 3000, hsaContribution: 1000, healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0, simpleIraContribution: 0, organizer: eligibilityOrganizer({ taxYear: 2025, hsa: hsaFacts() }) })).toThrow(/2025/);
  });
  it('assigns only the self-employed spouse’s Social Security wages, but combines Medicare wages', () => {
    const input = { taxYear: 2026, wages: 150000, ssWages: 150000, medicareWages: 150000, organizer: eligibilityOrganizer({ joint: jointFacts({ taxpayerWages: '50000', taxpayerSSWages: '50000', taxpayerMedicareWages: '50000' }) }) };
    expect(resolveJointWageOwnership(input)).toEqual({ businessOwner: 'taxpayer', ownerSocialSecurityWages: 50000, combinedMedicareWages: 150000 });
    expect(resolveJointWageOwnership({ ...input, organizer: eligibilityOrganizer({ joint: jointFacts({ businessOwner: 'spouse', taxpayerWages: '50000', taxpayerSSWages: '50000', taxpayerMedicareWages: '50000' }) }) }).ownerSocialSecurityWages).toBe(100000);
  });
  it('requires reconciliation after W-2 changes and does not combine two self-employed spouses', () => {
    const input = { taxYear: 2026, wages: 100000, ssWages: 100000, medicareWages: 100000, organizer: eligibilityOrganizer({ joint: jointFacts() }) };
    expect(() => resolveJointWageOwnership({ ...input, ssWages: 100100 })).toThrow(/match/);
    expect(() => resolveJointWageOwnership({ ...input, medicareWages: undefined })).toThrow(/Box 5/);
    expect(() => resolveJointWageOwnership({ ...input, organizer: eligibilityOrganizer({ joint: jointFacts({ oneSelfEmployedSpouse: 'no' }) }) })).toThrow(/separate/);
  });
});
