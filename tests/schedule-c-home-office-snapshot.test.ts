import { describe, expect, it } from 'vitest';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { computeScheduleCProfit, scheduleCReviewCode } from '@/lib/tax-rules/schedule-c-profit';
import type { HomeOfficeSettings } from '@/lib/reports/calc8829';
import type { Asset } from '@/lib/reports/calc4562';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const homeOffice = (overrides: Partial<HomeOfficeSettings> = {}): HomeOfficeSettings => ({
  totalHomeSqFt: 1500, officeSqFt: 300, rentOrMortgageInterest: 0, utilities: 0, insurance: 0, repairsMaintenance: 0, propertyTax: 0, other: 0,
  method: 'simplified', regularUse: 'yes', exclusiveUse: 'yes', exclusiveUseException: null, qualifyingUse: 'principal_place_of_business', housingType: 'rented', monthsUsed: 12, ...overrides,
});
const asset = (overrides: Partial<Asset> = {}): Asset => ({ id: 'a', description: 'Business computer', datePlacedInService: new Date('2026-04-01T00:00:00Z'), cost: 10000,
  businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...overrides });
type SnapshotInput = Parameters<typeof buildFederalTaxSnapshot>[0];
const snapshot = (input: Partial<SnapshotInput> = {}) => buildFederalTaxSnapshot({
  taxYear: 2026, profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(), transactions: [],
  grossReceipts: [{ amount: 100000 }], forms1099: [], w2Entries: [], deductions: {}, assets: [], estimatedPayments: 0, ...input,
});
const thrownCode = (run: () => unknown) => { try { run(); } catch (error) { return scheduleCReviewCode(error); } return null; };

