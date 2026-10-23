import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { reconcileBusinessIncome, listIncomeSourceCandidates, IncomeReconciliationRequiredError } from '../lib/tax-rules/business-income';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { aggregateScheduleC } from '../lib/schedule-c/aggregate';
import { generateScheduleCPlanningPDF } from '../lib/reports/schedule-c-pdf';
import {
  normalizeReconciliationDecision, resolveIncomeSources, samePaymentsAllowed, sourceKey, validateReconciliationDecision, type IncomeReconciliationDecision,
} from '../lib/tax-rules/income-reconciliation';
import {
  CORRECTED_ORIGINAL_BADGE, ERR_CORRECTED_NEEDS_TWO_NEC, ERR_CORRECTED_PICK, ERR_CORRECTED_SAME_PAYER, ERR_CORRECTED_SUM,
  ERR_NOT_BUSINESS_NEEDS_ONE_K, ERR_PARTS_EXCEED_GROSS, ERR_REASON_REQUIRED, ERR_SELECT_BUSINESS_RECORDS, NO_FORM_NO_INCOME, OUTSIDE_SC_NOTE,
  ERR_SAME_NEEDS_K, LEGACY_NEC_CHANGE_NOTICE, LEGACY_NEC_PRIOR_YEAR_NOTE, LEGACY_NEC_REOPEN_REASON, LEGACY_NEC_WARNING, PANEL_FORMS_NOTE, fillIncomeCopy,
} from '../lib/tax-rules/income-reconciliation-copy';
import * as incomeCopy from '../lib/tax-rules/income-reconciliation-copy';
import { summarizeIncomeReconciliation } from '../lib/tax-rules/income-reconciliation-response';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const deposit = (id: string, amount: number, date = '2026-02-01') => ({ id, trans_id: id, account_id: 'bank-1', amount: -amount, category: 'income', type: 'income', date, merchant_name: 'Synthetic platform payout' });
const receipt = (id: string, amount: number, source = 'Synthetic platform') => ({ id, amount, type: 'platform_income', source, date: '2026-01-31' });
const form = (id: string, amount: number, formType: '1099-K' | '1099-NEC' = '1099-K', payerName = 'Synthetic platform') => ({ id, amount, formType, payerName });
const ref = (kind: 'form_1099' | 'gross_receipt' | 'transaction', id: string, amount: number) => ({ kind, id, amount });
const decision = (id: string, type: IncomeReconciliationDecision['decision'], sources: IncomeReconciliationDecision['sources'], extra: Record<string, unknown> = {}) =>
  ({ id, taxYear: 2026, decision: type, sources, platformFeeAmount: null, ...extra });
const blocked = (run: () => unknown) => {
  try { run(); } catch (error) { if (error instanceof IncomeReconciliationRequiredError) return error; throw error; }
  throw new Error('expected INCOME_RECONCILIATION_REQUIRED');
};

describe('owner-recorded reconciliation decisions count each payment stream once', () => {
  it('counts a 1099-K and the direct income it reports once, without changing either record', () => {
    const receipts = [receipt('r1', 12000)], forms = [form('k1', 12000)];
    const before = JSON.stringify([receipts, forms]);
    expect(() => reconcileBusinessIncome(2026, [], receipts, forms)).toThrow(IncomeReconciliationRequiredError);
    const result = reconcileBusinessIncome(2026, [], receipts, forms, [decision('d1', 'same_payments', [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)])]);
    expect(result).toMatchObject({ grossReceipts: 12000, source: 'reconciled', reconciledDecisionCount: 1, feeExpenseCandidates: [] });
    expect(JSON.stringify([receipts, forms])).toBe(before);
  });
  it('lets a 1099-NEC correspond to several bank deposits that total the form', () => {
    const transactions = [deposit('t1', 4000), deposit('t2', 3500.25), deposit('t3', 2499.75)];
    const result = reconcileBusinessIncome(2026, transactions, [], [form('n1', 10000, '1099-NEC', 'Synthetic client')],
      [decision('d1', 'same_payments', [ref('form_1099', 'n1', 10000), ...transactions.map(tx => ref('transaction', tx.id, -tx.amount))])]);
    expect(result.grossReceipts).toBe(10000);
  });
  it('adds sources declared separate on top of the remaining unambiguous records', () => {
    const forms = [form('n1', 10000, '1099-NEC', 'Client A'), form('n2', 2500, '1099-NEC', 'Client B')];
    expect(() => reconcileBusinessIncome(2026, [], [], forms)).toThrow(IncomeReconciliationRequiredError);
    // With several 1099s in a year, every 1099 needs its own decision.
    const partial = blocked(() => reconcileBusinessIncome(2026, [], [], forms, [decision('d1', 'separate_income', [ref('form_1099', 'n2', 2500)])]));
    expect(partial.conflicts).toEqual([expect.objectContaining({ reason: 'multiple_forms', sources: [expect.objectContaining({ id: 'n1' })] })]);
    expect(reconcileBusinessIncome(2026, [], [], forms, [decision('d1', 'separate_income', [ref('form_1099', 'n2', 2500)]), decision('d2', 'separate_income', [ref('form_1099', 'n1', 10000)])]).grossReceipts).toBe(12500);
    expect(reconcileBusinessIncome(2026, [], [receipt('r1', 5000, 'Cash client')], [forms[0]], [decision('d1', 'separate_income', [ref('form_1099', 'n1', 10000)])]).grossReceipts).toBe(15000);
  });
  it('uses the 1099-K gross when fees were deducted before deposit and flags the fee for review only', () => {
    const transactions = [deposit('t1', 6000), deposit('t2', 4000)];
    const decisions = [decision('fee', 'k_includes_fees', [ref('form_1099', 'k1', 10500), ref('transaction', 't1', 6000), ref('transaction', 't2', 4000)], { platformFeeAmount: 500 })];
    const result = reconcileBusinessIncome(2026, transactions, [], [form('k1', 10500)], decisions);
    expect(result.grossReceipts).toBe(10500);
    expect(result.feeExpenseCandidates).toEqual([{ decisionId: 'fee', formId: 'k1', label: '1099-K · Synthetic platform', amount: 500 }]);
    expect(result.warnings.some(warning => warning.includes('expense candidate') && warning.includes('not recorded as a deductible expense'))).toBe(true);
    const snapshot = buildFederalTaxSnapshot({ taxYear: 2026, transactions, grossReceipts: [], forms1099: [form('k1', 10500)], reconciliationDecisions: decisions,
      w2Entries: [{ wages: 100000, federalWithheld: 0, socialSecurityWages: 100000, medicareWages: 100000 }],
      profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(), deductions: {}, assets: [], estimatedPayments: 0 });
    expect(snapshot.income).toMatchObject({ grossReceipts: 10500, totalDeductible: 0, scheduleCNetProfit: 10500 });
    expect(snapshot.result.calculationWarnings.some(warning => warning.includes('$500.00'))).toBe(true);
  });
  it('keeps the server-created import link and lets the owner reconcile that receipt with its deposit', () => {
    const receipts = [receipt('r1', 100000)], forms = [{ formType: '1099-K', amount: 100000, source: 'document_import', grossReceiptId: 'r1', id: 'imported', payer: 'Synthetic platform' }];
    const transactions = [deposit('t1', 100000)];
    expect(() => reconcileBusinessIncome(2026, transactions, receipts, forms)).toThrow(IncomeReconciliationRequiredError);
    const result = reconcileBusinessIncome(2026, transactions, receipts, forms, [decision('d1', 'same_payments', [ref('gross_receipt', 'r1', 100000), ref('transaction', 't1', 100000)])]);
    expect(result).toMatchObject({ grossReceipts: 100000, linkedDocumentCount: 1, reconciledDecisionCount: 1 });
    const error = blocked(() => reconcileBusinessIncome(2026, [], receipts, forms, [decision('d1', 'separate_income', [ref('form_1099', 'imported', 100000)])]));
    expect(error.conflicts[0]).toMatchObject({ reason: 'stale_decision', decisionId: 'd1' });
    expect(error.message).toContain('already linked');
  });
});

