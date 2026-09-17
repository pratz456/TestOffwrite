import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
import { assertGenericDependentCreditScope, DependentCreditReviewRequiredError, noChildEITCAgeAtYearEnd, readNoChildEITCAge, assertEITCDependencyScope } from '../lib/tax-rules/credit-scope';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const state = vi.hoisted(() => ({
  organizer: {} as Record<string, unknown>,
  profile: { filing_status: 'single' } as Record<string, unknown>,
  receipts: 20000,
  w2: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'credit-scope-owner' } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => [] }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }), getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => 0 }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({
  where() { return this; }, limit() { return this; },
  get: async () => {
    const records = name === 'tax_organizers' ? [state.organizer]
      : name === 'gross_receipts' ? [{ date: '2026-01-15', amount: state.receipts }]
      : name === 'w2_income' ? state.w2 : [];
    return { empty: !records.length, docs: records.map((record, i) => ({ id: `credit-scope-${i}`, data: () => record })) };
  },
}) } }));
import { GET as annualEstimate } from '../app/api/tax/compute-1040/route';
import { POST as annualPdf } from '../app/api/tax/form-1040/route';

const input = (overrides: Partial<Form1040Input> = {}): Form1040Input => ({
  taxYear: 2026, filingStatus: 'single', scheduleCNetProfit: 0, w2Wages: 4000,
  w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
  healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
  simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0,
  personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(), ...overrides,
});
const snapshot = (organizer: Record<string, unknown>) => buildFederalTaxSnapshot({
  taxYear: 2026, transactions: [], grossReceipts: [{ date: '2026-01-15', amount: 20000 }],
  forms1099: [], w2Entries: [], profile: { filing_status: 'single' }, organizer,
  deductions: {}, assets: [], estimatedPayments: 0,
});
beforeEach(() => {
  vi.restoreAllMocks(); resetRateLimitStore();
  state.profile = { filing_status: 'single' };
  state.organizer = reviewedPersonalDeductionOrganizer();
  state.receipts = 20000;
  state.w2 = [];
});

describe('dependent counts require eligibility review before annual totals', () => {
  it.each([{}, reviewedPersonalDeductionOrganizer()])('blocks the20k freelancer/dependent-parent refund with personal facts %j', facts => {
    expect(() => snapshot({ ...facts, dependents: '1', dependentDetails: 'Dependent parent, age 78' }))
      .toThrow(DependentCreditReviewRequiredError);
  });
  it.each([1, '2', 3, '0.5', -1, NaN, Infinity, false, [], 'unknown'].map(value => ({ value })))('does not turn unqualified/malformed count $value into credits or silently zero it', ({ value }) => {
    expect(() => assertGenericDependentCreditScope(value)).toThrow(DependentCreditReviewRequiredError);
  });
  it('withholds the ordinary zero-child adult estimate until all EITC facts are reviewed', () => {
    expect(() => snapshot({ ...reviewedPersonalDeductionOrganizer(), dependents: '0' })).toThrow('possible Earned Income Tax Credit');
  });
  it('keeps an independently ineligible high-income adult calculation available', () => {
    const result = compute1040(input({ w2Wages: 100000 }));
    expect(result.eitcCredit).toBe(0); expect(result.totalTax).toBeGreaterThan(0);
  });
  it('preserves explicitly assumed pure-calculator semantics without organizer facts', () => {
    const result = compute1040(input({ w2Wages: 10000, taxPayerAge: 30, personalDeductionOrganizer: undefined }));
    expect(result.eitcCredit).toBe(664);
  });
  it('never substitutes zero for a positive potential credit', () => {
    expect(() => assertEITCDependencyScope(664, false)).toThrow('IRS Publication 596');
    expect(() => assertEITCDependencyScope(664, true)).toThrow('can be claimed as a dependent');
    expect(() => assertEITCDependencyScope(0, false)).not.toThrow();
  });
  it.each(['single', 'married_filing_jointly'] as const)('review-blocks potentially positive EITC when a %s taxpayer/spouse is claimable', filingStatus => {
    const facts = filingStatus === 'single' ? { taxpayerDependent: 'yes' } : { spouseDependent: 'yes' };
    expect(() => compute1040(input({ filingStatus, personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, { ...facts, dependentEarnedIncome: '4000' }) })))
      .toThrow(DependentCreditReviewRequiredError);
  });
  it('does not block a dependent return where no EITC could be awarded', () => {
    const result = compute1040(input({ w2Wages: 0, otherIncome: 1000, personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, { taxpayerDependent: 'yes', dependentEarnedIncome: '0' }) }));
    expect(result.eitcCredit).toBe(0);
    expect(result.standardDeduction).toBe(1350);
  });
});

