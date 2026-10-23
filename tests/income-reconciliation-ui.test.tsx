import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Runs the real UI request/state handlers against the real reconciliation engine. Not a browser rendering test.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), navigate: vi.fn(), changed: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, callback };
      return harness.slots[index].callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++; const previous = harness.slots[index];
      if (!same(previous?.deps, deps)) {
        const next: any = { deps }; harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { IncomeReconciliationPanel } from '../components/income-reconciliation-panel';
import { TaxPreviewScreen } from '../components/tax-preview-screen';
import { incomeScreenTab, incomeScreenYear } from '../components/income-tracking-screen';
import { protectedScreenUrl } from '../lib/navigation/protected-screens';
import { prepareReconciliationDecision, summarizeIncomeReconciliation, type IncomeSourceRecords } from '../lib/tax-rules/income-reconciliation-response';
import {
  COMPARE_DIFF, COMPARE_SAME_AMOUNT, COMPARE_TITLE, CONFIRM_FORMS_REQUIRED, CONFIRM_SAME_BACK, CONFIRM_SAME_TITLE, CONFIRM_SAME_YES,
  CORRECTED_ORIGINAL_BADGE, CORRECTED_PICK_QUESTION, CORRECTED_PREVIEW, DECISION_HELP_CORRECTED, DECISION_LABEL_CORRECTED,
  DECISION_LABEL_NOT_BUSINESS, ERR_REASON_AMOUNT, GUIDE_ANSWER_APP, GUIDE_ANSWER_BANK, GUIDE_HINT_APP, GUIDE_HINT_BANK,
  GUIDE_QUESTION, LEGACY_RECONFIRM_BODY, LEGACY_RECONFIRM_CHANGE, LEGACY_RECONFIRM_YES, NO_CHOICE_YET, NO_FORM_NO_INCOME, PANEL_FORMS_NOTE,
  SAME_DISABLED_NEC, fillIncomeCopy,
} from '../lib/tax-rules/income-reconciliation-copy';
import { incomeReconciliationPath } from '../lib/tax-rules/income-reconciliation-response';
import * as incomeCopy from '../lib/tax-rules/income-reconciliation-copy';
import type { IncomeRecord } from '../lib/tax-rules/business-income';

type Element = ReactElement<Record<string, any>>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function render(component: () => unknown): Element {
  harness.cursor = 0;
  const tree = component() as Element;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
const panel = () => IncomeReconciliationPanel({ taxYear: 2026, onChanged: harness.changed });
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
const byLabel = (tree: Element, label: string) => walk(tree).find(node => node.props?.['aria-label'] === label)!;
const check = (tree: Element, label: string) => byLabel(tree, `Select ${label}`).props.onChange({ target: { checked: true } });
const radio = (tree: Element, value: string) => walk(tree).find(node => node.props?.type === 'radio' && node.props?.value === value)!.props.onChange();
const submit = (tree: Element) => walk(tree).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} });
const preview = (tree: Element) => text(walk(tree).find(node => node.props?.['aria-live'] === 'polite')!);

// Owner records behind the mocked API. The real summary/validation code answers every request.
const records: IncomeSourceRecords & { decisions: IncomeRecord[] } = { transactions: [], receipts: [], forms: [], decisions: [] };
const deposit = (id: string, amount: number) => ({ id, trans_id: id, account_id: 'bank-1', amount: -amount, category: 'income', type: 'income', date: '2026-03-01', merchant_name: 'Synthetic platform payout' });
const receipt = (id: string, amount: number) => ({ id, amount, type: 'freelance', source: 'Synthetic platform', date: '2026-01-31' });
const form = (id: string, amount: number, formType = '1099-K', payerName = 'Synthetic platform') => ({ id, amount, formType, payerName });
let nextId = 0;
function api(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (method === 'GET') return Promise.resolve(Response.json(summarizeIncomeReconciliation(2026, records)));
  if (method === 'DELETE') {
    const id = new URL(url, 'http://localhost').searchParams.get('id');
    records.decisions = records.decisions.filter(decision => decision.id !== id);
    return Promise.resolve(Response.json({ success: true }));
  }
  const id = method === 'PATCH' ? body.id : `d${++nextId}`;
  const prepared = prepareReconciliationDecision(2026, records, {
    id, decision: body.decision, sources: body.sources, platformFeeAmount: body.platformFeeAmount ?? 0, note: body.note ?? '',
    notBusinessParts: body.notBusinessParts ?? [], ...(body.paymentMethodHint ? { paymentMethodHint: body.paymentMethodHint } : {}),
    ...(body.correctedFormId ? { correctedFormId: body.correctedFormId } : {}),
  });
  if (!prepared.ok) return Promise.resolve(Response.json({ error: prepared.reason }, { status: prepared.status }));
  if (body.decision === 'same_payments') {
    const forms = (body.sources as Array<{ kind: string; amount: number }>).filter(source => source.kind === 'form_1099');
    const expected = forms.reduce((total, source) => total + Math.round(source.amount * 100), 0);
    if (forms.length >= 2 && Math.round(Number(body.confirmedFormsTotal) * 100) !== expected) {
      return Promise.resolve(Response.json({ error: CONFIRM_FORMS_REQUIRED }, { status: 400 }));
    }
  }
  records.decisions = [...records.decisions.filter(decision => decision.id !== id), { id, ...prepared.stored, decidedAt: '2026-04-01T12:00:00.000Z', version: 2, choiceConfirmedAt: '2026-04-01T12:00:00.000Z' }];
  return Promise.resolve(Response.json({ success: true, id, countedAmount: prepared.stored.countedAmount }, { status: method === 'PATCH' ? 200 : 201 }));
}
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.request.mockReset(); harness.navigate.mockReset(); harness.changed.mockReset();
  harness.request.mockImplementation(api);
  records.transactions = []; records.receipts = [receipt('r1', 12000)]; records.forms = [form('k1', 12000)]; records.decisions = []; nextId = 0;
});

