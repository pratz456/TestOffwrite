import { describe, expect, it } from 'vitest';
import { summarizeConfirmedDeductions, isReviewableBusinessOutflow } from '@/lib/tax/display-deductions';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { compute1040 } from '@/lib/tax-rules/compute-1040';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { eligibilityOrganizer, healthFacts, retirementFacts, hsaFacts } from './fixtures/eligibility';
import { formatRecordedTransactionAmount } from '@/lib/transactions/amount-display';

const expense = (facts: Record<string, unknown> = {}) => ({
  id: 'one', date: '2026-12-31T23:59:00-08:00', amount: 100, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
  iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', ...facts,
});

describe('confirmed transaction amounts displayed to the owner', () => {
  it('labels review-card bank amounts with their recorded currency, including refunds and missing currency', () => {
    expect(formatRecordedTransactionAmount({ amount: -20, iso_currency_code: 'USD' })).toBe('$20.00');
    expect(formatRecordedTransactionAmount({ amount: 20, iso_currency_code: 'EUR' }).replace(/\s/g, ' ')).toBe('EUR 20.00');
    expect(formatRecordedTransactionAmount({ amount: 20 })).toBe('20.00 (currency unknown)');
    expect(formatRecordedTransactionAmount({ amount: 1, unofficial_currency_code: 'BTC' })).toBe('1.00 (BTC)');
    expect(formatRecordedTransactionAmount({ amount: NaN, iso_currency_code: 'USD' })).toBe('Amount needs review');
  });
  it('returns the adjustment amounts actually applied, including SIMPLE, after supported limits', () => {
    const result = compute1040({ taxYear: 2025, filingStatus: 'single', scheduleCNetProfit: 100000, w2Wages: 0,
      selfEmploymentTax: 14000, halfSEDeduction: 7000, healthInsurancePremiums: 100000,
      w2FederalWithheld: 0, estimatedPayments: 0, sepIraContribution: 0, solo401kContribution: 0,
      simpleIraContribution: 6000, hsaContribution: 4300, studentLoanInterest: 9000,
      personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2025, {}, eligibilityOrganizer({ taxYear: 2025, hsa: hsaFacts(),
        retirement: retirementFacts({ plan: 'simple_ira', simpleMethod: 'match3', employeeContribution: '3229.50', employerContribution: '2770.50' }),
        health: healthFacts({ months: Array.from({ length: 12 }, (_, index) => ({ premiums: index === 11 ? '8333.37' : '8333.33', employerAccess: 'no' })) }) })) });
    expect(result.appliedAdjustments).toEqual({ halfSEDeduction: 7000, healthInsuranceDeduction: 87000,
      retirementContributions: 6000, hsaDeduction: 4300, studentLoanInterestDeduction: 2500 });
    expect(Object.values(result.appliedAdjustments).reduce((sum, amount) => sum + amount, 0)).toBe(result.adjustments);
  });
  it('reconciles signed meal cents and refunds with the Schedule C aggregate and CSV', () => {
    const records = [expense(), expense({ id: 'refund', amount: -20 }),
      expense({ id: 'meal', category: 'FOOD_AND_DRINK_RESTAURANT', amount: 10.01 }),
      expense({ id: 'meal-refund', category: 'FOOD_AND_DRINK_RESTAURANT', amount: -1.01 })];
    const summary = summarizeConfirmedDeductions(records, 2026);
    const exported = aggregateScheduleC(records, '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(summary.totalRecordedAmount).toBe(89);
    expect(summary.totalDeductible).toBe(84.5);
    expect(summary.totalDeductible).toBeCloseTo(exported.totalDeductible, 8);
    expect([...summary.contributions.values()]).toEqual([100, -20, 5.01, -0.51]);
    const csv = generateScheduleCCSV(exported.lineItemsArray, 2026);
    expect(csv).toContain(',24b,10.01,5.01,'); expect(csv).toContain(',24b,-1.01,-0.51,');
  });

  it('counts only the selected calendar year and server-confirmed posted records', () => {
    const records = [expense(), expense({ id: 'next', date: '2027-01-01' }), expense({ id: 'pending', pending: true }),
      expense({ id: 'removed', bank_removed: true }), expense({ id: 'copy', superseded_by: 'old/path' }),
      expense({ id: 'review', tax_review_required: true }), expense({ id: 'ai', review_status: 'pending_review' }),
      expense({ id: 'method', category: 'VEHICLE_REVIEW_REQUIRED' })];
    expect(summarizeConfirmedDeductions(records, 2026).totalDeductible).toBe(100);
    expect(summarizeConfirmedDeductions(records, 2027).totalDeductible).toBe(100);
    expect(summarizeConfirmedDeductions(records).totalDeductible).toBe(200);
  });

  it.each([{ amount: NaN }, { amount: Infinity }, { amount: '100' }, { date: '2026-02-30' },
    { iso_currency_code: undefined }, { iso_currency_code: 'EUR' }, { unofficial_currency_code: 'BTC' },
    { business_percent: 50 }, { business_use_percent: 0 }, { businessUsePercent: 99 },
    { equipment_details: { business_use_percentage: 50 } }, { deduction_override: 0 }, { deductible_amount: 50 }])
  ('blocks an ambiguous deduction instead of displaying a plausible full amount: %j', facts => {
    const summary = summarizeConfirmedDeductions([expense(facts)]);
    expect(summary.reviewMessage).toBeTruthy();
    expect(summary.totalDeductible).toBeNull(); expect(summary.totalRecordedAmount).toBeNull();
    expect(summary.contributions.size).toBe(0);
  });

  it('blocks duplicate identifiers and permits an explicitly full business allocation', () => {
    expect(summarizeConfirmedDeductions([expense(), expense()]).totalDeductible).toBeNull();
    expect(summarizeConfirmedDeductions([expense({ businessUsePercent: 100 })]).totalDeductible).toBe(100);
  });

  it('finds reviewable outflows without treating inflows, confirmations or personal decisions as opportunities', () => {
    const unreviewed = expense({ is_deductible: null, review_status: 'pending_review' });
    expect(isReviewableBusinessOutflow(unreviewed)).toBe(true);
    for (const facts of [{ amount: -100 }, { pending: true }, { bank_removed: true }, { superseded_by: 'old/path' },
      { is_deductible: false }, { iso_currency_code: 'EUR' }, { date: 'bad' }, { amount: Infinity }]) {
      expect(isReviewableBusinessOutflow({ ...unreviewed, ...facts })).toBe(false);
    }
    expect(isReviewableBusinessOutflow(expense())).toBe(false);
    expect(isReviewableBusinessOutflow(expense({ date: '2026-01-01', review_status: undefined }))).toBe(false);
  });
});
