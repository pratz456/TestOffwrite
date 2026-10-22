import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { QBIReviewRequiredError } from '../lib/tax-rules/qbi';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { summarizeW2Income } from '../lib/tax-rules/w2-income';
import { calcScheduleSE } from '../lib/reports/calcSE';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const base: Form1040Input = {
  taxYear: 2026, filingStatus: 'single', scheduleCNetProfit: 0, w2Wages: 0,
  w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
  healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
  simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0, taxPayerAge: 35,
};

describe('Form 8959 Part V withholding', () => {
  it('lowers the balance due by the $450 of Box 6 above 1.45% of Box 5 and leaves total tax unchanged', () => {
    // Box 1 intentionally $0 to isolate Additional Medicare math; real wages would trip QBIReviewRequiredError.
    // Box 5 $250,000 and Box 6 $4,075. Line 21 = $250,000 × 1.45% = $3,625. Line 22 = $450.
    // $100,000 profit, single, 2026. Line 18 stays $1,281.15 ($450 wages + $831.15 SE).
    const se = calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2026 }, 'single', 184500, 250000);
    expect(se.additionalMedicareTax).toBe(831.15);
    expect(se.totalSETax).toBe(2678.15);
    const shared = {
      ...base,
      scheduleCNetProfit: 100000,
      w2SocialSecurityWages: 184500,
      w2MedicareWages: 250000,
      selfEmploymentTax: se.totalSETax,
      halfSEDeduction: se.halfSEDeduction,
    };
    const blank = compute1040(shared);
    const credited = compute1040({ ...shared, w2MedicareWithheld: 4075 });
    expect(blank.additionalMedicareTax).toBe(1281.15);
    expect(credited.additionalMedicareTax).toBe(1281.15);
    expect(blank.totalTax).toBe(13202.02);
    expect(credited.totalTax).toBe(13202.02);
    expect(credited.additionalMedicareWithheld).toBe(450);
    expect(credited.w2FederalWithheld).toBe(0);
    expect(blank.w2FederalWithheld).toBe(0);
    expect(blank.totalPayments).toBe(0);
    expect(credited.totalPayments).toBe(450);
    expect(blank.balanceDue).toBe(13202.02);
    expect(credited.balanceDue).toBe(12752.02);
    expect(blank.refund).toBe(0);
    expect(credited.refund).toBe(0);
  });

  it('requires QBI review when Box 1 is $250,000 and profit is $100,000', () => {
    const se = calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2026 }, 'single', 184500, 250000);
    expect(() => compute1040({
      ...base, scheduleCNetProfit: 100000, w2Wages: 250000, w2SocialSecurityWages: 184500, w2MedicareWages: 250000,
      w2MedicareWithheld: 4075, selfEmploymentTax: se.totalSETax, halfSEDeduction: se.halfSEDeduction,
    })).toThrow(QBIReviewRequiredError);
  });

  it('sums two W-2s and keeps the $900 wage portion when neither employer withheld the extra 0.9%', () => {
    // Each Box 5 is $150,000 and each Box 6 is $2,175, which is exactly 1.45%.
    // Line 19 = $4,350. Line 20 = $300,000. Line 21 = $4,350. Line 22 = $0.
    // Combined wages still exceed $200,000, so line 18 includes the $900 wage portion.
    const forms = [
      { box1Wages: 150000, box2FederalWithheld: 4000, box3SocialSecurityWages: 150000, box5MedicareWages: 150000, box6MedicareWithheld: 2175 },
      { box1Wages: 150000, box2FederalWithheld: 5000, box3SocialSecurityWages: 150000, box5MedicareWages: 150000, box6MedicareWithheld: 2175 },
    ];
    const summary = summarizeW2Income(forms);
    expect(summary).toMatchObject({ wages: 300000, federalWithheld: 9000, medicareWages: 300000, medicareWithheld: 4350 });
    const form = compute1040({
      ...base,
      w2Wages: summary.wages,
      w2SocialSecurityWages: summary.socialSecurityWages,
      w2MedicareWages: summary.medicareWages,
      w2MedicareWithheld: summary.medicareWithheld,
      w2FederalWithheld: summary.federalWithheld,
    });
    expect(form.additionalMedicareWithheld).toBe(0);
    expect(form.additionalMedicareTax).toBe(900);
    expect(form.w2FederalWithheld).toBe(9000);
    expect(form.totalPayments).toBe(9000);
  });

  it('treats missing or zero Box 6 as line 22 of zero', () => {
    const wages = { ...base, w2Wages: 0, w2MedicareWages: 250000, scheduleCNetProfit: 0 };
    expect(compute1040(wages).additionalMedicareWithheld).toBe(0);
    expect(compute1040({ ...wages, w2MedicareWithheld: 0 }).additionalMedicareWithheld).toBe(0);
    expect(summarizeW2Income([{ box1Wages: 10000, box5MedicareWages: 10000 }]).medicareWithheld).toBe(0);
    expect(summarizeW2Income([{ box1Wages: 10000, box5MedicareWages: 10000, box6MedicareWithheld: 0 }]).medicareWithheld).toBe(0);
    expect(compute1040({ ...wages, w2MedicareWages: undefined, w2MedicareWithheld: 4075 }).additionalMedicareWithheld).toBe(0);
  });

  it('passes imported Box 6 through the annual snapshot without adding it to Box 2', () => {
    const w2 = {
      box1Wages: 0, box2FederalWithheld: 0, box3SocialSecurityWages: 184500,
      box5MedicareWages: 250000, box6MedicareWithheld: 4075,
    };
    const input = {
      taxYear: 2026, profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(),
      transactions: [], grossReceipts: [{ amount: 100000 }], forms1099: [], deductions: {}, assets: [], estimatedPayments: 0,
    };
    expect(() => buildFederalTaxSnapshot({
      ...input, w2Entries: [{ ...w2, box1Wages: 250000 }],
    })).toThrow(QBIReviewRequiredError);
    const blank = buildFederalTaxSnapshot({ ...input, w2Entries: [{ ...w2, box6MedicareWithheld: 0 }] });
    const credited = buildFederalTaxSnapshot({ ...input, w2Entries: [w2] });
    expect(credited.result.additionalMedicareTax).toBe(1281.15);
    expect(blank.result.totalTax).toBe(13202.02);
    expect(credited.result.totalTax).toBe(13202.02);
    expect(credited.result.additionalMedicareWithheld).toBe(450);
    expect(credited.result.w2FederalWithheld).toBe(0);
    expect(credited.payments.w2FederalWithheld).toBe(0);
    expect(credited.payments.additionalMedicareWithheld).toBe(450);
    expect(credited.payments.totalFederalWithheld).toBe(450);
    expect(blank.payments.totalFederalWithheld).toBe(0);
    expect(blank.result.balanceDue).toBe(13202.02);
    expect(credited.result.balanceDue).toBe(12752.02);
  });
});
