import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import type { ReactElement } from 'react';

// Real organizer persistence handler, federal snapshot, calculation and PDF
// route. Only auth, entitlement and Firestore transport are synthetic.
const state = vi.hoisted(() => ({
  records: {} as Record<string, Record<string, unknown>[]>,
  profile: { filing_status: 'single' } as Record<string, unknown>,
  calculations: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'benefits-owner' } }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => [] }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
// The Form 1040 PDF route is rate limited per owner; give the limiter an in-memory store independent of this suite's Admin double.
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { resetRateLimitStore } from './fixtures/rate-limit-store';
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
    add: async (data: Record<string, unknown>) => {
      (state.records[name] ??= []).push(data);
      return { id: `synthetic-${state.records[name].length}` };
    },
    get: async () => {
      const records = (state.records[name] || []).filter(record => filters.every(([field, value]) => record[field] === value));
      return { empty: !records.length, docs: records.map((record, i) => ({
        id: `synthetic-${i + 1}`, data: () => ({ ...record }),
        ref: { set: async (data: Record<string, unknown>) => { Object.assign(record, data); } },
      })) };
    },
  };
} } }));

import { POST as saveOrganizer, GET as getOrganizer } from '../app/api/tax/organizer/route';
import { GET as getQuarterlySummary } from '../app/api/tax/quarterly-reminders/route';
import { GET as getEstimate } from '../app/api/tax/compute-1040/route';
import { POST as exportPdf } from '../app/api/tax/form-1040/route';
import { assertSocialSecurityBenefitsSupported, SocialSecurityReviewRequiredError } from '../lib/tax-rules/social-security';
import { decryptSensitive, isEncrypted } from '../lib/security/utils';
import { EMPTY_ORGANIZER_ANSWERS } from '../components/tax-organizer-screen';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { eligibilityOrganizer, hsaFacts } from './fixtures/eligibility';
import { KpiGrid } from '../components/dashboard/KpiGrid';

const jsonRequest = (year = 2026) => new NextRequest(`http://localhost/api/tax/compute-1040?year=${year}`);
const pdfRequest = (year = 2026) => new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year }) });
async function save(answers: Record<string, string>, taxYear = 2026) {
  const response = await saveOrganizer(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify({ ...reviewedPersonalDeductionOrganizer(taxYear), ...answers, taxYear }) }));
  expect(response.status).toBe(201);
}
beforeEach(() => { vi.restoreAllMocks(); state.records = {}; state.profile = { filing_status: 'single' }; state.calculations = []; resetRateLimitStore(); });