describe('income reconciliation panel', () => {
  it('explains the hold, shows the conflicting records side by side, and never offers an automatic merge', async () => {
    render(panel); await flush(); const tree = render(panel); const content = text(tree);
    expect(content).toContain('never merges, edits or deletes income records automatically');
    expect(content).toContain('Tax totals for 2026 are on hold');
    expect(content).toContain('Transactions, gross receipts or 1099 forms may describe the same payments');
    expect(content).toContain('1099-K · Synthetic platform');
    expect(content).toContain('Direct income · Synthetic platform');
    expect(content).toContain('Needs a decision');
    expect(content).toContain(PANEL_FORMS_NOTE);
    expect(content).toContain(NO_FORM_NO_INCOME);
    expect(walk(tree).filter(node => node.props?.type === 'checkbox')).toHaveLength(2);
    expect(preview(tree)).toBe('Select the records this decision covers.');
    expect(walk(tree).find(node => node.props?.type === 'submit')!.props.disabled).toBe(true);
    expect(harness.request).toHaveBeenCalledWith('/api/income/reconciliation?year=2026');
  });

  it('records “same payments” for the selected records and then shows the gross receipts counted once', async () => {
    const before = JSON.stringify([records.receipts, records.forms]);
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), 'Direct income · Synthetic platform $12,000.00');
    radio(render(panel), 'same_payments');
    const ready = render(panel);
    expect(preview(ready)).toBe('Counts $12,000.00 once. Gross receipts for 2026 would be $12,000.00 if no other conflicts remain.');
    expect(walk(ready).find(node => node.props?.type === 'submit')!.props.disabled).toBe(false);
    await submit(ready);
    const [, init] = harness.request.mock.calls.find(([url, options]) => url === '/api/income/reconciliation' && options?.method === 'POST')!;
    expect(JSON.parse(String(init.body))).toEqual({ taxYear: 2026, decision: 'same_payments', platformFeeAmount: 0, note: '', explicitChoice: true,
      sources: [{ kind: 'form_1099', id: 'k1', amount: 12000 }, { kind: 'gross_receipt', id: 'r1', amount: 12000 }] });
    const after = render(panel); const content = text(after);
    expect(content).toContain('Gross receipts for 2026 (Schedule C line 1)');
    expect(content).toContain('$12,000.00');
    expect(content).not.toContain('on hold');
    expect(content).toContain('Saved decisions · 1');
    expect(content).toContain('Applied');
    expect(content).toContain('Counted $12,000.00 once');
    expect(walk(after).filter(node => node.props?.type === 'checkbox').every(node => node.props.disabled)).toBe(true);
    expect(harness.changed).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([records.receipts, records.forms])).toBe(before);
  });

  it('needs a fee amount for “1099-K includes fees”, counts the 1099-K gross, and flags the fee for review only', async () => {
    records.receipts = []; records.forms = [form('k1', 10500)]; records.transactions = [deposit('t1', 6000), deposit('t2', 4000)];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $10,500.00');
    check(render(panel), 'Bank income · Synthetic platform payout $6,000.00');
    check(render(panel), 'Bank income · Synthetic platform payout $4,000.00');
    radio(render(panel), 'same_payments');
    expect(preview(render(panel))).toContain('choose “1099-K includes fees” and enter the fee amount');
    radio(render(panel), 'k_includes_fees');
    const missingFee = render(panel);
    expect(preview(missingFee)).toContain('Enter the platform fee amount');
    expect(walk(missingFee).find(node => node.props?.type === 'submit')!.props.disabled).toBe(true);
    walk(missingFee).find(node => node.props?.id === 'reconciliation-fee')!.props.onChange({ target: { value: '500' } });
    const ready = render(panel);
    expect(text(ready)).toContain('1099-K includes fees of $500.00');
    expect(preview(ready)).toBe('Counts $10,500.00 once. Gross receipts for 2026 would be $10,500.00 if no other conflicts remain.');
    await submit(ready);
    const [, init] = harness.request.mock.calls.find(([url, options]) => url === '/api/income/reconciliation' && options?.method === 'POST')!;
    expect(JSON.parse(String(init.body))).toMatchObject({ decision: 'k_includes_fees', platformFeeAmount: 500 });
    const content = text(render(panel));
    expect(content).toContain('$10,500.00');
    expect(content).toContain('Platform fee of $500.00 recorded with 1099-K · Synthetic platform is an expense candidate for your review. It is not deducted');
    expect(content).toContain('$500.00 fee flagged for review');
  });

  it('shows the server’s reason when a decision is rejected and keeps the selection for correction', async () => {
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), 'Direct income · Synthetic platform $12,000.00');
    radio(render(panel), 'same_payments');
    harness.request.mockImplementation((url: string, init?: RequestInit) => init?.method === 'POST'
      ? Promise.resolve(Response.json({ error: 'Direct income · Synthetic platform is $12,500.00 in your records, not the $12,000.00 this decision names.' }, { status: 400 })) : api(url, init));
    await submit(render(panel));
    const tree = render(panel);
    expect(text(walk(tree).find(node => node.props?.role === 'alert' && text(node).includes('in your records'))!)).toContain('not the $12,000.00 this decision names');
    expect(walk(tree).filter(node => node.props?.type === 'checkbox' && node.props.checked)).toHaveLength(2);
    expect(harness.changed).not.toHaveBeenCalled();
    expect(records.decisions).toEqual([]);
  });

  it('marks a decision that no longer matches the records for review and removes it on request', async () => {
    records.decisions = [{ id: 'old', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 11000, decidedAt: '2026-02-01T00:00:00.000Z', version: 2,
      sources: [{ kind: 'form_1099', id: 'k1', amount: 11000, label: '1099-K · Synthetic platform' }, { kind: 'gross_receipt', id: 'r1', amount: 11000, label: 'Direct income · Synthetic platform' }] }];
    render(panel); await flush(); const tree = render(panel); const content = text(tree);
    expect(content).toContain('Needs review');
    expect(content).toContain('no longer matches your records');
    expect(content).toContain('2026-02-01');
    await byLabel(tree, 'Remove decision: Same payments').props.onClick();
    expect(harness.request).toHaveBeenCalledWith('/api/income/reconciliation?id=old', { method: 'DELETE' });
    const after = text(render(panel));
    expect(after).toContain('Saved decisions · 0');
    expect(after).not.toContain('Needs review');
    expect(after).toContain('Tax totals for 2026 are on hold');
    expect(harness.changed).toHaveBeenCalledTimes(1);
  });

  it('edits a saved decision through PATCH with the original id', async () => {
    records.decisions = [{ id: 'd-existing', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 12000, decidedAt: '2026-02-01T00:00:00.000Z', version: 2,
      sources: [{ kind: 'form_1099', id: 'k1', amount: 12000, label: '1099-K · Synthetic platform' }, { kind: 'gross_receipt', id: 'r1', amount: 12000, label: 'Direct income · Synthetic platform' }] }];
    render(panel); await flush();
    byLabel(render(panel), 'Edit decision: Same payments').props.onClick();
    const editing = render(panel);
    expect(text(editing)).toContain('Edit decision');
    expect(walk(editing).filter(node => node.props?.type === 'checkbox' && node.props.checked)).toHaveLength(2);
    walk(editing).find(node => node.props?.id === 'reconciliation-note')!.props.onChange({ target: { value: 'Matches the platform statement' } });
    await submit(render(panel));
    const [, init] = harness.request.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(String(init.body))).toMatchObject({ id: 'd-existing', note: 'Matches the platform statement' });
    expect(records.decisions).toEqual([expect.objectContaining({ id: 'd-existing', note: 'Matches the platform statement' })]);
    expect(text(render(panel))).toContain('Matches the platform statement');
  });

  it('describes records this workflow cannot reconcile without offering a decision form', async () => {
    records.forms = [form('m1', 900, '1099-MISC')];
    render(panel); await flush(); const tree = render(panel);
    expect(text(tree)).toContain('A saved record needs review before 2026 can be reconciled');
    expect(text(tree)).toContain('Confirm the tax treatment of this 1099');
    expect(walk(tree).find(node => node.type === 'form')).toBeUndefined();
  });
});

