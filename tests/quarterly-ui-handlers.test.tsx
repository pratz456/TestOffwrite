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
import { buildQuarterlyPlan, QUARTERLY_PLANNER_READY_MESSAGE, type MissingFact } from '../lib/tax-provider/quarterly-planner';
const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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

describe('authenticated quarterly summary renders planner figures or the specific missing facts', () => {
  const currentYear = new Date().getFullYear();
  // Facts are pinned to 2026 so the fixture stays valid; the component only checks that taxYear matches the current year.
  const plan = (asOf = '2026-09-01') => buildQuarterlyPlan({
    taxYear: 2026, filingStatus: 'single', currentYearTax: 20000, withholding: 0, priorYear: { available: true, totalTax: 10000, agi: 100000, coveredTwelveMonths: true },
    payments: [{ amount: 2500, paidDate: '2026-04-10', recordedQuarter: 1 }], asOf,
  });
  const ready = (planner = plan()) => Response.json({
    taxYear: currentYear, totalEstimatedTax: 20000, recordedEstimatedPayments: 2500, w2Withheld: 0, calculationWarnings: [],
    paymentReview: { code: 'QUARTERLY_PLANNER_READY', message: QUARTERLY_PLANNER_READY_MESSAGE }, planner,
    quarters: planner.installments.map(item => ({ quarter: item.quarter, dueDate: item.dueDate, amountPaid: item.quarter === 1 ? 2500 : 0, recommended: item.plannedEstimatedPayment, status: item.status })),
  });
  const component = () => QuarterlyTaxCalculator({ userProfile: { id: 'synthetic' }, transactions: [] });
  const anchors = (tree: any) => walk(tree).filter(n => n.type === 'a').map(n => n.props.href as string);

  it('shows the next due date, the amount to pay by it, the safe-harbor basis, recorded payments and a labeled interest illustration', async () => {
    const planner = plan(); h.request.mockImplementation(() => ready(planner));
    render(component); await flush(); const tree = render(component); const content = text(tree);
    expect(content).toContain('Planning estimate from reviewed facts'); expect(content).not.toContain('Payment amount needs review');
    expect(content).toContain('Next due date: 2026-09-15 (Q3)'); expect(content).toContain('$5,000.00'); expect(content).toContain('the Q3 installment alone is $2,500.00');
    expect(content).toContain('Safe-harbor basis used: 100% of 2025 tax ($10,000.00)'); expect(content).toContain('90% of the 2026 estimate ($18,000.00)');
    expect(content).toContain('Payment recorded: $2,500.00'); expect(content).toContain('No payment recorded'); expect(content).toContain('Upcoming');
    expect(content).toContain('Underpayment interest illustration (not a penalty determination)'); expect(content).toContain(`Illustrated interest so far: ${money(planner.underpaymentInterestIllustration.total!)}`);
    expect(content).toContain('April 16 – June 30, 2026: 6%'); expect(content).toContain('annualized income installment method');
    expect(content).toContain('Assumptions behind this planning estimate'); expect(anchors(tree)).toContain('https://www.irs.gov/instructions/i2210');
    expect(content).not.toContain('Overdue'); expect(content).not.toMatch(/you owe/i); expect(content).not.toMatch(/penalty (is|will be) due/i);
  });
  it('lists each missing fact with a link to the screen where it is entered instead of any payment figure', async () => {
    const missingFacts: MissingFact[] = [
      { key: 'prior_year_agi', label: '2025 adjusted gross income', detail: 'Enter the AGI from your 2025 Form 1040 (line 11).', enterAt: [{ screen: 'tax-organizer', href: '/protected?screen=tax-organizer', label: 'Tax Organizer › Prior year' }, { screen: 'deductions-entry', href: '/protected?screen=deductions-entry', label: 'Deductions › Prior-year tax' }] },
      { key: 'prior_return_twelve_months', label: '2025 return covered 12 months', detail: 'Answer whether your 2025 federal return covered a full 12 months.', enterAt: [{ screen: 'tax-organizer', href: '/protected?screen=tax-organizer', label: 'Tax Organizer › Prior year' }] },
    ];
    h.request.mockImplementation(() => Response.json({
      taxYear: currentYear, totalEstimatedTax: 20000, recordedEstimatedPayments: 0, w2Withheld: 0, calculationWarnings: [], quarters: [{ quarter: 1, dueDate: '2026-04-15', amountPaid: 0 }],
      paymentReview: { code: 'QUARTERLY_REVIEW_REQUIRED', message: 'Review required.', missingFacts, notes: ['Planning figures stay hidden until every listed fact is saved.'] },
      planner: { status: 'review_required', missingFacts, notes: ['Planning figures stay hidden until every listed fact is saved.'] },
    }));
    render(component); await flush(); const tree = render(component); const content = text(tree);
    expect(content).toContain('Payment amount needs review'); expect(content).toContain('2025 adjusted gross income'); expect(content).toContain('2025 return covered 12 months');
    expect(content).toContain('Planning figures stay hidden'); expect(anchors(tree)).toContain('/protected?screen=tax-organizer'); expect(anchors(tree)).toContain('/protected?screen=deductions-entry');
    expect(content).not.toContain('Next due date'); expect(content).not.toContain('to pay by that date'); expect(content).not.toContain('Safe-harbor basis used'); expect(content).toContain('No payment recorded');
  });
  it('says the interest illustration is unavailable when the 2027 rate is unpublished rather than showing $0', async () => {
    const planner = plan('2027-02-01'); h.request.mockImplementation(() => ready(planner));
    render(component); await flush(); const content = text(render(component));
    expect(planner.underpaymentInterestIllustration.total).toBeNull();
    expect(content).toContain('Illustrated interest so far: not available yet'); expect(content).toContain('2027-Q1'); expect(content).toContain('January 1 – April 15, 2027: not yet published');
    expect(content).toContain('All 2026 installment dates have passed'); expect(content).toContain('Remaining regular-method shortfall (planning estimate): $7,500.00');
    expect(content).not.toContain('Illustrated interest so far: $0.00');
  });
  it('rejects a malformed planner payload instead of rendering partial figures', async () => {
    h.request.mockImplementation(() => Response.json({ taxYear: currentYear, totalEstimatedTax: 20000, recordedEstimatedPayments: 0, w2Withheld: 0, calculationWarnings: [], quarters: [], paymentReview: { message: 'x' }, planner: { status: 'ready' } }));
    render(component); await flush(); const content = text(render(component));
    expect(content).toContain('The quarterly summary is incomplete'); expect(content).not.toContain('$20,000.00');
  });
});
