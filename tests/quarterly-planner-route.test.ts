import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  uid: 'planner-owner' as string | null, error: null as string | null,
  records: {} as Record<string, Record<string, unknown>[]>, tx: [] as Record<string, unknown>[],
  profile: { filing_status: 'Single' } as Record<string, unknown>,
  payments: [] as { quarter: 1 | 2 | 3 | 4; paidAmount: number; record: Record<string, unknown> | null }[],
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => { if (state.error) throw new Error(state.error); return state.tx; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.tx, error: state.error }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }), getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/firebase/quarterly-payments-server')>(),
  getRecordedQuarterlyPayments: async () => ([1, 2, 3, 4] as const).map(quarter => state.payments.find(payment => payment.quarter === quarter) ?? { quarter, paidAmount: 0, record: null }),
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({ where() { return this; }, limit() { return this; }, get: async () => ({ empty: !state.records[name]?.length, docs: (state.records[name] || []).map((data, id) => ({ id: String(id), data: () => data })) }) }) } }));
import { GET as annual } from '../app/api/tax/compute-1040/route';
import { GET as quarterly } from '../app/api/tax/quarterly-reminders/route';
import { POST as legacy } from '../app/api/tax/quarterly-estimates/route';
import { POST as voucher } from '../app/api/tax/generate-1040es/route';

const PRIOR_YEAR_FACTS = { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '100000' };
const req = (query = 'year=2026&asOf=2026-09-01') => new NextRequest(`http://localhost/api/tax/quarterly-reminders?${query}`);
const post = (body: unknown) => new NextRequest('http://localhost/api/tax/quarterly-estimates', { method: 'POST', body: JSON.stringify(body) });
const organizer = (facts: Record<string, unknown> = {}) => reviewedPersonalDeductionOrganizer(2026, {}, facts);
beforeEach(() => {
  state.uid = 'planner-owner'; state.error = null; state.profile = { filing_status: 'Single' };
  state.records = { tax_organizers: [organizer(PRIOR_YEAR_FACTS)] };
  state.payments = [{ quarter: 3, paidAmount: 750, record: { paidAmount: 750, paidDate: '2026-07-01' } }];
  state.tx = [{ iso_currency_code: 'USD', amount: -100000, date: '2026-02-01', category: 'income' }, { iso_currency_code: 'USD', amount: 1000, date: '2026-02-01', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true }];
});