describe('income gate deep link', () => {
  it('lists the conflicting records in the tax estimate notice and opens the reconcile tab for that year', async () => {
    const error = 'Review income sources before calculating tax: Transactions, gross receipts or 1099 forms may describe the same payments.';
    harness.request.mockImplementation((url: string) => Promise.resolve(Response.json({
      error, code: 'INCOME_RECONCILIATION_REQUIRED', taxYear: Number(new URL(url, 'http://localhost').searchParams.get('year')),
      conflicts: [{ reason: 'overlapping_sources', message: 'Transactions, gross receipts or 1099 forms may describe the same payments.', sources: [{ kind: 'form_1099', id: 'k1', amount: 12000.5, label: '1099-K · Synthetic platform' }] }],
      reviewPath: '/protected?screen=income-tracking&tab=reconcile&year=2026',
    }, { status: 422 })));
    const screen = () => TaxPreviewScreen({ user: { id: 'owner' }, onBack() {}, onNavigate: harness.navigate });
    render(screen); await flush(); const tree = render(screen);
    expect(text(tree)).toContain('1099-K · Synthetic platform $12,000.50');
    expect(text(tree)).not.toContain('$0');
    const year = new URL(String(harness.request.mock.calls[0][0]), 'http://localhost').searchParams.get('year');
    walk(tree).find(node => node.props?.onClick && text(node) === 'Reconcile income sources')!.props.onClick();
    expect(harness.navigate).toHaveBeenCalledWith(`income-tracking?tab=reconcile&year=${year}`);
    expect(protectedScreenUrl(`income-tracking?tab=reconcile&year=${year}`)).toBe(`/protected?screen=income-tracking&tab=reconcile&year=${year}`);
  });

  it('keeps unknown tabs and years inside the income screen’s own choices', () => {
    expect(protectedScreenUrl('income-tracking?tab=<script>&year=20x6')).toBe('/protected?screen=income-tracking');
    expect(protectedScreenUrl('tax-preview?tab=reconcile&year=2026')).toBe('/protected?screen=tax-preview');
    expect(incomeScreenTab('reconcile')).toBe('reconcile');
    expect(incomeScreenTab('unknown')).toBe('receipts');
    expect(incomeScreenTab(null)).toBe('receipts');
    expect(incomeScreenYear('2024', 2026)).toBe(2024);
    expect(incomeScreenYear('2021', 2026)).toBe(2026);
    expect(incomeScreenYear('2027', 2026)).toBe(2026);
    expect(incomeScreenYear(null, 2026)).toBe(2026);
  });
});

