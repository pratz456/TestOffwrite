import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { UserProfile } from '../lib/firebase/profiles-server';
import type { Asset } from '../lib/reports/calc4562';
const state = vi.hoisted(() => ({ records: {} as Record<string, Record<string, unknown>[]>, transactions: [] as Record<string, unknown>[], assets: [] as Asset[], fail: '', queries: [] as string[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'export-owner' } }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => { if (state.fail === 'transactions') throw new Error('private failure'); return state.transactions; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.transactions, error: state.fail === 'transactions' ? new Error('private failure') : null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { name: 'Synthetic Taxpayer', profession: 'Consultant', filing_status: 'single', primary_work_location: 'Home Office' }, error: state.fail === 'profile' ? new Error('private failure') : null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: state.assets, error: state.fail === 'assets' ? new Error('private failure') : null }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  state.queries.push(name); const filters: [string, unknown][] = [];
  return { where(field: string, _op: string, value: unknown) { filters.push([field, value]); return this; }, limit() { return this; }, get: async () => {
    if (state.fail === name) throw new Error('private Firestore failure');
    const records = (state.records[name] || []).filter(row => filters.every(([key, value]) => row[key] === value));
    return { empty: !records.length, docs: records.map((row, index) => ({ id: `record-${index}`, data: () => row })) };
  } };
} } }));
import { POST as scheduleC } from '../app/api/tax/schedule-c/export/route';
import { GET as calculateC } from '../app/api/tax/schedule-c/calculate/route';
import { GET as autoSE } from '../app/api/tax/schedule-se/auto/route';
import { loadScheduleSEData } from '../lib/reports/load-schedule-se';
import { generateScheduleSEPDF } from '../lib/reports/scheduleSE';
import { generateForm4562PDF } from '../lib/reports/form4562';
import { generateForm8829PDF } from '../lib/reports/form8829';
import { scheduleCExportLine } from '../lib/schedule-c/export-lines';
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
beforeEach(() => { vi.restoreAllMocks(); state.records = { gross_receipts: [record({ amount: 100000 })] }; state.transactions = []; state.assets = []; state.fail = ''; state.queries = []; });

