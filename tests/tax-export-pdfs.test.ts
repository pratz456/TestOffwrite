import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { UserProfile } from '../lib/firebase/profiles-server';
import type { Asset } from '../lib/reports/calc4562';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
const state = vi.hoisted(() => ({ records: {} as Record<string, Record<string, unknown>[]>, transactions: [] as Record<string, unknown>[], assets: [] as Asset[], fail: '', queries: [] as string[], extraWarnings: [] as string[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'export-owner' } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => ({ uid: 'export-owner' }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => 0 }));
vi.mock('@/lib/tax-rules/compute-1040', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tax-rules/compute-1040')>();
  return { ...actual, compute1040: (input: Parameters<typeof actual.compute1040>[0], prior?: number) => {
    const result = actual.compute1040(input, prior);
    result.calculationWarnings.push(...state.extraWarnings);
    return result;
  } };
});
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => { if (state.fail === 'transactions') throw new Error('private failure'); return state.transactions; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.transactions, error: state.fail === 'transactions' ? new Error('private failure') : null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { name: 'Synthetic Taxpayer', profession: 'Consultant', filing_status: 'single', primary_work_location: 'Home Office' }, error: state.fail === 'profile' ? new Error('private failure') : null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({
  getAssetsSettings: async () => ({ data: state.assets, error: state.fail === 'assets' ? new Error('private failure') : null }),
  getScheduleCSettings: async () => state.fail === 'assets'
    ? { data: null, error: new Error('private failure') }
    : { data: { assets: state.assets, homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null },
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  state.queries.push(name); const filters: [string, unknown][] = [];
  const query = { where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; }, limit() { return query; }, get: async () => {
    if (state.fail === name) throw new Error('private Firestore failure');
    const records = (state.records[name] || []).filter(row => filters.every(([key, value]) => row[key] === value));
    return { empty: !records.length, docs: records.map((row, index) => ({ id: `record-${index}`, data: () => row, ref: { set: async (patch: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (!options?.merge) { for (const key of Object.keys(row)) delete row[key]; }
      Object.assign(row, patch);
    } } })) };
  }, add: async (data: Record<string, unknown>) => { (state.records[name] ??= []).push(data); return { id: `record-${state.records[name].length}` }; } };
  return query;
} } }));
import { POST as scheduleC } from '../app/api/tax/schedule-c/export/route';
import { GET as calculateC } from '../app/api/tax/schedule-c/calculate/route';
import { GET as autoSE } from '../app/api/tax/schedule-se/auto/route';
import { loadScheduleSEData } from '../lib/reports/load-schedule-se';
import { generateScheduleSEPDF } from '../lib/reports/scheduleSE';
import { generateForm4562PDF } from '../lib/reports/form4562';
import { generateForm8829PDF } from '../lib/reports/form8829';
import { scheduleCExportLine } from '../lib/schedule-c/export-lines';
import { POST as form1040 } from '../app/api/tax/form-1040/route';
import { GET as getOrganizer, POST as saveOrganizer } from '../app/api/tax/organizer/route';
import { POST as exportReport } from '../app/api/reports/export/route';
import { EMPTY_ORGANIZER_ANSWERS } from '../components/tax-organizer-screen';
const profile = { name: 'Synthetic Taxpayer', filing_status: 'single' } as UserProfile;
const request = (body: unknown) => new NextRequest('http://localhost/api/tax/schedule-c/export', { method: 'POST', body: JSON.stringify(body) });
const record = (fields: Record<string, unknown>, taxYear = 2026) => ({ userId: 'export-owner', taxYear, ...fields });
const saveArtifact = (name: string, bytes: Uint8Array) => { if (process.env.TAX_EXPORT_ARTIFACT_DIR) { mkdirSync(process.env.TAX_EXPORT_ARTIFACT_DIR, { recursive: true }); writeFileSync(`${process.env.TAX_EXPORT_ARTIFACT_DIR}/${name}.pdf`, bytes); } };
function inspectText() {
  const spy = vi.spyOn(PDFPage.prototype, 'drawText');
  return { spy, text: () => spy.mock.calls.map(call => call[0]).join('\n'), checkBounds: () => {
    for (const [text, options] of spy.mock.calls) {
      expect(options!.y!, text).toBeGreaterThanOrEqual(20); expect(options!.y!, text).toBeLessThanOrEqual(766);
      expect(options!.x!, text).toBeGreaterThanOrEqual(42);
      expect(options!.x! + options!.font!.widthOfTextAtSize(text, options!.size!), text).toBeLessThanOrEqual(571);
    }
  } };
}
beforeEach(() => { vi.restoreAllMocks(); resetRateLimitStore(); state.records = { gross_receipts: [record({ amount: 100000 })] }; state.transactions = []; state.assets = []; state.fail = ''; state.queries = []; state.extraWarnings = []; });