const FLAG = 'NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME';
const radios = (tree: Element) => walk(tree).filter(node => node.props?.type === 'radio');
const clickText = (tree: Element, label: string) => walk(tree).find(node => typeof node.props?.onClick === 'function' && text(node) === label)!.props.onClick();

describe('reconciliation choice, guide question and Tax Watch rulings', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });
  afterEach(() => { delete process.env[FLAG]; });

  it('R-01 starts with no decision selected', async () => {
    records.receipts = [];
    records.forms = [form('k1', 10000), form('n1', 10000, '1099-NEC', 'Synthetic client')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $10,000.00');
    check(render(panel), '1099-NEC · Synthetic client $10,000.00');
    const tree = render(panel);
    expect(radios(tree).some(node => node.props.checked)).toBe(false);
    expect(walk(tree).find(node => node.props?.type === 'submit')!.props.disabled).toBe(true);
    expect(preview(tree)).toBe(NO_CHOICE_YET);
  });

  it('R-02 clears the decision after a save', async () => {
    records.forms = [form('k1', 10000), form('n1', 4000, '1099-NEC', 'Synthetic client')];
    records.receipts = [];
    render(panel); await flush();
    check(render(panel), '1099-NEC · Synthetic client $4,000.00');
    radio(render(panel), 'separate_income');
    await submit(render(panel));
    const tree = render(panel);
    expect(radios(tree).some(node => node.props.checked)).toBe(false);
  });

  it('R-03 opens an unknown saved decision with nothing selected', async () => {
    records.decisions = [{ id: 'mystery', taxYear: 2026, decision: 'unknown', platformFeeAmount: null, countedAmount: null, decidedAt: '2026-02-01T00:00:00.000Z', sources: [], notBusinessParts: [] }];
    render(panel); await flush();
    byLabel(render(panel), 'Edit decision: Unrecognized decision').props.onClick();
    const tree = render(panel);
    expect(text(tree)).toContain('Edit decision');
    expect(radios(tree).some(node => node.props.checked)).toBe(false);
  });

  it('R-04 refuses to save two equal forms as one amount without a choice', async () => {
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Synthetic client')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Synthetic client $12,000.00');
    const postsBefore = harness.request.mock.calls.filter(([, init]) => init?.method === 'POST').length;
    await submit(render(panel));
    const tree = render(panel);
    expect(walk(tree).filter(node => node.props?.role === 'alert').map(node => text(node)).join('\n')).toContain(NO_CHOICE_YET);
    expect(harness.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(postsBefore);
    expect(text(tree)).toContain('on hold');
    expect(records.decisions).toEqual([]);
  });

  it('R-06 shows the guide question only after a 1099 is selected', async () => {
    records.receipts = [];
    records.forms = [form('k1', 7500)];
    records.transactions = [deposit('t1', 4000), deposit('t2', 3500)];
    render(panel); await flush();
    check(render(panel), 'Bank income · Synthetic platform payout $4,000.00');
    check(render(panel), 'Bank income · Synthetic platform payout $3,500.00');
    expect(text(render(panel))).not.toContain(GUIDE_QUESTION);
    check(render(panel), '1099-K · Synthetic platform $7,500.00');
    expect(text(render(panel))).toContain(GUIDE_QUESTION);
  });

  it('R-07 and R-08 show guide hints without selecting a decision', async () => {
    records.receipts = [];
    records.forms = [form('k1', 10000), form('n1', 10000, '1099-NEC', 'Synthetic client')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $10,000.00');
    check(render(panel), '1099-NEC · Synthetic client $10,000.00');
    clickText(render(panel), GUIDE_ANSWER_APP);
    let tree = render(panel);
    expect(text(tree)).toContain(GUIDE_HINT_APP);
    expect(radios(tree).some(node => node.props.checked)).toBe(false);
    clickText(tree, GUIDE_ANSWER_BANK);
    tree = render(panel);
    expect(text(tree)).toContain(GUIDE_HINT_BANK);
    expect(radios(tree).some(node => node.props.checked)).toBe(false);
  });

  it('R-09 saves without a guide answer and stores no payment hint', async () => {
    records.receipts = [receipt('r1', 10000)];
    records.forms = [form('k1', 10000)];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $10,000.00');
    check(render(panel), 'Direct income · Synthetic platform $10,000.00');
    radio(render(panel), 'same_payments');
    await submit(render(panel));
    const [, init] = harness.request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    const body = JSON.parse(String(init.body));
    expect(body.explicitChoice).toBe(true);
    expect(body.paymentMethodHint).toBeUndefined();
    expect(text(render(panel))).toContain('$10,000.00');
    expect(records.decisions[0].paymentMethodHint).toBeUndefined();
  });

  it('R-20 disables save until a checked reason has an amount', async () => {
    records.receipts = [];
    records.transactions = [deposit('t1', 800)];
    records.forms = [form('k1', 1000)];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $1,000.00');
    radio(render(panel), 'k_not_business_income');
    walk(render(panel)).find(node => node.props?.['aria-label'] === 'Refunds or credits to customers')!.props.onChange();
    const tree = render(panel);
    expect(walk(tree).find(node => node.props?.type === 'submit')!.props.disabled).toBe(true);
    await submit(tree);
    expect(text(render(panel))).toContain(ERR_REASON_AMOUNT);
  });

  it('R-31 confirms a legacy same-payments decision once', async () => {
    records.decisions = [{ id: 'legacy', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 12000, decidedAt: '2026-02-01T00:00:00.000Z', version: 1,
      sources: [{ kind: 'form_1099', id: 'k1', amount: 12000, label: '1099-K · Synthetic platform' }, { kind: 'gross_receipt', id: 'r1', amount: 12000, label: 'Direct income · Synthetic platform' }] }];
    render(panel); await flush();
    expect(text(render(panel))).toContain(LEGACY_RECONFIRM_BODY);
    clickText(render(panel), LEGACY_RECONFIRM_YES);
    await flush();
    const [, init] = harness.request.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(String(init.body))).toMatchObject({ id: 'legacy', decision: 'same_payments', explicitChoice: true });
    expect(records.decisions[0]).toMatchObject({ version: 2, choiceConfirmedAt: '2026-04-01T12:00:00.000Z' });
    const after = text(render(panel));
    expect(after).not.toContain(LEGACY_RECONFIRM_BODY);
    expect(after).toContain('$12,000.00');
    expect(after).toContain('Applied');
  });

  it('R-32 opens a legacy decision for a new answer with nothing selected', async () => {
    records.decisions = [{ id: 'legacy', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 12000, decidedAt: '2026-02-01T00:00:00.000Z', version: 1,
      sources: [{ kind: 'form_1099', id: 'k1', amount: 12000, label: '1099-K · Synthetic platform' }, { kind: 'gross_receipt', id: 'r1', amount: 12000, label: 'Direct income · Synthetic platform' }] }];
    render(panel); await flush();
    clickText(render(panel), LEGACY_RECONFIRM_CHANGE);
    const tree = render(panel);
    expect(text(tree)).toContain('Edit decision');
    expect(radios(tree).some(node => node.props.checked)).toBe(false);
  });

  it('R-36 shows the corrected threshold copy', async () => {
    render(panel); await flush();
    const content = text(render(panel));
    expect(content).toContain(PANEL_FORMS_NOTE);
    expect(content).toContain(NO_FORM_NO_INCOME);
    expect(content).not.toContain('only above $20,000 and 200 transactions');
  });

  it('R-39 offers the not-business decision for a single 1099-K and counts personal outside Schedule C', async () => {
    records.receipts = [];
    records.forms = [form('k1', 900)];
    render(panel); await flush();
    const open = render(panel);
    expect(text(open)).toContain(DECISION_LABEL_NOT_BUSINESS);
    expect(text(open)).not.toContain('on hold');
    check(open, '1099-K · Synthetic platform $900.00');
    radio(render(panel), 'k_not_business_income');
    walk(render(panel)).find(node => node.props?.['aria-label'] === 'Personal, not business')!.props.onChange();
    walk(render(panel)).find(node => node.props?.id === 'reconciliation-personal')!.props.onChange({ target: { value: '900' } });
    await submit(render(panel));
    const content = text(render(panel));
    expect(content).toContain('$0.00');
    expect(content).toContain('Outside Schedule C, needs review $900.00');
  });

  it('disables same payments for two 1099-NEC forms and counts both on one separate-income save', async () => {
    records.receipts = [];
    records.forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12000, '1099-NEC', 'Client B')];
    render(panel); await flush();
    check(render(panel), '1099-NEC · Client A $12,000.00');
    check(render(panel), '1099-NEC · Client B $12,000.00');
    const blocked = render(panel);
    expect(radios(blocked).find(node => node.props.value === 'same_payments')!.props.disabled).toBe(true);
    expect(text(blocked)).toContain(SAME_DISABLED_NEC);
    radio(blocked, 'separate_income');
    await submit(render(panel));
    const posts = harness.request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body)).decision).toBe('separate_income');
    expect(text(render(panel))).toContain('$24,000.00');
    expect(text(render(panel))).not.toContain('on hold');
  });

  it('shows the v1.1 corrected-form label and keeps the code name off the label', async () => {
    expect(DECISION_LABEL_CORRECTED).toBe('A corrected 1099-NEC replaces the original');
    expect(CORRECTED_ORIGINAL_BADGE).toBe('Original, replaced by a corrected form. Kept, not counted.');
    expect(DECISION_HELP_CORRECTED).toBe('Use this when a client sent you a corrected 1099-NEC. We count the corrected form and keep the original in your records without counting it.');
    for (const value of Object.values(incomeCopy)) {
      if (typeof value !== 'string') continue;
      expect(value).not.toContain('corrected_form_replaces');
      expect(value).not.toContain('\u2013');
      expect(value).not.toContain('\u2014');
    }
    records.receipts = [];
    records.forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    render(panel); await flush();
    const tree = render(panel);
    expect(radios(tree).some(node => node.props.value === 'corrected_form_replaces')).toBe(true);
    expect(text(tree)).toContain(DECISION_LABEL_CORRECTED);
    expect(text(tree)).not.toContain('corrected_form_replaces');
  });
});

