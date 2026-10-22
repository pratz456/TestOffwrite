import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { BEFORE_WITHHOLDING_LABEL_PENDING_APPROVAL, PRIOR_YEAR_ONLY_LABEL_PENDING_APPROVAL, ZERO_PRIOR_TAX_LABEL_PENDING_APPROVAL } from '../lib/tax-provider/quarterly-planner';

const PLACEHOLDER = PRIOR_YEAR_ONLY_LABEL_PENDING_APPROVAL;
const BEFORE_WITHHOLDING = BEFORE_WITHHOLDING_LABEL_PENDING_APPROVAL;
const ZERO_PRIOR_TAX = ZERO_PRIOR_TAX_LABEL_PENDING_APPROVAL;

const state = vi.hoisted(() => ({
  uid: 'planner-owner' as string | null,
  error: null as string | null,
  records: {} as Record<string, Record<string, unknown>[]>,
  tx: [] as Record<string, unknown>[],
  profile: { filing_status: 'Single' } as Record<string, unknown>,
  payments: [] as { quarter: 1 | 2 | 3 | 4; paidAmount: number; record: Record<string, unknown> | null }[],
}));

vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/reports/export-records', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/reports/export-records')>(),
  readOwnedTransactions: async () => { if (state.error) throw new Error(state.error); return state.tx; },
}));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.tx, error: state.error }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({
  getAssetsSettings: async () => ({ data: [], error: null }),
  getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }),
}));
vi.mock('@/lib/firebase/quarterly-payments-server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/firebase/quarterly-payments-server')>(),
  getRecordedQuarterlyPayments: async () => ([1, 2, 3, 4] as const).map(quarter => state.payments.find(payment => payment.quarter === quarter) ?? { quarter, paidAmount: 0, record: null }),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (name: string) => ({ where() { return this; }, limit() { return this; }, get: async () => ({ empty: !state.records[name]?.length, docs: (state.records[name] || []).map((data, id) => ({ id: String(id), data: () => data })) }) }) },
}));

import { GET as annual } from '../app/api/tax/compute-1040/route';
import { POST as annualPdf } from '../app/api/tax/form-1040/route';
import { GET as quarterly } from '../app/api/tax/quarterly-reminders/route';
import { POST as legacy } from '../app/api/tax/quarterly-estimates/route';

const PRIOR_YEAR_FACTS = { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '100000' };
const WITHHOLDING = 2000;
const req = (query = 'year=2026&asOf=2026-09-01') => new NextRequest(`http://localhost/api/tax/quarterly-reminders?${query}`);
const post = (body: unknown) => new NextRequest('http://localhost/api/tax/quarterly-estimates', { method: 'POST', body: JSON.stringify(body) });
const organizer = (facts: Record<string, unknown> = {}) => reviewedPersonalDeductionOrganizer(2026, {}, facts);

beforeEach(() => {
  resetRateLimitStore();
  state.uid = 'planner-owner';
  state.error = null;
  state.profile = { filing_status: 'Single' };
  state.records = {
    tax_organizers: [organizer({ ...PRIOR_YEAR_FACTS, dependents: '1' })],
    w2_income: [{ wages: 80000, federalWithheld: WITHHOLDING }],
  };
  state.payments = [{ quarter: 3, paidAmount: 750, record: { paidAmount: 750, paidDate: '2026-07-01' } }];
  state.tx = [
    { iso_currency_code: 'USD', amount: -100000, date: '2026-02-01', category: 'income' },
    { iso_currency_code: 'USD', amount: 1000, date: '2026-02-01', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true },
  ];
});