describe('home office in the shared federal snapshot', () => {
  it('reduces Schedule C line 31 before Schedule SE, AGI and QBI while keeping the pre-asset figure', () => {
    const base = snapshot();
    const withOffice = snapshot({ homeOffice: homeOffice() });
    expect(base.income).toMatchObject({ scheduleCNetProfit: 100000, homeOfficeDeduction: 0, scheduleCLine31NetProfit: 100000 });
    expect(withOffice.income).toMatchObject({ scheduleCNetProfit: 100000, scheduleCLine29TentativeProfit: 100000, homeOfficeDeduction: 1500, scheduleCLine31NetProfit: 98500 });
    expect(withOffice.homeOfficeDeduction).toBe(1500);
    expect(withOffice.scheduleC.homeOffice.calculation).toMatchObject({ method: 'simplified', allowableSqFt: 300, allowableDeduction: 1500 });
    expect(base.seCalc).toMatchObject({ netProfitFromScheduleC: 100000, totalSETax: 14129.55 });
    expect(withOffice.seCalc).toMatchObject({ netProfitFromScheduleC: 98500, totalSETax: 13917.61 });
    expect(withOffice.result.totalIncome).toBe(98500);
    expect(withOffice.result.agi).toBeCloseTo(base.result.agi - 1500 + (base.seCalc.halfSEDeduction - withOffice.seCalc.halfSEDeduction), 2);
    expect(withOffice.result.qbiDeduction).toBeLessThan(base.result.qbiDeduction);
    expect(withOffice.result.totalTax).toBeLessThan(base.result.totalTax);
  });
  it('applies the line 29 gross-income limit from the same records and drops the excess without carryover', () => {
    const limited = snapshot({ grossReceipts: [{ amount: 900 }], homeOffice: homeOffice() });
    expect(limited.income).toMatchObject({ scheduleCLine29TentativeProfit: 900, homeOfficeDeduction: 900, scheduleCLine31NetProfit: 0 });
    expect(limited.scheduleC.homeOffice.calculation).toMatchObject({ tentativeDeduction: 1500, grossIncomeLimit: 900, disallowedNoCarryover: 600 });
    expect(limited.seCalc.totalSETax).toBe(0);
  });
  it('orders de minimis items, Section 179 and MACRS (line 13) before line 29 and the home office (line 30)', () => {
    const result = snapshot({
      grossReceipts: [{ amount: 40000 }], homeOffice: homeOffice(), depreciationElections: { deMinimisSafeHarborYears: [2026] },
      assets: [asset({ id: 'mouse', cost: 2000 }), asset({ id: 'workstation', section179Requested: true }), asset({ id: 'desk', cost: 3000, method: 'MACRS_7YR', category: 'furniture' })],
    });
    expect(result.scheduleC).toMatchObject({ profitBeforeAssets: 40000, section179BusinessIncome: 40000, deMinimisExpense: 2000, depreciationDeduction: 10428.7, tentativeProfit: 27571.3, homeOfficeDeduction: 1500, netProfit: 26071.3 });
    expect(result.income).toMatchObject({ deMinimisExpense: 2000, depreciationDeduction: 10428.7, scheduleCLine29TentativeProfit: 27571.3, homeOfficeDeduction: 1500, scheduleCLine31NetProfit: 26071.3 });
    expect(result.scheduleC.assetCalculation?.section179).toMatchObject({ electionYear: 2026, allowed: 10000, carryover: 0 });
    expect(result.result.totalIncome).toBe(26071.3);
    expect(result.result.calculationWarnings.join(' ')).toMatch(/De minimis safe harbor items are ordinary current-year expenses/);
    expect(result.result.calculationWarnings.join(' ')).toContain('§179(b)(3)(A)');
  });
  it('counts W-2 wages toward the §179 business-income limit and lets the resulting loss zero the home office', () => {
    const result = snapshot({ grossReceipts: [{ amount: 6000 }], w2Entries: [{ box1Wages: 20000, box3SocialSecurityWages: 20000, box5MedicareWages: 20000, box2FederalWithheld: 0 }], homeOffice: homeOffice(), assets: [asset({ section179Requested: true })] });
    expect(result.scheduleC).toMatchObject({ section179BusinessIncome: 26000, depreciationDeduction: 10000, tentativeProfit: -4000, homeOfficeDeduction: 0, netProfit: -4000 });
    expect(result.scheduleC.homeOffice.calculation).toMatchObject({ grossIncomeLimit: 0, allowableDeduction: 0, disallowedNoCarryover: 1500 });
  });
  it('raises HOME_OFFICE_REVIEW_REQUIRED for unanswered facts and for a legacy method with no saved facts', () => {
    expect(thrownCode(() => snapshot({ homeOffice: homeOffice({ exclusiveUse: null }) }))).toBe('HOME_OFFICE_REVIEW_REQUIRED');
    expect(thrownCode(() => snapshot({ homeOffice: homeOffice({ qualifyingUse: null }) }))).toBe('HOME_OFFICE_REVIEW_REQUIRED');
    expect(thrownCode(() => snapshot({ homeOffice: homeOffice({ method: 'actual' }) }))).toBe('HOME_OFFICE_REVIEW_REQUIRED');
    expect(thrownCode(() => snapshot({ profile: { filing_status: 'single', home_office_method: 'simplified' } }))).toBe('HOME_OFFICE_REVIEW_REQUIRED');
    expect(thrownCode(() => snapshot({ assets: [asset({ category: 'vehicle' })] }))).toBe('DEPRECIATION_REVIEW_REQUIRED');
    expect(scheduleCReviewCode(new Error('plain'))).toBeNull();
  });
  it('includes an explicit "no" as a $0 warning rather than a review stop', () => {
    const result = snapshot({ homeOffice: homeOffice({ exclusiveUse: 'no', exclusiveUseException: 'none' }) });
    expect(result.income).toMatchObject({ homeOfficeDeduction: 0, scheduleCLine31NetProfit: 100000 });
    expect(result.result.calculationWarnings.join(' ')).toContain('Home office deduction is $0');
  });
  it('shares one ordering helper with the SE loader and worksheet routes', () => {
    const direct = computeScheduleCProfit({ taxYear: 2026, grossReceipts: 100000, confirmedExpenses: 0, w2Wages: 0, assets: [], homeOffice: homeOffice({ monthsUsed: 6 }) });
    expect(direct).toMatchObject({ profitBeforeAssets: 100000, tentativeProfit: 100000, homeOfficeDeduction: 750, netProfit: 99250 });
    expect(snapshot({ homeOffice: homeOffice({ monthsUsed: 6 }) }).income.scheduleCLine31NetProfit).toBe(99250);
  });
});
