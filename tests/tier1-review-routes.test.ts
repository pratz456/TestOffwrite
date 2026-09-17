import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

// Real organizer persistence handler, federal snapshot, calculation, PDF and
// quarterly routes. Only auth, entitlement and Firestore transport are synthetic.
const state = vi.hoisted(() => ({
  records: {} as Record<string, Record<string, unknown>[]>,
  profile: { filing_status: 'single' } as Record<string, unknown>,
  tx: [] as Record<string, unknown>[],
  calculations: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'tier1-owner' } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => state.tx }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.tx, error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }), getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => 0 }));
vi.mock('@/lib/tax-rules/compute-1040', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tax-rules/compute-1040')>();
  return { ...actual, compute1040: (...args: Parameters<typeof actual.compute1040>) => {
    const result = actual.compute1040(...args);
    state.calculations.push(result as unknown as Record<string, unknown>);
    return result;
  } };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  const filters: [string, unknown][] = [];
  return {
    where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return this; },
    limit() { return this; },
    add: async (data: Record<string, unknown>) => { (state.records[name] ??= []).push(data); return { id: `synthetic-${state.records[name].length}` }; },
    get: async () => {
      const records = (state.records[name] || []).filter(record => filters.every(([field, value]) => record[field] === value));
      return { empty: !records.length, docs: records.map((record, i) => ({
        id: `synthetic-${i + 1}`, data: () => ({ ...record }), ref: { set: async (data: Record<string, unknown>) => { Object.assign(record, data); } },
      })) };
    },
  };
} } }));

import { POST as saveOrganizer, GET as getOrganizer } from '../app/api/tax/organizer/route';
import { GET as getEstimate } from '../app/api/tax/compute-1040/route';
import { POST as exportPdf } from '../app/api/tax/form-1040/route';
import { GET as getQuarterlySummary } from '../app/api/tax/quarterly-reminders/route';
import { KpiGrid } from '../components/dashboard/KpiGrid';
import { EMPTY_ORGANIZER_ANSWERS } from '../components/tax-organizer-screen';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedBusinessLossFacts, reviewedOBBBADeductionFacts, SYNTHETIC_VIN } from './fixtures/tier1-facts';

const jsonRequest = (year = 2026) => new NextRequest(`http://localhost/api/tax/compute-1040?year=${year}`);
const pdfRequest = (year = 2026) => new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year }) });
const quarterlyRequest = (year = 2026) => new NextRequest(`http://localhost/api/tax/quarterly-reminders?year=${year}`);
async function save(answers: Record<string, string>, taxYear = 2026) {
  const response = await saveOrganizer(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify({ ...EMPTY_ORGANIZER_ANSWERS, ...reviewedPersonalDeductionOrganizer(taxYear), ...answers, taxYear }) }));
  expect([200, 201]).toContain(response.status); // 201 creates the year's record; 200 updates it.
}
async function expectReview(code: string, detail: RegExp) {
  const createPdf = vi.spyOn(PDFDocument, 'create');
  for (const response of [await getEstimate(jsonRequest()), await exportPdf(pdfRequest()), await getQuarterlySummary(quarterlyRequest())]) {
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ code, error: expect.stringContaining('Tax Organizer') });
    expect(body.error).toMatch(detail);
  }
  expect(state.calculations).toHaveLength(0);
  expect(createPdf).not.toHaveBeenCalled();
  createPdf.mockRestore();
}
async function pdfText(): Promise<string> {
  const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
  const pdf = await exportPdf(pdfRequest()); expect(pdf.status).toBe(200);
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  return drawText.mock.calls.map(call => call[0]).join(' ');
}
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function walk(node: any): any[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }

beforeEach(() => {
  vi.restoreAllMocks(); resetRateLimitStore(); state.records = {}; state.profile = { filing_status: 'single' }; state.tx = []; state.calculations = [];
  state.records.w2_income = [{ userId: 'tier1-owner', taxYear: 2026, wages: 60000, federalWithheld: 0, socialSecurityWages: 60000, medicareWages: 60000 }];
});

describe('capital-gain character through the routes', () => {
  it('review-blocks the legacy combined total in JSON, PDF and quarterly entrypoints', async () => {
    await save({ hasCapGains: 'yes', amountCapGains: '20000' });
    await expectReview('CAPITAL_GAIN_REVIEW_REQUIRED', /long-term treatment is not assumed/);
    const saved = await (await getOrganizer(new NextRequest('http://localhost/api/tax/organizer?year=2026'))).json();
    expect(saved.organizer).toMatchObject({ amountCapGains: '20000', amountShortTermCapGains: '', amountLongTermCapGains: '' });
  });

  it('persists the split, limits the loss on line 7 and matches JSON to the PDF', async () => {
    await save({ hasCapGains: 'yes', amountShortTermCapGains: '-5000', amountLongTermCapGains: '1000', amountCapGains: '-4000' });
    const response = await getEstimate(jsonRequest()); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.income).toMatchObject({ capGains: -3000, shortTermCapGains: -5000, longTermCapGains: 1000, capitalLossCarryforward: 1000 });
    expect(body.form1040.totalIncome).toBe(57000);
    expect(body.form1040.calculationWarnings.some((w: string) => w.includes('$1,000 carries forward'))).toBe(true);
    const drawn = await pdfText();
    expect(drawn).toContain('-$3,000.00');
    expect(state.calculations[0]).toEqual(state.calculations[1]);
  });
});

