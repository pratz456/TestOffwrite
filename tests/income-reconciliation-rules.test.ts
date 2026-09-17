import { describe, expect, it } from 'vitest';
import { reconcileBusinessIncome, listIncomeSourceCandidates, IncomeReconciliationRequiredError } from '../lib/tax-rules/business-income';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { normalizeReconciliationDecision, resolveIncomeSources, sourceKey, validateReconciliationDecision, type IncomeReconciliationDecision } from '../lib/tax-rules/income-reconciliation';
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
      w2Entries: [{ wages: 100000, federalWithheld: 0 }], profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(), deductions: {}, assets: [], estimatedPayments: 0 });
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
    ['separate_income', [ref('form_1099', 'k1', 10000), ref('gross_receipt', 'r1', 10000)], 0, 'one record at a time'],
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
    expect(normalizeReconciliationDecision({ id: 'd', taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k', 1)], platformFeeAmount: null, note: '' })).toEqual({ id: 'd', taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k', 1)], platformFeeAmount: 0 });
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