describe('unreconciled overlaps still block, with conflicts named by reference', () => {
  it('returns the existing 422 with every overlapping record listed by kind, id, label and amount', () => {
    const error = blocked(() => reconcileBusinessIncome(2026, [deposit('t1', 100)], [receipt('r1', 100)], [form('k1', 100)]));
    expect(error.code).toBe('INCOME_RECONCILIATION_REQUIRED');
    expect(error.message).toContain('Review income sources before calculating tax');
    expect(error.message).toContain('never merges or deletes records automatically');
    expect(error.conflicts.map(conflict => conflict.reason)).toEqual(['overlapping_sources']);
    expect(error.conflicts[0].sources).toEqual([
      { kind: 'transaction', id: 't1', amount: 100, label: 'Bank income · Synthetic platform payout' },
      { kind: 'gross_receipt', id: 'r1', amount: 100, label: 'Direct income · Synthetic platform' },
      { kind: 'form_1099', id: 'k1', amount: 100, label: '1099-K · Synthetic platform' },
    ]);
    expect(JSON.stringify(error.conflicts)).not.toContain('bank-1');
  });
  it('blocks a deposit left outside a decision that has no bank record, instead of counting it again', () => {
    const decisions = [decision('d1', 'same_payments', [ref('form_1099', 'k1', 500), ref('gross_receipt', 'r1', 500)])];
    const error = blocked(() => reconcileBusinessIncome(2026, [deposit('t1', 500)], [receipt('r1', 500)], [form('k1', 500)], decisions));
    expect(error.conflicts).toEqual([expect.objectContaining({ reason: 'unreconciled_against_decision', decisionId: 'd1', sources: [expect.objectContaining({ id: 't1' })] })]);
    expect(error.message).toContain('Add those records to that decision or mark them as separate income');
    expect(reconcileBusinessIncome(2026, [deposit('t1', 500)], [receipt('r1', 500)], [form('k1', 500)],
      [...decisions, decision('d2', 'separate_income', [ref('transaction', 't1', 500)])]).grossReceipts).toBe(1000);
    expect(reconcileBusinessIncome(2026, [deposit('t1', 500)], [receipt('r1', 500)], [form('k1', 500)],
      [decision('d1', 'same_payments', [ref('form_1099', 'k1', 500), ref('gross_receipt', 'r1', 500), ref('transaction', 't1', 500)])]).grossReceipts).toBe(500);
  });
  it('still requires a decision for a second unreconciled 1099 and for a receipt beside a reconciled deposit', () => {
    const decisions = [decision('d1', 'same_payments', [ref('form_1099', 'k1', 500), ref('transaction', 't1', 500)])];
    const secondForm = blocked(() => reconcileBusinessIncome(2026, [deposit('t1', 500)], [], [form('k1', 500), form('n1', 500, '1099-NEC')], decisions));
    expect(secondForm.conflicts).toEqual([expect.objectContaining({ reason: 'multiple_forms', sources: [expect.objectContaining({ id: 'n1', amount: 500 })] })]);
    expect(reconcileBusinessIncome(2026, [deposit('t1', 500)], [], [form('k1', 500), form('n1', 500, '1099-NEC')], decisions.concat(decision('d2', 'separate_income', [ref('form_1099', 'n1', 500)]))).grossReceipts).toBe(1000);
    expect(blocked(() => reconcileBusinessIncome(2026, [deposit('t1', 500)], [receipt('r1', 200)], [form('k1', 500)], decisions)).conflicts[0].reason).toBe('unreconciled_against_decision');
    expect(reconcileBusinessIncome(2026, [deposit('t1', 500)], [receipt('r1', 200)], [form('k1', 500)], decisions.concat(decision('d2', 'separate_income', [ref('gross_receipt', 'r1', 200)]))).grossReceipts).toBe(700);
  });
  it('never applies a decision from another tax year, a malformed record, or a record whose amount changed', () => {
    const inputs = [[deposit('t1', 100)], [receipt('r1', 100)], [form('k1', 100)]] as const;
    const valid = decision('d1', 'same_payments', [ref('form_1099', 'k1', 100), ref('gross_receipt', 'r1', 100), ref('transaction', 't1', 100)]);
    expect(reconcileBusinessIncome(2026, ...inputs, [valid]).grossReceipts).toBe(100);
    for (const [stale, detail] of [
      [{ ...valid, taxYear: 2025 }, 'another tax year'],
      [{ ...valid, decision: 'merge_everything' }, 'malformed'],
      [{ ...valid, sources: [{ kind: 'form_1099', id: 'k1', amount: 'all' }] }, 'malformed'],
      [{ ...valid, sources: [ref('form_1099', 'k1', 99), ref('gross_receipt', 'r1', 100), ref('transaction', 't1', 100)] }, 'is $100.00 in your records, not the $99.00'],
      [{ ...valid, sources: [ref('form_1099', 'k1', 100), ref('gross_receipt', 'deleted', 100), ref('transaction', 't1', 100)] }, 'no longer exists'],
    ] as const) {
      const error = blocked(() => reconcileBusinessIncome(2026, ...inputs, [stale]));
      expect(error.conflicts[0]).toMatchObject({ reason: 'stale_decision', decisionId: 'd1' });
      expect(error.message).toContain(detail);
    }
  });
  it('rejects a second decision that claims an already reconciled record', () => {
    const first = decision('d1', 'same_payments', [ref('form_1099', 'k1', 100), ref('gross_receipt', 'r1', 100)]);
    const second = decision('d2', 'separate_income', [ref('gross_receipt', 'r1', 100)]);
    const error = blocked(() => reconcileBusinessIncome(2026, [], [receipt('r1', 100)], [form('k1', 100)], [first, second]));
    expect(error.conflicts).toEqual([expect.objectContaining({ reason: 'stale_decision', decisionId: 'd2' })]);
    expect(error.message).toContain('already reconciled in another saved decision');
  });
  it('preserves the unsupported-record gates ahead of any decision', () => {
    expect(() => reconcileBusinessIncome(2026, [], [{ id: 'r1', amount: 500, type: 'rental' }], [], [decision('d1', 'separate_income', [ref('gross_receipt', 'r1', 500)])])).toThrow('Rental or investment income');
    expect(() => reconcileBusinessIncome(2026, [], [], [{ id: 'i1', formType: '1099-INT', amount: 500 }], [decision('d1', 'separate_income', [ref('form_1099', 'i1', 500)])])).toThrow('Confirm the tax treatment');
  });
});

