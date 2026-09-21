/**
 * Primary-source audit of every hard-coded 2025 and 2026 federal figure (verified 2026-09-18).
 * Each expectation is the amount printed in the cited IRS/SSA/statutory source, so a
 * silent edit to a constant fails here even when the engine math still balances.
 *
 * Sources:
 *   RP24-40  Rev. Proc. 2024-40 (2025 inflation adjustments)   https://www.irs.gov/pub/irs-drop/rp-24-40.pdf
 *   RP25-32  Rev. Proc. 2025-32 (2026 inflation adjustments)   https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
 *   PL119-21 One Big Beautiful Bill Act, enrolled text          https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm
 *   N24-80 / N25-67  retirement plan limits 2025 / 2026         https://www.irs.gov/pub/irs-drop/n-24-80.pdf, n-25-67.pdf
 *   RP24-25 / RP25-19  HSA limits 2025 / 2026                   https://www.irs.gov/pub/irs-drop/rp-24-25.pdf, rp-25-19.pdf
 *   N25-05 / N26-10 / Ann. 2026-11  standard mileage            https://www.irs.gov/pub/irs-drop/n-25-05.pdf, n-26-10.pdf, https://www.irs.gov/irb/2026-29_irb
 *   i1040sse (2025) / f1040es (2026)  Social Security wage base https://www.irs.gov/instructions/i1040sse, https://www.irs.gov/pub/irs-pdf/f1040es.pdf
 *   irs.gov/payments/quarterly-interest-rates  §6621 rates
 */
import { describe, expect, it } from 'vitest';
import { calculateSALTLimit, getFederalTaxRules, getSection179Limits } from '../lib/tax-rules/federal-year-rules';
import {
  NON_ITEMIZER_CHARITY_FIRST_YEAR, NON_ITEMIZER_CHARITY_LIMIT, NON_ITEMIZER_CHARITY_LIMIT_JOINT,
  QUALIFIED_OVERTIME_LIMIT, QUALIFIED_OVERTIME_LIMIT_JOINT, QUALIFIED_TIPS_LIMIT, SCHEDULE_1A_FIRST_YEAR, SCHEDULE_1A_LAST_YEAR,
  TIPS_OVERTIME_PHASEOUT_PER_THOUSAND, TIPS_OVERTIME_PHASEOUT_THRESHOLD, TIPS_OVERTIME_PHASEOUT_THRESHOLD_JOINT,
  VEHICLE_LOAN_INTEREST_LIMIT, VEHICLE_LOAN_PHASEOUT_PER_THOUSAND, VEHICLE_LOAN_PHASEOUT_THRESHOLD, VEHICLE_LOAN_PHASEOUT_THRESHOLD_JOINT,
} from '../lib/tax-rules/obbba-deductions';
import { STUDENT_LOAN_INTEREST_LIMIT, STUDENT_LOAN_PHASEOUT_WIDTH, STUDENT_LOAN_PHASEOUT_WIDTH_JOINT, limitHSADeduction, limitStudentLoanInterest } from '../lib/tax-rules/compute-1040';
import { calculateLTCGTax } from '../lib/tax-rules/credits';
import { CAPITAL_LOSS_LIMIT, CAPITAL_LOSS_LIMIT_SEPARATE } from '../lib/tax-rules/capital-gains';
import { calculateSocialSecurityWorksheet } from '../lib/tax-rules/social-security';
import { businessMileageRateForDate } from '../lib/tax-rules/mileage-rates';
import { getTaxRatesAndLimits } from '../lib/reports/calcSE';
import { DE_MINIMIS_SAFE_HARBOR_LIMIT } from '../lib/reports/calc4562';
import { SIMPLIFIED_MAX_SQFT, SIMPLIFIED_RATE_PER_SQFT } from '../lib/reports/calc8829';
import { getInstallmentDueDates, getUnderpaymentRate } from '../lib/tax-provider/quarterly-planner';
import { getIndividualReturnDueDate } from '../lib/tax-provider/payment-deadlines';

const ends = (year: number, status: Parameters<typeof calculateSALTLimit>[1]) => getFederalTaxRules(year).brackets[status].map(b => b.max);
const y2025 = getFederalTaxRules(2025);
const y2026 = getFederalTaxRules(2026);

