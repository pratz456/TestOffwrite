import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';

const base: Form1040Input = {
  taxYear: 2026, filingStatus: 'single', scheduleCNetProfit: 20000, w2Wages: 0,
  w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 2826, halfSEDeduction: 1413,
  healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
  simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0, taxPayerAge: 40,
};

describe('statutory above-the-line limits in the federal planning estimate', () => {
  it('limits self-employed health insurance to business earned income after SE tax and retirement deductions', () => {
    const result = compute1040({ ...base, healthInsurancePremiums: 30000, sepIraContribution: 4000 });
    // 20,000 profit − 1,413 half SE − 4,000 SEP = 14,587 allowed; adjustments also include the SEP and half SE.
    expect(result.adjustments).toBe(1413 + 4000 + 14587);
    expect(result.agi).toBe(0);
    expect(result.calculationWarnings.join(' ')).toContain('health insurance deduction is limited');
    const within = compute1040({ ...base, healthInsurancePremiums: 5000 });
    expect(within.adjustments).toBe(1413 + 5000);
    expect(within.calculationWarnings.join(' ')).not.toContain('health insurance deduction is limited');
  });

  it('caps student loan interest at $2,500 and denies it when married filing separately', () => {
    const capped = compute1040({ ...base, studentLoanInterest: 4000 });
    expect(capped.adjustments).toBe(1413 + 2500);
    expect(capped.calculationWarnings.join(' ')).toContain('limited to $2,500');
    expect(capped.calculationWarnings.join(' ')).toContain('phases out');
    const separate = compute1040({ ...base, filingStatus: 'married_filing_separately', studentLoanInterest: 1000 });
    expect(separate.adjustments).toBe(1413);
    expect(separate.calculationWarnings.join(' ')).toContain('not deductible when married filing separately');
  });

  it('reports the effective rate on total federal tax, including self-employment tax', () => {
    const result = compute1040({ ...base, scheduleCNetProfit: 100000, selfEmploymentTax: 14130, halfSEDeduction: 7065 });
    expect(result.effectiveRate).toBeCloseTo((result.totalTax / result.totalIncome) * 100, 2);
    expect(result.effectiveRate).toBeGreaterThan((result.incomeTax / result.totalIncome) * 100);
  });
});