describe('Schedule C real PDF and request integrity', () => {
  it.each([2027, 2026.5, '2026junk', '', null])('rejects unsupported/malformed year %s before fetching records', async year => {
    expect((await scheduleC(request({ year }))).status).toBe(400); expect(state.queries).toHaveLength(0);
  });
  it.each(['transactions', 'profile', 'gross_receipts'])('returns an error instead of blank/zero PDF on %s failure', async fail => {
    state.fail = fail; const create = vi.spyOn(PDFDocument, 'create'); const response = await scheduleC(request({ year: 2026 }));
    expect(response.status).toBe(503); expect(create).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('private');
  });
  it('prints recorded receipts, every signed transaction and no invented filing elections', async () => {
    state.transactions = Array.from({ length: 70 }, (_, i) => ({ id: `tx-${i}`, merchant_name: `SYNTHETIC-RECORD-${String(i).padStart(3, '0')}`, amount: 100, date: '2026-03-01', iso_currency_code: 'USD', category: 'unknown', is_deductible: true }));
    state.transactions.push({ merchant_name: 'SYNTHETIC-REFUND', amount: -20, date: '2026-03-01', iso_currency_code: 'USD', category: 'unknown', is_deductible: true });
    state.transactions.push({ merchant_name: 'SYNTHETIC-MEAL', amount: 10.01, date: '2026-03-01', iso_currency_code: 'USD', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true });
    state.transactions.push({ merchant_name: 'UNCONFIRMED-EXCLUDED', amount: 999, date: '2026-03-01', iso_currency_code: 'USD', category: 'unknown', is_deductible: null });
    state.records.gross_receipts!.push(record({ amount: 99999 }, 2025), { userId: 'other-owner', taxYear: 2026, amount: 99999 });
    const view = inspectText(); const response = await scheduleC(request({ year: '2026', includeAppendix: true }));
    expect(response.status).toBe(200); const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
    expect(view.text()).toContain('$100,000.00'); expect(view.text()).toContain('$6,985.01'); expect(view.text()).toContain('$93,014.99');
    for (let i = 0; i < 70; i++) expect(view.text()).toContain(`SYNTHETIC-RECORD-${String(i).padStart(3, '0')}`);
    expect(view.text()).toContain('-$20.00'); expect(view.text()).toContain('$5.01'); expect(view.text()).not.toContain('UNCONFIRMED-EXCLUDED');
    expect(view.text()).not.toContain('Cash'); expect(view.text()).not.toContain('Home Office');
    expect(view.text()).toContain('Not determined'); expect(view.text()).toContain('27b'); expect(view.text()).toContain('NOT FOR FILING');
    expect(response.headers.get('cache-control')).toContain('no-store'); view.checkBounds(); saveArtifact('schedule-c-2026', bytes);
  });
  it('still renders when organizer identifier fields are absent', async () => {
    state.records.tax_organizers = [record({ filingStatus: 'single' })];
    const view = inspectText();
    const response = await scheduleC(request({ year: 2026, includeAppendix: false }));
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0x25);
    expect(view.text()).toContain('Not provided');
    expect(view.text()).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(view.text()).not.toContain('___-__-____');
    expect(view.text()).not.toContain('000-00-0000');
    expect(view.text()).not.toContain('***-**-');
    const drawn = view.spy.mock.calls.map(call => call[0]);
    expect(drawn[drawn.indexOf('SSN (last 4)') + 1]).toBe('');
  });
  it('leaves the SSN and line D boxes blank even when organizer values are stored', async () => {
    const { encryptSensitive } = await import('../lib/security/utils');
    state.records.tax_organizers = [record({ taxpayerSSN: encryptSensitive('900000001'), ein: encryptSensitive('123456789') })];
    const view = inspectText(); expect((await scheduleC(request({ year: 2026, includeAppendix: false }))).status).toBe(200);
    const drawn = view.spy.mock.calls.map(call => call[0]);
    expect(drawn[drawn.indexOf('SSN (last 4)') + 1]).toBe('');
    expect(drawn[drawn.indexOf('EIN (last 4)') + 1]).toBe('');
    expect(view.text()).not.toMatch(/900000001|900-00-0001|123456789|\*\*\*-\*\*-|\*\*-\*\*\*/);
    state.records.tax_organizers = [record({ taxpayerSSN: '900000001' })];
    const legacy = inspectText(); expect((await scheduleC(request({ year: 2026, includeAppendix: false }))).status).toBe(200);
    const legacyDrawn = legacy.spy.mock.calls.map(call => call[0]);
    expect(legacyDrawn[legacyDrawn.indexOf('SSN (last 4)') + 1]).toBe('');
    expect(legacy.text()).not.toMatch(/900000001|900-00-0001|\*\*\*-\*\*-/);
  });
  it('honors a summary-only request without silently including transaction details', async () => {
    state.transactions = [{ merchant_name: 'PRIVATE-DETAIL-MARKER', amount: 100, date: '2026-03-01', iso_currency_code: 'USD', category: 'unknown', is_deductible: true }];
    const view = inspectText(); expect((await scheduleC(request({ year: 2026, includeAppendix: false }))).status).toBe(200);
    expect(view.text()).not.toContain('PRIVATE-DETAIL-MARKER'); expect(view.text()).toContain('omitted at your request');
  });
  it('uses the actual changed OtherExpenses line reference by year', () => {
    expect(scheduleCExportLine('27a', 2024)).toBe('27a'); expect(scheduleCExportLine('27a', 2025)).toBe('27b'); expect(scheduleCExportLine('24b', 2026)).toBe('24b');
  });
});