describe('decision validation against current records', () => {
  const candidates = () => {
    const { candidates } = listIncomeSourceCandidates(2026, [deposit('t1', 9500), deposit('t2', 250)], [receipt('r1', 10000)], [form('k1', 10000), form('n1', 3000, '1099-NEC', 'Client')]);
    return new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
  };
  const check = (type: IncomeReconciliationDecision['decision'], sources: IncomeReconciliationDecision['sources'], fee = 0) =>
    validateReconciliationDecision({ id: 'new', taxYear: 2026, decision: type, sources, platformFeeAmount: fee }, candidates());
  it('explains mismatched totals and points a short 1099-K at the fee decision', () => {
    const result = check('same_payments', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 9500)]);
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain('1099-K · Synthetic platform $10,000.00; bank income $9,500.00');
    expect((result as { reason: string }).reason).toContain('1099-K includes fees');
  });
  it('accepts matching totals, including several deposits and a gross direct-income record beside net deposits', () => {
    expect(check('same_payments', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000)])).toMatchObject({ ok: true, countedCents: 1000000, feeCents: 0 });
    expect(check('k_includes_fees', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000), ref('transaction', 't1', 9500)], 500)).toMatchObject({ ok: true, countedCents: 1000000, feeCents: 50000 });
  });
  it.each([
    ['same_payments', [ref('form_1099', 'k1', 10000)], 0, 'at least two records'],
    ['same_payments', [ref('transaction', 't1', 9500), ref('transaction', 't2', 250)], 0, 'at least two kinds'],
    ['same_payments', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000)], 25, '1099-K includes fees'],
    ['k_includes_fees', [ref('form_1099', 'n1', 3000), ref('transaction', 't2', 250)], 2750, 'exactly one 1099-K'],
    ['k_includes_fees', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 9500)], 0, 'more than $0'],
    ['k_includes_fees', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 9500)], 10000, 'less than the 1099-K gross'],
    ['k_includes_fees', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 9500)], 400, 'neither the 1099-K gross'],
    ['k_includes_fees', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000)], 500, 'choose “same payments” instead'],
    ['same_payments', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000), ref('gross_receipt', 'r1', 10000)], 0, 'listed twice'],
    ['separate_income', [ref('gross_receipt', 'r1', 9999)], 0, 'is $10,000.00 in your records, not the $9,999.00'],
    ['separate_income', [ref('gross_receipt', 'missing', 10000)], 0, 'no longer exists'],
  ] as const)('rejects %s with %j (fee %s): %s', (type, sources, fee, reason) => {
    const result = check(type, [...sources], fee);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(reason);
  });
  it('lets two information returns that report the same payments count once, but not two deposits', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [], [], [form('k1', 10000), form('n1', 10000, '1099-NEC')]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    expect(validateReconciliationDecision({ id: 'new', taxYear: 2026, decision: 'same_payments', platformFeeAmount: 0, sources: [ref('form_1099', 'k1', 10000), ref('form_1099', 'n1', 10000)] }, byKey)).toMatchObject({ ok: true, countedCents: 1000000 });
  });
  it('normalizes saved records conservatively', () => {
    expect(normalizeReconciliationDecision({ id: 'd', taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k', 1)], platformFeeAmount: null, note: '' })).toEqual({ id: 'd', taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k', 1)], platformFeeAmount: 0, notBusinessParts: [] });
    expect(normalizeReconciliationDecision({ id: 'd', taxYear: 2026, decision: 'same_payments', sources: [] })).toBeNull();
    expect(normalizeReconciliationDecision({ id: 'd', taxYear: '2026', decision: 'same_payments', sources: [ref('form_1099', 'k', 1)] })).toBeNull();
    expect(normalizeReconciliationDecision({ id: 'd', taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k', 1)], platformFeeAmount: -5 })).toBeNull();
  });
  it('reports the remaining unclaimed totals by kind without applying stale decisions', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [deposit('t1', 100)], [receipt('r1', 250)], []);
    const resolution = resolveIncomeSources(2026, candidates, [decision('d1', 'separate_income', [ref('gross_receipt', 'r1', 999)])]);
    expect(resolution.appliedDecisionIds).toEqual([]);
    expect(resolution.unclaimedCents).toEqual({ form_1099: 0, gross_receipt: 25000, transaction: 10000 });
    expect(resolution.conflicts.map(conflict => conflict.reason)).toEqual(['stale_decision', 'overlapping_sources']);
  });
});

const notBusiness = (
  id: string,
  sources: IncomeReconciliationDecision['sources'],
  parts: IncomeReconciliationDecision['notBusinessParts'],
  fee = 0,
) => decision(id, 'k_not_business_income', sources, { platformFeeAmount: fee, notBusinessParts: parts });

async function pdfText(data: { grossReceipts: number; returnsAndAllowances: number; netReceipts: number }) {
  const spy = vi.spyOn(PDFPage.prototype, 'drawText');
  await generateScheduleCPlanningPDF({ taxYear: 2026, ...data, lineItems: [], includeAppendix: false });
  const calls = spy.mock.calls.map(call => String(call[0]));
  spy.mockRestore();
  return calls;
}

