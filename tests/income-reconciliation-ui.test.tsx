import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const form = (id: string, amount: number, formType = '1099-K') => ({ id, amount, formType, payerName: 'Synthetic platform' });
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
  const prepared = prepareReconciliationDecision(2026, records, { id, decision: body.decision, sources: body.sources, platformFeeAmount: body.platformFeeAmount ?? 0, note: body.note ?? '' });
  if (!prepared.ok) return Promise.resolve(Response.json({ error: prepared.reason }, { status: prepared.status }));
  records.decisions = [...records.decisions.filter(decision => decision.id !== id), { id, ...prepared.stored, decidedAt: '2026-04-01T12:00:00.000Z' }];
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
    expect(content).toContain('$20,000 and 200 transactions');
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
    const ready = render(panel);
    expect(preview(ready)).toBe('Counts $12,000.00 once. Gross receipts for 2026 would be $12,000.00 if no other conflicts remain.');
    expect(walk(ready).find(node => node.props?.type === 'submit')!.props.disabled).toBe(false);
    await submit(ready);
    const [, init] = harness.request.mock.calls.find(([url, options]) => url === '/api/income/reconciliation' && options?.method === 'POST')!;
    expect(JSON.parse(String(init.body))).toEqual({ taxYear: 2026, decision: 'same_payments', platformFeeAmount: 0, note: '',
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
    records.decisions = [{ id: 'old', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 11000, decidedAt: '2026-02-01T00:00:00.000Z',
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
    records.decisions = [{ id: 'd-existing', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, countedAmount: 12000, decidedAt: '2026-02-01T00:00:00.000Z',
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