describe('selected-year SE source and worksheet', () => {
  it('shares W2 wage-base reduction and current records with the preview, ignoring saved summaries', async () => {
    state.records.w2_income = [record({ wages: 180000, socialSecurityWages: 180000, medicareWages: 180000 }), record({ wages: 999999 }, 2025)];
    state.records.tax_summary = [record({ scheduleCNetProfit: 999999, taxYear: 2024 })];
    const response = await autoSE(new NextRequest('http://localhost/api/tax/schedule-se/auto?year=2026'));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.calculation).toMatchObject({ socialSecurityTax: 558, medicareTax: 2678.15, totalSETax: 3236.15, halfSEDeduction: 1618.08 });
    const data = await loadScheduleSEData('export-owner', 2026); const view = inspectText(); const bytes = await generateScheduleSEPDF(data);
    expect(view.text()).toContain('$184,500.00'); expect(view.text()).toContain('$3,236.15'); expect(view.text()).toContain('$1,618.08');
    expect(view.text()).not.toContain('___-__-____'); expect(view.text()).not.toContain('000-00-0000'); expect(view.text()).not.toContain('***-**-');
    expect(view.text()).not.toContain('2024 Tax Rates'); expect(state.queries).not.toContain('tax_summary'); view.checkBounds(); saveArtifact('schedule-se-2026', bytes);
  });
  it('includes supported depreciation before SE, matching the shared annual input ordering', async () => {
    state.assets = [{ id: 'computer', description: 'Synthetic computer', datePlacedInService: new Date('2026-03-01'), cost: 1000, businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false }];
    const data = await loadScheduleSEData('export-owner', 2026);
    expect(data).toMatchObject({ netProfitBeforeDepreciation: 100000, depreciationDeduction: 200, netProfit: 99800 });
    // First-year, nonlisted, >50% business use in a published year: §179 is calculated within the business-income limit.
    state.assets[0].section179Requested = true;
    expect(await loadScheduleSEData('export-owner', 2026)).toMatchObject({ depreciationDeduction: 1000, netProfit: 99000 });
    // Reg. §1.179-1(d): at or under 50% business use the election is unavailable, so the review gate still answers 422.
    state.assets[0].businessUsePercent = 50;
    expect((await autoSE(new NextRequest('http://localhost/api/tax/schedule-se/auto?year=2026'))).status).toBe(422);
  });
  it('does not calculate false zero when the asset or income lookup fails', async () => {
    state.fail = 'assets'; const response = await autoSE(new NextRequest('http://localhost/api/tax/schedule-se/auto?year=2026'));
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('calculation');
  });
  it('repairs the legacy ScheduleC helper: selected-year recorded receipts and confirmed net expenses', async () => {
    state.transactions = [{ amount: 100, date: '2025-03-01', iso_currency_code: 'USD', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true }, { amount: 999, date: '2025-03-01', iso_currency_code: 'USD', category: 'unknown', is_deductible: null }];
    state.records.gross_receipts = [record({ amount: 1000 }, 2025)];
    const response = await calculateC(new NextRequest('http://localhost/api/tax/schedule-c/calculate?year=2025'));
    expect(response.status).toBe(200); expect((await response.json()).data).toMatchObject({ year: 2025, totalIncome: 1000, totalExpenses: 50, netProfit: 950 });
    state.fail = 'transactions'; expect((await calculateC(new NextRequest('http://localhost/api/tax/schedule-c/calculate?year=2025'))).status).toBe(503);
  });
});