describe('Social Security requires the missing IRS facts', () => {
  it.each([2024, 2025, 2026])('withholds JSON and PDF for a saved $20,000-only benefits organizer in %s', async year => {
    // With complete ordinary-case facts and no other income, $20,000 of net
    // benefits would be below the IRS single base amount. Legacy Box 3 alone
    // cannot establish those facts, and must never be converted to $17,000.
    await save({ hasSocialSecurity: 'yes', amountSocialSecurity: '20000' }, year);
    const before = JSON.stringify(state.records);
    const createPdf = vi.spyOn(PDFDocument, 'create');
    const json = await getEstimate(jsonRequest(year));
    const pdf = await exportPdf(pdfRequest(year));
    expect(json.status).toBe(422); expect(pdf.status).toBe(422);
    const body = await json.json();
    expect(body).toEqual({ code: 'SOCIAL_SECURITY_REVIEW_REQUIRED', error: expect.stringContaining('Tax Organizer') });
    expect(body.error).toContain('Publication 915');
    expect(await pdf.json()).toEqual(body);
    expect(pdf.headers.get('content-type')).toContain('application/json');
    expect(state.calculations).toHaveLength(0);
    expect(createPdf).not.toHaveBeenCalled();
    expect(JSON.stringify(state.records)).toBe(before);
    const saved = await (await getOrganizer(new NextRequest(`http://localhost/api/tax/organizer?year=${year}`))).json();
    expect(saved.organizer).toMatchObject({ hasSocialSecurity: 'yes', amountSocialSecurity: '20000' });
  });

  it.each([
    { hasSocialSecurity: 'yes', amountSocialSecurity: '' },
    { hasSocialSecurity: 'yes', amountSocialSecurity: '0' },
    { amountSocialSecurity: '20000' },
    { hasSocialSecurity: 'no', amountSocialSecurity: '20000' },
    { hasSocialSecurity: 'no', amountSocialSecurity: '-1500' },
    { amountSocialSecurity: 'unknown' },
  ])('does not silently assume zero or 85%% for incomplete/legacy benefits %j', async answers => {
    await save(answers as Record<string, string>);
    for (const response of [await getEstimate(jsonRequest()), await exportPdf(pdfRequest())]) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('SOCIAL_SECURITY_REVIEW_REQUIRED');
      expect(body).not.toHaveProperty('form1040');
      expect(body).not.toHaveProperty('income');
    }
    expect(state.calculations).toHaveLength(0);
  });

  it.each(['single', 'married_filing_jointly', 'married_filing_separately', 'head_of_household'])('does not infer missing benefit facts from filing status %s or high wages', async filingStatus => {
    state.profile.filing_status = filingStatus;
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: 2026, wages: 100000 }];
    await save({ hasSocialSecurity: 'yes', amountSocialSecurity: '20000' });
    expect((await getEstimate(jsonRequest())).status).toBe(422);
    expect((await exportPdf(pdfRequest())).status).toBe(422);
    expect(state.calculations).toHaveLength(0);
  });

  it.each([{}, { hasSocialSecurity: 'no', amountSocialSecurity: '0.00' }, { hasSocialSecurity: '', amountSocialSecurity: '' }])('keeps the real no-benefits JSON/PDF calculation unchanged for %j', async answers => {
    await save(answers as Record<string, string>);
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: 2026, wages: 100000 }];
    const response = await getEstimate(jsonRequest()); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.income.socialSecurity).toBe(0);
    expect(body.form1040).toMatchObject({ totalIncome: 100000, incomeTax: 13170 });
    const pdf = await exportPdf(pdfRequest());
    expect(pdf.status).toBe(200); expect(pdf.headers.get('content-type')).toContain('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(state.calculations).toHaveLength(2);
    expect(state.calculations[0]).toEqual(state.calculations[1]);
  });

  it('does not block the current owner/year for someone else’s or prior-year benefits', async () => {
    state.records.tax_organizers = [
      { ...reviewedPersonalDeductionOrganizer(), userId: 'benefits-owner', taxYear: 2026 },
      { userId: 'other-owner', taxYear: 2026, hasSocialSecurity: 'yes', amountSocialSecurity: '20000' },
      { userId: 'benefits-owner', taxYear: 2025, hasSocialSecurity: 'yes', amountSocialSecurity: '20000' },
    ];
    expect((await getEstimate(jsonRequest())).status).toBe(200);
    expect((await exportPdf(pdfRequest())).status).toBe(200);
  });

  it.each([{ amountSocialSecurity: NaN }, { amountSocialSecurity: Infinity }, { amountSocialSecurity: false }, { amountSocialSecurity: [] }, { amountSocialSecurity: '0x0' }, { hasSocialSecurity: 'unknown' }])('review-blocks malformed stored benefit facts %j', organizer => {
    expect(() => assertSocialSecurityBenefitsSupported(organizer)).toThrow(SocialSecurityReviewRequiredError);
  });

  it('offers the organizer review action without displaying a fabricated dashboard amount', () => {
    const onReview = vi.fn();
    const tree = KpiGrid({ taxYear: 2026, state: { status: 'review', code: 'SOCIAL_SECURITY_REVIEW_REQUIRED', message: new SocialSecurityReviewRequiredError().message }, onReview, onRetry() {} });
    type ReviewElement = ReactElement<{ children?: unknown; value?: unknown; onClick?: () => void }>;
    const walk = (node: unknown): ReviewElement[] => Array.isArray(node) ? node.flatMap(walk)
      : node && typeof node === 'object' && 'props' in node ? [node as ReviewElement, ...walk((node as ReviewElement).props.children)] : [];
    const nodes = walk(tree);
    expect(nodes.some(node => typeof node.props.value === 'string' && node.props.value.startsWith('$'))).toBe(false);
    nodes.find(node => node.type === 'button' && node.props.children === 'Review Social Security records')!.props.onClick!();
    expect(onReview).toHaveBeenCalledWith('tax-organizer');
  });
});


const supportedBenefits = () => ({
  hasSocialSecurity: 'yes', amountSocialSecurity: '6200', filingStatus: 'single',
  socialSecurityNetBenefits: '5980', socialSecurityFederalWithheld: '250',
  socialSecurityTaxExemptInterest: '0', socialSecurityExcludedSavingsBondInterest: '0', socialSecurityAdoptionExclusion: '0',
  socialSecurityResident: 'yes', socialSecurityLumpSum: 'no', socialSecuritySpecialIRA: 'no', socialSecurityForeignExclusion: 'no',
  socialSecurityIncomeComplete: 'yes', socialSecurityAdjustmentsComplete: 'yes', socialSecurityLivedApartAllYear: '', socialSecurityRetirementReviewed: 'yes',
});

