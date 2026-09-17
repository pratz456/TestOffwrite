import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ uid: 'quarterly-owner' as string | null, error: null as string | null, records: {} as Record<string, Record<string, unknown>[]>, tx: [] as Record<string, unknown>[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => { if (state.error) throw new Error(state.error); return state.tx; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.tx, error: state.error }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { filing_status: 'Single', prior_year_tax: 10000 }, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }), getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [{ quarter: 3, paidAmount: 750 }], totalRecordedPayments: () => 750 }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({ where() { return this; }, limit() { return this; }, get: async () => ({ empty: !state.records[name]?.length, docs: (state.records[name] || []).map((data, id) => ({ id: String(id), data: () => data })) }) }) } }));
import { GET as annual } from '../app/api/tax/compute-1040/route';
import { GET as quarterly } from '../app/api/tax/quarterly-reminders/route';
import { POST as legacy } from '../app/api/tax/quarterly-estimates/route';
import { POST as voucher } from '../app/api/tax/generate-1040es/route';
const req = (year = 2026) => new NextRequest(`http://localhost/api/tax/quarterly-reminders?year=${year}`);
const post = (body: unknown) => new NextRequest('http://localhost/api/tax/quarterly-estimates', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { state.uid = 'quarterly-owner'; state.error = null; state.records = { tax_organizers: [reviewedPersonalDeductionOrganizer()] }; state.tx = [{ amount: -100000, date: '2026-02-01', category: 'income' }, { amount: 1000, date: '2026-02-01', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true }]; });

describe('quarterly summary uses the shared saved-record annual engine', () => {
  it('matches annual JSON tax including QBI and records payments without claiming an installment is paid', async () => {
    const expected = await (await annual(req())).json();
    const response = await quarterly(req()); expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.totalEstimatedTax).toBe(expected.form1040.totalTax); expect(result.incomeTax).toBe(expected.form1040.incomeTax);
    expect(result.seCalc).toEqual(expected.seCalc); expect(result.netProfit).toBe(99000);
    expect(result.recordedEstimatedPayments).toBe(750); expect(result.quarters[2].amountPaid).toBe(750);
    expect(result).toMatchObject({ onTrack: null, estimatedPenaltyRisk: null, safeHarborTotal: null, perQuarterRecommended: null, paymentReview: { code: 'QUARTERLY_REVIEW_REQUIRED' } });
    expect(result.quarters.every((q: any) => q.recommended === null && q.status === 'review_required')).toBe(true);
  });
  it('legacyPOST ignores supplied inflated income and tax totals, using owner records', async () => {
    const response = await legacy(post({ taxYear: 2026, userProfile: { business_income: 999999 }, transactions: [{ amount: -999999 }], taxCalculation: { quarterlyAmount: 0 } }));
    expect(response.status).toBe(200); expect((await response.json()).grossReceipts).toBe(100000);
  });
  it('propagates Social Security review and does not leak an annual/quarterly amount', async () => {
    state.records.tax_organizers = [reviewedPersonalDeductionOrganizer(2026, {}, { hasSocialSecurity: 'yes', amountSocialSecurity: '20000' })];
    for (const response of [await quarterly(req()), await legacy(post({ taxYear: 2026 }))]) {
      expect(response.status).toBe(422); const body = await response.json(); expect(body.code).toBe('SOCIAL_SECURITY_REVIEW_REQUIRED'); expect(body).not.toHaveProperty('totalEstimatedTax');
    }
  });
  it.each([undefined, reviewedPersonalDeductionOrganizer(2025)])('preserves missing/stale personal deduction review across quarterly entrypoints', async organizer => {
    state.records.tax_organizers = organizer ? [organizer] : [];
    for (const response of [await quarterly(req()), await legacy(post({ taxYear: 2026 }))]) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('PERSONAL_DEDUCTION_REVIEW_REQUIRED');
      expect(body.error).toContain('Tax Organizer');
      expect(body).not.toHaveProperty('totalEstimatedTax');
      expect(body).not.toHaveProperty('perQuarterRecommended');
    }
  });
  it('preserves overlapping income review rather than dropping unsupported source data', async () => {
    state.records.gross_receipts = [{ amount: 100000 }];
    const response = await quarterly(req()); expect(response.status).toBe(422); expect((await response.json()).code).toBe('INCOME_RECONCILIATION_REQUIRED');
  });
  it('rejects2027 in both entrypoints and does not replace load failure with zero', async () => {
    expect((await quarterly(req(2027))).status).toBe(400); expect((await legacy(post({ taxYear: 2027 }))).status).toBe(400);
    state.error = 'synthetic data unavailable'; expect((await quarterly(req())).status).toBe(503);
  });
  it('requires authentication and blocks client-asserted voucher amounts even for Premium', async () => {
    const response = await voucher(post({ quarter: 3, taxYear: 2026, taxCalculation: { quarterlyAmount: 100 } }));
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('QUARTERLY_REVIEW_REQUIRED');
    state.uid = null; expect((await quarterly(req())).status).toBe(401); expect((await legacy(post({}))).status).toBe(401); expect((await voucher(post({}))).status).toBe(401);
  });
});