describe('complete bounded asset/home-office PDFs', () => {
  it('paginates every asset and does not repeat obsolete election limits or claim1:1 fields', async () => {
    const assets: Asset[] = Array.from({ length: 12 }, (_, i) => ({ id: `asset-${i}`, description: `SYNTHETIC-ASSET-${i} long description for clear preparer records`, datePlacedInService: new Date('2026-03-01'), cost: 1000, businessUsePercent: 50, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false }));
    const view = inspectText(); const bytes = await generateForm4562PDF({ userProfile: profile, assetsSettings: assets, transactions: [], taxYear: 2026 });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
    for (let i = 0; i < 12; i++) expect(view.text()).toContain(`SYNTHETIC-ASSET-${i} `);
    expect(view.text()).toContain('$1,200.00'); expect(view.text()).not.toContain('1:1'); expect(view.text()).not.toContain('$1,160,000');
    view.checkBounds(); saveArtifact('form-4562-2026', bytes);
  });
  it('preserves missing-home-office-context review and correctly labels the supported synthetic rental subset', async () => {
    const base = { userProfile: profile, transactions: [], taxYear: 2026, homeOfficeSettings: { totalHomeSqFt: 1000, officeSqFt: 200, rentOrMortgageInterest: 24000, utilities: 2400, insurance: 600, repairsMaintenance: 1000, propertyTax: 0, other: 0 } };
    await expect(generateForm8829PDF(base)).rejects.toMatchObject({ code: 'HOME_OFFICE_DETAILS_REQUIRED' });
    const view = inspectText(); const bytes = await generateForm8829PDF({ ...base, calculationContext: { method: 'actual', housingType: 'rented', qualifiedScheduleCBusinessUse: true, expensesLimitedToBusinessUsePeriod: true, form8829Line8Income: 1000, directOperatingExpenses: 400, priorOperatingExpenseCarryover: 800, casualtyLosses: 0, depreciationAndCasualtyCarryover: 0 } });
    expect(view.text()).toContain('$1,000.00'); expect(view.text()).toContain('$5,800.00'); expect(view.text()).not.toContain('Maximum home office deduction'); expect(view.text()).not.toContain('1:1');
    view.checkBounds(); saveArtifact('form-8829-synthetic-supported', bytes);
  });
});