function dialog(tree: Element) {
  return walk(tree).find(node => node.props?.role === 'alertdialog')!;
}
function classNames(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(classNames);
  if (!node || typeof node !== 'object') return [];
  const props = (node as { props?: { className?: unknown; children?: unknown } }).props ?? {};
  const own = typeof props.className === 'string' ? props.className.split(/\s+/) : [];
  return [...own, ...classNames(props.children)];
}
const posts = () => harness.request.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH');

describe('v1.1 confirm step, compare and corrected form', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });
  afterEach(() => { delete process.env[FLAG]; });

  it('R-41 saves two forms as separate income in one request', async () => {
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Client A $12,000.00');
    radio(render(panel), 'separate_income');
    await submit(render(panel));
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0][1].body)).sources).toHaveLength(2);
    expect(records.decisions).toHaveLength(1);
    expect(records.decisions[0]).toMatchObject({ decision: 'separate_income', countedAmount: 24000 });
    const summary = text(render(panel));
    expect(summary).toContain('$24,000.00');
    expect(summary).not.toContain('on hold');
  });

  it('R-45 never makes separate income take more clicks than same payments', async () => {
    const clicks = async (kinds: Array<'separate_income' | 'same_payments'>, labels: string[]) => {
      harness.slots = []; harness.request.mockClear();
      render(panel); await flush();
      let count = 0;
      for (const label of labels) { check(render(panel), label); count += 1; }
      radio(render(panel), kinds[0]); count += 1;
      await submit(render(panel)); count += 1;
      const open = dialog(render(panel));
      if (open) { clickText(render(panel), fillIncomeCopy(CONFIRM_SAME_YES, { counted: '$12,000.00' })); count += 1; await flush(); }
      return count;
    };
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    const separateA = await clicks(['separate_income'], ['1099-K · Synthetic platform $12,000.00', '1099-NEC · Client A $12,000.00']);
    records.decisions = [];
    const sameA = await clicks(['same_payments'], ['1099-K · Synthetic platform $12,000.00', '1099-NEC · Client A $12,000.00']);
    expect(separateA).toBe(4);
    expect(sameA).toBe(5);
    expect(separateA).toBeLessThanOrEqual(sameA);

    records.decisions = [];
    records.forms = [form('k1', 10000)];
    records.transactions = [deposit('t1', 10000)];
    const labelsB = ['1099-K · Synthetic platform $10,000.00', 'Bank income · Synthetic platform payout $10,000.00'];
    const separateB = await clicks(['separate_income'], labelsB);
    records.decisions = [];
    const sameB = await clicks(['same_payments'], labelsB);
    expect(separateB).toBe(4);
    expect(sameB).toBe(4);

    records.decisions = [];
    records.transactions = [deposit('t1', 12000)];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    const labelsC = ['1099-K · Synthetic platform $12,000.00', '1099-NEC · Client A $12,000.00', 'Bank income · Synthetic platform payout $12,000.00'];
    const separateC = await clicks(['separate_income'], labelsC);
    records.decisions = [];
    const sameC = await clicks(['same_payments'], labelsC);
    expect(separateC).toBeLessThanOrEqual(sameC);
  });

  it('R-47 and R-48 ask before counting two forms once, and going back sends nothing', async () => {
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Client A $12,000.00');
    radio(render(panel), 'same_payments');
    await submit(render(panel));
    expect(posts()).toHaveLength(0);
    const open = render(panel);
    const alert = dialog(open);
    expect(text(alert)).toContain(CONFIRM_SAME_TITLE);
    expect(text(alert)).toContain("Your forms report $24,000.00. We'll count $12,000.00 on line 1.");
    const buttons = walk(alert).filter(node => node.props?.variant);
    expect(buttons.map(node => node.props.variant)).toEqual(['outline', 'outline']);
    expect(buttons.every(node => !node.props.autoFocus)).toBe(true);
    alert.props.onKeyDown({ key: 'Enter', preventDefault() {} });
    expect(posts()).toHaveLength(0);
    alert.props.onKeyDown({ key: 'Escape', preventDefault() {} });
    const back = render(panel);
    expect(dialog(back)).toBeUndefined();
    expect(posts()).toHaveLength(0);
    expect(walk(back).filter(node => node.props?.type === 'checkbox' && node.props.checked)).toHaveLength(2);
    expect(radios(back).filter(node => node.props.name === 'reconciliation-decision').some(node => node.props.checked)).toBe(false);

    radio(back, 'same_payments');
    await submit(render(panel));
    clickText(render(panel), CONFIRM_SAME_BACK);
    const closed = render(panel);
    expect(dialog(closed)).toBeUndefined();
    expect(posts()).toHaveLength(0);
    expect(radios(closed).filter(node => node.props.name === 'reconciliation-decision').some(node => node.props.checked)).toBe(false);
  });

  it('R-49 saves once after the confirm button', async () => {
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Client A $12,000.00');
    radio(render(panel), 'same_payments');
    await submit(render(panel));
    clickText(render(panel), fillIncomeCopy(CONFIRM_SAME_YES, { counted: '$12,000.00' }));
    await flush();
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0][1].body))).toMatchObject({ decision: 'same_payments', confirmedFormsTotal: 24000 });
    expect(text(render(panel))).toContain('$12,000.00');
    expect(text(render(panel))).not.toContain('on hold');
  });

  it('R-52 confirms a legacy two-form decision before the PATCH', async () => {
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    records.decisions = [{ id: 'legacy', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 12000, decidedAt: '2026-02-01T00:00:00.000Z', version: 1,
      sources: [{ kind: 'form_1099', id: 'k1', amount: 12000, label: '1099-K · Synthetic platform' }, { kind: 'form_1099', id: 'n1', amount: 12000, label: '1099-NEC · Client A' }] }];
    render(panel); await flush();
    clickText(render(panel), LEGACY_RECONFIRM_YES);
    const open = render(panel);
    expect(posts()).toHaveLength(0);
    expect(text(dialog(open))).toContain("Your forms report $24,000.00. We'll count $12,000.00 on line 1.");
  });

  it('R-53 shows the payer and form type on separate lines without truncation', async () => {
    const payer = 'Synthetic platform payer name that is seventy characters long exactly!';
    expect(payer).toHaveLength(70);
    records.receipts = [];
    records.forms = [form('k1', 12000, '1099-K', payer), form('n1', 12000, '1099-NEC', 'Client A')];
    render(panel); await flush();
    const tree = render(panel);
    expect(text(tree)).toContain(payer);
    expect(text(tree)).toContain('1099-K');
    expect(text(tree)).toContain('Client A');
    expect(text(tree)).toContain('1099-NEC');
    const rows = walk(tree).filter(node => node.type === 'li' && text(node).includes('1099-'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(classNames(row)).not.toContain('truncate');
  });

  it('R-54 compares two forms and switches to a strip at three, without choosing', async () => {
    records.receipts = [];
    records.forms = [form('k1', 12000), form('n1', 11400, '1099-NEC', 'Client A')];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Client A $11,400.00');
    const different = render(panel);
    expect(text(different)).toContain(COMPARE_TITLE);
    expect(text(different)).toContain('Form');
    expect(text(different)).toContain('Payer');
    expect(text(different)).toContain('Amount');
    expect(text(different)).toContain(fillIncomeCopy(COMPARE_DIFF, { diff: '$600.00' }));
    expect(radios(different).some(node => node.props.checked)).toBe(false);

    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A')];
    harness.slots = [];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Client A $12,000.00');
    const equal = render(panel);
    expect(text(equal)).toContain(COMPARE_SAME_AMOUNT);
    expect(radios(equal).some(node => node.props.checked)).toBe(false);

    records.forms = [form('k1', 12000), form('n1', 12000, '1099-NEC', 'Client A'), form('k2', 500, '1099-K', 'Second platform')];
    harness.slots = [];
    render(panel); await flush();
    check(render(panel), '1099-K · Synthetic platform $12,000.00');
    check(render(panel), '1099-NEC · Client A $12,000.00');
    check(render(panel), '1099-K · Second platform $500.00');
    const strip = render(panel);
    expect(text(strip)).not.toContain(COMPARE_TITLE);
    expect(text(strip)).toContain('Second platform');
    expect(text(strip)).toContain('$500.00');
    expect(radios(strip).some(node => node.props.checked)).toBe(false);
  });

  it('R-58 disables same payments for two 1099-NECs from one payer or two', async () => {
    for (const payer of ['Client B', 'Client A']) {
      harness.slots = [];
      records.receipts = [];
      records.decisions = [];
      records.forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12000, '1099-NEC', payer)];
      render(panel); await flush();
      const first = payer === 'Client A' ? '1099-NEC · Client A $12,000.00' : '1099-NEC · Client A $12,000.00';
      check(render(panel), first);
      const secondLabel = `1099-NEC · ${payer} $12,000.00`;
      const boxes = walk(render(panel)).filter(node => node.props?.['aria-label'] === `Select ${secondLabel}`);
      boxes[boxes.length - 1].props.onChange({ target: { checked: true } });
      const blocked = render(panel);
      expect(radios(blocked).find(node => node.props.value === 'same_payments')!.props.disabled).toBe(true);
      expect(text(blocked)).toContain(SAME_DISABLED_NEC);
    }
    radio(render(panel), 'separate_income');
    await submit(render(panel));
    expect(text(render(panel))).toContain('$24,000.00');
  });

  it('R-65 keeps the corrected-form pick blank until the user chooses one', async () => {
    records.receipts = [];
    records.forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    render(panel); await flush();
    check(render(panel), '1099-NEC · Client A $12,000.00');
    const second = walk(render(panel)).filter(node => node.props?.['aria-label'] === 'Select 1099-NEC · Client A $12,500.00');
    second[second.length - 1].props.onChange({ target: { checked: true } });
    radio(render(panel), 'corrected_form_replaces');
    const blank = render(panel);
    const picks = radios(blank).filter(node => node.props.name === 'corrected-form');
    expect(picks).toHaveLength(2);
    expect(picks.every(node => node.props.checked === false)).toBe(true);
    expect(text(blank)).toContain(CORRECTED_PICK_QUESTION);
    expect(walk(blank).find(node => node.props?.type === 'submit')!.props.disabled).toBe(true);
    picks[1].props.onChange();
    expect(walk(render(panel)).find(node => node.props?.type === 'submit')!.props.disabled).toBe(false);
  });

  it('R-68 saves a corrected form without matching the amounts or opening the confirm dialog', async () => {
    records.receipts = [];
    records.forms = [form('n1', 12000, '1099-NEC', 'Client A'), form('n2', 12500, '1099-NEC', 'Client A')];
    render(panel); await flush();
    check(render(panel), '1099-NEC · Client A $12,000.00');
    walk(render(panel)).filter(node => node.props?.['aria-label'] === 'Select 1099-NEC · Client A $12,500.00').at(-1)!.props.onChange();
    radio(render(panel), 'corrected_form_replaces');
    radios(render(panel)).filter(node => node.props.name === 'corrected-form')[1].props.onChange();
    const ready = render(panel);
    expect(preview(ready)).toBe(fillIncomeCopy(CORRECTED_PREVIEW, { corrected: '$12,500.00', original: '$12,000.00' }));
    expect(dialog(ready)).toBeUndefined();
    await submit(ready);
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0][1].body))).toMatchObject({ decision: 'corrected_form_replaces', correctedFormId: 'n2' });
    expect(dialog(render(panel))).toBeUndefined();
  });
});

describe('tax preview reconcile link', () => {
  it('R-57 opens income records on the reconcile tab from reviewPath or the helper', async () => {
    const reviewPath = '/protected?screen=income-tracking&tab=reconcile&year=2026';
    const screen = () => TaxPreviewScreen({ user: { id: 'owner' }, onBack() {}, onNavigate: harness.navigate });
    harness.request.mockResolvedValue(Response.json({ error: 'Review income sources', code: 'INCOME_RECONCILIATION_REQUIRED', conflicts: [], reviewPath }, { status: 422 }));
    render(screen); await flush();
    const incomeLink = () => walk(render(screen)).find(node => node.props?.href && text(node).includes('Income records'))!;
    expect(incomeLink().props.href).toBe(reviewPath);
    harness.request.mockResolvedValue(Response.json({ error: 'Review income sources', code: 'INCOME_RECONCILIATION_REQUIRED', conflicts: [] }, { status: 422 }));
    await walk(render(screen)).find(node => node.props?.['aria-label'] === 'Refresh tax estimate')!.props.onClick();
    await flush();
    expect(incomeLink().props.href).toBe(incomeReconciliationPath(2026));
  });
});
