import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: new Map<number, () => void>(), request: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (next: unknown) => { state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = { current: initial };
      return state.slots[index];
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as unknown[] | undefined;
      if (previous?.length === dependencies.length && previous.every((value, position) => Object.is(value, dependencies[position]))) return;
      state.slots[index] = dependencies;
      state.effects.push(() => {
        state.cleanups.get(index)?.();
        const cleanup = effect();
        if (typeof cleanup === 'function') state.cleanups.set(index, cleanup);
      });
    },
    useCallback<T>(callback: T, dependencies: unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { dependencies: unknown[]; callback: T } | undefined;
      if (previous?.dependencies.length === dependencies.length && previous.dependencies.every((value, position) => Object.is(value, dependencies[position]))) return previous.callback;
      state.slots[index] = { callback, dependencies };
      return callback;
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: state.request }));
import { DeductionsEntryScreen } from '../components/deductions-entry-screen';
import { IncomeTrackingScreen } from '../components/income-tracking-screen';

type Props = { children?: unknown; id?: string; 'aria-label'?: string; value?: unknown; disabled?: boolean; type?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void | Promise<void>; onValueChange?: (value: string) => void; onSubmit?: (event: { preventDefault(): void }) => Promise<void>;
};
type Element = ReactElement<Props>;
const walk = (node: unknown): Element[] => Array.isArray(node) ? node.flatMap(walk) : isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const props = { user: { id: 'synthetic-record-owner' }, onBack() {} };
const deductions = () => DeductionsEntryScreen(props);
const income = () => IncomeTrackingScreen(props);
function render(component: () => ReactElement) { state.cursor = 0; return component(); }
async function mount(component: () => ReactElement) {
  render(component); state.effects.splice(0).forEach(effect => effect());
  // Flush the fetch and response.json promises used by the real loading handlers.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return render(component);
}
function change(component: () => ReactElement, id: string, value: string) {
  const input = walk(render(component)).find(node => node.props.id === id);
  expect(input, `Missing input ${id}`).toBeDefined(); input!.props.onChange!({ target: { value } });
}
function click(component: () => ReactElement, label: string) {
  const button = walk(render(component)).find(node => typeof node.props.onClick === 'function' && text(node) === label);
  expect(button, `Missing button ${label}`).toBeDefined(); return button!.props.onClick!();
}
beforeEach(() => { state.slots = []; state.cursor = 0; state.effects = []; state.cleanups.clear(); vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { state.cleanups.forEach(cleanup => cleanup()); vi.clearAllTimers(); vi.useRealTimers(); });

function selectYear(component: () => ReactElement, year: number) {
  const select = walk(render(component)).find(node => typeof node.props.onValueChange === 'function' && /^\d{4}$/.test(String(node.props.value)));
  expect(select).toBeDefined(); select!.props.onValueChange!(String(year));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('compact record forms preserve saved values and input actions', () => {
  it('keeps every saved deduction in a disclosure and saves edits without clearing other groups', async () => {
    const saved = { healthInsurancePremiums: 1400, sepIraContribution: 2000, solo401kEmployeeContribution: 3000,
      solo401kEmployerContribution: 4000, simpleIraContribution: 5000, hsaContribution: 600,
      studentLoanInterest: 700, priorYearTotalTax: 8000, priorYearAGI: 150000.01, charitableCashDonations: 900, charitableNonCashDonations: 1000 };
    state.request.mockResolvedValueOnce(Response.json({ deductions: saved }));
    await mount(deductions);
    for (const [key, value] of Object.entries(saved)) {
      expect(walk(render(deductions)).find(node => node.props.id === `deduction-${key}`)?.props.value).toBe(String(value));
    }
    // Prior-year tax and AGI are reference facts, not a deduction subtotal.
    const priorYear = walk(render(deductions)).find(node => node.type === 'details' && text(node).includes('Prior-year tax and AGI'))!;
    expect(text(priorYear)).toContain('2 of 2 entered'); expect(text(priorYear)).not.toContain('$158,000');
    expect(text(priorYear)).toContain('Form 1040, line 11');
    change(deductions, 'deduction-hsaContribution', '625');
    state.request.mockResolvedValueOnce(Response.json({ success: true }));
    await click(deductions, 'Save deductions');
    const [url, options] = state.request.mock.calls.at(-1)!;
    expect(url).toBe('/api/tax/deductions');
    expect(JSON.parse(options.body)).toEqual({ taxYear: new Date().getFullYear(), ...saved, hsaContribution: 625 });
    expect(text(render(deductions))).toContain('Saved!');
  });
  it('keeps the entered deduction and visible error after a rejected save', async () => {
    state.request.mockResolvedValueOnce(Response.json({ deductions: null }));
    await mount(deductions); change(deductions, 'deduction-healthInsurancePremiums', '123');
    state.request.mockResolvedValueOnce(Response.json({ error: 'Review this amount' }, { status: 400 }));
    await click(deductions, 'Save deductions');
    const tree = render(deductions);
    expect(text(tree)).toContain('Review this amount');
    expect(walk(tree).find(node => node.props.id === 'deduction-healthInsurancePremiums')?.props.value).toBe('123');
    expect(text(tree)).not.toContain('Saved!');
  });
  it('still saves direct income from the compact Add Income action', async () => {
    state.request.mockResolvedValueOnce(Response.json({ forms: [] })).mockResolvedValueOnce(Response.json({ entries: [] }));
    await mount(income); await click(income, 'Add Income');
    change(income, 'income-source', 'Synthetic customer');
    change(income, 'income-amount', '42.50');
    change(income, 'income-description', 'Synthetic invoice');
    state.request.mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ entries: [] }));
    await walk(render(income)).find(node => node.type === 'form')!.props.onSubmit!({ preventDefault() {} });
    const [url, options] = state.request.mock.calls.find(call => call[1]?.method === 'POST')!;
    expect(url).toBe('/api/income/gross-receipts');
    expect(JSON.parse(options.body)).toMatchObject({ source: 'Synthetic customer', amount: 42.5, description: 'Synthetic invoice', type: 'freelance', taxYear: new Date().getFullYear() });
    expect(walk(render(income)).filter(node => node.type === 'form')).toHaveLength(0);
  });
  it('still saves a 1099 and exposes named delete controls for saved forms', async () => {
    state.request.mockResolvedValueOnce(Response.json({ forms: [] })).mockResolvedValueOnce(Response.json({ entries: [] }));
    await mount(income); await click(income, 'Add 1099');
    change(income, 'income-payer', 'Synthetic payer'); change(income, 'income-form-amount', '250');
    state.request.mockResolvedValueOnce(Response.json({ form: { id: 'form-one', payerName: 'Synthetic payer', amount: 250, formType: '1099-NEC', taxYear: new Date().getFullYear() } }));
    await walk(render(income)).find(node => node.type === 'form')!.props.onSubmit!({ preventDefault() {} });
    const [url, options] = state.request.mock.calls.at(-1)!;
    expect(url).toBe('/api/income/1099');
    expect(JSON.parse(options.body)).toEqual({ payerName: 'Synthetic payer', amount: 250, formType: '1099-NEC', taxYear: new Date().getFullYear() });
    expect(walk(render(income)).find(node => node.props['aria-label'] === 'Delete 1099-NEC from Synthetic payer')).toBeDefined();
  });
});