describe('1099-K amounts that are not business income', () => {
  const refunds = (amount: number) => [{ reason: 'refunds_credits' as const, amount }];
  const personal = (amount: number) => [{ reason: 'personal' as const, amount }];

  it('R-11 puts refunds on line 2 and fees in the review list, and profit uses line 3', () => {
    const transactions = [deposit('t1', 5000), deposit('t2', 4200)];
    const forms = [form('k1', 10000)];
    const saved = [notBusiness('d1', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 5000), ref('transaction', 't2', 4200)], refunds(500), 300)];
    const result = reconcileBusinessIncome(2026, transactions, [], forms, saved);
    expect(result).toMatchObject({
      grossReceipts: 10000, returnsAndAllowances: 500, netReceipts: 9500, outsideScheduleC: [],
      feeExpenseCandidates: [expect.objectContaining({ amount: 300, formId: 'k1' })],
    });
    const snapshot = buildFederalTaxSnapshot({
      taxYear: 2026, transactions, grossReceipts: [], forms1099: forms, reconciliationDecisions: saved,
      w2Entries: [{ wages: 100000, federalWithheld: 0, socialSecurityWages: 100000, medicareWages: 100000 }],
      profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(),
      deductions: {}, assets: [], estimatedPayments: 0,
    });
    expect(snapshot.scheduleC.profitBeforeAssets).toBe(9500);
    expect(snapshot.income.grossReceipts).toBe(10000);
    expect(snapshot.income.netReceipts).toBe(9500);
    expect(snapshot.income.scheduleCNetProfit).toBe(9500);
  });

  it('R-12 and R-13 keep personal off every Schedule C line, including the PDF', async () => {
    const transactions = [deposit('t1', 2200)];
    const forms = [form('k1', 3000)];
    const saved = [notBusiness('d1', [ref('form_1099', 'k1', 3000), ref('transaction', 't1', 2200)], personal(800))];
    const before = JSON.stringify([transactions, forms]);
    const result = reconcileBusinessIncome(2026, transactions, [], forms, saved);
    expect(result).toMatchObject({ grossReceipts: 2200, returnsAndAllowances: 0, netReceipts: 2200 });
    expect(result.outsideScheduleC).toEqual([expect.objectContaining({ amount: 800, status: 'needs_review', formId: 'k1' })]);
    expect(result.warnings.filter(warning => warning.includes(OUTSIDE_SC_NOTE))).toHaveLength(1);
    expect(JSON.stringify([transactions, forms])).toBe(before);
    const drawn = await pdfText(result);
    expect(drawn).not.toContain('$800.00');
  });

  it('R-14 does not put a personal amount on any expense line', () => {
    const expense = { id: 'e1', amount: 40, date: '2026-03-01', category: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', is_deductible: true, review_status: 'confirmed' };
    const transactions = [deposit('t1', 2200), expense];
    const forms = [form('k1', 3000)];
    const saved = [notBusiness('d1', [ref('form_1099', 'k1', 3000), ref('transaction', 't1', 2200)], personal(800))];
    const withoutDecision = aggregateScheduleC([expense], '2026');
    const withDecision = aggregateScheduleC([expense], '2026');
    expect(withDecision).toEqual(withoutDecision);
    expect(withDecision.lineItemsArray.some(row => row.total === 800 || row.deductible === 800)).toBe(false);
    const income = reconcileBusinessIncome(2026, transactions, [], forms, saved);
    expect(income.outsideScheduleC[0].amount).toBe(800);
    expect(income.returnsAndAllowances).toBe(0);
  });

  it('R-15 allows a whole 1099-K to be personal when nothing else is selected', () => {
    const forms = [form('k1', 1500)];
    const result = reconcileBusinessIncome(2026, [], [], forms, [notBusiness('d1', [ref('form_1099', 'k1', 1500)], personal(1500))]);
    expect(result).toMatchObject({ grossReceipts: 0, returnsAndAllowances: 0, netReceipts: 0 });
    expect(result.outsideScheduleC).toEqual([expect.objectContaining({ amount: 1500, status: 'needs_review' })]);
  });

  it('R-16 keeps refunds on line 2 and personal outside Schedule C in one decision', () => {
    const receipts = [receipt('r1', 5000)];
    const forms = [form('k1', 6000)];
    const before = JSON.stringify([receipts, forms]);
    const result = reconcileBusinessIncome(2026, [], receipts, forms, [notBusiness('d1', [ref('form_1099', 'k1', 6000), ref('gross_receipt', 'r1', 5000)], [
      { reason: 'refunds_credits', amount: 400 }, { reason: 'personal', amount: 600 },
    ])]);
    expect(result).toMatchObject({ grossReceipts: 5400, returnsAndAllowances: 400, netReceipts: 5000 });
    expect(result.outsideScheduleC).toEqual([expect.objectContaining({ amount: 600 })]);
    expect(JSON.stringify([receipts, forms])).toBe(before);
  });

  it('R-17 rejects a sum that does not reach the 1099-K gross', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [deposit('t1', 5000), deposit('t2', 4200)], [], [form('k1', 10000)]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const result = validateReconciliationDecision(notBusiness('d1', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 5000), ref('transaction', 't2', 4200)], refunds(500)), byKey);
    expect(result.ok).toBe(false);
    const reason = (result as { reason: string }).reason;
    expect(reason.startsWith("The parts don't add up to the 1099-K gross of $10,000.00")).toBe(true);
    expect(reason).toContain('bank income $9,200.00');
    expect(reason).toContain('= $9,700.00');
  });

  it('R-18 rejects parts that exceed the 1099-K gross', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [], [], [form('k1', 1000)]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const result = validateReconciliationDecision(notBusiness('d1', [ref('form_1099', 'k1', 1000)], [
      { reason: 'refunds_credits', amount: 700 }, { reason: 'personal', amount: 400 },
    ]), byKey);
    expect(result).toEqual({ ok: false, reason: fillIncomeCopy(ERR_PARTS_EXCEED_GROSS, { parts: '$1,100.00', gross: '$1,000.00' }) });
  });

  it('R-19 rejects a not-business decision with no reason', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [deposit('t1', 1000)], [], [form('k1', 1000)]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const result = validateReconciliationDecision(notBusiness('d1', [ref('form_1099', 'k1', 1000), ref('transaction', 't1', 1000)], []), byKey);
    expect(result).toEqual({ ok: false, reason: ERR_REASON_REQUIRED });
  });

  it('R-21 requires the deposits or direct income for a remaining business part', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [], [], [form('k1', 2000)]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const result = validateReconciliationDecision(notBusiness('d1', [ref('form_1099', 'k1', 2000)], refunds(200)), byKey);
    expect(result).toEqual({ ok: false, reason: fillIncomeCopy(ERR_SELECT_BUSINESS_RECORDS, { business: '$1,800.00' }) });
  });

  it('R-22 rejects the not-business decision on a 1099-NEC', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [deposit('t1', 2500)], [], [form('n1', 3000, '1099-NEC')]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const result = validateReconciliationDecision(notBusiness('d1', [ref('form_1099', 'n1', 3000), ref('transaction', 't1', 2500)], personal(500)), byKey);
    expect(result).toEqual({ ok: false, reason: ERR_NOT_BUSINESS_NEEDS_ONE_K });
  });

  it('R-23 rejects refund or personal parts on any other decision', () => {
    const { candidates } = listIncomeSourceCandidates(2026, [], [receipt('r1', 10000)], [form('k1', 10000)]);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const result = validateReconciliationDecision(decision('d1', 'same_payments', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000)], {
      notBusinessParts: refunds(100),
    }), byKey);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('Refund and personal amounts can only be recorded');
  });

  it('R-25 prints Schedule C lines 1, 2 and 3 and uses line 3 on the worksheet', async () => {
    const result = reconcileBusinessIncome(2026, [deposit('t1', 5000), deposit('t2', 4200)], [], [form('k1', 10000)], [
      notBusiness('d1', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 5000), ref('transaction', 't2', 4200)], refunds(500), 300),
    ]);
    const drawn = await pdfText(result);
    expect(drawn).toEqual(expect.arrayContaining(['$10,000.00', '$500.00', '$9,500.00']));
    const worksheet = drawn.indexOf('Worksheet');
    expect(drawn.slice(worksheet, worksheet + 4)).toContain('$9,500.00');
  });

  it('R-39 lets one 1099-K with no other records take the not-business decision', () => {
    const forms = [form('k1', 900)];
    expect(() => reconcileBusinessIncome(2026, [], [], forms)).not.toThrow();
    const open = reconcileBusinessIncome(2026, [], [], forms);
    expect(open.grossReceipts).toBe(900);
    const saved = reconcileBusinessIncome(2026, [], [], forms, [notBusiness('d1', [ref('form_1099', 'k1', 900)], personal(900))]);
    expect(saved).toMatchObject({ grossReceipts: 0, netReceipts: 0 });
    expect(saved.outsideScheduleC).toEqual([expect.objectContaining({ amount: 900 })]);
  });

  it('R-40 leaves the underlying records byte-identical after R-11', () => {
    const transactions = [deposit('t1', 5000), deposit('t2', 4200)];
    const forms = [form('k1', 10000)];
    const before = JSON.stringify([transactions, forms]);
    reconcileBusinessIncome(2026, transactions, [], forms, [
      notBusiness('d1', [ref('form_1099', 'k1', 10000), ref('transaction', 't1', 5000), ref('transaction', 't2', 4200)], refunds(500), 300),
    ]);
    expect(JSON.stringify([transactions, forms])).toBe(before);
  });
});