describe('Schedule C loss through the routes', () => {
  beforeEach(() => {
    state.tx = [{ amount: 9000, date: '2026-03-01', category: 'office_expense', is_deductible: true }];
    state.records.gross_receipts = [{ userId: 'tier1-owner', taxYear: 2026, amount: 4000 }];
  });

  it('review-blocks a loss without the at-risk, participation and profit-motive facts', async () => {
    await save({});
    await expectReview('BUSINESS_LOSS_REVIEW_REQUIRED', /net loss of \$5,000/);
    await save({ businessLossFacts: reviewedBusinessLossFacts(2026, { profitMotive: 'no' }) });
    await expectReview('BUSINESS_LOSS_REVIEW_REQUIRED', /section 183 hobby/);
  });

  it('offsets other income with $0 SE tax once the facts are saved, in JSON, PDF and quarterly output', async () => {
    await save({ businessLossFacts: reviewedBusinessLossFacts() });
    const body = await (await getEstimate(jsonRequest())).json();
    expect(body.income).toMatchObject({ scheduleCNetProfit: -5000, scheduleCAllowed: -5000 });
    expect(body.seCalc.totalSETax).toBe(0);
    expect(body.form1040).toMatchObject({ totalIncome: 55000, agi: 55000, selfEmploymentTax: 0, qbiDeduction: 0 });
    expect(body.form1040.calculationWarnings.some((w: string) => w.includes('Form 8995 line 16'))).toBe(true);
    const quarterly = await (await getQuarterlySummary(quarterlyRequest())).json();
    expect(quarterly).toMatchObject({ netProfit: -5000, totalEstimatedTax: body.form1040.totalTax });
    expect(await pdfText()).toContain('-$5,000.00');
  });
});

describe('Working Families Tax Cuts deductions through the routes', () => {
  beforeEach(() => { state.records.gross_receipts = [{ userId: 'tier1-owner', taxYear: 2026, amount: 40000 }]; });

  it('review-blocks SSTB tips and business-use vehicle interest', async () => {
    await save({ obbbaDeductionFacts: reviewedOBBBADeductionFacts(2026, { hasQualifiedTips: 'yes', qualifiedTipsAmount: '8000', tipsOccupationListed: 'yes', tipsBusinessSSTB: 'yes' }) });
    await expectReview('OBBBA_DEDUCTION_REVIEW_REQUIRED', /Notice 2025-69/);
    await save({ obbbaDeductionFacts: reviewedOBBBADeductionFacts(2026, {
      hasVehicleLoanInterest: 'yes', vehicleLoanInterestAmount: '3000', vehicleLoanAfter2024: 'yes', vehicleNewUSAssembled: 'yes', vehiclePersonalUse: 'no', vehicleLoanQualified: 'yes', vehicleVIN: SYNTHETIC_VIN,
    }) });
    await expectReview('OBBBA_DEDUCTION_REVIEW_REQUIRED', /Schedule C business-interest rules/);
  });

  it('applies the tips deduction on line 13b before QBI and shows it in the PDF', async () => {
    await save({ obbbaDeductionFacts: reviewedOBBBADeductionFacts(2026, { hasQualifiedTips: 'yes', qualifiedTipsAmount: '8000', tipsOccupationListed: 'yes', tipsBusinessSSTB: 'no' }) });
    const body = await (await getEstimate(jsonRequest())).json();
    expect(body.form1040).toMatchObject({ qualifiedTipsDeduction: 8000, scheduleOneADeductions: 8000 });
    expect(body.form1040.obbbaDeductions.qualifiedTips).toMatchObject({ deduction: 8000, limitedAmount: 8000, phaseoutReduction: 0 });
    // QBI excludes the deducted tips: (40,000 - half SE tax - 8,000) x 20%.
    expect(body.form1040.qbiDeduction).toBeCloseTo((40000 - body.seCalc.halfSEDeduction - 8000) * 0.2, 1);
    const drawn = await pdfText();
    expect(drawn).toContain('Schedule 1-A line 38'); expect(drawn).toContain('$8,000.00');
  });
});

describe('dashboard review routing', () => {
  it.each([
    ['CAPITAL_GAIN_REVIEW_REQUIRED', 'Review capital gain character'],
    ['BUSINESS_LOSS_REVIEW_REQUIRED', 'Review business loss facts'],
    ['OBBBA_DEDUCTION_REVIEW_REQUIRED', 'Review Working Families Tax Cuts deductions'],
  ])('sends %s to the Tax Organizer without totals', (code, label) => {
    const onReview = vi.fn();
    const tree = KpiGrid({ state: { status: 'review', code, message: 'Review in Tax Organizer.' } as any, taxYear: 2026, onRetry() {}, onReview });
    expect(text(tree)).toContain('needs review'); expect(text(tree)).not.toContain('$');
    walk(tree).find(node => node.type === 'button' && text(node) === label).props.onClick();
    expect(onReview).toHaveBeenCalledWith('tax-organizer');
  });
});