describe('ordinary income brackets (RP24-40 §2.01, RP25-32 §4.01)', () => {
  it('2025 taxable-income ceilings for all four filing statuses', () => {
    expect(ends(2025, 'single')).toEqual([11925, 48475, 103350, 197300, 250525, 626350, Infinity]);
    expect(ends(2025, 'married_filing_jointly')).toEqual([23850, 96950, 206700, 394600, 501050, 751600, Infinity]);
    expect(ends(2025, 'married_filing_separately')).toEqual([11925, 48475, 103350, 197300, 250525, 375800, Infinity]);
    expect(ends(2025, 'head_of_household')).toEqual([17000, 64850, 103350, 197300, 250500, 626350, Infinity]);
  });
  it('2026 taxable-income ceilings for all four filing statuses', () => {
    expect(ends(2026, 'single')).toEqual([12400, 50400, 105700, 201775, 256225, 640600, Infinity]);
    expect(ends(2026, 'married_filing_jointly')).toEqual([24800, 100800, 211400, 403550, 512450, 768700, Infinity]);
    expect(ends(2026, 'married_filing_separately')).toEqual([12400, 50400, 105700, 201775, 256225, 384350, Infinity]);
    expect(ends(2026, 'head_of_household')).toEqual([17700, 67450, 105700, 201750, 256200, 640600, Infinity]);
  });
  it('seven permanent rates (PL119-21 §70101) and the printed cumulative tax at each 2026 joint boundary', () => {
    expect(y2026.brackets.single.map(b => b.rate)).toEqual([0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]);
    // RP25-32 Table 1: $2,480 / $11,600 / $35,932 / $82,048 / $116,896 / $206,583.50.
    let tax = 0;
    const printed = [2480, 11600, 35932, 82048, 116896, 206583.5];
    y2026.brackets.married_filing_jointly.slice(0, 6).forEach((b, i) => { tax += (b.max - b.min) * b.rate; expect(Math.round(tax * 100) / 100).toBe(printed[i]); });
  });
});

describe('standard deduction', () => {
  it('2025 uses the PL119-21 §70102(b) amounts, not the superseded RP24-40 §2.15 figures', () => {
    expect(y2025.standardDeductions).toEqual({ single: 15750, married_filing_jointly: 31500, married_filing_separately: 15750, head_of_household: 23625 });
  });
  it('2026 uses RP25-32 §4.14(1)', () => {
    expect(y2026.standardDeductions).toEqual({ single: 16100, married_filing_jointly: 32200, married_filing_separately: 16100, head_of_household: 24150 });
  });
});

describe('credits', () => {
  it('child tax credit: $2,200 (PL119-21 §70104; RP25-32 §4.05) with the $1,700 refundable amount (RP24-40 §2.05, RP25-32 §4.05)', () => {
    expect([y2025.childTaxCreditPerChild, y2025.refundableChildTaxCreditPerChild]).toEqual([2200, 1700]);
    expect([y2026.childTaxCreditPerChild, y2026.refundableChildTaxCreditPerChild]).toEqual([2200, 1700]);
  });
  it('EITC 2025 table (RP24-40 §2.06)', () => {
    expect(y2025.eitcInvestmentIncomeLimit).toBe(11950);
    expect([0, 1, 2, 3].map(n => y2025.eitc[n as 0 | 1 | 2 | 3].maxCredit)).toEqual([649, 4328, 7152, 8046]);
    expect([0, 1, 2, 3].map(n => y2025.eitc[n as 0 | 1 | 2 | 3].phaseOutStart)).toEqual([10620, 23350, 23350, 23350]);
    expect([0, 1, 2, 3].map(n => y2025.eitc[n as 0 | 1 | 2 | 3].phaseOutStartMFJ)).toEqual([17730, 30470, 30470, 30470]);
    expect([0, 1, 2, 3].map(n => y2025.eitc[n as 0 | 1 | 2 | 3].phaseOutEnd)).toEqual([19104, 50434, 57310, 61555]);
    expect([0, 1, 2, 3].map(n => y2025.eitc[n as 0 | 1 | 2 | 3].phaseOutEndMFJ)).toEqual([26214, 57554, 64430, 68675]);
  });
  it('EITC 2026 table (RP25-32 §4.06) and the statutory §32(b) percentages', () => {
    expect(y2026.eitcInvestmentIncomeLimit).toBe(12200);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].maxCredit)).toEqual([664, 4427, 7316, 8231]);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].phaseOutStart)).toEqual([10860, 23890, 23890, 23890]);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].phaseOutStartMFJ)).toEqual([18140, 31160, 31160, 31160]);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].phaseOutEnd)).toEqual([19540, 51593, 58629, 62974]);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].phaseOutEndMFJ)).toEqual([26820, 58863, 65899, 70244]);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].phaseInRate)).toEqual([0.0765, 0.34, 0.40, 0.45]);
    expect([0, 1, 2, 3].map(n => y2026.eitc[n as 0 | 1 | 2 | 3].phaseOutRate)).toEqual([0.0765, 0.1598, 0.2106, 0.2106]);
  });
});