describe('IRS no-child EITC age boundaries', () => {
  it.each([
    ['2002-01-01', 25, true], ['2002-01-02', 24, false],
    ['1962-01-01', 64, true], ['1961-12-31', 65, false],
  ])('uses the different age25/age65 rules for %s', (dateOfBirth, age, eligible) => {
    expect(noChildEITCAgeAtYearEnd(dateOfBirth, 2026)).toBe(age);
    const calculate = () => compute1040(input({ personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth }) }));
    if (eligible) expect(calculate).toThrow(DependentCreditReviewRequiredError);
    else expect(calculate().eitcCredit).toBe(0);
  });
  it('uses an eligible joint spouse even when the taxpayer is over65', () => {
    const organizer = reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth: '1950-06-01', spouseDoB: '1970-06-01' });
    expect(readNoChildEITCAge(organizer, 2026, 'married_filing_jointly')).toBe(56);
    expect(() => compute1040(input({ filingStatus: 'married_filing_jointly', personalDeductionOrganizer: organizer }))).toThrow(DependentCreditReviewRequiredError);
  });
  it.each(['2026-02-30', '1990-2-1', 'not a date', '2027-01-01'])('rejects invalid/future saved birth date %s', date => {
    expect(() => noChildEITCAgeAtYearEnd(date, 2026)).toThrow();
  });
});

describe('annual JSON/PDF review response', () => {
  it('withholds the age30 single10kW2 annual total and PDF without EITC eligibility facts', async () => {
    state.receipts = 0;
    state.w2 = [{ wages: 10000, federalWithheld: 0 }];
    state.organizer = reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth: '1996-05-20', dependents: '0' });
    const before = JSON.stringify(state.organizer);
    const createPdf = vi.spyOn(PDFDocument, 'create');
    const json = await annualEstimate(new NextRequest('http://localhost/api/tax/compute-1040?year=2026'));
    const pdf = await annualPdf(new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) }));
    expect(json.status).toBe(422); expect(pdf.status).toBe(422);
    const body = await json.json();
    expect(body).toEqual({ code: 'DEPENDENT_CREDIT_REVIEW_REQUIRED', error: expect.stringContaining('possible Earned Income Tax Credit') });
    expect(body.error).toContain('valid SSNs'); expect(body.error).toContain('main U.S. home'); expect(body.error).toContain('qualifying child');
    expect(body).not.toHaveProperty('form1040'); expect(body).not.toHaveProperty('refund');
    expect(await pdf.json()).toEqual(body); expect(createPdf).not.toHaveBeenCalled();
    expect(JSON.stringify(state.organizer)).toBe(before);
  });
  it.each(['dependent parent', 'claimable taxpayer'])('returns422 without fabricated totals or a PDF for %s', async kind => {
    state.organizer = kind === 'dependent parent'
      ? { dependents: '1', dependentDetails: 'Dependent parent, age78' }
      : reviewedPersonalDeductionOrganizer(2026, { taxpayerDependent: 'yes', dependentEarnedIncome: '3717.41' });
    if (kind === 'claimable taxpayer') state.receipts = 4000;
    const original = JSON.stringify(state.organizer);
    const createPdf = vi.spyOn(PDFDocument, 'create');
    const responses = [
      await annualEstimate(new NextRequest('http://localhost/api/tax/compute-1040?year=2026')),
      await annualPdf(new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ code: 'DEPENDENT_CREDIT_REVIEW_REQUIRED', error: expect.stringContaining('Tax Organizer') });
      expect(response.headers.get('content-type')).toContain('application/json');
    }
    expect(createPdf).not.toHaveBeenCalled();
    expect(JSON.stringify(state.organizer)).toBe(original);
  });
});
