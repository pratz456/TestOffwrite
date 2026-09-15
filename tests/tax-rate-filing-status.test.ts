import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { calculateEffectiveTaxRate, calculateFederalIncomeTax, getMarginalTaxRate, getUserTaxRate, getUserTaxRateDisplay } from '../lib/tax-rules/federal-brackets';
import { calcCombinedSERate } from '../lib/tax-rules/kpi-calculations';
import { FilingStatusReviewRequiredError } from '../lib/tax-rules/filing-status';

const fixture = vi.hoisted(() => ({ status: 'Single', income: 100000 }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'synthetic' }, error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { income: fixture.income, filing_status: fixture.status }, error: null }) }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: [{ id: 'expense', amount: 1000, date: '2026-09-01', is_deductible: true }], error: null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (path: string) => ({ get: async () => ({ docs: path.endsWith('/accounts') ? [{ id: 'manual' }] : [{ data: () => ({ amount: -100000, category: 'income', date: '2026-09-01' }) }] }) }) } }));
import { GET as savings } from '../app/api/tax-savings/route';
import { GET as monthly } from '../app/api/monthly-deductions/route';
import { GET as profitLossPDF, POST as profitLoss } from '../app/api/reports/profit-loss/route';

beforeEach(() => {
  fixture.status = 'Single'; fixture.income = 100000;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const labels = [['Single', 'single'], ['Married Filing Jointly', 'married_filing_jointly'], ['Married Filing Separately', 'married_filing_separately'], ['Head of Household', 'head_of_household']] as const;
describe('shared dashboard rate normalization', () => {
  it.each(labels)('uses the canonical rate for the onboarding label %s', (label, key) => {
    const profile = { income: 100000, filing_status: label };
    const canonical = { ...profile, filing_status: key };
    expect(calculateFederalIncomeTax(100000, label)).toBe(calculateFederalIncomeTax(100000, key));
    expect(calculateEffectiveTaxRate(profile)).toBe(calculateEffectiveTaxRate(canonical));
    expect(getUserTaxRate(profile)).toBe(getUserTaxRate(canonical));
    expect(getMarginalTaxRate(profile)).toBe(getMarginalTaxRate(canonical));
    expect(calcCombinedSERate(100000, label)).toEqual(calcCombinedSERate(100000, key));
    expect(getUserTaxRateDisplay(profile)).toEqual({ rate: getUserTaxRate(canonical), filingStatus: key, reviewMessage: null });
  });
  it('does not use the Single rate for the Married Filing Jointly label', () => {
    expect(getUserTaxRate({ income: 100000, filing_status: 'Married Filing Jointly' })).toBeLessThan(getUserTaxRate({ income: 100000, filing_status: 'Single' }));
    expect(getMarginalTaxRate({ income: 90000, filing_status: 'Married Filing Jointly' })).toBe(12);
    expect(getMarginalTaxRate({ income: 90000, filing_status: 'Single' })).toBe(22);
  });
  it.each(['Qualifying Widower', 'not-a-status'])('withholds the display rate for %s, even without income', status => {
    for (const income of [100000, 0, undefined]) {
      const profile = { filing_status: status, income };
      for (const calculate of [() => calculateEffectiveTaxRate(profile), () => getUserTaxRate(profile), () => getMarginalTaxRate(profile), () => calcCombinedSERate(income ?? 0, status), () => calculateFederalIncomeTax(income ?? 0, status)]) {
        expect(calculate).toThrow(FilingStatusReviewRequiredError);
      }
      expect(getUserTaxRateDisplay(profile)).toMatchObject({ rate: null, filingStatus: null, reviewMessage: expect.stringContaining('filing status in Profile') });
    }
  });
});

const requests = () => [
  savings(new NextRequest('http://localhost/api/tax-savings')),
  monthly(new NextRequest('http://localhost/api/monthly-deductions?year=2026')),
  profitLoss(new NextRequest('http://localhost/api/reports/profit-loss', { method: 'POST', body: JSON.stringify({ year: 2026 }) })),
  profitLossPDF(new NextRequest('http://localhost/api/reports/profit-loss?format=pdf&year=2026')),
];
describe('savings and P&L APIs use the same filing-status contract', () => {
  it.each(labels)('calculates %s with the same rate as its engine key', async (label, key) => {
    fixture.status = label;
    const responses = await Promise.all(requests());
    responses.forEach(response => expect(response.status).toBe(200));
    const rate = getUserTaxRate({ income: 100000, filing_status: key });
    expect((await responses[0].json()).data.taxSavings.yearToDate).toBe(1000 * rate);
    expect((await responses[1].json()).data.summary.yearToDateTotal).toBe(1000 * rate);
    expect((await responses[2].json()).incomeTax).toBe((100000 - 100000 * .153 * .5) * rate);
    expect(responses[3].headers.get('content-type')).toContain('application/pdf');
  });
  it.each(['Qualifying Widower', 'unknown'])('returns actionable422 for %s without returning savings or a PDF', async status => {
    fixture.status = status;
    const responses = await Promise.all(requests());
    for (const response of responses) {
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'FILING_STATUS_REVIEW_REQUIRED', error: expect.stringContaining('filing status in Profile') });
    }
  });
});
