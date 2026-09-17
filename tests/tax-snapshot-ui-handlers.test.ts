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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.navigate, replace: harness.navigate }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'snapshot-owner' }, loading: false }) }));
import { TaxFilingHubScreen } from '../components/tax-filing-hub-screen';
import { TaxPreviewScreen } from '../components/tax-preview-screen';
import { FileTaxesScreen } from '../components/file-taxes-screen';
import { reviewTargetForCode } from '../lib/tax/dashboard-snapshot';

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
    income: { grossReceipts: 20000, income1099: 0, scheduleCNetProfit: 15000, totalDeductible: 5000, w2Wages: 50000, socialSecurityNetBenefits: 0, socialSecurity: 0 },
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
  return Promise.resolve(response({ data: { year: taxYear, netProfit: 15000, totalIncome: 20000,
    totalExpenses: 5000, confirmedExpenses: 5000, depreciationDeduction: 0 } }));
}
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.request.mockReset(); harness.navigate.mockReset();
  harness.request.mockImplementation(requests);
});

describe('filing hub uses the successful shared tax snapshot', () => {
  it('shows the confirmed expense amount when the Schedule C response has no count', async () => {
    harness.request.mockImplementation((url: string) => {
      const taxYear = Number(new URL(url, 'http://localhost').searchParams.get('year'));
      if (url.includes('compute-1040')) {
        const data = snapshot(taxYear);
        data.income.totalDeductible = 350;
        data.income.scheduleCNetProfit = 19650;
        return Promise.resolve(response(data));
      }
      return Promise.resolve(response({ data: { year: taxYear, netProfit: 19650, totalIncome: 20000,
        totalExpenses: 350, confirmedExpenses: 350, depreciationDeduction: 0 } }));
    });
    render(); await flush(); const tree = render();
    const expenseRow = walk(tree).find(node => node.key === 'expenses')!;
    expect(text(expenseRow)).toContain('$350 net confirmed expense amount');
    expect(text(expenseRow)).toContain('Recorded');
    expect(text(tree)).not.toContain('No confirmed expenses yet');
    expect(text(tree)).toContain('They do not establish that your return is complete or ready to file.');
  });

  it.each([0, -50])('keeps a net expense amount of %s reviewable instead of inferring a record count', async amount => {
    harness.request.mockImplementation((url: string) => {
      const taxYear = Number(new URL(url, 'http://localhost').searchParams.get('year'));
      if (!url.includes('compute-1040')) return requests(url);
      const data = snapshot(taxYear);
      Object.assign(data.income, { grossReceipts: 0, totalDeductible: amount, scheduleCNetProfit: -amount });
      data.form1040.totalIncome = 50000 - amount;
      return Promise.resolve(response(data));
    });
    render(); await flush(); const tree = render();
    const expenseRow = walk(tree).find(node => node.key === 'expenses')!;
    expect(text(expenseRow)).toContain(`${amount === 0 ? '$0' : '-$50'} net confirmed expense amount`);
    expect(text(expenseRow)).toContain('Review expenses and refunds');
    expect(text(expenseRow)).not.toContain('Recorded');
    expect(text(tree)).not.toContain('No confirmed expenses yet');
    // W-2 wages alone do not establish recorded business income/expenses.
    const businessRow = walk(tree).find(node => node.key === 'schedule-c')!;
    expect(text(businessRow)).not.toContain('Recorded');
  });

  it('surfaces income reconciliation 422 and marks readiness unavailable instead of summing overlapping income', async () => {
    const error = 'Review income sources before calculating tax: Transactions, gross receipts or 1099 forms may describe the same payments.';
    harness.request.mockImplementation((url: string) => url.includes('compute-1040')
      ? Promise.resolve(response({ error, code: 'INCOME_RECONCILIATION_REQUIRED' }, 422)) : requests(url));
    render(); await flush(); const tree = render(); const content = text(tree);
    expect(content).toContain(error);
    expect(content).toContain('Records and estimates');
    expect(content).not.toContain('Filing readiness');
    expect(content).not.toContain('$40,000');
    expect(content).not.toContain('steps complete');
    const exports = walk(tree).filter(node => text(node).trim() === 'Export PDF' && node.props?.onClick);
    expect(exports.map(node => node.props.disabled)).toEqual([true, false, false]);
    expect(walk(tree).find(node => text(node) === 'Download records archive (JSON)' && node.props?.onClick)!.props.disabled).toBe(false);
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

  it('wires recorded quarterly payments and 1099-documented receipts from the snapshot instead of zeros', async () => {
    harness.request.mockImplementation((url: string) => {
      if (!url.includes('compute-1040')) return requests(url);
      const data = snapshot(Number(new URL(url, 'http://localhost').searchParams.get('year')));
      data.payments.estimatedPayments = 750;
      data.income.income1099 = 20000;
      return Promise.resolve(response(data));
    });
    render(); await flush(); const tree = render();
    const quarterlyRow = walk(tree).find(node => node.key === 'quarterly')!;
    expect(text(quarterlyRow)).toContain('$750 in recorded estimated payments');
    expect(text(quarterlyRow)).toContain('Recorded');
    expect(text(quarterlyRow)).not.toContain('Review if you made quarterly payments');
    expect(text(walk(tree).find(node => node.key === 'income')!)).toContain('$65,000 total income · $20,000 documented on 1099 forms');
    expect(text(tree)).toContain('After $750 in recorded estimated payments and $0 in W-2 withholding.');
  });

  it('keeps quarterly payments reviewable when none are recorded and omits a 1099 total of zero', async () => {
    render(); await flush(); const tree = render();
    const quarterlyRow = walk(tree).find(node => node.key === 'quarterly')!;
    expect(text(quarterlyRow)).toContain('Review if you made quarterly payments');
    expect(text(quarterlyRow)).toContain('Review'); expect(text(quarterlyRow)).not.toContain('Recorded');
    const incomeRow = text(walk(tree).find(node => node.key === 'income')!);
    expect(incomeRow).toContain('$65,000 total income'); expect(incomeRow).not.toContain('1099');
    expect(text(tree)).toContain('After $0 in recorded estimated payments');
  });

  it.each([{ payments: { estimatedPayments: 'none' } }, { payments: {} }, { income: { income1099: null } }])('treats a snapshot missing payment or 1099 totals %j as unavailable', async override => {
    harness.request.mockImplementation((url: string) => {
      if (!url.includes('compute-1040')) return requests(url);
      const data = snapshot(Number(new URL(url, 'http://localhost').searchParams.get('year')));
      const merged = { ...data, ...override, income: { ...data.income, ...(override as any).income } };
      return Promise.resolve(response(merged));
    });
    render(); await flush(); const tree = render();
    expect(text(tree)).toContain('The federal estimate is incomplete or belongs to another year.');
    expect(text(tree)).not.toContain('$65,000');
  });

  it('shows the calculation warnings beside every refund or balance figure and hides both on a 422', async () => {
    harness.request.mockImplementation((url: string) => {
      if (!url.includes('compute-1040')) return requests(url);
      const data = snapshot(Number(new URL(url, 'http://localhost').searchParams.get('year')));
      data.form1040.refund = 1200;
      data.form1040.calculationWarnings = ['Synthetic limit: refunds reduce confirmed expenses.'];
      return Promise.resolve(response(data));
    });
    render(); await flush(); let tree = render();
    const estimate = walk(tree).find(node => node.type === 'section' && text(node).includes('federal planning estimate'))!;
    expect(text(estimate)).toContain('Estimated refund'); expect(text(estimate)).toContain('$1,200');
    // The notice element is a child component; it renders within the same section as the figure.
    const notice = walk(estimate).find(node => node.props?.warnings)!;
    expect(notice.props).toMatchObject({ taxYear: String(year), warnings: ['Synthetic limit: refunds reduce confirmed expenses.'] });
    harness.request.mockImplementation((url: string) => url.includes('compute-1040')
      ? Promise.resolve(response({ error: 'Review income sources first.', code: 'INCOME_RECONCILIATION_REQUIRED' }, 422)) : requests(url));
    walk(tree).find(node => node.props?.onValueChange)!.props.onValueChange(String(year - 1));
    render(); await flush(); tree = render();
    const unavailable = walk(tree).find(node => node.type === 'section' && text(node).includes('federal planning estimate'))!;
    expect(text(unavailable)).toContain('Unavailable'); expect(text(unavailable)).not.toContain('$1,200');
    expect(walk(unavailable).some(node => node.props?.warnings)).toBe(false);
  });

  it('hides prior-year figures if the next year fails and offers an actionable retry', async () => {
    render(); await flush(); const previous = render();
    harness.request.mockImplementation((url: string) => url.includes('compute-1040')
      ? Promise.resolve(response({ error: 'Saved tax inputs could not be loaded. Please retry.' }, 503)) : requests(url));
    walk(previous).find(node => node.props?.onValueChange)!.props.onValueChange(String(year - 1));
    render(); await flush(); const tree = render();
    expect(text(tree)).not.toContain('$65,000');
    expect(text(tree)).toContain('Saved tax inputs could not be loaded. Please retry.');
    expect(text(tree)).toContain('Records and estimates');
    harness.request.mockImplementation(requests);
    await walk(tree).find(node => node.props?.onClick && text(node) === 'Retry filing summary')!.props.onClick();
    expect(text(render())).toContain('$65,000');
  });
});

describe('file taxes screen routes Schedule C through the shared federal snapshot', () => {
  const renderFileTaxes = () => render(FileTaxesScreen as unknown as typeof TaxFilingHubScreen);
  const providerCopy = 'WriteOff prepares your tax data, filing and payment are';

  it('shows the reconciled server figures instead of a client-side aggregate', async () => {
    renderFileTaxes(); await flush(); const tree = renderFileTaxes(); const content = text(tree);
    expect(harness.request.mock.calls.map(([url]) => url)).toEqual([`/api/tax/compute-1040?year=${year}`]);
    expect(content).toContain('Gross receipts'); expect(content).toContain('$20,000.00');
    expect(content).toContain('Confirmed expenses'); expect(content).toContain('$5,000.00');
    expect(content).toContain('Net profit'); expect(content).toContain('$15,000.00');
    expect(content).toContain('same federal calculation shown on your dashboard');
    expect(content).toContain(providerCopy);
    expect(content).toContain('Continue to TurboTax');
    expect(walk(tree).some(node => node.props?.role === 'alert')).toBe(false);
  });

  it('renders the 422 review message with a deep link to the input screen and never a profit figure', async () => {
    const error = 'Review income sources before calculating tax: Transactions, gross receipts or 1099 forms may describe the same payments.';
    harness.request.mockImplementation(() => Promise.resolve(response({ error, code: 'INCOME_RECONCILIATION_REQUIRED' }, 422)));
    renderFileTaxes(); await flush(); const tree = renderFileTaxes(); const content = text(tree);
    const alert = walk(tree).find(node => node.props?.role === 'alert')!;
    expect(text(alert)).toContain(`${year} Schedule C summary needs review`);
    expect(text(alert)).toContain(error);
    const link = walk(alert).find(node => node.props?.href)!;
    expect(link.props.href).toBe('/protected?screen=income-tracking');
    expect(text(link)).toBe('Review income sources');
    expect(content).not.toContain('Net profit'); expect(content).not.toMatch(/\$\d/);
    expect(content).not.toContain('No business income or confirmed expenses');
    expect(content).toContain(providerCopy);
  });

  it('offers a retry without a deep link when the calculation is unavailable', async () => {
    harness.request.mockImplementation(() => Promise.resolve(response({ error: 'Could not complete the tax calculation. Please retry.' }, 503)));
    renderFileTaxes(); await flush(); let tree = renderFileTaxes();
    const alert = walk(tree).find(node => node.props?.role === 'alert')!;
    expect(text(alert)).toContain(`${year} Schedule C summary unavailable`);
    expect(walk(alert).some(node => node.props?.href)).toBe(false);
    harness.request.mockImplementation(requests);
    walk(alert).find(node => node.props?.onClick && text(node) === 'Retry summary')!.props.onClick();
    renderFileTaxes(); await flush(); tree = renderFileTaxes();
    expect(text(tree)).toContain('$15,000.00');
  });

  it('reloads the snapshot for the selected supported year and shows the empty state for zero records', async () => {
    renderFileTaxes(); await flush(); const tree = renderFileTaxes();
    const select = walk(tree).find(node => node.type === 'select')!;
    expect(walk(select).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['2026', '2025', '2024']);
    harness.request.mockImplementation((url: string) => {
      const data = snapshot(Number(new URL(url, 'http://localhost').searchParams.get('year')));
      Object.assign(data.income, { grossReceipts: 0, totalDeductible: 0, scheduleCNetProfit: 0 });
      return Promise.resolve(response(data));
    });
    select.props.onChange({ target: { value: String(year - 1) } });
    renderFileTaxes(); await flush(); const previous = renderFileTaxes();
    expect(harness.request.mock.calls.at(-1)![0]).toBe(`/api/tax/compute-1040?year=${year - 1}`);
    expect(text(previous)).toContain(`No business income or confirmed expenses recorded for ${year - 1}`);
    expect(text(previous)).not.toContain('Net profit');
  });
});

describe('review codes map to the input screen that fixes them', () => {
  it.each([
    ['FILING_STATUS_REVIEW_REQUIRED', 'settings', 'Review profile'],
    ['INCOME_RECONCILIATION_REQUIRED', 'income-tracking', 'Review income sources'],
    ['SOCIAL_SECURITY_REVIEW_REQUIRED', 'tax-organizer', 'Review Social Security records'],
    ['PERSONAL_DEDUCTION_REVIEW_REQUIRED', 'tax-organizer', 'Review personal deductions'],
    ['DEPENDENT_CREDIT_REVIEW_REQUIRED', 'tax-organizer', 'Review dependent eligibility'],
    ['EXPORT_REVIEW_REQUIRED', 'transactions', 'Review transactions'],
    ['DEPRECIATION_REVIEW_REQUIRED', 'tax-preview', 'Review tax inputs'],
    [undefined, 'tax-preview', 'Review tax inputs'],
  ])('%s → %s', (code, screen, label) => {
    expect(reviewTargetForCode(code)).toEqual({ screen, label });
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