describe('record years, load failures, and deletion failures stay truthful', () => {
  it.each(['forms', 'receipts'] as const)('shows a recoverable %s load error instead of an empty-record claim', async kind => {
    state.request.mockImplementation(async (url: string) => url.includes(kind === 'forms' ? '/1099?' : '/gross-receipts?')
      ? Response.json({ error: 'Synthetic failure' }, { status: 503 })
      : Response.json({ forms: [], entries: [] }));
    const tree = await mount(income);
    expect(text(tree)).toContain(kind === 'forms' ? 'Could not load 1099 forms' : 'Could not load direct income');
    expect(text(tree)).not.toContain(kind === 'forms' ? 'No 1099 forms yet' : 'No income entries yet');
    expect(text(tree)).toContain(kind === 'forms' ? 'Retry 1099 forms' : 'Retry direct income');
  });
  it.each(['form', 'receipt'] as const)('retains a saved %s when the server rejects deletion', async kind => {
    state.request.mockResolvedValueOnce(Response.json({ forms: [{ id: 'form-one', payerName: 'Saved payer', amount: 150, formType: '1099-NEC', taxYear: 2026 }] }))
      .mockResolvedValueOnce(Response.json({ entries: [{ id: 'receipt-one', source: 'Saved client', amount: 150, date: '2026-01-01', type: 'freelance', taxYear: 2026 }] }));
    const tree = await mount(income);
    state.request.mockResolvedValueOnce(Response.json({ error: 'Synthetic failure' }, { status: 500 }));
    const name = kind === 'form' ? 'Delete 1099-NEC from Saved payer' : 'Delete income from Saved client';
    await walk(tree).find(node => node.props['aria-label'] === name)!.props.onClick!();
    expect(walk(render(income)).find(node => node.props['aria-label'] === name)).toBeDefined();
    expect(text(render(income))).toContain(kind === 'form' ? 'Could not delete this 1099 form' : 'Could not delete this income record');
  });
  it('new income uses the selected year and a date in that year', async () => {
    state.request.mockImplementation(async () => Response.json({ forms: [], entries: [] }));
    await mount(income);
    const year = new Date().getFullYear() - 1;
    selectYear(income, year); await mount(income); await click(income, 'Add Income');
    change(income, 'income-source', 'Prior year client'); change(income, 'income-amount', '100');
    state.request.mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ entries: [] }));
    await walk(render(income)).find(node => node.type === 'form')!.props.onSubmit!({ preventDefault() {} });
    const post = state.request.mock.calls.find(call => call[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toMatchObject({ taxYear: year, date: `${year}-01-01` });
    await click(income, 'Add 1099');
    const yearControl = walk(render(income)).find(node => node.props.id === 'income-form-year');
    expect(yearControl).toBeDefined();
    // The surrounding Select stores the new form's independent tax-year value.
    expect(walk(render(income)).filter(node => typeof node.props.onValueChange === 'function' && node.props.value === String(year))).toHaveLength(2);
  });
  it('ignores old income responses after selecting another year', async () => {
    const oldForms = deferred<Response>(); const oldReceipts = deferred<Response>();
    state.request.mockReturnValueOnce(oldForms.promise).mockReturnValueOnce(oldReceipts.promise);
    await mount(income);
    const year = new Date().getFullYear() - 1;
    selectYear(income, year);
    state.request.mockResolvedValueOnce(Response.json({ forms: [] })).mockResolvedValueOnce(Response.json({ entries: [] }));
    await mount(income);
    oldForms.resolve(Response.json({ forms: [{ id: 'wrong', payerName: 'Wrong year payer', amount: 9000, taxYear: year + 1 }] }));
    oldReceipts.resolve(Response.json({ entries: [{ id: 'wrong', source: 'Wrong year client', amount: 9000, date: '2026-01-01', type: 'freelance', taxYear: year + 1 }] }));
    await mount(income);
    expect(text(render(income))).not.toContain('Wrong year');
    expect(text(render(income))).not.toContain('$9,000');
  });
  it('clears deductions when the newly selected year has no record and blocks save during load', async () => {
    state.request.mockResolvedValueOnce(Response.json({ deductions: { healthInsurancePremiums: 1400 } }));
    await mount(deductions);
    const pending = deferred<Response>(); state.request.mockReturnValueOnce(pending.promise);
    selectYear(deductions, new Date().getFullYear() - 1);
    await mount(deductions);
    expect(text(render(deductions))).not.toContain('$1,400');
    expect(walk(render(deductions)).some(node => text(node) === 'Save deductions')).toBe(false);
    pending.resolve(Response.json({ deductions: null })); await mount(deductions);
    expect(walk(render(deductions)).find(node => node.props.id === 'deduction-healthInsurancePremiums')?.props.value).toBe('');
  });
  it('ignores a late deduction response from the previous year', async () => {
    const old = deferred<Response>(); state.request.mockReturnValueOnce(old.promise);
    await mount(deductions); selectYear(deductions, new Date().getFullYear() - 1);
    state.request.mockResolvedValueOnce(Response.json({ deductions: { hsaContribution: 250 } }));
    await mount(deductions);
    old.resolve(Response.json({ deductions: { hsaContribution: 9999 } })); await mount(deductions);
    expect(walk(render(deductions)).find(node => node.props.id === 'deduction-hsaContribution')?.props.value).toBe('250');
  });
  it('does not offer to overwrite deductions after a failed load', async () => {
    state.request.mockResolvedValueOnce(Response.json({ error: 'Synthetic failure' }, { status: 500 }));
    const tree = await mount(deductions);
    expect(text(tree)).toContain('Could not load deductions');
    expect(text(tree)).toContain('Retry deductions');
    expect(text(tree)).not.toContain('Save deductions');
  });
});