describe('prior-year-only quarterly plan when dependent credit review blocks the annual estimate', () => {
  it('gives four amounts from 100% of prior-year tax minus withholding and recorded payments', async () => {
    const annualBody = await (await annual(req())).json();
    expect(annualBody.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
    const response = await quarterly(req());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.priorYearOnly).toBe(true);
    expect(result.withholdingApplied).toBe(true);
    expect(result.annualStatus).toBe('review_required');
    expect(result.annualStatusMessage).toBe(annualBody.error);
    expect(result.paymentReview.message).toBe(PLACEHOLDER);
    expect(result.planner).toMatchObject({
      status: 'ready',
      priorYearOnly: true,
      annualStatus: 'review_required',
      annualStatusMessage: annualBody.error,
      requiredAnnualPayment: {
        basis: 'prior_year_100',
        requiredAnnualPayment: 10000,
        ninetyPercentOfCurrentYear: null,
        withholding: WITHHOLDING,
        estimatedPaymentsRequired: 8000,
      },
    });
    expect(result.priorYearBaseMayOverstate).toBe(true);
    expect(result.safeHarborBasis).toBe('prior_year_100');
    expect(result.safeHarborTotal).toBe(10000);
    expect(result.usingPriorYearSafeHarbor).toBe(true);
    expect(result.w2Withheld).toBe(WITHHOLDING);
    expect(result.recordedEstimatedPayments).toBe(750);
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2000, 2000, 2000, 2000]);
    expect(result.quarters.map((quarter: { dueDate: string }) => quarter.dueDate)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
    expect(result.quarters.map((quarter: { withholdingCredited: number; paymentsMatchedTotal: number }) => [quarter.withholdingCredited, quarter.paymentsMatchedTotal])).toEqual([
      [500, 0], [500, 0], [500, 750], [500, 0],
    ]);
    expect(result.remainingTarget).toBe(7250);
    expect(result.planner.nextDue).toMatchObject({ quarter: 3, dueDate: '2026-09-15', amountToPay: 5250, installmentOnly: 2000, includesEarlierShortfall: true });
    expect(result).not.toHaveProperty('totalEstimatedTax');
  });

  it('uses 110% above the shared AGI threshold, 100% at $150,000, and 100% at MFS $75,000 versus 110% at $75,001', async () => {
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearAGI: '150001', dependents: '1' })];
    let result = await (await quarterly(req())).json();
    expect(result.safeHarborBasis).toBe('prior_year_110');
    expect(result.planner.requiredAnnualPayment.requiredAnnualPayment).toBe(11000);
    expect(result.planner.requiredAnnualPayment.basis).toBe('prior_year_110');
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2250, 2250, 2250, 2250]);

    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearAGI: '150000', dependents: '1' })];
    result = await (await quarterly(req())).json();
    expect(result.safeHarborBasis).toBe('prior_year_100');
    expect(result.planner.requiredAnnualPayment.requiredAnnualPayment).toBe(10000);
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2000, 2000, 2000, 2000]);

    state.profile = { filing_status: 'married_filing_separately' };
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearAGI: '75000', dependents: '1' })];
    result = await (await quarterly(req())).json();
    expect(result.safeHarborBasis).toBe('prior_year_100');
    expect(result.planner.requiredAnnualPayment.requiredAnnualPayment).toBe(10000);
    expect(result.planner.requiredAnnualPayment.basis).toBe('prior_year_100');
    expect(result.planner.requiredAnnualPayment.priorYear.agiThreshold).toBe(75000);
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2000, 2000, 2000, 2000]);

    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearAGI: '75001', dependents: '1' })];
    result = await (await quarterly(req())).json();
    expect(result.safeHarborBasis).toBe('prior_year_110');
    expect(result.planner.requiredAnnualPayment.requiredAnnualPayment).toBe(11000);
    expect(result.planner.requiredAnnualPayment.basis).toBe('prior_year_110');
    expect(result.planner.requiredAnnualPayment.priorYear.agiThreshold).toBe(75000);
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2250, 2250, 2250, 2250]);
  });

  // Joint last year, separate this year. Saved prior-year facts have no filing-status field — PriorYearFacts is prior-year tax, AGI, and the 12-month answer — so nothing can read last year's joint status. §6654(d)(1)(C)(ii) uses this year's status.
  it('uses 110% at $100,000 prior-year AGI when this year is married filing separately', async () => {
    state.profile = { filing_status: 'married_filing_separately' };
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearAGI: '100000', dependents: '1' })];
    const result = await (await quarterly(req())).json();
    expect(result.priorYearOnly).toBe(true);
    expect(result.filingStatus).toBe('married_filing_separately');
    expect(result.safeHarborBasis).toBe('prior_year_110');
    expect(result.planner.requiredAnnualPayment).toMatchObject({
      basis: 'prior_year_110',
      requiredAnnualPayment: 11000,
      priorYear: { agi: 100000, agiThreshold: 75000, multiplier: 1.1 },
    });
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2250, 2250, 2250, 2250]);
  });

  // Separate last year, joint this year. There is still no prior-year filing-status input, so nothing can read last year's separate status.
  it('uses 100% at $100,000 prior-year AGI when this year is married filing jointly', async () => {
    state.profile = { filing_status: 'married_filing_jointly' };
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearAGI: '100000', dependents: '1' })];
    const result = await (await quarterly(req())).json();
    expect(result.priorYearOnly).toBe(true);
    expect(result.filingStatus).toBe('married_filing_jointly');
    expect(result.safeHarborBasis).toBe('prior_year_100');
    expect(result.planner.requiredAnnualPayment).toMatchObject({
      basis: 'prior_year_100',
      requiredAnnualPayment: 10000,
      priorYear: { agi: 100000, agiThreshold: 150000, multiplier: 1 },
    });
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2000, 2000, 2000, 2000]);
  });

  it('returns the original 422 when prior-year facts are missing', async () => {
    state.records.tax_organizers = [organizer({ dependents: '1' })];
    const annualResponse = await annual(req());
    const response = await quarterly(req());
    expect(response.status).toBe(annualResponse.status);
    expect(await response.json()).toEqual(await annualResponse.json());
    const body = await (await quarterly(req())).json();
    expect(body.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
    expect(body).not.toHaveProperty('planner');
    expect(body).not.toHaveProperty('priorYearOnly');
  });

  it('returns no amounts when the 12-month answer is missing', async () => {
    const { priorReturnCoveredTwelveMonths: omitted, ...facts } = PRIOR_YEAR_FACTS;
    expect(omitted).toBe('yes');
    state.records.tax_organizers = [organizer({ ...facts, dependents: '1' })];
    expect(state.records.tax_organizers[0]).not.toHaveProperty('priorReturnCoveredTwelveMonths');
    const annualResponse = await annual(req());
    const response = await quarterly(req());
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual(await annualResponse.json());
    expect(body.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
    for (const key of ['quarters', 'safeHarborTotal', 'safeHarborPerQuarter', 'safeHarborBasis', 'perQuarterRecommended', 'remainingTarget', 'totalEstimatedTax', 'w2Withheld', 'recordedEstimatedPayments', 'priorYearOnly', 'zeroPriorTaxReview', 'planner']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('returns the original 422 when the prior return did not cover twelve months', async () => {
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorReturnCoveredTwelveMonths: 'no', dependents: '1' })];
    const annualResponse = await annual(req());
    const response = await quarterly(req());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(await annualResponse.json());
  });

  it('returns a different 422 unchanged', async () => {
    state.records.tax_organizers = [organizer(PRIOR_YEAR_FACTS)];
    state.records.gross_receipts = [{ amount: 100000 }];
    const annualResponse = await annual(req());
    const quarterlyResponse = await quarterly(req());
    const legacyResponse = await legacy(post({ taxYear: 2026 }));
    const annualBody = await annualResponse.json();
    expect(annualBody.code).toBe('INCOME_RECONCILIATION_REQUIRED');
    expect(quarterlyResponse.status).toBe(annualResponse.status);
    expect(await quarterlyResponse.json()).toEqual(annualBody);
    expect(legacyResponse.status).toBe(annualResponse.status);
    expect(await legacyResponse.json()).toEqual(annualBody);
  });

  it('returns gross prior-year installments when W-2 federal withholding cannot be read', async () => {
    state.records.w2_income = [{ wages: 80000 }];
    const annualBody = await (await annual(req())).json();
    expect(annualBody.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
    const response = await quarterly(req());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.withholdingApplied).toBe(false);
    expect(body.priorYearOnly).toBe(true);
    expect(body.annualStatus).toBe('review_required');
    expect(body.annualStatusMessage).toBe(annualBody.error);
    expect(body.paymentReview).toEqual({ code: 'PRIOR_YEAR_ONLY', message: BEFORE_WITHHOLDING });
    expect(body.safeHarborBasis).toBe('prior_year_100');
    expect(body.safeHarborTotal).toBe(10000);
    expect(body.recordedEstimatedPayments).toBe(750);
    expect(body.remainingTarget).toBe(9250);
    expect(body.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2500, 2500, 2500, 2500]);
    expect(body.quarters.map((quarter: { withholdingCredited: number }) => quarter.withholdingCredited)).toEqual([0, 0, 0, 0]);
    expect(body.planner.requiredAnnualPayment).toMatchObject({
      basis: 'prior_year_100',
      requiredAnnualPayment: 10000,
      withholding: 0,
      estimatedPaymentsRequired: 10000,
    });
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('w2Withheld');
    expect(body).not.toHaveProperty('totalFederalWithheld');
    expect(body).not.toHaveProperty('totalPaid');
    expect(body).not.toHaveProperty('totalEstimatedTax');
  });

  it('keeps today\'s response when compute-1040 succeeds', async () => {
    state.records.tax_organizers = [organizer(PRIOR_YEAR_FACTS)];
    state.records.w2_income = [];
    const expected = await (await annual(req())).json();
    const response = await quarterly(req());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.totalEstimatedTax).toBe(expected.form1040.totalTax);
    expect(result.recordedEstimatedPayments).toBe(750);
    expect(result.paymentReview.code).toBe('QUARTERLY_PLANNER_READY');
    expect(result.planner.status).toBe('ready');
    expect(result.planner.requiredAnnualPayment).toMatchObject({
      basis: 'prior_year_100',
      requiredAnnualPayment: 10000,
      ninetyPercentOfCurrentYear: Math.round(expected.form1040.totalTax * 90) / 100,
      estimatedPaymentsRequired: 10000,
    });
    expect(result).toMatchObject({
      safeHarborTotal: 10000,
      safeHarborPerQuarter: 2500,
      safeHarborBasis: 'prior_year_100',
      usingPriorYearSafeHarbor: true,
      perQuarterRecommended: 2500,
      remainingTarget: 9250,
    });
    expect(result.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2500, 2500, 2500, 2500]);
    expect(result).not.toHaveProperty('priorYearOnly');
    expect(result).not.toHaveProperty('annualStatus');
    expect(result.planner).not.toHaveProperty('priorYearOnly');
    expect(result.planner).not.toHaveProperty('annualStatus');
  });

  it('passes the prior-year-only shape through quarterly-estimates', async () => {
    const fromGet = await (await quarterly(req('year=2026'))).json();
    const response = await legacy(post({ taxYear: 2026, taxCalculation: { quarterlyAmount: 1 }, userProfile: { prior_year_tax: 1 } }));
    expect(response.status).toBe(200);
    const fromPost = await response.json();
    expect(fromPost).toEqual(fromGet);
    expect(fromPost.priorYearOnly).toBe(true);
    expect(fromPost.annualStatus).toBe('review_required');
    expect(fromPost.safeHarborBasis).toBe('prior_year_100');
    expect(fromPost.safeHarborTotal).toBe(10000);
    expect(fromPost.quarters.map((quarter: { recommended: number }) => quarter.recommended)).toEqual([2000, 2000, 2000, 2000]);
    expect(fromPost.paymentReview.message).toBe(PLACEHOLDER);
    expect(fromPost.withholdingApplied).toBe(true);
  });

  it('returns a zero-prior-tax review with no amounts when prior-year tax is 0', async () => {
    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearTax: '0', dependents: '1' })];
    const annualBody = await (await annual(req())).json();
    expect(annualBody.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
    const response = await quarterly(req());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.priorYearOnly).toBe(true);
    expect(body.zeroPriorTaxReview).toBe(true);
    expect(body.annualStatus).toBe('review_required');
    expect(body.annualStatusMessage).toBe(annualBody.error);
    expect(body.paymentReview).toEqual({ code: 'ZERO_PRIOR_TAX', message: ZERO_PRIOR_TAX });
    for (const key of ['quarters', 'safeHarborTotal', 'safeHarborPerQuarter', 'safeHarborBasis', 'perQuarterRecommended', 'remainingTarget', 'totalEstimatedTax', 'w2Withheld', 'totalFederalWithheld', 'totalPaid', 'recordedEstimatedPayments', 'planner', 'withholdingApplied', 'usingPriorYearSafeHarbor', 'priorYearBaseMayOverstate']) {
      expect(body).not.toHaveProperty(key);
    }
    const legacyResponse = await legacy(post({ taxYear: 2026 }));
    expect(legacyResponse.status).toBe(200);
    expect(await legacyResponse.json()).toEqual(body);

    state.records.tax_organizers = [organizer({ ...PRIOR_YEAR_FACTS, priorYearTax: '0', priorYearAGI: '150001', dependents: '1' })];
    const aboveThreshold = await (await quarterly(req())).json();
    expect(aboveThreshold.priorYearOnly).toBe(true);
    expect(aboveThreshold.zeroPriorTaxReview).toBe(true);
    expect(aboveThreshold.paymentReview.message).toBe(ZERO_PRIOR_TAX);
    expect(aboveThreshold).not.toHaveProperty('quarters');
    expect(aboveThreshold).not.toHaveProperty('safeHarborTotal');
  });

  it('marks the prior-year line 24 total tax as a base that may overstate the safe harbor', async () => {
    const response = await quarterly(req());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.priorYearOnly).toBe(true);
    expect(body.priorYearBaseMayOverstate).toBe(true);
    expect(body.planner.requiredAnnualPayment.priorYear.totalTax).toBe(10000);
    expect(body.safeHarborTotal).toBe(10000);
    state.records.w2_income = [{ wages: 80000 }];
    const gross = await (await quarterly(req())).json();
    expect(gross.withholdingApplied).toBe(false);
    expect(gross.priorYearBaseMayOverstate).toBe(true);
    expect(gross.safeHarborTotal).toBe(10000);
  });

  it('leaves compute-1040 and the 1040 summary PDF on the dependent-credit 422', async () => {
    const createPdf = vi.spyOn(PDFDocument, 'create');
    try {
      const annualResponse = await annual(req());
      const pdfResponse = await annualPdf(new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) }));
      expect(annualResponse.status).toBe(422);
      expect(pdfResponse.status).toBe(422);
      const annualBody = await annualResponse.json();
      const pdfBody = await pdfResponse.json();
      expect(pdfBody).toEqual(annualBody);
      expect(annualBody.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
      expect(annualBody).not.toHaveProperty('form1040');
      expect(pdfBody).not.toHaveProperty('form1040');
      expect(annualResponse.headers.get('content-type')).toContain('application/json');
      expect(pdfResponse.headers.get('content-type')).toContain('application/json');
      expect(createPdf).not.toHaveBeenCalled();
    } finally {
      createPdf.mockRestore();
    }
  });
});
