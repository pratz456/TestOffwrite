import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

/**
 * In-memory Firestore stand-in: `docs` holds document paths → data (set/merge/get), `rows` holds
 * top-level query collections filtered by where(). The real settings-server module runs on top of
 * it, so persistence, normalization and every route's 422 handling are exercised together.
 */
const store = vi.hoisted(() => ({ uid: 'owner-a' as string | null, docs: new Map<string, Record<string, unknown>>(), rows: {} as Record<string, Record<string, unknown>[]>, transactions: [] as Record<string, unknown>[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: store.uid ? { uid: store.uid } : null, error: store.uid ? null : 'unauthenticated' }) }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => { if (!store.uid) throw new Error('unauthenticated'); return { uid: store.uid }; } }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => store.transactions }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { name: 'Synthetic Taxpayer', filing_status: 'single' }, error: null }) }));
vi.mock('@/lib/firebase/admin', () => {
  const doc = (path: string) => ({
    get: async () => { const data = store.docs.get(path); return { exists: data !== undefined, id: path.split('/').pop(), data: () => data }; },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => { store.docs.set(path, options?.merge ? { ...(store.docs.get(path) ?? {}), ...data } : { ...data }); },
    update: async (data: Record<string, unknown>) => { store.docs.set(path, { ...(store.docs.get(path) ?? {}), ...data }); },
    delete: async () => { store.docs.delete(path); },
    collection: (sub: string) => collection(`${path}/${sub}`),
  });
  const collection = (path: string) => {
    const filters: [string, unknown][] = [];
    const query = {
      where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
      limit() { return query; },
      get: async () => {
        const prefix = `${path}/`;
        const subDocs = [...store.docs.entries()].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }));
        const rows = (store.rows[path] ?? []).filter(row => filters.every(([key, value]) => row[key] === value)).map((row, index) => ({ id: `row-${index}`, data: () => row }));
        const docs = [...subDocs, ...rows];
        return { empty: docs.length === 0, docs, forEach: (fn: (row: { id: string; data: () => Record<string, unknown> }) => void) => docs.forEach(fn) };
      },
      doc: (id: string) => doc(`${path}/${id}`),
      add: async (data: Record<string, unknown>) => { const id = `auto-${store.docs.size}`; store.docs.set(`${path}/${id}`, data); return { id }; },
    };
    return query;
  };
  return { adminDb: { collection } };
});
import { GET as getHomeOffice, POST as postHomeOffice } from '../app/api/settings/home-office/route';
import { GET as getDepreciation, POST as postDepreciation } from '../app/api/settings/depreciation/route';
import { GET as homeOfficeWorksheet } from '../app/api/tax/home-office/route';
import { GET as form4562Worksheet } from '../app/api/tax/form-4562/route';
import { GET as compute1040 } from '../app/api/tax/compute-1040/route';
import { GET as calculateScheduleC } from '../app/api/tax/schedule-c/calculate/route';
import { GET as scheduleSE } from '../app/api/tax/schedule-se/auto/route';
import { POST as exportForms } from '../app/api/reports/export/route';

const json = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const completeFacts = { method: 'simplified', regularUse: 'yes', exclusiveUse: 'yes', exclusiveUseException: null, qualifyingUse: 'principal_place_of_business', housingType: 'rented', monthsUsed: 12, officeSqFt: 300, totalHomeSqFt: 1500 };
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
const seedAsset = (id: string, fields: Record<string, unknown>) => store.docs.set(`user_profiles/owner-a/assets/${id}`, { description: id, datePlacedInService: timestamp('2026-04-01T00:00:00Z'), cost: 10000, businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...fields });

beforeEach(() => {
  store.uid = 'owner-a'; store.docs.clear(); store.transactions = [];
  store.rows = { gross_receipts: [{ userId: 'owner-a', taxYear: 2026, amount: 100000 }], tax_organizers: [{ userId: 'owner-a', ...reviewedPersonalDeductionOrganizer() }], w2_income: [], income_1099: [], tax_deductions: [] };
});

