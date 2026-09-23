import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';

const state = vi.hoisted(() => ({ uid: 'savings-owner' as string | null, error: null as string | null,
  profile: { income: 100000, filing_status: 'single' } as Record<string, unknown>, transactions: [] as object[], owners: [] as string[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async (uid: string) => { state.owners.push(uid); return { data: state.profile, error: state.error }; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async (uid: string) => { state.owners.push(uid); return { data: state.transactions, error: state.error }; } }));
import { GET as monthly } from '@/app/api/monthly-deductions/route';
import { GET as savings } from '@/app/api/tax-savings/route';
const expense = (facts: Record<string, unknown> = {}) => ({ date: '2026-03-01', amount: 100, category: 'office_expense',
  iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', ...facts });
const request = (query = '') => new NextRequest(`http://localhost/api/monthly-deductions${query}`);
const now = new Date('2026-09-23T12:00:00Z');

beforeEach(() => { state.uid = 'savings-owner'; state.error = null; state.owners = [];
  state.profile = { income: 100000, filing_status: 'single' }; state.transactions = [expense()]; });

describe('monthly displayed deductions and income-tax planning estimates', () => {
  it('nets refunds and applies the meal limit once, matching signed Schedule C cents', () => {
    const result = buildMonthlySavings([expense(), expense({ amount: -20 }),
      expense({ category: 'FOOD_AND_DRINK_RESTAURANT', amount: 10.01 }),
      expense({ category: 'FOOD_AND_DRINK_RESTAURANT', amount: -1.01 })], 2026, .2, now);
    expect(result.summary.deductionBasis).toBe(84.5);
    expect(result.summary.yearToDateTotal).toBeCloseTo(16.9);
    expect(result.monthlyData[2]).toMatchObject({ deductionBasis: 84.5, count: 4 });
    expect(result.estimateNotice).toContain('Not a refund or return calculation');
  });
  it('excludes other years, future days, pending, removed, superseded and unconfirmed records', () => {
    const excluded = [{ date: '2025-03-01' }, { date: '2026-12-01' }, { pending: true }, { bank_removed: true },
      { superseded_by: 'old-copy' }, { review_status: 'pending_review' }, { is_deductible: false }];
    expect(buildMonthlySavings([expense(), ...excluded.map(expense)], 2026, .2, now).summary.deductionBasis).toBe(100);
  });
  it('uses the bank calendar date without shifting a December transaction into January', () => {
    const result = buildMonthlySavings([expense({ date: '2025-12-31T23:30:00-08:00' })], 2025, .2, now);
    expect(result.monthlyData[11].deductionBasis).toBe(100);
  });
  it('uses supported datetime-only records consistently for buckets, future filtering and years', () => {
    const result = buildMonthlySavings([
      expense({ date: undefined, datetime: '2026-03-01T10:00:00Z' }),
      expense({ date: null, datetime: '2026-12-01T10:00:00Z' }),
      expense({ date: undefined, datetime: '2025-12-31T23:30:00-08:00' }),
    ], 2026, .2, now);
    expect(result.monthlyData[2]).toMatchObject({ deductionBasis: 100, count: 1 });
    expect(result.monthlyData[11].deductionBasis).toBe(0);
    expect(result.summary.yearToDateTotal).toBe(20);
    expect(result.diagnostics.expensesInYear).toBe(1);
    expect(result.availableYears).toEqual([2026, 2025]);
  });
  it('never advertises unsupported historical years that the monthly endpoint rejects', () => {
    const historical = expense({ date: '2023-03-01' });
    expect(buildMonthlySavings([historical, expense({ date: '2025-03-01' })], 2026, .2, now).availableYears).toEqual([2025]);
    expect(buildMonthlySavings([historical], 2026, .2, now).availableYears).toEqual([2026]);
  });
  it.each([{ iso_currency_code: undefined }, { iso_currency_code: 'EUR' }, { business_use_percentage: 50 },
    { deductible_amount: 50 }, { date: 'invalid' }, { amount: Infinity }])('requires review for ambiguous amount facts %j', facts => {
    expect(() => buildMonthlySavings([expense(facts)], 2026, .2, now)).toThrow();
  });
  it('withholds unpublished years and invalid rates; permits a genuine zero rate', () => {
    expect(() => buildMonthlySavings([], 2027, .2, now)).toThrow();
    expect(() => buildMonthlySavings([], 2026, NaN, now)).toThrow();
    expect(buildMonthlySavings([expense()], 2026, 0, now).summary.yearToDateTotal).toBe(0);
  });
});

describe('savings API boundaries', () => {
  it('uses the requested published year and owner records, with a private response', async () => {
    state.transactions = [expense({ date: '2025-03-01' }), expense()];
    const response = await monthly(request('?year=2025'));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.taxYear).toBe(2025);
    expect(data.summary.deductionBasis).toBe(100);
    expect(data.summary.yearToDateTotal).toBeCloseTo(100 * getUserTaxRate(state.profile, 2025));
    expect(state.owners).toEqual(['savings-owner', 'savings-owner']);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['2027', '2026junk', ''])('does not silently replace an invalid or unpublished year: %s', async year => {
    const response = await monthly(request(`?year=${year}`));
    expect(response.status).toBe(400); expect((await response.json()).code).toBe('TAX_YEAR_UNAVAILABLE');
    expect(state.owners).toEqual([]);
  });
  it.each([monthly, savings])('withholds estimates when income, currency, or wage ownership needs review', async route => {
    state.profile = { filing_status: 'single' };
    let response = await route(request()); expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('TAX_RATE_REVIEW_REQUIRED');
    state.profile = { income: 100000, filing_status: 'single' }; state.transactions = [expense({ iso_currency_code: undefined })];
    response = await route(request()); expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('EXPORT_REVIEW_REQUIRED');
    state.profile = { income: 100000, filing_status: 'married_filing_jointly', w2_income: 100000 };
    response = await route(request()); expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('TAX_CALCULATION_SCOPE_REVIEW_REQUIRED');
  });
  it.each([monthly, savings])('does not turn unavailable records into $0 or expose another owner', async route => {
    state.error = 'synthetic private backend detail';
    let response = await route(request()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private backend detail');
    state.uid = null; state.owners = [];
    response = await route(request()); expect(response.status).toBe(401); expect(state.owners).toEqual([]);
  });
});
