import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Runs the real UI request/state handlers. This is not a browser rendering test.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), navigate: vi.fn() }));
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
import { TaxFilingHubScreen } from '../components/tax-filing-hub-screen';
import { TaxPreviewScreen } from '../components/tax-preview-screen';

type Element = ReactElement<Record<string, any>>;
function render(component = TaxFilingHubScreen): Element {
  harness.cursor = 0;
  const tree = component({ user: { id: 'snapshot-owner' }, onBack() {}, onNavigate: harness.navigate }) as Element;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const year = new Date().getFullYear();
const response = (body: unknown, status = 200) => Response.json(body, { status });
function snapshot(taxYear = year) {
  return {
    taxYear,
    income: { grossReceipts: 20000, scheduleCNetProfit: 15000, totalDeductible: 5000, w2Wages: 50000, socialSecurityNetBenefits: 0, socialSecurity: 0 },
    w2: { count: 1, withheld: 0 }, seCalc: { totalSETax: 2000, halfSEDeduction: 1000 },
    deductions: { healthInsurancePremiums: 2000 }, payments: { estimatedPayments: 0 },
    form1040: { taxYear, totalIncome: 65000, totalTax: 0, balanceDue: 0, refund: 0, agi: 62000, effectiveRate: 0, marginalRate: 0, enhancedSeniorDeduction: 0, socialSecurityFederalWithheld: 0, calculationWarnings: [] },
  };
}
function requests(url: string) {
  const taxYear = Number(new URL(url, 'http://localhost').searchParams.get('year'));
  if (url.includes('compute-1040')) return Promise.resolve(response(snapshot(taxYear)));
  if (url.includes('gross-receipts')) return Promise.resolve(response({ totalGrossReceipts: 20000 }));
  if (url.includes('/1099')) return Promise.resolve(response({ forms: [{ amount: 20000 }] }));
  if (url.includes('schedule-se')) return Promise.resolve(response({ netProfit: 40000, totalIncome: 90000, calculation: { totalSETax: 9999 } }));
  return Promise.resolve(response({ confirmedCount: 35, totalDeductible: 5000 }));
}
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.request.mockReset(); harness.navigate.mockReset();
  harness.request.mockImplementation(requests);
});

describe('filing hub uses the successful shared tax snapshot', () => {
  it('surfaces income reconciliation 422 and marks readiness unavailable instead of summing overlapping income', async () => {
    const error = 'Review income sources before calculating tax: Transactions, gross receipts or 1099 forms may describe the same payments.';
    harness.request.mockImplementation((url: string) => url.includes('compute-1040')
      ? Promise.resolve(response({ error, code: 'INCOME_RECONCILIATION_REQUIRED' }, 422)) : requests(url));
    render(); await flush(); const tree = render(); const content = text(tree);
    expect(content).toContain(error);
    expect(content).toContain('Filing readinessUnavailable');
    expect(content).not.toContain('$40,000');
    expect(content).not.toContain('steps complete');
    expect(walk(tree).filter(node => text(node).trim() === 'Export PDF' && node.props?.onClick).every(node => node.props.disabled)).toBe(true);
    expect(harness.request.mock.calls.map(([url]) => url)).not.toEqual(expect.arrayContaining([expect.stringContaining('/income/')]));
  });

  it('uses snapshot income and self-employment tax, including explicitly calculated zeros', async () => {
    render(); await flush(); const content = text(render());
    expect(content).toContain('$65,000');
    expect(content).toContain('SE tax: $2,000');
    expect(content).toContain('$50,000 in W-2 wages · $0 withheld');
    expect(content).toContain('Total Tax$0');
    expect(content).not.toContain('$9,999');
    expect(content).not.toContain('$90,000');
  });

  it('hides prior-year figures if the next year fails and offers an actionable retry', async () => {
    render(); await flush(); const previous = render();
    harness.request.mockImplementation((url: string) => url.includes('compute-1040')
      ? Promise.resolve(response({ error: 'Saved tax inputs could not be loaded. Please retry.' }, 503)) : requests(url));
    walk(previous).find(node => node.props?.onValueChange)!.props.onValueChange(String(year - 1));
    render(); await flush(); const tree = render();
    expect(text(tree)).not.toContain('$65,000');
    expect(text(tree)).toContain('Saved tax inputs could not be loaded. Please retry.');
    expect(text(tree)).toContain('Filing readinessUnavailable');
    harness.request.mockImplementation(requests);
    await walk(tree).find(node => node.props?.onClick && text(node) === 'Retry filing summary')!.props.onClick();
    expect(text(render())).toContain('$65,000');
  });
});

