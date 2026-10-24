import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregateScheduleC } from '@/lib/schedule-c/aggregate';
import { dashboardRecordStatus, summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import { summarizeRecordedCashFlow } from '@/lib/dashboard/cash-flow-summary';
import { assembleAuditSupportPacket } from '@/lib/reports/audit-support-packet';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { convertTransactionsToCSV } from '@/lib/reports/transaction-export';
import { isReviewableBusinessOutflow, summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';
import { buildQuarterlyPlan } from '@/lib/tax-provider/quarterly-planner';
import { sumExpensesForQuarter, sumIncomeForQuarter, sumPotentialExpensesForQuarter } from '@/lib/tax-provider/quarterly-estimates';
import { reconcileBusinessIncome } from '@/lib/tax-rules/business-income';
import { DependentCreditReviewRequiredError } from '@/lib/tax-rules/credit-scope';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { recordedTransactionType, reviewCategory } from '@/lib/transactions/ai-review-contract';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

/** Shape written by app/api/tax/import-bank-statement/route.ts before any review. */
function imported(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'statement-imports', userId: 'synthetic-owner', trans_id: 'row-1',
    merchant_name: 'Synthetic stationery', name: 'Synthetic stationery', amount: 32.5,
    iso_currency_code: 'USD', date: '2026-06-15', category: 'Office Supplies', transaction_type: 'debit',
    is_deductible: null, deduction_score: null, analyzed: false, analysis_status: 'pending', analysisStatus: 'pending',
    pending: false, ...overrides,
  };
}

const debit = imported();
const credit = imported({
  trans_id: 'row-2', merchant_name: 'Synthetic refund', name: 'Synthetic refund', amount: -40,
  date: '2026-06-16', category: 'Other', transaction_type: 'credit',
});
const incomeCredit = imported({
  trans_id: 'row-3', merchant_name: 'Synthetic deposit', name: 'Synthetic deposit', amount: -20000,
  date: '2026-06-20', category: 'Income', transaction_type: 'credit',
});

function snapshot(transactions: Record<string, unknown>[]) {
  return buildFederalTaxSnapshot({
    taxYear: 2026, profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(),
    transactions, grossReceipts: [], forms1099: [], w2Entries: [], deductions: {}, assets: [], estimatedPayments: 0,
  });
}

function quarterly(totalTax: number) {
  return buildQuarterlyPlan({
    taxYear: 2026, filingStatus: 'single', currentYearTax: totalTax, withholding: 0,
    priorYear: { available: false, reason: 'short_year_or_no_return' }, payments: [], asOf: '2026-09-01',
  });
}

describe('statement import rows before review', () => {
  const baseline = snapshot([]);

  it('keeps a null deductible debit out of Schedule C, the federal estimate, and the quarterly payment', () => {
    const result = snapshot([debit]);
    expect(aggregateScheduleC([debit as never], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
    expect(aggregateScheduleC([debit as never], '2026', undefined, { mode: 'default' }).totalDeductible).toBe(0);
    expect(reconcileBusinessIncome(2026, [debit], [], []).grossReceipts).toBe(0);
    expect(result.income).toMatchObject({ grossReceipts: 0, totalDeductible: 0, scheduleCNetProfit: 0, scheduleCLine31NetProfit: 0 });
    expect(result.result.totalTax).toBe(baseline.result.totalTax);
    expect(result.seCalc.totalSETax).toBe(baseline.seCalc.totalSETax);
    expect(quarterly(result.result.totalTax).requiredAnnualPayment.requiredAnnualPayment)
      .toBe(quarterly(baseline.result.totalTax).requiredAnnualPayment.requiredAnnualPayment);
    expect(sumExpensesForQuarter([debit as never], 2026, 2, 'UTC').confirmed_deductible_expenses).toBe(0);
    expect(sumPotentialExpensesForQuarter([debit as never], 2026, 2, 'UTC').potential_deductions_needing_review).toBe(0);
    expect(sumIncomeForQuarter([debit as never], 2026, 2, 'UTC').grossIncome).toBe(0);
  });

  it('keeps a null deductible credit with a non income category out of gross receipts and the quarterly estimate', () => {
    const rows = [debit, credit];
    const result = snapshot(rows);
    const income = reconcileBusinessIncome(2026, rows, [], []);
    expect(income.grossReceipts).toBe(0);
    expect(income.unclassifiedCreditCount).toBe(1);
    expect(reconcileBusinessIncome(2026, [{ ...credit, type: 'income' }], [], []).grossReceipts).toBe(0);
    expect(result.income.grossReceipts).toBe(0);
    expect(result.result.totalTax).toBe(baseline.result.totalTax);
    expect(result.seCalc.totalSETax).toBe(baseline.seCalc.totalSETax);
    expect(quarterly(result.result.totalTax).totals.requiredInstallments)
      .toBe(quarterly(baseline.result.totalTax).totals.requiredInstallments);
    expect(sumIncomeForQuarter([credit as never], 2026, 2, 'America/Los_Angeles').grossIncome).toBe(0);
    expect(aggregateScheduleC([credit as never], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });

  it('counts an unreviewed credit as gross receipts when its category is income or revenue, and that raises federal and self employment tax', () => {
    for (const category of ['income', 'Income', 'revenue', 'REVENUE']) {
      const row = { ...incomeCredit, category };
      const reconciled = reconcileBusinessIncome(2026, [row], [], []);
      expect(reconciled.grossReceipts).toBe(20000);
      expect(reconciled.unclassifiedCreditCount).toBe(0);
    }
    // $20,000 of Schedule C profit still has potential EITC: earned income after the
    // deductible half of self-employment tax stays under the 2026 zero-child phaseout
    // end ($19,540). The annual total is withheld. A larger credit clears that gate.
    expect(() => snapshot([incomeCredit])).toThrow(DependentCreditReviewRequiredError);
    const abovePhaseout = { ...incomeCredit, amount: -25000 };
    const result = snapshot([abovePhaseout]);
    expect(result.income.grossReceipts).toBe(25000);
    expect(result.income.totalDeductible).toBe(0);
    expect(result.income.scheduleCLine31NetProfit).toBe(25000);
    expect(result.result.totalTax).toBeGreaterThan(baseline.result.totalTax);
    expect(result.seCalc.totalSETax).toBeGreaterThan(baseline.seCalc.totalSETax);
    const plan = quarterly(result.result.totalTax);
    expect(plan.requiredAnnualPayment.requiredAnnualPayment).toBeGreaterThan(quarterly(baseline.result.totalTax).requiredAnnualPayment.requiredAnnualPayment);
    expect(plan.totals.requiredInstallments).toBeGreaterThan(0);
    expect(sumIncomeForQuarter([{ ...incomeCredit, category: 'income' } as never], 2026, 2, 'UTC').grossIncome).toBe(20000);
    expect(sumIncomeForQuarter([incomeCredit as never], 2026, 2, 'Asia/Tokyo').grossIncome).toBe(0);
  });

  it('does not treat a positive debit categorized as income as a receipt', () => {
    const row = imported({ amount: 20000, category: 'income', transaction_type: 'debit' });
    expect(() => reconcileBusinessIncome(2026, [row], [], [])).toThrow(/posted receipt/);
    expect(() => snapshot([row])).toThrow(/posted receipt/);
    expect(sumIncomeForQuarter([row as never], 2026, 2, 'UTC').grossIncome).toBe(0);
  });

  it('counts the same rows as cash movement and review work, not as confirmed deductions', () => {
    const rows = [debit, credit];
    expect(summarizeConfirmedDeductions(rows, 2026)).toMatchObject({ totalDeductible: 0, totalRecordedAmount: 0, reviewMessage: null });
    expect(buildMonthlySavings(rows, 2026, 0.22, new Date('2026-09-01T00:00:00Z')).summary.deductionBasis).toBe(0);
    expect(summarizeRecordedCashFlow(rows, 2026).months[5]).toMatchObject({ expenses: 32.5, income: 40 });
    expect(summarizeDashboardRecords(rows)).toMatchObject({ deductibleCount: 0, needsReviewCount: 2, categoryMagnitude: 0 });
    expect(dashboardRecordStatus(incomeCredit)).toBe('income');
    expect(summarizeDashboardRecords([incomeCredit]).categoryMagnitude).toBe(0);
    expect(isReviewableBusinessOutflow(debit)).toBe(true);
    expect(isReviewableBusinessOutflow(credit)).toBe(false);
    expect(recordedTransactionType(debit)).toBe('expense');
    expect(recordedTransactionType(credit)).toBeUndefined();
    expect(recordedTransactionType(incomeCredit)).toBe('income');
    expect(reviewCategory('Office Supplies')).toBeUndefined();
    expect(reviewCategory('SERVICE_SUBSCRIPTION')?.value).toBe('software_subscriptions');

    const scheduleC = generateScheduleCCSV(aggregateScheduleC([debit, credit] as never, '2026', undefined, { mode: 'confirmed-only' }).lineItemsArray, 2026);
    expect(scheduleC.split('\r\n')).toHaveLength(1);
    const listed = convertTransactionsToCSV(rows);
    expect(listed).toContain('Unreviewed');
    expect(listed).not.toContain('Confirmed contribution');
    const packet = assembleAuditSupportPacket('synthetic-owner', 2026, { transactions: rows, trips: [], receipts: [] });
    expect(packet.summary).toMatchObject({ deductionCount: 0, recordedAmount: 0 });

    const insights = readFileSync('components/ai-insights-page.tsx', 'utf8');
    expect(insights).toContain("isReviewableBusinessOutflow(t) && businessLike(t)");
    expect(insights).toContain('/software|subscription|internet|phone|office|design|advertising|professional|business/');
    const businessLike = /software|subscription|internet|phone|office|design|advertising|professional|business/;
    const reviewable = rows.filter(row => isReviewableBusinessOutflow(row) && businessLike.test(String(row.category).toLowerCase()));
    expect(reviewable.map(row => row.amount)).toEqual([32.5]);
  });
});