describe('Form 1040 planning PDF prints its review notes', () => {
  const request1040 = (year: unknown = 2026) => new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year }) });
  // Form pages use a 36pt margin and a 19pt footer line; appendix pages stay inside them.
  const checkFormBounds = (spy: ReturnType<typeof inspectText>['spy']) => {
    for (const [text, options] of spy.mock.calls) {
      expect(options!.y!, text).toBeGreaterThanOrEqual(18); expect(options!.y!, text).toBeLessThanOrEqual(766);
      expect(options!.x!, text).toBeGreaterThanOrEqual(36);
      expect(options!.x! + options!.font!.widthOfTextAtSize(text, options!.size!), text).toBeLessThanOrEqual(576.1);
    }
  };
  beforeEach(() => { state.records.tax_organizers = [record(reviewedPersonalDeductionOrganizer())]; });

  it('lists every calculation and completeness warning on the result page and in the appendix', async () => {
    state.transactions = [{ id: 'inflow', amount: -50, date: '2026-03-01', iso_currency_code: 'USD', category: 'unknown', is_deductible: false }];
    const view = inspectText(); const response = await form1040(request1040());
    expect(response.status).toBe(200); const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(3);
    const text = view.text();
    // compute1040 planning note + unreviewed Schedule 1-A note + reconciliation inflow warning + SSN + address completeness notes.
    expect(text).toContain('Review notes (5)');
    expect(text).toContain('1 posted inflow(s) are excluded from business receipts until classified as income/revenue.');
    expect(text.match(/SSN not filled in on this summary/g)).toHaveLength(2); // page 2 block + appendix
    expect(text.match(/Mailing address incomplete - update in Tax Organizer/g)).toHaveLength(2);
    expect(text).toContain('5 calculation or completeness note(s) qualify the figures on pages 1-2:');
    expect(text).not.toContain('Full list continues');
    expect(text).toContain('Amount you owe (line 24 minus line 33).'); expect(text).toContain('Page 1 of 3'); expect(text).toContain('NOT FOR FILING');
    checkFormBounds(view.spy); saveArtifact('form-1040-2026-review-notes', bytes);
  });

  it('keeps a long warning list inside the page and points to the appendix, which prints all of it', async () => {
    state.extraWarnings = Array.from({ length: 40 }, (_, i) => `SYNTHETIC-WARNING-${String(i).padStart(2, '0')} requires review before this figure is relied on for planning or payment decisions. Emoji check → ok.`);
    const view = inspectText(); const response = await form1040(request1040());
    expect(response.status).toBe(200); const bytes = new Uint8Array(await response.arrayBuffer());
    const text = view.text();
    expect(text).toContain('Review notes (44)');
    expect(text).toContain('Full list continues in the review notes appendix (page 3).');
    for (let i = 0; i < 40; i++) expect(text).toContain(`SYNTHETIC-WARNING-${String(i).padStart(2, '0')}`);
    expect(text).toContain('[U+2192]'); expect(text).not.toContain('→');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
    checkFormBounds(view.spy);
  });

  it('leaves SSN and bank boxes blank even when those values are stored', async () => {
    const { encryptSensitive } = await import('../lib/security/utils');
    state.records.tax_organizers = [record({ ...reviewedPersonalDeductionOrganizer(), spouseName: 'Synthetic Spouse',
      taxpayerSSN: encryptSensitive('900000001'), spouseSSN: '900000002', bankAccount: encryptSensitive('000123456789'), bankRouting: '071000013',
      bankAccountType: 'savings', ipPin: encryptSensitive('123456'), dependentDetails: 'Emma Shah, 900-00-0003, 2018-03-15, Daughter' })];
    const view = inspectText(); const response = await form1040(request1040());
    expect(response.status).toBe(200);
    const text = view.text();
    const drawn = view.spy.mock.calls.map(call => call[0]);
    expect(drawn[drawn.indexOf('Social security number (last 4 only)') + 1]).toBe('Home address');
    expect(drawn[drawn.indexOf('SSN (last 4)') + 1]).toBe('');
    expect(drawn[drawn.indexOf('Spouse SSN (last 4)') + 1]).toBe('');
    expect(drawn[drawn.indexOf('Optional refund routing / account (last 4)') + 1]).toBe('');
    expect(text).toContain('Provided to preparer separately');
    expect(text).not.toContain('Emma Shah');
    expect(text).not.toMatch(/900000001|900-00-0001|900000002|900-00-0002|000123456789|071000013|123456|900-00-0003|\*\*\*-\*\*-|\*\*\*\*\*0013|\*\*\*\*6789/);
    expect(text).toContain('SSN not filled in');
    checkFormBounds(view.spy); saveArtifact('form-1040-2026-masked-identifiers', new Uint8Array(await response.arrayBuffer()));
  });

  it('still renders when organizer identifier fields are absent', async () => {
    state.records.tax_organizers = [record(reviewedPersonalDeductionOrganizer())];
    const view = inspectText();
    const response = await form1040(request1040());
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0x25);
    expect(view.text()).toContain('Not provided');
    expect(view.text()).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(view.text()).not.toContain('___-__-____');
    expect(view.text()).not.toContain('000-00-0000');
    expect(view.text()).not.toContain('***-**-');
    const drawn = view.spy.mock.calls.map(call => call[0]);
    expect(drawn[drawn.indexOf('Social security number (last 4 only)') + 1]).not.toMatch(/^\*\*\*|___-__-____|000-00-0000/);
    expect(drawn).not.toContain('___-__-____');
  });

  it('never prints a refund/balance page without its review notes block', async () => {
    state.records.w2_income = [record({ wages: 100000, federalWithheld: 90000, socialSecurityWages: 100000, medicareWages: 100000 })];
    const view = inspectText(); expect((await form1040(request1040())).status).toBe(200);
    const text = view.text();
    expect(text).toContain('Estimated overpayment - refund election not collected');
    expect(text).toMatch(/Review notes \(\d+\)/);
    checkFormBounds(view.spy);
  });
});

