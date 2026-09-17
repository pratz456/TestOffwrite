import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ uid: 'owner-a' as string | null, txError: null as string | null, transactions: [] as Record<string, unknown>[], paid: 750, depreciation: 0, reads: [] as string[], collections: {} as Record<string, Record<string, unknown>[]>, profile: {} as Record<string, unknown> }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null, error: state.uid ? null : 'unauthenticated' }) }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => { if (state.txError) throw new Error(state.txError); return state.transactions; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: [], error: state.txError }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: state.depreciation ? [{}] : [], error: null }) }));
vi.mock('@/lib/reports/calc4562', () => ({ calc4562: () => ({ totalDepreciation: state.depreciation }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  state.reads.push(name);
  return {
    where() { return this; }, limit() { return this; },
    get: async () => ({ empty: !(state.collections[name]?.length), docs: (state.collections[name] || []).map(data => ({ data: () => data })) }),
    doc: (uid: string) => ({ collection: (sub: string) => ({ doc: (id: string) => ({ get: async () => {
      state.reads.push(`${name}/${uid}/${sub}/${id}`);
      return { exists: id === 'Q1_2026', data: () => ({ paidAmount: state.paid }) };
    } }) }) }),
  };
} } }));
import { GET } from '../app/api/tax/compute-1040/route';

beforeEach(() => {
  state.uid = 'owner-a'; state.txError = null; state.transactions = []; state.paid = 750; state.depreciation = 0; state.reads.length = 0;
  state.profile = { filing_status: 'single', w2_federal_withheld: 99999 };
  state.collections = { tax_organizers: [reviewedPersonalDeductionOrganizer()], w2_income: [{ box1Wages: 100000, box2FederalWithheld: 5000, box3SocialSecurityWages: 100000, box5MedicareWages: 100000 }] };
});
function request(year = '2026') { return new NextRequest(`http://localhost/api/tax/compute-1040?year=${year}`); }

describe('Form1040 API integration', () => {
  it('uses saved quarterly payments and does not add duplicate profile withholding over W-2 forms', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const data = await response.json();
    expect(data.payments).toEqual({ estimatedPayments: 750, w2FederalWithheld: 5000, socialSecurityFederalWithheld: 0, totalFederalWithheld: 5000 });
    expect(data.form1040.standardDeduction).toBe(16100);
    expect(data.form1040.incomeTax).toBe(13170);
    expect(state.reads).toContain('user_profiles/owner-a/quarterly_payments/Q1_2026');
    expect(state.reads).not.toContain('quarterly_payments');
  });

  it('applies depreciation before Schedule SE and keeps a zero Box3 from falling back to Box1', async () => {
    state.collections = { tax_organizers: [reviewedPersonalDeductionOrganizer()], gross_receipts: [{ amount: 100000 }], w2_income: [{ box1Wages: 100000, box3SocialSecurityWages: 0, box5MedicareWages: 100000 }] };
    state.depreciation = 20000;
    const result = await (await GET(request())).json();
    expect(result.seCalc.netProfitFromScheduleC).toBe(80000);
    expect(result.seCalc.socialSecurityTax).toBe(9161.12);
    expect(result.seCalc.totalSETax).toBe(11303.64);
  });

  it.each(['2027', '2026garbage', 'NaN', '2026.5', '0x7ea', '2.026e3', '2026%20'])('rejects unavailable/invalid year %s before reading financial data', async year => {
    expect((await GET(request(year))).status).toBe(400);
    expect(state.reads).toEqual([]);
  });

  it.each([undefined, reviewedPersonalDeductionOrganizer(2025)])('requires current-year personal deduction facts before exposing an annual amount', async organizer => {
    state.collections.tax_organizers = organizer ? [organizer] : [];
    const response = await GET(request());
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('PERSONAL_DEDUCTION_REVIEW_REQUIRED');
    expect(body.error).toContain('Tax Organizer');
    expect(body).not.toHaveProperty('form1040');
  });

  it('reports a data-load failure instead of a calculation from silent zeros', async () => {
    state.txError = 'internal provider details';
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('internal provider details');
  });

  it.each([
    { date: 'invalid', amount: 100, category: 'SERVICE_SUBSCRIPTION', is_deductible: true },
    { date: '2026-01-15', amount: 'invalid', category: 'SERVICE_SUBSCRIPTION', is_deductible: true },
    { date: '2026-01-15', amount: 100, iso_currency_code: 'EUR', category: 'SERVICE_SUBSCRIPTION', is_deductible: true },
  ])('withholds the annual estimate when export inputs require review: %j', async transaction => {
    state.transactions = [transaction];
    const result = await GET(request()); expect(result.status).toBe(422);
    expect(await result.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
  });

  it('requires authentication before financial reads', async () => {
    state.uid = null;
    expect((await GET(request())).status).toBe(401);
    expect(state.reads).toEqual([]);
  });
});