describe('quarterly summary keeps the review response until every planner fact is saved', () => {
  it.each([
    ['no prior-year facts', {}, ['prior_return_twelve_months', 'prior_year_total_tax', 'prior_year_agi']],
    ['12-month answer only', { priorReturnCoveredTwelveMonths: 'yes' }, ['prior_year_total_tax', 'prior_year_agi']],
    ['prior tax without AGI', { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000' }, ['prior_year_agi']],
    ['prior tax and AGI without the 12-month answer', { priorYearTax: '10000', priorYearAGI: '100000' }, ['prior_return_twelve_months']],
  ])('lists the missing facts when the organizer has %s', async (_label, facts, missing) => {
    state.records.tax_organizers = [organizer(facts)];
    const response = await quarterly(req()); expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.paymentReview.code).toBe('QUARTERLY_REVIEW_REQUIRED'); expect(result.planner.status).toBe('review_required');
    expect(result.paymentReview.missingFacts.map((fact: { key: string }) => fact.key)).toEqual(missing);
    expect(result.paymentReview.missingFacts.every((fact: { enterAt: { href: string }[] }) => fact.enterAt.some(item => item.href.includes('tax-organizer')))).toBe(true);
    expect(result).toMatchObject({ perQuarterRecommended: null, remainingTarget: null, safeHarborTotal: null, safeHarborPerQuarter: null, usingPriorYearSafeHarbor: false, onTrack: null, estimatedPenaltyRisk: null });
    expect(result.quarters.every((quarter: { recommended: unknown; status: string }) => quarter.recommended === null && quarter.status === 'review_required')).toBe(true);
    expect(result.recordedEstimatedPayments).toBe(750); expect(result.quarters[2].amountPaid).toBe(750); expect(typeof result.totalEstimatedTax).toBe('number');
  });
  it('does not fall back to the Deductions prior-year tax when the 12-month answer is missing', async () => {
    state.records.tax_organizers = [organizer()]; state.records.tax_deductions = [{ priorYearTotalTax: 10000, priorYearAGI: 100000 }];
    const result = await (await quarterly(req())).json();
    expect(result.planner.status).toBe('review_required'); expect(result.paymentReview.missingFacts.map((fact: { key: string }) => fact.key)).toEqual(['prior_return_twelve_months']);
  });
  it('requires saved current-year income before comparing against the 90% target', async () => {
    state.tx = [];
    const result = await (await quarterly(req())).json();
    expect(result.planner.status).toBe('review_required'); expect(result.paymentReview.missingFacts.map((fact: { key: string }) => fact.key)).toEqual(['current_year_estimate']);
  });
});

describe('quarterly summary returns planner figures from reviewed facts', () => {
  it('extends the shared-snapshot response with per-quarter regular-method figures and assumptions', async () => {
    const expected = await (await annual(req())).json();
    const response = await quarterly(req()); expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.totalEstimatedTax).toBe(expected.form1040.totalTax); expect(result.recordedEstimatedPayments).toBe(750); expect(result.quarters[2].amountPaid).toBe(750);
    expect(result.paymentReview).toEqual({ code: 'QUARTERLY_PLANNER_READY', message: expect.stringContaining('Planning estimate') });
    expect(result.paymentReview.message).not.toMatch(/you owe/i);
    expect(result.planner.status).toBe('ready'); expect(result.asOf).toBe('2026-09-01');
    expect(result.planner.requiredAnnualPayment).toMatchObject({ basis: 'prior_year_100', requiredAnnualPayment: 10000, ninetyPercentOfCurrentYear: Math.round(expected.form1040.totalTax * 90) / 100, estimatedPaymentsRequired: 10000 });
    expect(result).toMatchObject({ safeHarborTotal: 10000, safeHarborPerQuarter: 2500, safeHarborBasis: 'prior_year_100', usingPriorYearSafeHarbor: true, perQuarterRecommended: 2500, remainingTarget: 9250, onTrack: null, estimatedPenaltyRisk: null });
    expect(result.quarters.map((quarter: { recommended: number; status: string; paymentsMatchedTotal: number }) => [quarter.recommended, quarter.status, quarter.paymentsMatchedTotal])).toEqual([
      [2500, 'no_payment_recorded', 0], [2500, 'no_payment_recorded', 0], [2500, 'upcoming', 750], [2500, 'upcoming', 0],
    ]);
    expect(result.quarters.map((quarter: { dueDate: string }) => quarter.dueDate)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
    expect(result.planner.nextDue).toEqual({ quarter: 3, dueDate: '2026-09-15', amountToPay: 6750, includesEarlierShortfall: true, installmentOnly: 2500 });
    expect(result.planner.underpaymentInterestIllustration.label).toContain('illustration'); expect(result.planner.underpaymentInterestIllustration.total).toBeGreaterThan(0);
    expect(result.planner.annualizedIncomeMethod.available).toBe(false);
    expect(result.planner.assumptions.join(' ')).toContain('most recent payment date'); expect(result.planner.assumptions.join(' ')).toContain('basis selected: 100% of prior-year tax');
    expect(result.planner.sources.publication505).toBe('https://www.irs.gov/publications/p505');
    expect(result.quarters[0].recommended).not.toBe(Math.round(expected.form1040.totalTax / 4 * 100) / 100);
  });
  it('uses only the 90% current-year target when the prior return did not cover 12 months', async () => {
    state.records.tax_organizers = [organizer({ priorReturnCoveredTwelveMonths: 'no' })];
    const result = await (await quarterly(req())).json();
    expect(result.planner.status).toBe('ready'); expect(result.planner.requiredAnnualPayment.priorYear).toBeNull();
    expect(result.safeHarborBasis).toBe('current_year_90'); expect(result.usingPriorYearSafeHarbor).toBe(false); expect(result.safeHarborTotal).toBe(result.planner.requiredAnnualPayment.ninetyPercentOfCurrentYear);
  });
  it('applies the 110% multiplier from saved prior-year AGI and reads Deductions when the organizer lacks amounts', async () => {
    state.records.tax_organizers = [organizer({ priorReturnCoveredTwelveMonths: 'yes' })]; state.records.tax_deductions = [{ priorYearTotalTax: 10000, priorYearAGI: 150000.01 }];
    const result = await (await quarterly(req())).json();
    expect(result.planner.status).toBe('ready'); expect(result.planner.requiredAnnualPayment).toMatchObject({ basis: 'prior_year_110', requiredAnnualPayment: 11000 }); expect(result.safeHarborPerQuarter).toBe(2750);
  });
  it('matches recorded payments by their saved payment date and reports unpublished 2027 rates as unavailable', async () => {
    state.payments = [{ quarter: 1, paidAmount: 2500, record: { paidDate: '2026-06-10' } }];
    const result = await (await quarterly(req('year=2026&asOf=2027-02-01'))).json();
    expect(result.quarters[0]).toMatchObject({ amountPaid: 2500, paymentsMatchedTotal: 0 }); expect(result.quarters[1].paymentsMatchedTotal).toBe(2500);
    expect(result.planner.nextDue).toBeNull(); expect(result.planner.afterFinalDueDate).toEqual({ returnDueDate: '2027-04-15', remainingShortfall: 7500 });
    expect(result.planner.underpaymentInterestIllustration.total).toBeNull(); expect(result.planner.underpaymentInterestIllustration.unpublishedRatePeriods).toEqual(['2027-Q1']);
  });
  it('ignores an invalid asOf parameter and plans from today', async () => {
    const result = await (await quarterly(req('year=2026&asOf=tomorrow'))).json();
    expect(result.asOf).toBe(new Date().toISOString().slice(0, 10)); expect(result.planner.status).toBe('ready');
  });
  it('serves the same planner through the legacy POST entrypoint without trusting client totals', async () => {
    const response = await legacy(post({ taxYear: 2026, taxCalculation: { quarterlyAmount: 1 }, userProfile: { prior_year_tax: 1 } }));
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.planner.status).toBe('ready'); expect(result.safeHarborTotal).toBe(10000); expect(result.grossReceipts).toBe(100000);
  });
});

describe('planner facts never weaken existing review gates', () => {
  it('propagates Social Security review with no planner or annual amount', async () => {
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, hasSocialSecurity: 'yes', amountSocialSecurity: '20000' })];
    for (const response of [await quarterly(req()), await legacy(post({ taxYear: 2026 }))]) {
      expect(response.status).toBe(422); const body = await response.json();
      expect(body.code).toBe('SOCIAL_SECURITY_REVIEW_REQUIRED'); expect(body).not.toHaveProperty('planner'); expect(body).not.toHaveProperty('totalEstimatedTax');
    }
  });
  it('keeps the voucher endpoint review-blocked and the unauthenticated and unsupported-year responses unchanged', async () => {
    const blocked = await voucher(post({ quarter: 3, taxYear: 2026, taxCalculation: { quarterlyAmount: 2500 } }));
    expect(blocked.status).toBe(422); expect((await blocked.json()).code).toBe('QUARTERLY_REVIEW_REQUIRED');
    expect((await quarterly(req('year=2027'))).status).toBe(400);
    state.error = 'synthetic data unavailable'; expect((await quarterly(req())).status).toBe(503);
    state.error = null; state.uid = null; expect((await quarterly(req())).status).toBe(401);
  });
});