describe('Tax Watch R10.5 year split', () => {
  const necPair = () => [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12000, '1099-NEC', 'Client B')];
  const necSources = () => [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)];

  it('keeps one 1099-NEC matched to its own deposits as same payments while the flag is on', () => {
    const transactions = [deposit('t1', 4000), deposit('t2', 3500.25), deposit('t3', 2499.75)];
    const forms = [form('n1', 10000, '1099-NEC', 'Synthetic client')];
    const sources = [ref('form_1099', 'n1', 10000), ...transactions.map(tx => ref('transaction', tx.id, -tx.amount))];
    expect(samePaymentsAllowed([
      { kind: 'form_1099', formType: '1099-NEC' },
      { kind: 'transaction' }, { kind: 'transaction' }, { kind: 'transaction' },
    ])).toBe(true);
    const { candidates } = listIncomeSourceCandidates(2026, transactions, [], forms);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    process.env.r10_5LegacyNecReopen = '1';
    try {
      expect(validateReconciliationDecision(decision('d1', 'same_payments', sources), byKey, new Map(), { rejectNecOnlySamePayments: true }))
        .toMatchObject({ ok: true, countedCents: 1000000 });
      const result = reconcileBusinessIncome(2026, transactions, [], forms, [decision('d1', 'same_payments', sources, { version: 1 })]);
      expect(result.grossReceipts).toBe(10000);
      expect(result.netReceipts).toBe(10000);
      expect(result.warnings).not.toContain(LEGACY_NEC_REOPEN_REASON);
      expect(result.warnings).not.toContain(LEGACY_NEC_PRIOR_YEAR_NOTE);
      expect(result.warnings).not.toContain(LEGACY_NEC_WARNING);
    } finally {
      delete process.env.r10_5LegacyNecReopen;
    }
  });

  it('R-73 and R-74 keep the saved total and show only the non-blocking warning while the switch is off', () => {
    delete process.env.r10_5LegacyNecReopen;
    const forms = necPair();
    const saved = decision('d1', 'same_payments', necSources(), { version: 1, countedAmount: 12000 });
    const before = JSON.stringify([forms, saved]);
    const result = reconcileBusinessIncome(2026, [], [], forms, [saved]);
    expect(result.grossReceipts).toBe(12000);
    expect(result.netReceipts).toBe(12000);
    expect(result.warnings).toContain(LEGACY_NEC_WARNING);
    expect(result.warnings).not.toContain(LEGACY_NEC_REOPEN_REASON);
    expect(result.warnings).not.toContain(LEGACY_NEC_PRIOR_YEAR_NOTE);
    const summary = summarizeIncomeReconciliation(2026, { transactions: [], receipts: [], forms, decisions: [saved] });
    expect(summary.grossReceipts).toBe(12000);
    expect(summary.conflicts).toEqual([]);
    expect(summary.notices).toEqual([LEGACY_NEC_WARNING]);
    expect(summary.decisions[0].legacyNecWarning).toBe(LEGACY_NEC_WARNING);
    expect(summary.decisions[0].changeNotice).toBeUndefined();
    expect(JSON.stringify([forms, saved])).toBe(before);
  });

  it('R-71 reopens the current year with the reason and shows $24,000 only alongside it', () => {
    const forms = necPair();
    const saved = decision('d1', 'same_payments', necSources(), { version: 1, countedAmount: 12000 });
    const before = JSON.stringify([forms, saved]);
    process.env.r10_5LegacyNecReopen = '1';
    try {
      const error = blocked(() => reconcileBusinessIncome(2026, [], [], forms, [saved]));
      expect(error.conflicts[0]).toMatchObject({ reason: 'stale_decision', decisionId: 'd1' });
      expect(error.conflicts[0].message).toContain(LEGACY_NEC_REOPEN_REASON);
      expect(error.conflicts[0].message).toContain(ERR_SAME_NEEDS_K);
      expect(error.message).not.toContain('no longer matches your records');
      const summary = summarizeIncomeReconciliation(2026, { transactions: [], receipts: [], forms, decisions: [saved] });
      expect(summary.grossReceipts).toBe(24000);
      expect(summary.decisions[0].changeNotice).toBe(LEGACY_NEC_CHANGE_NOTICE);
      expect(summary.decisions[0].applied).toBe(false);
      expect(JSON.stringify([forms, saved])).toBe(before);
    } finally {
      delete process.env.r10_5LegacyNecReopen;
    }
  });

  it('R-72 flags 2025 and 2024 NEC-only same-payments decisions without rewriting those saved totals', () => {
    for (const taxYear of [2025, 2024]) {
      const forms = necPair();
      const saved = decision('d1', 'same_payments', necSources(), { version: 1, countedAmount: 12000, taxYear });
      const before = JSON.stringify([forms, saved]);
      expect(reconcileBusinessIncome(taxYear, [], [], forms, [saved]).grossReceipts).toBe(12000);
      process.env.r10_5LegacyNecReopen = '1';
      try {
        const result = reconcileBusinessIncome(taxYear, [], [], forms, [saved]);
        expect(result.grossReceipts).toBe(12000);
        expect(result.netReceipts).toBe(12000);
        expect(result.reconciledDecisionCount).toBe(1);
        expect(result.warnings).toContain(LEGACY_NEC_PRIOR_YEAR_NOTE);
        expect(result.warnings).not.toContain(LEGACY_NEC_REOPEN_REASON);
        expect(result.warnings).not.toContain(LEGACY_NEC_WARNING);
        const summary = summarizeIncomeReconciliation(taxYear, { transactions: [], receipts: [], forms, decisions: [saved] });
        expect(summary.grossReceipts).toBe(12000);
        expect(summary.notices).toEqual([LEGACY_NEC_PRIOR_YEAR_NOTE]);
        expect(summary.conflicts).toEqual([]);
        expect(summary.decisions[0].applied).toBe(true);
        expect(summary.decisions[0].changeNotice).toBeUndefined();
      } finally {
        delete process.env.r10_5LegacyNecReopen;
      }
      expect(reconcileBusinessIncome(taxYear, [], [], forms, [saved]).warnings).not.toContain(LEGACY_NEC_PRIOR_YEAR_NOTE);
      expect(JSON.stringify([forms, saved])).toBe(before);
    }
  });

  it('R-76 lets one 1099-NEC and its matching deposit stay same payments', () => {
    const transactions = [deposit('t1', 5000)];
    const forms = [form('n1', 5000, '1099-NEC', 'Client A')];
    const sources = [ref('form_1099', 'n1', 5000), ref('transaction', 't1', 5000)];
    const { candidates } = listIncomeSourceCandidates(2026, transactions, [], forms);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const check = validateReconciliationDecision(decision('d1', 'same_payments', sources), byKey);
    expect(check).toMatchObject({ ok: true, countedCents: 500000 });
    expect(JSON.stringify(check)).not.toContain(ERR_SAME_NEEDS_K);
    const result = reconcileBusinessIncome(2026, transactions, [], forms, [decision('d1', 'same_payments', sources)]);
    expect(result.grossReceipts).toBe(5000);
    expect(result.netReceipts).toBe(5000);
    expect(result.warnings.join('\n')).not.toContain(ERR_SAME_NEEDS_K);
    expect(result.warnings).not.toContain(LEGACY_NEC_WARNING);
  });
});

