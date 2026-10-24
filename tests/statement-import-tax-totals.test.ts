import { describe, expect, it, vi } from 'vitest';
import { aggregateScheduleC } from '@/lib/schedule-c/aggregate';
import { dashboardRecordStatus, summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import { summarizeRecordedCashFlow } from '@/lib/dashboard/cash-flow-summary';
import { assembleAuditSupportPacket, auditSupportPacketCSV, generateAuditSupportPDF } from '@/lib/reports/audit-support-packet';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { preparerMonthlySummary, generatePreparerReport } from '@/lib/reports/preparer-report';
import { HELD_OUT_REASON_TEXT, HELD_OUT_REVIEW_ARIA_LABEL, HELD_OUT_REVIEW_LINK_TEXT, summarizeHeldOutDuplicates } from '@/lib/transactions/held-out-duplicates';
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

    const businessLike = /software|subscription|internet|phone|office|design|advertising|professional|business/;
    const reviewable = rows.filter(row => isReviewableBusinessOutflow(row) && businessLike.test(String(row.category).toLowerCase()));
    expect(reviewable.map(row => row.amount)).toEqual([32.5]);
  });

  it('leaves a flagged legacy income credit out of gross receipts and reports the held out amount', () => {
    const flagged = { ...incomeCredit, amount: -25000, possibleDuplicate: true, possibleDuplicateReason: 'legacy_match' };
    expect(reconcileBusinessIncome(2026, [flagged], [], []).grossReceipts).toBe(0);
    expect(reconcileBusinessIncome(2026, [flagged], [], []).unclassifiedCreditCount).toBe(0);
    const result = snapshot([flagged]);
    expect(result.income.grossReceipts).toBe(0);
    expect(result.income.totalDeductible).toBe(0);
    expect(result.result.totalTax).toBe(baseline.result.totalTax);
    expect(result.heldOutDuplicates).toMatchObject({ count: 1, amount: 25000, credits: 25000, debits: 0, creditCount: 1, debitCount: 0, reviewHref: '/protected?screen=review-transactions' });
    expect(result.heldOutDuplicates.message).toContain('PLACEHOLDER');
    expect(result.heldOutDuplicates.message).toContain('$25,000.00');
    expect(result.heldOutDuplicates.message).toContain('review it');
    expect(result.heldOutDuplicates.message).not.toContain('review them');
    expect(result.heldOutDuplicates.message).not.toContain('legacy_match');
  });

  it('leaves a flagged bank linked debit out of confirmed expenses and reports the held out amount', () => {
    const confirmed = imported({
      amount: 40, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true, review_status: 'confirmed', date: '2026-06-15',
    });
    const flagged = { ...confirmed, trans_id: 'flagged-debit', possibleDuplicate: true, possibleDuplicateReason: 'bank_linked' };
    expect(aggregateScheduleC([confirmed, flagged] as never, '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(40);
    const result = buildFederalTaxSnapshot({
      taxYear: 2026, profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(),
      transactions: [confirmed, flagged], grossReceipts: [{ amount: 100000 }], forms1099: [], w2Entries: [], deductions: {}, assets: [], estimatedPayments: 0,
    });
    expect(result.income.totalDeductible).toBe(40);
    expect(result.income.grossReceipts).toBe(100000);
    expect(result.heldOutDuplicates).toMatchObject({ count: 1, amount: 40, credits: 0, debits: 40, creditCount: 0, debitCount: 1, reviewHref: '/protected?screen=review-transactions' });
    expect(result.heldOutDuplicates.message).toContain('PLACEHOLDER');
    expect(result.heldOutDuplicates.message).toContain('$40.00');
    expect(result.heldOutDuplicates.message).toContain('review it');
    expect(result.heldOutDuplicates.message).not.toContain('review them');
    expect(result.heldOutDuplicates.message).not.toContain('bank_linked');
  });

  it('puts the held out count and amount in the Schedule C CSV and PDF', async () => {
    const flaggedDebit = imported({
      trans_id: 'flagged-debit', amount: 40, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true,
      review_status: 'confirmed', date: '2026-06-15', possibleDuplicate: true, possibleDuplicateReason: 'bank_linked',
    });
    const flaggedCredit = { ...incomeCredit, amount: -25000, possibleDuplicate: true, possibleDuplicateReason: 'legacy_match' };
    const heldOut = summarizeHeldOutDuplicates([flaggedDebit, flaggedCredit], 2026);
    expect(heldOut).toMatchObject({ count: 2, amount: 25040, credits: 25000, debits: 40, creditCount: 1, debitCount: 1 });
    expect(heldOut.message).toContain('review them');
    const csv = generateScheduleCCSV([], 2026, heldOut);
    expect(csv).toContain('PLACEHOLDER');
    expect(csv).toContain('25000.00');
    expect(csv).toContain('40.00');
    expect(csv).not.toContain('25040.00');
    expect(csv).toContain('/protected?screen=review-transactions');
    const { PDFDocument, PDFPage } = await import('pdf-lib');
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const bytes = await generateScheduleCPlanningPDF({ taxYear: 2026, grossReceipts: 0, lineItems: [], includeAppendix: false, heldOutDuplicates: heldOut });
    const text = spy.mock.calls.map(call => String(call[0])).join('\n');
    expect(text).toContain('PLACEHOLDER');
    expect(text).toContain('$25,000.00');
    expect(text).toContain('$40.00');
    expect(text).not.toContain('$25,040.00');
    expect(text).toContain('/protected?screen=review-transactions');
    const subtotalAt = text.indexOf('28 subtotal');
    const worksheetAt = text.indexOf('Worksheet');
    expect(worksheetAt).toBeGreaterThan(subtotalAt);
    expect(text.slice(subtotalAt, worksheetAt)).not.toContain('Held out');
    expect(text.indexOf('Held out credits')).toBeGreaterThan(worksheetAt);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('includes an unflagged income credit in snapshot gross receipts', () => {
    const row = { ...incomeCredit, amount: -25000 };
    const result = snapshot([row]);
    expect(result.income.grossReceipts).toBe(25000);
    expect(result.heldOutDuplicates).toMatchObject({ count: 0, credits: 0, debits: 0, amount: 0 });
  });

  it('keeps the audit packet total equal to Schedule C and preparer inflow equal to gross receipts', async () => {
    const kept = imported({
      trans_id: 'kept-supplies', amount: 500, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
      is_deductible: true, review_status: 'confirmed', merchant_name: 'Kept supplies',
    });
    const flaggedExpense = {
      ...kept, trans_id: 'flagged-supplies', possibleDuplicate: true, possibleDuplicateReason: 'ambiguous_account', merchant_name: 'Flagged supplies',
    };
    const rows = [kept, flaggedExpense];
    const scheduleCTotal = aggregateScheduleC(rows as never, '2026', undefined, { mode: 'confirmed-only' }).totalDeductible;
    const packet = assembleAuditSupportPacket('synthetic-owner', 2026, { transactions: rows, trips: [], receipts: [] });
    expect(scheduleCTotal).toBe(500);
    expect(packet.summary.recordedAmount).toBe(scheduleCTotal);
    expect(packet.summary.deductionCount).toBe(1);
    expect(packet.deductions.map(record => record.merchant)).toEqual(['Kept supplies']);
    expect(packet.summary.heldOutDuplicates).toMatchObject({ count: 1, credits: 0, debits: 500 });
    const packetCsv = auditSupportPacketCSV(packet);
    expect(packetCsv).toContain('PLACEHOLDER');
    expect(packetCsv).toContain('500.00');
    expect(packetCsv).toContain('/protected?screen=review-transactions');
    expect(packetCsv).not.toContain('ambiguous_account');
    const { PDFPage } = await import('pdf-lib');
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    await generateAuditSupportPDF(packet);
    const packetText = spy.mock.calls.map(call => String(call[0])).join('\n');
    expect(packetText).toContain(packet.summary.heldOutDuplicates.message);
    expect(packetText).not.toContain('ambiguous_account');
    spy.mockRestore();

    const keptIncome = { ...incomeCredit, amount: -500, trans_id: 'kept-income' };
    const flaggedIncome = { ...keptIncome, trans_id: 'flagged-income', possibleDuplicate: true, possibleDuplicateReason: 'cross_document' };
    const gross = reconcileBusinessIncome(2026, [keptIncome, flaggedIncome], [], []).grossReceipts;
    const summary = preparerMonthlySummary([keptIncome, flaggedIncome], 2026);
    const inflow = summary.groups.get('USD')!.reduce((sum, row) => sum + row.inflow, 0) / 100;
    expect(gross).toBe(500);
    expect(inflow).toBe(gross);
    expect(summary.heldOutDuplicates).toMatchObject({ count: 1, credits: 500, debits: 0 });
    const reportSpy = vi.spyOn(PDFPage.prototype, 'drawText');
    await generatePreparerReport([keptIncome, flaggedIncome], 2026);
    const reportText = reportSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(reportText).toContain('Held out credits');
    expect(reportText).toContain('$500.00');
    expect(reportText).not.toContain('cross_document');
    reportSpy.mockRestore();
  });

  it('marks the review link, label, and reason as placeholders and hides stored reason codes', () => {
    for (const value of [HELD_OUT_REVIEW_LINK_TEXT, HELD_OUT_REVIEW_ARIA_LABEL, HELD_OUT_REASON_TEXT]) {
      expect(value.startsWith('PLACEHOLDER')).toBe(true);
      expect(value).not.toMatch(/legacy_match|bank_linked|statement_match|cross_document|ambiguous_account/);
    }
    expect(HELD_OUT_REASON_TEXT).not.toContain('review them');
  });
});