describe('Form1040 API informational state planning estimate', () => {
  it('omits the state estimate and notices when no state is saved', async () => {
    const data = await (await GET(request())).json();
    expect(data.stateTax).toBeNull();
    expect(data.businessTaxNotices).toEqual([]);
    expect(data.form1040).not.toHaveProperty('totalTaxWithState');
  });

  it('returns the supported registry estimate for a saved full state name, separate from total tax, with city-based notices', async () => {
    state.profile = { filing_status: 'single', state: 'New York', mailing_address: { city: 'Brooklyn', state: 'New York' } };
    const data = await (await GET(request())).json();
    expect(data.stateTax).toMatchObject({
      supported: true, label: 'informational state planning estimate', stateCode: 'NY', stateName: 'New York', taxYear: 2026,
      filingStatus: 'single', noIncomeTax: false, stateWithheld: 0,
    });
    // 2026 single: $100,000 wages, $8,000 standard deduction, IT-2105-I schedule; no recapture below $107,650 NYAGI.
    expect(data.stateTax.estimate).toBeCloseTo(4191 + 0.059 * (92000 - 80650), 2);
    expect(data.stateTax.stateBalanceDue).toBeCloseTo(data.stateTax.estimate, 2);
    expect(data.stateTax.components).toMatchObject({ federalAGI: 100000, stateAGI: 100000, taxableIncome: 92000 });
    expect(data.stateTax.warnings.join(' ')).toMatch(/New York City resident income tax/);
    expect(data.stateTax.sources.every((url: string) => url.startsWith('https://www.tax.ny.gov/'))).toBe(true);
    expect(data.totalTax).toBe(data.form1040.totalTax);
    expect(data.form1040.incomeTax).toBe(13170);
    expect(data.form1040.calculationWarnings.some((note: string) => /state estimate/i.test(note))).toBe(false);
    expect(data.businessTaxNotices.map((notice: { id: string }) => notice.id)).toEqual(['nyc-ubt']);
    expect(data.businessTaxNotices[0].sources[0].url).toMatch(/^https:\/\/www\.nyc\.gov\//);
  });

  it('returns supported:false with a reason and keeps the not-validated warning for an unpublished state-year', async () => {
    state.profile = { filing_status: 'single', state: 'CA' };
    const data = await (await GET(request())).json();
    expect(data.stateTax).toMatchObject({ supported: false, stateCode: 'CA', stateName: 'California', taxYear: 2026, stateWithheld: 0 });
    expect(data.stateTax.reason).toMatch(/2026/);
    expect(data.stateTax).not.toHaveProperty('estimate');
    expect(data.stateTax).not.toHaveProperty('stateBalanceDue');
    expect(data.form1040.calculationWarnings.some((note: string) => /California state estimate has not been validated for tax year 2026/.test(note))).toBe(true);
    expect(data.businessTaxNotices).toEqual([]);
  });

  it('reports $0 for a no-income-tax state with the state-level business tax notice', async () => {
    state.profile = { filing_status: 'single', mailing_address: { state: 'WA', city: 'Seattle' } };
    const data = await (await GET(request())).json();
    expect(data.stateTax).toMatchObject({ supported: true, noIncomeTax: true, estimate: 0, stateCode: 'WA' });
    expect(data.stateTax).not.toHaveProperty('stateBalanceDue');
    expect(data.stateTax.notes.join(' ')).toMatch(/B&O/);
    expect(data.businessTaxNotices.map((notice: { id: string }) => notice.id)).toEqual(['wa-bo']);
  });
});