describe('Schedule C real PDF and request integrity', () => {
  it.each([2027, 2026.5, '2026junk', '', null])('rejects unsupported/malformed year %s before fetching records', async year => {
    expect((await scheduleC(request({ year }))).status).toBe(400); expect(state.queries).toHaveLength(0);
  });
  it.each(['transactions', 'profile', 'gross_receipts'])('returns an error instead of blank/zero PDF on %s failure', async fail => {
    state.fail = fail; const create = vi.spyOn(PDFDocument, 'create'); const response = await scheduleC(request({ year: 2026 }));
    expect(response.status).toBe(503); expect(create).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('private');
  });
  it('prints recorded receipts, every signed transaction and no invented filing elections', async () => {
    state.transactions = Array.from({ length: 70 }, (_, i) => ({ id: `tx-${i}`, merchant_name: `SYNTHETIC-RECORD-${String(i).padStart(3, '0')}`, amount: 100, date: '2026-03-01', category: 'unknown', is_deductible: true }));
    state.transactions.push({ merchant_name: 'SYNTHETIC-REFUND', amount: -20, date: '2026-03-01', category: 'unknown', is_deductible: true });
    state.transactions.push({ merchant_name: 'SYNTHETIC-MEAL', amount: 10.01, date: '2026-03-01', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true });
    state.transactions.push({ merchant_name: 'UNCONFIRMED-EXCLUDED', amount: 999, date: '2026-03-01', category: 'unknown', is_deductible: null });
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
  it('honors a summary-only request without silently including transaction details', async () => {
    state.transactions = [{ merchant_name: 'PRIVATE-DETAIL-MARKER', amount: 100, date: '2026-03-01', category: 'unknown', is_deductible: true }];
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
    expect(view.text()).not.toContain('2024 Tax Rates'); expect(state.queries).not.toContain('tax_summary'); view.checkBounds(); saveArtifact('schedule-se-2026', bytes);
  });
  it('includes supported depreciation before SE, matching the shared annual input ordering', async () => {
    state.assets = [{ id: 'computer', description: 'Synthetic computer', datePlacedInService: new Date('2026-03-01'), cost: 1000, businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false }];
    const data = await loadScheduleSEData('export-owner', 2026);
    expect(data).toMatchObject({ netProfitBeforeDepreciation: 100000, depreciationDeduction: 200, netProfit: 99800 });
    state.assets[0].section179Requested = true;
    expect((await autoSE(new NextRequest('http://localhost/api/tax/schedule-se/auto?year=2026'))).status).toBe(422);
  });
  it('does not calculate false zero when the asset or income lookup fails', async () => {
    state.fail = 'assets'; const response = await autoSE(new NextRequest('http://localhost/api/tax/schedule-se/auto?year=2026'));
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('calculation');
  });
  it('repairs the legacy ScheduleC helper: selected-year recorded receipts and confirmed net expenses', async () => {
    state.transactions = [{ amount: 100, date: '2025-03-01', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true }, { amount: 999, date: '2025-03-01', category: 'unknown', is_deductible: null }];
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


describe('complete tax-export input validation', () => {
  it.each([{ date: '2026-02-30', amount: 10 }, { date: '2026-02-01', amount: 'unknown' }, { date: '2026-02-01', amount: 10, iso_currency_code: 'EUR' }])('requires review instead of silently dropping malformed records %j', async invalid => {
    state.transactions = [{ ...invalid, category: 'unknown', is_deductible: true }];
    const response = await scheduleC(request({ year: 2026 }));
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
  });
});


it('blocks duplicate logical records across storage paths instead of counting both', async () => {
  state.transactions = ['transactions/one', 'user_profiles/owner/accounts/a/transactions/two'].map(recordPath => ({ id: 'same-source-id', recordPath, date: '2026-01-01', amount: 100, is_deductible: true }));
  const response = await scheduleC(request({ year: 2026 }));
  expect(response.status).toBe(422); expect((await response.json()).error).toContain('Duplicate transaction');
});


it('serves complete signed Schedule C CSV with formula-safe merchant text', async () => {
  state.transactions = [{ id: 'refund', date: '2026-01-01', amount: -20, is_deductible: true, merchant_name: '=HYPERLINK("bad")', category: 'unknown' }];
  const response = await scheduleC(request({ year: 2026, format: 'csv' }));
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/csv');
  const csv = await response.text(); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain(',27b,-20,-20,');
});


it.each([{ business_percent: 50 }, { business_use_percent: 0 }, { business_use_percentage: '100' }, { businessUsePercent: 101 }, { equipment_details: { business_use_percentage: 80 } }])('requires mixed-use review rather than deducting the full recorded expense %j', async allocation => {
  state.transactions = [{ id: 'mixed', date: '2026-01-01', amount: 100, is_deductible: true, category: 'unknown', ...allocation }];
  const response = await scheduleC(request({ year: 2026 }));
  expect(response.status).toBe(422); expect((await response.json()).error).toContain('business-use percentage');
});
it('does not apply a second percentage to a fully-business meal or block unconfirmed/pending allocations', async () => {
  state.transactions = [{ id: 'meal', date: '2026-01-01', amount: 100, is_deductible: true, category: 'FOOD_AND_DRINK_RESTAURANT', business_percent: 100 },
    { id: 'unconfirmed', date: '2026-01-01', amount: 500, is_deductible: null, business_percent: 50 },
    { id: 'pending', date: '2026-01-01', amount: 500, is_deductible: true, pending: true, business_percent: 50 }];
  const response = await scheduleC(request({ year: 2026, format: 'csv' }));
  expect(response.status).toBe(200); expect(await response.text()).toContain(',24b,100,50,');
});