describe('capital gains and losses', () => {
  it('0% / 15% breakpoints (RP24-40 §2.03, RP25-32 §4.03) and the 0/15/20% stacking', () => {
    expect(y2025.capitalGainsThresholds).toEqual({ single: [48350, 533400], married_filing_jointly: [96700, 600050], married_filing_separately: [48350, 300000], head_of_household: [64750, 566700] });
    expect(y2026.capitalGainsThresholds).toEqual({ single: [49450, 545500], married_filing_jointly: [98900, 613700], married_filing_separately: [49450, 306850], head_of_household: [66200, 579600] });
    expect(calculateLTCGTax(1000, 49450, 'single', 2026)).toBe(0);
    expect(calculateLTCGTax(1000, 50450, 'single', 2026)).toBe(150);
    expect(calculateLTCGTax(1000, 546500, 'single', 2026)).toBe(200);
  });
  it('§1211(b) net capital loss limit is $3,000 ($1,500 married filing separately), not indexed', () => {
    expect([CAPITAL_LOSS_LIMIT, CAPITAL_LOSS_LIMIT_SEPARATE]).toEqual([3000, 1500]);
  });
});

describe('self-employment tax and Social Security', () => {
  it('wage base $176,100 (2025 Schedule SE instructions) and $184,500 (2026 Form 1040-ES worksheet line 5)', () => {
    expect([y2025.socialSecurityWageBase, y2026.socialSecurityWageBase]).toEqual([176100, 184500]);
  });
  it('12.4% + 2.9% on 92.35% of net earnings; 0.9% Additional Medicare above the unindexed §1401(b)(2) thresholds', () => {
    for (const year of [2025, 2026]) {
      const limits = getTaxRatesAndLimits(year);
      expect(limits).toMatchObject({ socialSecurityRate: 0.124, medicareRate: 0.029, additionalMedicareRate: 0.009, seAdjustmentFactor: 0.9235 });
      expect([limits.additionalMedicareThresholdSingle, limits.additionalMedicareThresholdMarried, limits.additionalMedicareThresholdMarriedSeparate]).toEqual([200000, 250000, 125000]);
    }
  });
  it('§86 benefit taxability base amounts $25,000 / $32,000 and 85% tiers at $34,000 / $44,000 (unindexed)', () => {
    const single = calculateSocialSecurityWorksheet({ taxYear: 2026, filingStatus: 'single', netBenefits: 20000, otherIncome: 30000, taxExemptInterest: 0, excludedSavingsBondInterest: 0, exclusionAddbacks: 0, allowedAdjustments: 0 });
    expect([single.baseAmount, single.upperBaseAmount]).toEqual([25000, 34000]);
    const joint = calculateSocialSecurityWorksheet({ taxYear: 2026, filingStatus: 'married_filing_jointly', netBenefits: 20000, otherIncome: 30000, taxExemptInterest: 0, excludedSavingsBondInterest: 0, exclusionAddbacks: 0, allowedAdjustments: 0 });
    expect([joint.baseAmount, joint.upperBaseAmount]).toEqual([32000, 44000]);
  });
});