describe('home office settings persistence', () => {
  it('returns null when nothing is saved and stores unanswered facts as null, never as "no"', async () => {
    expect(await (await getHomeOffice(json('settings/home-office'))).json()).toEqual({ success: true, data: null });
    const saved = await postHomeOffice(json('settings/home-office', { officeSqFt: 250, totalHomeSqFt: 1000, method: 'simplified' }));
    expect(saved.status).toBe(200);
    const { data } = await saved.json();
    expect(data).toMatchObject({ officeSqFt: 250, totalHomeSqFt: 1000, method: 'simplified', regularUse: null, exclusiveUse: null, exclusiveUseException: null, qualifyingUse: null, housingType: null, monthsUsed: null });
    expect(store.docs.get('user_profiles/owner-a/settings/homeOffice')).toMatchObject({ officeSqFt: 250, method: 'simplified' });
  });
  it('accepts one answer at a time, keeps earlier answers, and clears a fact back to unanswered with null', async () => {
    await postHomeOffice(json('settings/home-office', completeFacts));
    expect((await (await postHomeOffice(json('settings/home-office', { exclusiveUse: 'no', exclusiveUseException: 'none' }))).json()).data).toMatchObject({ exclusiveUse: 'no', exclusiveUseException: 'none', regularUse: 'yes', monthsUsed: 12 });
    expect((await (await postHomeOffice(json('settings/home-office', { qualifyingUse: null }))).json()).data).toMatchObject({ qualifyingUse: null, exclusiveUse: 'no' });
    expect((await (await getHomeOffice(json('settings/home-office'))).json()).data).toMatchObject({ officeSqFt: 300, housingType: 'rented', qualifyingUse: null });
  });
  it.each([
    [{ exclusiveUse: 'sometimes' }, 'exclusiveUse'], [{ qualifyingUse: 'garage' }, 'qualifyingUse'], [{ monthsUsed: 13 }, 'monthsUsed'], [{ monthsUsed: 6.5 }, 'monthsUsed'],
    [{ officeSqFt: -1 }, 'officeSqFt'], [{ officeSqFt: 2000, totalHomeSqFt: 1000 }, 'must not exceed'], [{ homeOfficeDeduction: 1500 }, 'Unknown field'], [{ method: 'hybrid' }, 'method'],
  ])('rejects %j with a typed 400 instead of storing a fact the calculation would misread', async (body, message) => {
    const response = await postHomeOffice(json('settings/home-office', body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_HOME_OFFICE_INPUT', error: expect.stringContaining(message) });
    expect(store.docs.has('user_profiles/owner-a/settings/homeOffice')).toBe(false);
  });
  it('rejects empty, non-object and unauthenticated writes', async () => {
    expect((await postHomeOffice(json('settings/home-office', {}))).status).toBe(400);
    expect((await postHomeOffice(json('settings/home-office', [1]))).status).toBe(400);
    store.uid = null;
    expect((await postHomeOffice(json('settings/home-office', completeFacts))).status).toBe(401);
    expect((await getHomeOffice(json('settings/home-office'))).status).toBe(401);
    expect(store.docs.size).toBe(0);
  });
  it('reads stale or unknown stored option values as unanswered', async () => {
    store.docs.set('user_profiles/owner-a/settings/homeOffice', { officeSqFt: 100, totalHomeSqFt: 900, exclusiveUse: 'true', monthsUsed: '12', method: 'simplified' });
    expect((await (await getHomeOffice(json('settings/home-office'))).json()).data).toMatchObject({ exclusiveUse: null, monthsUsed: null, method: 'simplified' });
  });
});

describe('de minimis election persistence', () => {
  it('starts empty, stores supported years only, and replaces the list on each save', async () => {
    expect(await (await getDepreciation(json('settings/depreciation'))).json()).toMatchObject({ data: { deMinimisSafeHarborYears: [] } });
    expect((await (await postDepreciation(json('settings/depreciation', { deMinimisSafeHarborYears: [2026, 2025, 2026] }))).json()).data).toEqual({ deMinimisSafeHarborYears: [2025, 2026] });
    expect((await (await postDepreciation(json('settings/depreciation', { deMinimisSafeHarborYears: [2026] }))).json()).data).toEqual({ deMinimisSafeHarborYears: [2026] });
    expect((await (await getDepreciation(json('settings/depreciation'))).json()).data).toEqual({ deMinimisSafeHarborYears: [2026] });
  });
  it.each([{ deMinimisSafeHarborYears: [2027] }, { deMinimisSafeHarborYears: '2026' }, { deMinimisSafeHarborYears: [2026], bonus: true }, { years: [2026] }])('rejects %j', async body => {
    expect((await postDepreciation(json('settings/depreciation', body))).status).toBe(400);
    expect(store.docs.has('user_profiles/owner-a/settings/depreciation')).toBe(false);
  });
  it('requires authentication', async () => {
    store.uid = null;
    expect((await getDepreciation(json('settings/depreciation'))).status).toBe(401);
    expect((await postDepreciation(json('settings/depreciation', { deMinimisSafeHarborYears: [2026] }))).status).toBe(401);
  });
});

describe('worksheet and estimate routes share the 422 review contract', () => {
  it('returns the simplified worksheet from saved facts and the selected-year line 29 limit', async () => {
    await postHomeOffice(json('settings/home-office', completeFacts));
    const response = await homeOfficeWorksheet(json('tax/home-office?year=2026'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ taxYear: 2026, deduction: 1500, reviewReasons: [], worksheet: { allowableSqFt: 300, tentativeDeduction: 1500, allowableDeduction: 1500, grossIncomeLimit: 100000 }, scheduleC: { grossReceipts: 100000, tentativeProfit: 100000, netProfit: 98500 } });
    expect(body.scope).toContain('not Form 8829');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('answers 422 HOME_OFFICE_REVIEW_REQUIRED with the unanswered questions across every dependent route', async () => {
    await postHomeOffice(json('settings/home-office', { ...completeFacts, exclusiveUse: null }));
    const worksheet = await homeOfficeWorksheet(json('tax/home-office?year=2026'));
    expect(worksheet.status).toBe(422);
    const body = await worksheet.json();
    expect(body).toMatchObject({ code: 'HOME_OFFICE_REVIEW_REQUIRED', settings: { exclusiveUse: null } });
    expect(body.reviewReasons).toEqual([expect.stringContaining('exclusively for business')]);
    for (const route of [compute1040(json('tax/compute-1040?year=2026')), calculateScheduleC(json('tax/schedule-c/calculate?year=2026')), scheduleSE(json('tax/schedule-se/auto?year=2026')), exportForms(json('reports/export', { type: 'form8829', year: 2026 }))]) {
      const response = await route;
      expect(response.status).toBe(422);
      const payload = await response.json();
      expect(payload.code).toBe('HOME_OFFICE_REVIEW_REQUIRED');
      expect(payload).not.toHaveProperty('form1040'); expect(payload).not.toHaveProperty('data');
    }
  });
  it('keeps a saved home office with no method out of the estimate with a warning, not a stop', async () => {
    await postHomeOffice(json('settings/home-office', { officeSqFt: 300, totalHomeSqFt: 1500 }));
    const response = await compute1040(json('tax/compute-1040?year=2026'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.homeOffice).toEqual({ deduction: 0, worksheet: null });
    expect(body.form1040.calculationWarnings.join(' ')).toContain('no home office deduction is included');
  });
  it('flows the home office and elections into the annual estimate, Schedule C subtotal and Schedule SE', async () => {
    await postHomeOffice(json('settings/home-office', completeFacts));
    await postDepreciation(json('settings/depreciation', { deMinimisSafeHarborYears: [2026] }));
    seedAsset('mouse', { cost: 1800 }); seedAsset('workstation', { section179Requested: true });
    const estimate = await (await compute1040(json('tax/compute-1040?year=2026'))).json();
    expect(estimate.income).toMatchObject({ scheduleCNetProfit: 100000, deMinimisExpense: 1800, depreciationDeduction: 10000, scheduleCLine29TentativeProfit: 88200, homeOfficeDeduction: 1500, scheduleCLine31NetProfit: 86700 });
    expect(estimate.depreciation).toMatchObject({ totalDepreciation: 10000, deMinimisExpense: 1800, assetCount: 2, section179: { electionYear: 2026, allowed: 10000, limit: 2560000 } });
    expect(estimate.homeOffice).toMatchObject({ deduction: 1500, worksheet: { allowableDeduction: 1500 } });
    expect(estimate.seCalc.netProfitFromScheduleC).toBe(86700);
    const scheduleC = (await (await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'))).json()).data;
    expect(scheduleC).toMatchObject({ totalIncome: 100000, confirmedExpenses: 0, deMinimisExpense: 1800, depreciationDeduction: 10000, homeOfficeDeduction: 1500, totalExpenses: 13300, netProfit: 86700 });
    const se = await (await scheduleSE(json('tax/schedule-se/auto?year=2026'))).json();
    expect(se.calculation.netProfitFromScheduleC).toBe(86700);
  });
  it('serves the Form 4562 worksheet with year-labeled limits and the real business income, or 422 for unsupported assets', async () => {
    seedAsset('workstation', { section179Requested: true, cost: 3000000 });
    store.rows.w2_income = [{ userId: 'owner-a', taxYear: 2026, box1Wages: 50000, box3SocialSecurityWages: 50000, box5MedicareWages: 50000 }];
    const response = await form4562Worksheet(json('tax/form-4562?year=2026'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ taxYear: 2026, businessIncome: 150000, deMinimisElected: false, deMinimisLimit: 2500, section179Limits: { taxYear: 2026, limit: 2560000, phaseoutThreshold: 4090000 } });
    expect(body.calculation.section179).toMatchObject({ elected: 2560000, allowed: 150000, carryover: 2410000, businessIncomeLimit: 150000 });
    expect(body.calculation).toMatchObject({ totalSection179: 150000, totalRegularDepreciation: 88000 });
    seedAsset('van', { category: 'vehicle' });
    const review = await form4562Worksheet(json('tax/form-4562?year=2026'));
    expect(review.status).toBe(422); expect(await review.json()).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
    expect((await form4562Worksheet(json('tax/form-4562?year=2027'))).status).toBe(400);
    expect((await homeOfficeWorksheet(json('tax/home-office?year=20x6'))).status).toBe(400);
  });
  it('exports the simplified planning worksheet PDF only when the facts are complete', async () => {
    expect((await exportForms(json('reports/export', { type: 'form8829', year: 2026 }))).status).toBe(400);
    await postHomeOffice(json('settings/home-office', { ...completeFacts, monthsUsed: 9, housingType: 'owned' }));
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const response = await exportForms(json('reports/export', { type: 'form8829', year: 2026 }));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/pdf');
    expect((await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))).getPageCount()).toBeGreaterThan(0);
    const text = spy.mock.calls.map(call => call[0]).join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('$1,125.00'); expect(text).toContain('Rev. Proc. 2013-13'); expect(text).toMatch(/planning/i); expect(text).toContain('Schedule A');
    spy.mockRestore();
  });
  it('exports the Form 4562 worksheet with de minimis and Section 179 detail', async () => {
    await postDepreciation(json('settings/depreciation', { deMinimisSafeHarborYears: [2026] }));
    seedAsset('mouse', { cost: 1800 }); seedAsset('workstation', { section179Requested: true });
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const response = await exportForms(json('reports/export', { type: 'form4562', year: 2026 }));
    expect(response.status).toBe(200);
    const text = spy.mock.calls.map(call => call[0]).join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('$1,800.00'); expect(text).toContain('$10,000.00'); expect(text).toContain('Rev. Proc. 2025-32'); expect(text).toContain('De minimis safe harbor');
    spy.mockRestore();
  });
});