describe('complete Social Security facts reach real JSON and PDF', () => {
  it('persists supported HSA eligibility and reconciles its deduction across the Social Security JSON/PDF worksheets', async () => {
    await save({ ...supportedBenefits(), socialSecurityNetBenefits: '20000', amountOtherIncome: '17000', paidHSA: 'yes', hsaAmount: '1000',
      ...eligibilityOrganizer({ hsa: hsaFacts() }) });
    const response = await getEstimate(jsonRequest()); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.socialSecurityWorksheet).toMatchObject({ allowedAdjustments: 1000, combinedIncome: 26000, taxableBenefits: 500 });
    expect(body.form1040.appliedAdjustments.hsaDeduction).toBe(1000);
    const pdf = await exportPdf(pdfRequest()); expect(pdf.status).toBe(200);
    expect(state.calculations[0]).toEqual(state.calculations[1]);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it.each([
    '{"version":1,"taxYear":2025}', '{"version":1,"taxYear":2026,"approved":true}',
    '{"version":1,"taxYear":2026,"hsa":{"age55":true}}', 'not json',
  ])('rejects malformed or other-year eligibility without writing answers: %s', adjustmentEligibilityFacts => {
    return saveOrganizer(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify({ taxYear: 2026, adjustmentEligibilityFacts }) }))
      .then(response => { expect(response.status).toBe(400); expect(state.records.tax_organizers).toBeUndefined(); });
  });
  it('saves the full real organizer defaults with one reserved personal-deduction JSON field', async () => {
    const answers = { ...EMPTY_ORGANIZER_ANSWERS, personalDeductionFacts: '{}' };
    expect(Object.keys(answers).length).toBeLessThanOrEqual(80);
    await save(answers);
    const response = await getOrganizer(new NextRequest('http://localhost/api/tax/organizer?year=2026'));
    expect(response.status).toBe(200); expect((await response.json()).organizer).toMatchObject(answers);
  });

  it.each([2024, 2025, 2026])('persists the IRS Example1 facts and matches JSON/PDF in%s', async year => {
    await save({ ...supportedBenefits(), amount1099INT: '990', amountIRADistributions: '18600' }, year);
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: year, wages: 9400, federalWithheld: 1000 }];
    const loaded = await (await getOrganizer(new NextRequest(`http://localhost/api/tax/organizer?year=${year}`))).json();
    expect(loaded.organizer).toMatchObject(supportedBenefits());
    const response = await getEstimate(jsonRequest(year)); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.income).toMatchObject({ socialSecurity: 2990, socialSecurityNetBenefits: 5980 });
    expect(body.socialSecurityWorksheet).toMatchObject({ combinedIncome: 31980, taxableBenefits: 2990 });
    expect(body.form1040.totalIncome).toBe(31980);
    expect(body.payments).toMatchObject({ w2FederalWithheld: 1000, socialSecurityFederalWithheld: 250, totalFederalWithheld: 1250 });
    expect(body.form1040.totalPayments).toBe(1250);
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    const pdf = await exportPdf(pdfRequest(year)); expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(state.calculations[0]).toEqual(state.calculations[1]);
    const text = drawText.mock.calls.map(call => call[0]).join(' ');
    expect(text).toContain('Box5 net benefits'); expect(text).toContain('SSA/RRB federal income tax withheld');
    expect(text).toContain('5,980'); expect(text).toContain('2,990');
    if (year === 2026 && process.env.SOCIAL_SECURITY_PDF_ARTIFACT) writeFileSync(process.env.SOCIAL_SECURITY_PDF_ARTIFACT, bytes);
  });
  it('supports the joint IRS Example3 bond exclusion without adding excluded interest to taxable income', async () => {
    state.profile.filing_status = 'married_filing_jointly';
    await save({ ...supportedBenefits(), filingStatus: 'married_filing_jointly', socialSecurityNetBenefits: '10000', socialSecurityExcludedSavingsBondInterest: '200', amount1099INT: '2300', amountIRADistributions: '38000' });
    const body = await (await getEstimate(jsonRequest())).json();
    expect(body.income.socialSecurity).toBe(6275); expect(body.form1040.totalIncome).toBe(46575);
  });
  it('excludes student-loan interest from the benefit worksheet while applying it once to AGI', async () => {
    await save({ ...supportedBenefits(), socialSecurityNetBenefits: '20000', amountOtherIncome: '17000' });
    state.records.tax_deductions = [{ userId: 'benefits-owner', taxYear: 2026, studentLoanInterest: 1000 }];
    const body = await (await getEstimate(jsonRequest())).json();
    expect(body.socialSecurityWorksheet).toMatchObject({ allowedAdjustments: 0, combinedIncome: 27000, taxableBenefits: 1000 });
    expect(body.form1040.adjustments).toBe(1000); expect(body.form1040.totalIncome).toBe(18000);
  });
  it.each([['yes', 0], ['no', 3400]])('uses MFS lived-apart answer%s consistently in JSON/PDF', async (livedApart, expected) => {
    state.profile.filing_status = 'married_filing_separately';
    await save({ ...supportedBenefits(), filingStatus: 'married_filing_separately', socialSecurityNetBenefits: '4000', socialSecurityLivedApartAllYear: livedApart, amountOtherIncome: '8000' });
    const response = await getEstimate(jsonRequest()); expect(response.status).toBe(200); expect((await response.json()).income.socialSecurity).toBe(expected);
    expect((await exportPdf(pdfRequest())).status).toBe(200); expect(state.calculations[0]).toEqual(state.calculations[1]);
  });
  it.each([
    { socialSecurityLumpSum: 'yes' }, { socialSecuritySpecialIRA: 'yes' }, { socialSecurityForeignExclusion: 'yes' },
    { socialSecurityNetBenefits: '-500' }, { socialSecurityIncomeComplete: '' }, { filingStatus: 'married_filing_jointly' },
    { amountIRADistributions: '18600', socialSecurityRetirementReviewed: '' }, { amountIRADistributions: '18600', socialSecurityRetirementReviewed: 'no' },
    { amountCapGains: '-3000' }, { amountCapGains: '1000' }, { amountRentalIncome: '1000' },
  ])('keeps unsupported/incomplete facts%j review-blocked in both routes', async overrides => {
    await save({ ...supportedBenefits(), ...overrides });
    for (const response of [await getEstimate(jsonRequest()), await exportPdf(pdfRequest())]) {
      expect(response.status).toBe(422); expect((await response.json()).code).toBe('SOCIAL_SECURITY_REVIEW_REQUIRED');
    }
    expect(state.calculations).toHaveLength(0);
  });
  it('preserves Social Security reconciliation precedence, then requires HSA eligibility after amounts match', async () => {
    await save({ ...supportedBenefits(), socialSecurityNetBenefits: '20000', amountOtherIncome: '17000', paidHSA: 'yes', hsaAmount: '1000' });
    state.records.tax_deductions = [{ userId: 'benefits-owner', taxYear: 2026, hsaContribution: 500 }];
    for (const missing of [await getEstimate(jsonRequest()), await exportPdf(pdfRequest())]) {
      expect(missing.status).toBe(422);
      expect(await missing.json()).toEqual({ code: 'SOCIAL_SECURITY_REVIEW_REQUIRED', error: expect.stringContaining('Tax Deductions') });
    }
    state.records.tax_deductions = [{ userId: 'benefits-owner', taxYear: 2026, hsaContribution: 1000 }];
    for (const response of [await getEstimate(jsonRequest()), await exportPdf(pdfRequest()), await getQuarterlySummary(new NextRequest('http://localhost/api/tax/quarterly-reminders?year=2026'))]) {
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ code: 'TAX_CALCULATION_SCOPE_REVIEW_REQUIRED', error: expect.stringContaining('HSA eligibility') });
    }
    expect(state.calculations).toEqual([]);
  });
  it('quarterly records include benefit withholding once and retain the separate W2 field', async () => {
    await save(supportedBenefits());
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: 2026, wages: 40000, federalWithheld: 1000 }];
    const response = await getQuarterlySummary(new NextRequest('http://localhost/api/tax/quarterly-reminders?year=2026'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ w2Withheld: 1000, socialSecurityWithheld: 250, totalFederalWithheld: 1250, totalPaid: 1250 });
  });
  it('still rejects2027 even when all benefit facts are supplied', async () => {
    await save(supportedBenefits(), 2027);
    expect((await getEstimate(jsonRequest(2027))).status).toBe(400);
    expect((await exportPdf(pdfRequest(2027))).status).toBe(400);
  });
});