describe('business deductions', () => {
  it('QBI thresholds (RP24-40 §2.27, RP25-32 §4.26) and the PL119-21 §70105 phase-in widening to $75,000 / $150,000 from 2026', () => {
    expect(y2025.qbiThreshold).toEqual({ single: 197300, married_filing_jointly: 394600, married_filing_separately: 197300, head_of_household: 197300 });
    expect(y2025.qbiPhaseInWidth).toBe(50000);
    expect(y2026.qbiThreshold).toEqual({ single: 201750, married_filing_jointly: 403500, married_filing_separately: 201775, head_of_household: 201750 });
    expect(y2026.qbiPhaseInWidth).toBe(75000);
  });
  it('§179: $2,500,000 / $4,000,000 for 2025 (PL119-21 §70306) and $2,560,000 / $4,090,000 for 2026 (RP25-32 §4.24)', () => {
    expect(getSection179Limits(2025)).toMatchObject({ limit: 2500000, phaseoutThreshold: 4000000 });
    expect(getSection179Limits(2026)).toMatchObject({ limit: 2560000, phaseoutThreshold: 4090000 });
  });
  it('§461(l) excess business loss thresholds: $313,000 / $626,000 (RP24-40 §2.32) and $256,000 / $512,000 (RP25-32 §4.31)', () => {
    expect(y2025.excessBusinessLossThreshold).toEqual({ single: 313000, married_filing_jointly: 626000, married_filing_separately: 313000, head_of_household: 313000 });
    expect(y2026.excessBusinessLossThreshold).toEqual({ single: 256000, married_filing_jointly: 512000, married_filing_separately: 256000, head_of_household: 256000 });
  });
  it('de minimis safe harbor $2,500 (Reg. §1.263(a)-1(f), Notice 2015-82) and simplified home office $5 × 300 sq ft (Rev. Proc. 2013-13)', () => {
    expect(DE_MINIMIS_SAFE_HARBOR_LIMIT).toBe(2500);
    expect([SIMPLIFIED_RATE_PER_SQFT, SIMPLIFIED_MAX_SQFT]).toEqual([5, 300]);
  });
  it('business standard mileage: 70¢ (N25-05), 72.5¢ (N26-10) and 76¢ from 2026-07-01 (Ann. 2026-11)', () => {
    expect(businessMileageRateForDate('2025-07-04')?.ratePerMile).toBe(0.70);
    expect(businessMileageRateForDate('2026-06-30')?.ratePerMile).toBe(0.725);
    expect(businessMileageRateForDate('2026-07-01')?.ratePerMile).toBe(0.76);
    expect(businessMileageRateForDate('2027-01-01')).toBeNull();
  });
});

describe('itemized and above-the-line limits', () => {
  it('SALT cap $40,000 / $500,000 for 2025 and $40,400 / $505,000 for 2026 (§164(b)(7) via PL119-21 §70120); 30% phase-down to a $10,000 floor', () => {
    expect([y2025.saltCap, y2025.saltPhaseoutStart, y2026.saltCap, y2026.saltPhaseoutStart]).toEqual([40000, 500000, 40400, 505000]);
    expect(calculateSALTLimit(2026, 'single', 505000)).toBe(40400);
    expect(calculateSALTLimit(2026, 'single', 605000)).toBe(10400);
    expect(calculateSALTLimit(2026, 'single', 700000)).toBe(10000);
    expect(calculateSALTLimit(2026, 'married_filing_separately', 252500)).toBe(20200);
  });
  it('student loan interest $2,500 with MAGI phaseouts $85,000–$100,000 / $170,000–$200,000 (RP24-40 §2.30) and $85,000–$100,000 / $175,000–$205,000 (RP25-32 §4.29)', () => {
    expect([STUDENT_LOAN_INTEREST_LIMIT, STUDENT_LOAN_PHASEOUT_WIDTH, STUDENT_LOAN_PHASEOUT_WIDTH_JOINT]).toEqual([2500, 15000, 30000]);
    expect(limitStudentLoanInterest(2025, 'married_filing_jointly', 3000, 0)).toMatchObject({ limited: 2500, phaseoutStart: 170000, phaseoutEnd: 200000 });
    expect(limitStudentLoanInterest(2026, 'single', 3000, 0)).toMatchObject({ phaseoutStart: 85000, phaseoutEnd: 100000 });
    expect(limitStudentLoanInterest(2026, 'married_filing_jointly', 3000, 0)).toMatchObject({ phaseoutStart: 175000, phaseoutEnd: 205000 });
  });
  it('HSA limits $4,300 / $8,550 (RP24-25 §2) and $4,400 / $8,750 (RP25-19 §2) plus the fixed $1,000 catch-up', () => {
    expect(y2025.hsaContributionLimit).toEqual({ selfOnly: 4300, family: 8550, catchUp: 1000 });
    expect(y2026.hsaContributionLimit).toEqual({ selfOnly: 4400, family: 8750, catchUp: 1000 });
    expect(limitHSADeduction(2026, 'married_filing_jointly', 20000)).toEqual({ deduction: 10750, ceiling: 10750, selfOnlyCeiling: 5400 });
  });
  it('§415(c) defined-contribution / SEP limit $70,000 (N24-80) and $72,000 (N25-67)', () => {
    expect([y2025.sepContributionLimit, y2026.sepContributionLimit]).toEqual([70000, 72000]);
  });
});