describe('Tax Watch same-payments and separate-income rulings', () => {
  it('rejects same payments for two 1099-NEC forms and counts them once each', () => {
    const forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12000, '1099-NEC', 'Client B')];
    const sources = [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)];
    expect(samePaymentsAllowed([{ kind: 'form_1099', formType: '1099-NEC' }, { kind: 'form_1099', formType: '1099-NEC' }])).toBe(false);
    expect(samePaymentsAllowed([
      { kind: 'form_1099', formType: '1099-NEC' }, { kind: 'form_1099', formType: '1099-NEC' }, { kind: 'transaction' },
    ])).toBe(false);
    const { candidates } = listIncomeSourceCandidates(2026, [], [], forms);
    const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
    const rejected = validateReconciliationDecision(decision('d1', 'same_payments', sources), byKey);
    expect(rejected).toEqual({ ok: false, reason: ERR_SAME_NEEDS_K });
    // R10.5 is off by default, so a decision already saved this way still counts.
    const kept = reconcileBusinessIncome(2026, [], [], forms, [decision('d1', 'same_payments', sources, { version: 1 })]);
    expect(kept.grossReceipts).toBe(12000);
    const counted = reconcileBusinessIncome(2026, [], [], forms, [decision('d1', 'separate_income', sources)]);
    expect(counted.grossReceipts).toBe(24000);
    expect(counted.netReceipts).toBe(24000);
  });

  it('saves separate income for several records in one decision', () => {
    const forms = [form('k1', 12000), form('n1', 4000, '1099-NEC', 'Client B')];
    const result = reconcileBusinessIncome(2026, [], [], forms, [decision('d1', 'separate_income', [ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 4000)])]);
    expect(result.grossReceipts).toBe(16000);
    expect(result.reconciledDecisionCount).toBe(1);
  });

  it('R-10 ignores the payment-method hint in every total', () => {
    const receipts = [receipt('r1', 10000)];
    const forms = [form('k1', 10000)];
    const sources = [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000)];
    const app = reconcileBusinessIncome(2026, [], receipts, forms, [decision('d1', 'same_payments', sources, { paymentMethodHint: 'app_or_card' })]);
    const bank = reconcileBusinessIncome(2026, [], receipts, forms, [decision('d1', 'same_payments', sources, { paymentMethodHint: 'check_ach_wire' })]);
    expect(app.grossReceipts).toBe(10000);
    expect(app.netReceipts).toBe(bank.netReceipts);
    expect(app.grossReceipts).toBe(bank.grossReceipts);
    expect(app.returnsAndAllowances).toBe(bank.returnsAndAllowances);
  });
});