describe('personal deductions use the same saved facts in JSON and PDF', () => {
  it.each([[2024, 16550, 0], [2025, 17750, 6000], [2026, 18150, 6000]])('prints the supported senior deductions and total for%s', async (year, standard, senior) => {
    await save({ dateOfBirth: '1955-05-20' }, year);
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: year, wages: 60000 }];
    const json = await getEstimate(jsonRequest(year)); expect(json.status).toBe(200);
    const body = await json.json();
    expect(body.form1040).toMatchObject({ agi: 60000, deductionUsed: standard, enhancedSeniorDeduction: senior, taxableIncome: 60000 - standard - senior });
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    const pdf = await exportPdf(pdfRequest(year)); expect(pdf.status).toBe(200);
    const calls = drawText.mock.calls; const text = calls.map(call => call[0]).join(' ');
    expect(state.calculations[0]).toEqual(state.calculations[1]);
    const totalLabel = calls.find(call => call[0] === (year === 2024 ? 'Add lines 12 and 13' : 'Add lines 12e, 13a and 13b'))!;
    expect(totalLabel).toBeDefined();
    expect(calls.some(call => call[0] === `$${(standard + senior).toLocaleString('en-US', { minimumFractionDigits: 2 })}` && Math.abs(call[1]!.y! - totalLabel[1]!.y!) < 3)).toBe(true);
    if (year === 2024) { expect(text).not.toContain('13b'); expect(text).not.toContain('Enhanced senior deduction'); }
    else { expect(text).toContain('13b'); expect(text).toContain('Enhanced senior deduction'); expect(text).toContain('$6,000.00'); }
    if (year === 2026 && process.env.PERSONAL_DEDUCTIONS_PDF_ARTIFACT) writeFileSync(process.env.PERSONAL_DEDUCTIONS_PDF_ARTIFACT, Buffer.from(await pdf.arrayBuffer()));
  });

  it('preserves QBI and senior deduction parity in the PDF total', async () => {
    await save({ dateOfBirth: '1955-05-20' });
    state.records.gross_receipts = [{ userId: 'benefits-owner', taxYear: 2026, amount: 30000 }];
    const json = await getEstimate(jsonRequest()); expect(json.status).toBe(200);
    const body = await json.json();
    // 30,000 profit - 2,119.43 half-SE - 18,150 standard - 6,000 senior
    // leaves 3,730.57 before QBI, so its 20% income cap is 746.114.
    expect(body.form1040.qbiDeduction).toBeCloseTo(746.114, 2);
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    expect((await exportPdf(pdfRequest())).status).toBe(200);
    expect(state.calculations[0]).toEqual(state.calculations[1]);
    const total = body.form1040.deductionUsed + body.form1040.enhancedSeniorDeduction + body.form1040.qbiDeduction;
    expect(drawText.mock.calls.some(call => call[0] === `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)).toBe(true);
  });

  it('returns the actionable personal-deduction review response before creating a PDF', async () => {
    await save({ personalDeductionFacts: '' });
    const create = vi.spyOn(PDFDocument, 'create');
    const json = await getEstimate(jsonRequest()), pdf = await exportPdf(pdfRequest());
    expect(json.status).toBe(422); expect(pdf.status).toBe(422);
    expect(await pdf.json()).toEqual(await json.json());
    expect(create).not.toHaveBeenCalled();
  });
});


describe('Form1040 preparer export completeness disclosures', () => {
  it('prints saved taxpayer/spouse identities with masked identifiers and missing-record warnings without filing authorization', async () => {
    state.profile = { filing_status: 'married_filing_jointly', name: 'Synthetic Maria Long Family Name 漢' };
    await save({ filingStatus: 'married_filing_jointly', spouseName: 'Synthetic Spouse Full Name' });
    // Legacy plaintext spouse SSN: read as-is, printed masked, re-encrypted by the read.
    state.records.tax_organizers[0].spouseSSN = '111223333';
    const draw = vi.spyOn(PDFPage.prototype, 'drawText');
    const response = await exportPdf(pdfRequest()); expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
    const text = draw.mock.calls.map(call => call[0]).join(' ');
    expect(text).toContain('Synthetic Spouse Full Name'); expect(text).toContain('***-**-3333');
    expect(text).not.toContain('111-22-3333'); expect(text).not.toContain('111223333');
    const stored = state.records.tax_organizers[0].spouseSSN as string;
    expect(isEncrypted(stored)).toBe(true); expect(decryptSensitive(stored)).toBe('111223333');
    expect(text).toContain('Synthetic Maria Long Family Name [U+6F22]');
    expect(text).toContain('SSN not filled in'); expect(text).toContain('Mailing address incomplete');
    expect(text).toContain('Do not file this export with the IRS'); expect(text).not.toContain('Under penalties of perjury'); expect(text).not.toContain('Sign Here');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