describe('Working Families Tax Cuts deductions (PL119-21 §§70201–70203, 70424)', () => {
  it('statutory amounts and MAGI phaseouts for 2025–2028', () => {
    expect([SCHEDULE_1A_FIRST_YEAR, SCHEDULE_1A_LAST_YEAR]).toEqual([2025, 2028]);
    expect([QUALIFIED_TIPS_LIMIT, TIPS_OVERTIME_PHASEOUT_THRESHOLD, TIPS_OVERTIME_PHASEOUT_THRESHOLD_JOINT, TIPS_OVERTIME_PHASEOUT_PER_THOUSAND]).toEqual([25000, 150000, 300000, 100]);
    expect([QUALIFIED_OVERTIME_LIMIT, QUALIFIED_OVERTIME_LIMIT_JOINT]).toEqual([12500, 25000]);
    expect([VEHICLE_LOAN_INTEREST_LIMIT, VEHICLE_LOAN_PHASEOUT_THRESHOLD, VEHICLE_LOAN_PHASEOUT_THRESHOLD_JOINT, VEHICLE_LOAN_PHASEOUT_PER_THOUSAND]).toEqual([10000, 100000, 200000, 200]);
  });
  it('§170(p) non-itemizer charitable deduction $1,000 / $2,000 begins with tax year 2026', () => {
    expect([NON_ITEMIZER_CHARITY_FIRST_YEAR, NON_ITEMIZER_CHARITY_LIMIT, NON_ITEMIZER_CHARITY_LIMIT_JOINT]).toEqual([2026, 1000, 2000]);
  });
});

describe('estimated tax calendar and §6621 underpayment rates', () => {
  it('2026 installments match the 2026 Form 1040-ES (April 15, June 15, Sept. 15, 2026 and Jan. 15, 2027)', () => {
    expect(getInstallmentDueDates(2026).map(d => d.dueDate)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
  });
  it('2027 installments follow §6654(c)(2) with the §7503 shift of Saturday Jan. 15, 2028 past Martin Luther King Jr. Day to Tuesday Jan. 18, 2028', () => {
    expect(getInstallmentDueDates(2027).map(d => d.dueDate)).toEqual(['2027-04-15', '2027-06-15', '2027-09-15', '2028-01-18']);
  });
  it('individual return due dates: April 15, 2026 for 2025 and April 15, 2027 for 2026 (no weekend or Emancipation Day shift)', () => {
    expect(getIndividualReturnDueDate(2025).toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(getIndividualReturnDueDate(2026).toISOString().slice(0, 10)).toBe('2027-04-15');
  });
  it('non-corporate underpayment rates: 7% for every 2025 quarter; 7% / 6% / 7% / 7% for 2026; 2027 Q1 unpublished', () => {
    expect(([1, 2, 3, 4] as const).map(q => getUnderpaymentRate(2025, q))).toEqual([0.07, 0.07, 0.07, 0.07]);
    expect(([1, 2, 3, 4] as const).map(q => getUnderpaymentRate(2026, q))).toEqual([0.07, 0.06, 0.07, 0.07]);
    expect(getUnderpaymentRate(2027, 1)).toBeNull();
  });
});