describe('complete tax-export input validation', () => {
  it.each([{ date: '2026-02-30', amount: 10 }, { date: '2026-02-01', amount: 'unknown' }, { date: '2026-02-01', amount: 10, iso_currency_code: 'EUR' }])('requires review instead of silently dropping malformed records %j', async invalid => {
    state.transactions = [{ iso_currency_code: 'USD', ...invalid, category: 'unknown', is_deductible: true }];
    const response = await scheduleC(request({ year: 2026 }));
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
  });
  it.each([{ iso_currency_code: undefined }, { deduction_override: 0 }, { deductible_amount: 30 }, { deduction_amount: 30 }, { deductible_amount_override: 30 }, { deduction_percentage: 50 }])('requires review for unknown currency or an unapplied deduction adjustment %j', async facts => {
    state.transactions = [{ id: 'review', date: '2026-03-01', amount: 100, category: 'unknown', is_deductible: true, iso_currency_code: 'USD', ...facts }];
    const response = await scheduleC(request({ year: 2026 }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
  });
});


it('blocks duplicate logical records across storage paths instead of counting both', async () => {
  state.transactions = ['transactions/one', 'user_profiles/owner/accounts/a/transactions/two'].map(recordPath => ({ id: 'same-source-id', recordPath, date: '2026-01-01', iso_currency_code: 'USD', amount: 100, is_deductible: true }));
  const response = await scheduleC(request({ year: 2026 }));
  expect(response.status).toBe(422); expect((await response.json()).error).toContain('Duplicate transaction');
});


it('serves complete signed Schedule C CSV with formula-safe merchant text', async () => {
  state.transactions = [{ id: 'refund', date: '2026-01-01', iso_currency_code: 'USD', amount: -20, is_deductible: true, merchant_name: '=HYPERLINK("bad")', category: 'unknown' }];
  const response = await scheduleC(request({ year: 2026, format: 'csv' }));
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/csv');
  const csv = await response.text(); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain(',27b,-20,-20,');
});


it.each([{ business_percent: 50 }, { business_use_percent: 0 }, { business_use_percentage: '100' }, { businessUsePercent: 101 }, { equipment_details: { business_use_percentage: 80 } }])('requires mixed-use review rather than deducting the full recorded expense %j', async allocation => {
  state.transactions = [{ id: 'mixed', date: '2026-01-01', iso_currency_code: 'USD', amount: 100, is_deductible: true, category: 'unknown', ...allocation }];
  const response = await scheduleC(request({ year: 2026 }));
  expect(response.status).toBe(422); expect((await response.json()).error).toContain('business-use percentage');
});
it('does not apply a second percentage to a fully-business meal or block unconfirmed/pending allocations', async () => {
  state.transactions = [{ id: 'meal', date: '2026-01-01', iso_currency_code: 'USD', amount: 100, is_deductible: true, category: 'FOOD_AND_DRINK_RESTAURANT', business_percent: 100 },
    { id: 'unconfirmed', date: '2026-01-01', iso_currency_code: 'USD', amount: 500, is_deductible: null, business_percent: 50 },
    { id: 'pending', date: '2026-01-01', iso_currency_code: 'USD', amount: 500, is_deductible: true, pending: true, business_percent: 50 }];
  const response = await scheduleC(request({ year: 2026, format: 'csv' }));
  expect(response.status).toBe(200); expect(await response.text()).toContain(',24b,100,50,');
});

describe('organizer screen round-trip and export boxes', () => {
  const RETIRED = new Set(['taxpayerSSN', 'spouseSSN', 'bankRouting', 'bankAccount', 'ipPin']);
  // Same load-then-save shape as tax-organizer-screen.tsx readOrganizerYear + organizerSaveBody.
  const screenSaveBody = (organizer: Record<string, unknown>, taxYear: number) => {
    const next: Record<string, unknown> = { ...EMPTY_ORGANIZER_ANSWERS, ...organizer };
    next.taxpayerSSN = '';
    next.spouseSSN = '';
    next.bankRouting = '';
    next.bankAccount = '';
    next.ipPin = '';
    const body: Record<string, unknown> = { taxYear };
    for (const [key, value] of Object.entries(next)) {
      if (RETIRED.has(key) || /^dependent\d*(SSN|ITIN)$/.test(key)) continue;
      body[key] = value;
    }
    return body;
  };
  const cellAfter = (drawn: string[], label: string) => {
    const index = drawn.indexOf(label);
    expect(index, label).toBeGreaterThanOrEqual(0);
    return drawn[index + 1];
  };

  it('keeps a loaded organizer byte-identical, then one edited word, and exports blank SSN, bank and line D boxes', async () => {
    const { encryptSensitive } = await import('../lib/security/utils');
    const ein = encryptSensitive('123456789');
    const taxpayerSSN = encryptSensitive('900000001');
    const spouseSSN = encryptSensitive('900000002');
    const dependentSSN = encryptSensitive('900000003');
    const ipPin = encryptSensitive('123456');
    const bankRouting = encryptSensitive('071000013');
    const bankAccount = encryptSensitive('000123456789');
    const details = 'The child lives here. SSN 900-00-1111. Order 555000222.';
    const defaults = Object.fromEntries(Object.entries(EMPTY_ORGANIZER_ANSWERS).filter(([, value]) => value !== ''));
    state.records.tax_organizers = [record({
      ...reviewedPersonalDeductionOrganizer(),
      ...defaults,
      filingStatus: 'single', spouseName: 'Synthetic Spouse', dependentDetails: details,
      streetAddress: '1 Main St', city: 'Austin', stateAddr: 'TX', zipCode: '78701', priorYearAGI: '50000',
      ein, taxpayerSSN, spouseSSN, dependentSSN, ipPin, bankRouting, bankAccount,
    })];
    const stored = () => state.records.tax_organizers![0];
    const before = { ...stored() };

    const loaded = await (await getOrganizer(new NextRequest('http://localhost/api/tax/organizer?year=2026'))).json();
    expect(loaded.organizer.ein).toBe('**-***6789');
    expect(loaded.organizer.taxpayerSSN).toBe('***-**-0001');
    expect(loaded.organizer.dependentDetails).toBe('The child lives here. SSN ***-**-1111. Order ***-**-0222.');
    expect(loaded.organizer.dependentDetails).not.toContain('900-00-1111');
    expect(loaded.organizer.dependentDetails).not.toContain('555000222');
    const payload = screenSaveBody(loaded.organizer, loaded.taxYear);
    expect(payload.ein).toBe('**-***6789');
    expect(payload.dependentDetails).toBe(loaded.organizer.dependentDetails);
    expect(payload).not.toHaveProperty('taxpayerSSN');

    const unchanged = await saveOrganizer(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify(payload) }));
    expect(unchanged.status).toBe(200);
    const afterLoad = { ...stored() };
    expect(Object.keys(afterLoad).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) expect(afterLoad[key], key).toBe(before[key]);

    const edited = screenSaveBody({ ...loaded.organizer, dependentDetails: String(loaded.organizer.dependentDetails).replace('child', 'student') }, loaded.taxYear);
    const saved = await saveOrganizer(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify(edited) }));
    expect(saved.status).toBe(200);
    const afterEdit = stored();
    expect(afterEdit.dependentDetails).toBe('The student lives here. SSN 900-00-1111. Order 555000222.');
    expect(Object.keys(afterEdit).sort()).toEqual([...Object.keys(before), 'updatedAt'].sort());
    for (const key of Object.keys(before)) {
      if (key === 'dependentDetails') continue;
      expect(afterEdit[key], key).toBe(before[key]);
    }
    expect(afterEdit.updatedAt).toBeInstanceOf(Date);

    const view = inspectText();
    const scheduleCResponse = await scheduleC(request({ year: 2026, includeAppendix: false }));
    expect(scheduleCResponse.status).toBe(200);
    expect(Buffer.from(await scheduleCResponse.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const scheduleCDrawn = view.spy.mock.calls.map(call => call[0]);
    expect(cellAfter(scheduleCDrawn, 'SSN (last 4)')).toBe('');
    expect(cellAfter(scheduleCDrawn, 'EIN (last 4)')).toBe('');
    expect(scheduleCDrawn.join('\n')).not.toMatch(/900-00-1111|900000001|555000222|123456789|071000013|000123456789|\*\*\*-\*\*-|\*\*-\*\*\*/);

    view.spy.mockClear();
    const formResponse = await form1040(new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) }));
    expect(formResponse.status).toBe(200);
    expect(Buffer.from(await formResponse.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const formDrawn = view.spy.mock.calls.map(call => call[0]);
    expect(cellAfter(formDrawn, 'Social security number (last 4 only)')).toBe('Home address');
    expect(cellAfter(formDrawn, 'SSN (last 4)')).toBe('');
    expect(cellAfter(formDrawn, 'Spouse SSN (last 4)')).toBe('');
    expect(cellAfter(formDrawn, 'Optional refund routing / account (last 4)')).toBe('');
    expect(formDrawn.join('\n')).not.toMatch(/900-00-1111|900000001|900000002|900000003|555000222|123456789|071000013|000123456789|\*\*\*-\*\*-|\*\*\*\*6789|\*\*\*\*\*0013/);

    view.spy.mockClear();
    const seResponse = await exportReport(new NextRequest('http://localhost/api/reports/export', { method: 'POST', body: JSON.stringify({ type: 'scheduleSE', year: 2026 }) }));
    expect(seResponse.status).toBe(200);
    expect(Buffer.from(await seResponse.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const seText = view.spy.mock.calls.map(call => call[0]).join('\n');
    expect(seText).not.toMatch(/900-00-1111|900000001|555000222|123456789|071000013|000123456789|\*\*\*-\*\*-|\*\*-\*\*\*|000-00-0000|___-__-____/);
    expect(seText).not.toContain('SSN (last 4)');
    expect(seText).not.toContain('EIN (last 4)');
    expect(seText).not.toContain('Optional refund routing / account (last 4)');
  });
});