describe('legacy decisions and copy', () => {
  it('R-30 keeps a version 1 same-payments decision counting once and asks for confirmation', () => {
    const receipts = [receipt('r1', 12000)];
    const forms = [form('k1', 12000)];
    const sources = [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)];
    const legacy = { ...decision('d1', 'same_payments', sources), version: 1, countedAmount: 12000 };
    const current = { ...decision('d1', 'same_payments', sources), version: 2, choiceConfirmedAt: '2026-04-01T00:00:00.000Z', countedAmount: 12000 };
    expect(reconcileBusinessIncome(2026, [], receipts, forms, [legacy]).grossReceipts).toBe(12000);
    expect(reconcileBusinessIncome(2026, [], receipts, forms, [legacy])).toMatchObject(
      reconcileBusinessIncome(2026, [], receipts, forms, [current]),
    );
    process.env.legacyDecisionReconfirm = '1';
    try {
      const summary = summarizeIncomeReconciliation(2026, { transactions: [], receipts, forms, decisions: [legacy] });
      expect(summary.grossReceipts).toBe(12000);
      expect(summary.netReceipts).toBe(12000);
      expect(summary.decisions[0].needsReconfirm).toBe(true);
    } finally {
      delete process.env.legacyDecisionReconfirm;
    }
  });

  it('keeps every saved decision on the old total when legacy reconfirm is off, and does not ask', () => {
    const receipts = [receipt('r1', 12000)];
    const forms = [form('k1', 12000)];
    const sources = [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)];
    const saved = { ...decision('d1', 'same_payments', sources), version: 1, countedAmount: 12000 };
    const confirmed = { ...decision('d2', 'same_payments', sources), version: 2, choiceConfirmedAt: '2026-04-01T00:00:00.000Z', countedAmount: 12000 };
    try {
      for (const value of [undefined, 'true', '0'] as const) {
        if (value === undefined) delete process.env.legacyDecisionReconfirm;
        else process.env.legacyDecisionReconfirm = value;
        for (const row of [saved, confirmed]) {
          expect(() => reconcileBusinessIncome(2026, [], receipts, forms, [row])).not.toThrow();
          const result = reconcileBusinessIncome(2026, [], receipts, forms, [row]);
          expect(result.grossReceipts).toBe(12000);
          expect(result.netReceipts).toBe(12000);
          const summary = summarizeIncomeReconciliation(2026, { transactions: [], receipts, forms, decisions: [row] });
          expect(summary.conflicts).toEqual([]);
          expect(summary.grossReceipts).toBe(12000);
          expect(summary.decisions[0].needsReconfirm).toBe(false);
        }
      }
    } finally {
      delete process.env.legacyDecisionReconfirm;
    }
  });

  it('asks once about a saved same-payments decision only when legacy reconfirm is on', () => {
    const receipts = [receipt('r1', 12000)];
    const forms = [form('k1', 12000)];
    const sources = [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)];
    const saved = { ...decision('d1', 'same_payments', sources), version: 1, countedAmount: 12000 };
    process.env.legacyDecisionReconfirm = '1';
    try {
      expect(() => reconcileBusinessIncome(2026, [], receipts, forms, [saved])).not.toThrow();
      expect(reconcileBusinessIncome(2026, [], receipts, forms, [saved]).grossReceipts).toBe(12000);
      const summary = summarizeIncomeReconciliation(2026, { transactions: [], receipts, forms, decisions: [saved] });
      expect(summary.grossReceipts).toBe(12000);
      expect(summary.conflicts).toEqual([]);
      expect(summary.decisions[0].needsReconfirm).toBe(true);
    } finally {
      delete process.env.legacyDecisionReconfirm;
    }
  });

  it('R-33 does not ask to reconfirm version 1 separate-income or fee decisions', () => {
    process.env.legacyDecisionReconfirm = '1';
    try {
      const summary = summarizeIncomeReconciliation(2026, {
        transactions: [deposit('t1', 6000), deposit('t2', 4000)], receipts: [], forms: [form('k1', 10500), form('n1', 2500, '1099-NEC', 'Client B')],
        decisions: [
          { ...decision('fee', 'k_includes_fees', [ref('form_1099', 'k1', 10500), ref('transaction', 't1', 6000), ref('transaction', 't2', 4000)], { platformFeeAmount: 500 }), version: 1 },
          { ...decision('sep', 'separate_income', [ref('form_1099', 'n1', 2500)]), version: 1 },
        ],
      });
      expect(summary.decisions.map(item => item.needsReconfirm)).toEqual([false, false]);
      expect(summary.grossReceipts).toBe(13000);
    } finally {
      delete process.env.legacyDecisionReconfirm;
    }
  });

  it('R-36 and R-37 keep the threshold wording and drop the banned claims', () => {
    expect(PANEL_FORMS_NOTE).toContain('over $20,000 and over 200 transactions');
    expect(NO_FORM_NO_INCOME).toContain("No form doesn't mean no income");
    let grep = '';
    try {
      grep = execFileSync('git', ['grep', '-n', 'only above $20,000 and 200 transactions', '--', 'components', 'lib'], { encoding: 'utf8' });
    } catch (error) {
      grep = typeof error === 'object' && error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    }
    expect(grep).toBe('');
    for (const value of Object.values(incomeCopy)) {
      if (typeof value !== 'string') continue;
      expect(value).not.toContain('every dollar counted once');
      expect(value).not.toContain('finished');
      expect(value).not.toContain('\u2013');
      expect(value).not.toContain('\u2014');
    }
  });
});