describe('tax preview wage display', () => {
  it.each([0, 40000])('keeps W-2 wages at %s when other income and depreciation affect total income', async wages => {
    harness.request.mockImplementation((url: string) => {
      const data = snapshot(Number(new URL(url, 'http://localhost').searchParams.get('year')));
      data.income.w2Wages = wages;
      data.form1040.totalIncome = wages + 15000 + 500 - 1000;
      return Promise.resolve(response(data));
    });
    render(TaxPreviewScreen); await flush(); const collapsed = render(TaxPreviewScreen);
    walk(collapsed).find(node => node.props?.onClick && text(node) === 'Show')!.props.onClick();
    const row = walk(render(TaxPreviewScreen)).find(node => node.type === 'div' && node.props?.className?.includes('justify-between px-4 py-2') && text(node).includes('W-2 wages'))!;
    expect(text(row)).toContain(wages === 0 ? '$0' : '$40,000');
    expect(text(row)).not.toContain(wages === 0 ? '-$500' : '$39,500');
  });
});


describe('tax preview personal deduction and benefit contract', () => {
  it.each(['PERSONAL_DEDUCTION_REVIEW_REQUIRED', 'DEPENDENT_CREDIT_REVIEW_REQUIRED'])('routes %s to Tax Organizer without fake totals or the add-income empty state', async code => {
    render(TaxPreviewScreen); await flush(); const previous = render(TaxPreviewScreen);
    expect(text(previous)).toContain('$65,000');
    harness.request.mockResolvedValue(response({ code, error: 'Review the saved eligibility answers in Tax Organizer.' }, 422));
    await walk(previous).find(node => node.props?.['aria-label'] === 'Refresh tax estimate')!.props.onClick();
    const tree = render(TaxPreviewScreen), content = text(tree);
    expect(content).toContain('Review the saved eligibility answers in Tax Organizer.');
    expect(content).not.toContain('No data yet'); expect(content).not.toContain('Add Income');
    expect(content).not.toContain('$65,000'); expect(content).not.toContain('$0');
    walk(tree).find(node => node.props?.onClick && text(node) === 'Review Tax Organizer')!.props.onClick();
    expect(harness.navigate).toHaveBeenCalledWith('tax-organizer');
  });

  it('shows server-provided net and taxable benefits, benefit withholding, and the separate senior deduction', async () => {
    const data = snapshot(2026);
    Object.assign(data.income, { socialSecurityNetBenefits: 20000, socialSecurity: 17000 });
    Object.assign(data.form1040, { enhancedSeniorDeduction: 6000, socialSecurityFederalWithheld: 1200 });
    harness.request.mockResolvedValue(response(data));
    render(TaxPreviewScreen); await flush();
    walk(render(TaxPreviewScreen)).find(node => node.props?.onClick && text(node) === 'Show')!.props.onClick();
    const rows = walk(render(TaxPreviewScreen)).filter(node => node.type === 'div' && node.props?.className?.includes('justify-between px-4 py-2')).map(text);
    expect(rows).toEqual(expect.arrayContaining([
      expect.stringContaining('Net Social Security benefits$20,000'),
      expect.stringContaining('Taxable Social Security benefits$17,000'),
      expect.stringContaining('Social Security / RRB withholding($1,200)'),
      expect.stringContaining('Enhanced senior deduction($6,000)'),
    ]));
  });
});
