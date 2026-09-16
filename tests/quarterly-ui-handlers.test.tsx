import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const i = h.cursor++, old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/components/landing/landing-header', () => ({ LandingHeader: 'LandingHeader' }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
import { QuarterlyEstimateClient } from '../app/tools/quarterly-estimate-calculator/quarterly-estimate-client';
import { QuarterlyTaxCalculator } from '../components/quarterly-tax-calculator';
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function render(component: () => any = QuarterlyEstimateClient) { h.cursor = 0; const tree = component(); h.effects.splice(0).forEach(effect => effect()); return tree; }
function field(label: string, value: string) { walk(render()).find(n => n.props?.['aria-label'] === label).props.onChange({ target: { value } }); }
function submit() { walk(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); }
beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; h.request.mockReset(); });
afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); });

describe('public regular-method tool uses complete reviewed inputs', () => {
  it('never presents zero-dollar installments from missing facts', () => {
    submit(); const content = text(render()); expect(content).toContain('Choose whether'); expect(content).not.toContain('$0.00'); expect(content).not.toContain('Regular-method illustration');
  });
  it('uses the prior-year AGI and withholding inputs, shows original dates, and clears results on edit', () => {
    field('Expected annual federal tax', '20000'); field('Expected annual withholding', '2000'); field('Prior-year return', 'eligible'); field('Prior-year AGI', '200000'); field('Prior-year tax', '10000');
    walk(render()).filter(n => n.props?.type === 'checkbox').forEach(n => n.props.onChange({ target: { checked: true } }));
    submit(); let content = text(render()); expect(content).toContain('$9,000.00'); expect(content).toContain('$2,250.00'); expect(content).toContain('2026-04-15'); expect(content).toContain('2027-01-15'); expect(content).toContain('not a current balance');
    field('Prior-year AGI', ''); content = text(render()); expect(content).not.toContain('$2,250.00');
    submit(); expect(text(render())).toContain('Enter prior-year AGI');
  });
  it('requires exemption review when no prior return was filed before showing current-year installments', () => {
    field('Expected annual federal tax', '20000'); field('Expected annual withholding', '0'); field('Prior-year return', 'unavailable');
    walk(render()).filter(n => n.type === 'label' && !text(n).includes('no-prior-tax exception'))
      .flatMap(walk).filter(n => n.props?.type === 'checkbox').forEach(n => n.props.onChange({ target: { checked: true } }));
    submit(); let content = text(render());
    expect(content).toContain('Review the no-prior-year-tax exception'); expect(content).not.toContain('$18,000.00');
    const exceptionLabel = walk(render()).find(n => n.type === 'label' && text(n).includes('no-prior-tax exception'));
    walk(exceptionLabel).find(n => n.props?.type === 'checkbox').props.onChange({ target: { checked: true } });
    submit(); content = text(render()); expect(content).toContain('$18,000.00'); expect(content).toContain('$4,500.00');
  });
});

describe('authenticated quarterly summary handles review and stale data', () => {
  const currentYear = new Date().getFullYear();
  const response = () => Response.json({ taxYear: currentYear, totalEstimatedTax: 12000, recordedEstimatedPayments: 100, w2Withheld: 0, calculationWarnings: [], paymentReview: { message: 'Review dated payments before choosing an installment.' }, quarters: [{ quarter: 1, dueDate: `${currentYear}-04-15`, amountPaid: 100 }] });
  it('displays recorded annual figures without inventing per-quarter payment or penalty status', async () => {
    h.request.mockImplementation(response);
    const component = () => QuarterlyTaxCalculator({ userProfile: { id: 'synthetic' }, transactions: [] });
    expect(text(render(component))).toContain('Loading'); await flush(); const content = text(render(component));
    expect(content).toContain('$12,000.00'); expect(content).toContain('Payment amount needs review'); expect(content).not.toContain('$3,000'); expect(content).not.toContain('Overdue');
  });
  it('shows total federal withholding including benefit withholding instead of the W2-only amount', async () => {
    h.request.mockResolvedValue(Response.json({ ...(await response().json()), w2Withheld: 1000, totalFederalWithheld: 1250 }));
    const component = () => QuarterlyTaxCalculator({ userProfile: { id: 'synthetic' }, transactions: [] });
    render(component); await flush(); const content = text(render(component));
    expect(content).toContain('$1,250.00'); expect(content).not.toContain('$1,000.00');
  });
  it('preserves422 guidance and removes earlier amounts immediately after inputs change', async () => {
    h.request.mockImplementation(response); let transactions: unknown[] = [];
    const component = () => QuarterlyTaxCalculator({ userProfile: { id: 'synthetic' }, transactions });
    render(component); await flush(); expect(text(render(component))).toContain('$12,000.00');
    h.request.mockResolvedValue(Response.json({ code: 'SOCIAL_SECURITY_REVIEW_REQUIRED', error: 'Review Social Security benefits before calculating tax.' }, { status: 422 }));
    transactions = [{ id: 'new-record' }]; expect(text(render(component))).not.toContain('$12,000.00'); await flush();
    const content = text(render(component)); expect(content).toContain('Review Social Security benefits'); expect(content).not.toContain('$0.00');
  });
});