describe('v1.1 separate income, legacy NEC matches and corrected forms', () => {
  const byKey = (transactions: ReturnType<typeof deposit>[] = [], receipts: ReturnType<typeof receipt>[] = [], forms: ReturnType<typeof form>[] = []) => {
    const { candidates } = listIncomeSourceCandidates(2026, transactions, receipts, forms);
    return new Map(candidates.map(candidate => [sourceKey(candidate), candidate]));
  };

  it('R-42 counts every selected record in one separate-income decision', () => {
    const transactions = [deposit('t1', 4000)];
    const receipts = [receipt('r1', 3000)];
    const forms = [form('n1', 2500, '1099-NEC', 'Client A')];
    const check = validateReconciliationDecision(decision('d1', 'separate_income', [
      ref('transaction', 't1', 4000), ref('gross_receipt', 'r1', 3000), ref('form_1099', 'n1', 2500),
    ]), byKey(transactions, receipts, forms));
    expect(check).toMatchObject({ ok: true, countedCents: 950000 });
    expect(JSON.stringify(check)).not.toContain('Mark one record at a time');
  });

  it('R-43 reports the whole separate-income decision stale when one amount changes', () => {
    const forms = [form('k1', 12000), form('n1', 11000, '1099-NEC', 'Client A')];
    const saved = decision('d1', 'separate_income', [ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 12000)]);
    const before = JSON.stringify(forms);
    const error = blocked(() => reconcileBusinessIncome(2026, [], [], forms, [saved]));
    expect(error.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'stale_decision', decisionId: 'd1' }),
      expect.objectContaining({ reason: 'multiple_forms', sources: expect.arrayContaining([
        expect.objectContaining({ id: 'k1' }), expect.objectContaining({ id: 'n1' }),
      ]) }),
    ]));
    expect(JSON.stringify(forms)).toBe(before);
  });

  it('R-44 still rejects a fee on separate income', () => {
    const forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    const check = validateReconciliationDecision(decision('d1', 'separate_income', [
      ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 12000),
    ], { platformFeeAmount: 100 }), byKey([], [], forms));
    expect(check).toEqual({ ok: false, reason: 'Separate income does not record a platform fee.' });
  });

  it('R-46 still counts one separate record on top of other income', () => {
    const forms = [form('n1', 10000, '1099-NEC', 'Client A')];
    const result = reconcileBusinessIncome(2026, [], [receipt('r1', 5000, 'Cash client')], forms, [
      decision('d1', 'separate_income', [ref('form_1099', 'n1', 10000)]),
    ]);
    expect(result.grossReceipts).toBe(15000);
  });

  it('R-61 reopens a saved NEC-only same-payments decision only while the flag is on', () => {
    const forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12000, '1099-NEC', 'Client B')];
    const saved = decision('d1', 'same_payments', [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)], { version: 1 });
    const before = JSON.stringify([forms, saved]);
    expect(reconcileBusinessIncome(2026, [], [], forms, [saved]).grossReceipts).toBe(12000);
    process.env.r10_5LegacyNecReopen = '1';
    try {
      const error = blocked(() => reconcileBusinessIncome(2026, [], [], forms, [saved]));
      expect(error.conflicts).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: 'stale_decision', message: expect.stringContaining(ERR_SAME_NEEDS_K) }),
      ]));
    } finally {
      delete process.env.r10_5LegacyNecReopen;
    }
    expect(reconcileBusinessIncome(2026, [], [], forms, [saved]).grossReceipts).toBe(12000);
    expect(JSON.stringify([forms, saved])).toBe(before);
  });

  it('R-62 counts the corrected 1099-NEC and keeps the original at zero', () => {
    const forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    const before = JSON.stringify(forms);
    const saved = decision('d1', 'corrected_form_replaces', [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500)], { correctedFormId: 'n2' });
    const result = reconcileBusinessIncome(2026, [], [], forms, [saved]);
    expect(result.grossReceipts).toBe(12500);
    const { candidates } = listIncomeSourceCandidates(2026, [], [], forms);
    const resolution = resolveIncomeSources(2026, candidates, [saved]);
    expect(resolution.replacedForms).toEqual([{ decisionId: 'd1', formId: 'n1', label: '1099-NEC · Client A', amount: 12000 }]);
    expect(resolution.conflicts.some(conflict => conflict.reason === 'multiple_forms')).toBe(false);
    const summary = summarizeIncomeReconciliation(2026, { transactions: [], receipts: [], forms, decisions: [saved] });
    expect(summary.candidates.find(candidate => candidate.id === 'n1')).toMatchObject({ badge: CORRECTED_ORIGINAL_BADGE });
    expect(JSON.stringify(forms)).toBe(before);
  });

  it('R-63 requires the same payer, ignoring case and surrounding spaces', () => {
    const different = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client B')];
    const mismatch = validateReconciliationDecision(decision('d1', 'corrected_form_replaces', [
      ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500),
    ], { correctedFormId: 'n2' }), byKey([], [], different));
    expect(mismatch).toEqual({ ok: false, reason: fillIncomeCopy(ERR_CORRECTED_SAME_PAYER, { payerA: 'Client A', payerB: 'Client B' }) });
    const spaced = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', ' client a ')];
    const matched = validateReconciliationDecision(decision('d1', 'corrected_form_replaces', [
      ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500),
    ], { correctedFormId: 'n2' }), byKey([], [], spaced));
    expect(matched).toMatchObject({ ok: true, countedCents: 1250000 });
  });

  it('R-64 rejects anything other than two 1099-NEC forms', () => {
    const mixed = [form('k1', 12000, '1099-K', 'Client A'), form('n1', 12000, '1099-NEC', 'Client A')];
    const three = [form('n1', 1000, '1099-NEC', 'Client A'), form('n2', 1000, '1099-NEC', 'Client A'), form('n3', 1000, '1099-NEC', 'Client A')];
    for (const forms of [mixed, three]) {
      const check = validateReconciliationDecision(decision('d1', 'corrected_form_replaces', forms.map(item => ref('form_1099', item.id, item.amount)), { correctedFormId: 'n1' }), byKey([], [], forms));
      expect(check).toEqual({ ok: false, reason: ERR_CORRECTED_NEEDS_TWO_NEC });
    }
  });

  it('R-65 rejects a corrected decision until the corrected form is one of the two', () => {
    const forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    const sources = [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500)];
    expect(validateReconciliationDecision(decision('d1', 'corrected_form_replaces', sources), byKey([], [], forms))).toEqual({ ok: false, reason: ERR_CORRECTED_PICK });
    expect(validateReconciliationDecision(decision('d1', 'corrected_form_replaces', sources, { correctedFormId: 't1' }), byKey([], [], forms))).toEqual({ ok: false, reason: ERR_CORRECTED_PICK });
  });

  it('R-66 counts deposits only when they match the corrected form', () => {
    const forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    const sources = [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500), ref('transaction', 't1', 12500)];
    const matched = reconcileBusinessIncome(2026, [deposit('t1', 12500)], [], forms, [decision('d1', 'corrected_form_replaces', sources, { correctedFormId: 'n2' })]);
    expect(matched.grossReceipts).toBe(12500);
    const short = validateReconciliationDecision(decision('d1', 'corrected_form_replaces', [
      ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500), ref('transaction', 't1', 12000),
    ], { correctedFormId: 'n2' }), byKey([deposit('t1', 12000)], [], forms));
    expect(short).toEqual({ ok: false, reason: fillIncomeCopy(ERR_CORRECTED_SUM, { kind: 'bank income', selected: '$12,000.00', corrected: '$12,500.00' }) });
  });

  it('R-67 still asks about a deposit left out of a corrected-form decision', () => {
    const forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    const saved = decision('d1', 'corrected_form_replaces', [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500)], { correctedFormId: 'n2' });
    const error = blocked(() => reconcileBusinessIncome(2026, [deposit('t1', 12500)], [], forms, [saved]));
    expect(error.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unreconciled_against_decision', sources: [expect.objectContaining({ id: 't1' })] }),
    ]));
  });
});
