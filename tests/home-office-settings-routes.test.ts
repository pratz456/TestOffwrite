import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

/**
 * In-memory Firestore stand-in: `docs` holds document paths → data (set/merge/get), `rows` holds
 * top-level query collections filtered by where(). The real settings-server module runs on top of
 * it, so persistence, normalization and every route's 422 handling are exercised together.
 */
const store = vi.hoisted(() => ({ uid: 'owner-a' as string | null, docs: new Map<string, Record<string, unknown>>(), rows: {} as Record<string, Record<string, unknown>[]>, transactions: [] as Record<string, unknown>[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: store.uid ? { uid: store.uid } : null, error: store.uid ? null : 'unauthenticated' }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
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
import { GET as quarterlyReminders } from '../app/api/tax/quarterly-reminders/route';
import { PATCH as patchAsset, POST as postAssets } from '../app/api/settings/assets/route';
import { acceleratedMacrsDeduction, businessUseBasis, calc4562, LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER, type Asset } from '../lib/reports/calc4562';
import { computeScheduleCProfit } from '../lib/tax-rules/schedule-c-profit';

const json = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const completeFacts = { method: 'simplified', regularUse: 'yes', exclusiveUse: 'yes', exclusiveUseException: null, qualifyingUse: 'principal_place_of_business', housingType: 'rented', monthsUsed: 12, officeSqFt: 300, totalHomeSqFt: 1500 };
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
const seedAsset = (id: string, fields: Record<string, unknown>) => store.docs.set(`user_profiles/owner-a/assets/${id}`, { description: id, datePlacedInService: timestamp('2026-04-01T00:00:00Z'), cost: 10000, businessUsePercent: 100, category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...fields });

beforeEach(() => {
  resetRateLimitStore(); store.uid = 'owner-a'; store.docs.clear(); store.transactions = [];
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
  it('withholds listed equipment figures from the worksheet, Schedule C, Schedule SE, and Form 4562 PDF', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 15, 12, 0, 0)));
    try {
      const siblingMacrs = acceleratedMacrsDeduction(businessUseBasis(3000, 100), 'MACRS_5YR');
      const saved = await postAssets(json('settings/assets', { assets: [{ description: 'Mixer', datePlacedInService: '2026-05-01', cost: 4000, businessUsePercent: 50, category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, listedEquipmentAnswer: 'no' }] }));
      expect(saved.status).toBe(200);
      const stored = [...store.docs.entries()].find(([key]) => key.startsWith('user_profiles/owner-a/assets/'));
      expect(stored?.[1].listedEquipmentAnswer).toBe('no');
      stored![1].datePlacedInService = { toDate: () => new Date('2026-05-01T00:00:00.000Z') };
      const answeredNoMacrs = acceleratedMacrsDeduction(businessUseBasis(4000, 50), 'MACRS_5YR');
      const answeredNo = await form4562Worksheet(json('tax/form-4562?year=2026'));
      expect(answeredNo.status).toBe(200);
      expect((await answeredNo.json()).calculation.totalRegularDepreciation).toBe(answeredNoMacrs);
      store.docs.clear();
      seedAsset('laptop', { description: 'Office computer', cost: 3000, businessUsePercent: 100, category: 'computer', listedEquipmentAnswer: 'yes' });
      seedAsset('camera', { description: 'Camera body', cost: 8642, businessUsePercent: 50, category: 'equipment', listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement', section179Requested: true, bonusEligible: true });
      const worksheet = await form4562Worksheet(json('tax/form-4562?year=2026'));
      expect(worksheet.status).toBe(200);
      const body = await worksheet.json();
      expect(body.calculation.totalDepreciation).toBe(siblingMacrs);
      expect(body.calculation.totalSection179).toBe(0);
      expect(body.calculation.totalBonusDepreciation).toBe(0);
      expect(body.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'camera').regularDepreciation).toBe(0);
      expect(body.calculation.notes.join('\n')).toContain(LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER);
      const scheduleCResponse = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
      expect(scheduleCResponse.status).toBe(422);
      const scheduleCBody = await scheduleCResponse.json();
      expect(scheduleCBody).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
      expect(scheduleCBody.error).toContain('PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.');
      expect(scheduleCBody).not.toHaveProperty('data');
      const estimateResponse = await compute1040(json('tax/compute-1040?year=2026'));
      expect(estimateResponse.status).toBe(422);
      const estimateBody = await estimateResponse.json();
      expect(estimateBody).not.toHaveProperty('form1040');
      expect(estimateBody).not.toHaveProperty('depreciation');
      const seResponse = await scheduleSE(json('tax/schedule-se/auto?year=2026'));
      expect(seResponse.status).toBe(422);
      expect(await seResponse.json()).not.toHaveProperty('calculation');
      const exported = await exportForms(json('reports/export', { type: 'form4562', year: 2026 }));
      expect(exported.status).toBe(422);
      expect(exported.headers.get('content-type')).toContain('application/json');
      expect(await exported.json()).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
      const patched = await patchAsset(new NextRequest('http://localhost/api/settings/assets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: 'laptop', listedEquipmentAnswer: 'yes' }) }));
      expect(patched.status).toBe(400);
      store.docs.delete('user_profiles/owner-a/assets/camera');
      seedAsset('recorder', { description: 'Recorder', cost: 8642, businessUsePercent: 50, category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false });
      const blank = await form4562Worksheet(json('tax/form-4562?year=2026'));
      const blankBody = await blank.json();
      expect(blank.status).toBe(200);
      expect(blankBody.calculation.totalDepreciation).toBe(siblingMacrs);
      expect(blankBody.calculation.notes.join('\n')).toContain('PLACEHOLDER: We need one answer about Recorder before we can show your estimate. What kind of equipment is it?');
      expect(blankBody.calculation.notes.join('\n')).not.toContain(LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER);
      expect(blankBody.calculation.heldAssets).toEqual([{ id: 'recorder', name: 'Recorder', reason: 'question' }]);
      expect(blankBody.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'recorder').regularDepreciation).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('held equipment sends profit consumers down the depreciation review path', () => {
  const message = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
  const placed = new Date('2026-05-01T00:00:00.000Z');
  const clearAssets = () => { for (const key of [...store.docs.keys()]) if (key.includes('/assets/')) store.docs.delete(key); };
  const seed = (id: string, fields: Record<string, unknown> = {}) => {
    clearAssets();
    seedAsset(id, { description: id, datePlacedInService: { toDate: () => placed }, cost: 10000, businessUsePercent: 100, category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...fields });
  };
  const asAsset = (id: string, fields: Partial<Asset> = {}): Asset => ({
    id, description: id, datePlacedInService: placed, cost: 10000, businessUsePercent: 100,
    category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...fields,
  });
  const profitFor = (id: string, fields: Partial<Asset> = {}) => computeScheduleCProfit({
    taxYear: 2026, grossReceipts: 100000, confirmedExpenses: 0, w2Wages: 0, assets: [asAsset(id, fields)],
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 15, 12)));
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    ['yes at 50', { businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement' }, 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.'],
    ['blank at 50', { businessUsePercent: 50 }, 'PLACEHOLDER: We need one answer about camera before we can show your estimate. What kind of equipment is it?'],
  ])('Schedule C calculate reviews %s instead of returning a profit', async (_label, fields, expected) => {
    seed('camera', fields);
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
    expect(body.error).toContain(expected);
    if (String(_label).startsWith('blank')) expect(body.error).not.toContain(message);
    expect(body).not.toHaveProperty('data');
    expect(JSON.stringify(body)).not.toContain('netProfit');
  });

  it.each([
    ['yes at 50.01', { businessUsePercent: 50.01, listedEquipmentAnswer: 'yes' }],
    ['yes at 51', { businessUsePercent: 51, listedEquipmentAnswer: 'yes' }],
    ['no at 50', { businessUsePercent: 50, listedEquipmentAnswer: 'no' }],
    ['computer at 50', { category: 'computer', businessUsePercent: 50, listedEquipmentAnswer: 'yes' }],
  ])('Schedule C calculate keeps the helper figure for %s', async (_label, fields) => {
    seed('camera', fields);
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const expected = profitFor('camera', fields);
    const reference = calc4562([asAsset('plain', { category: 'computer', businessUsePercent: Number(fields.businessUsePercent) })], 100000, 2026);
    expect(body.data.depreciationDeduction).toBe(expected.depreciationDeduction);
    expect(body.data.depreciationDeduction).toBe(reference.totalDepreciation);
    expect(body.data.netProfit).toBe(expected.netProfit);
    expect(body.data.depreciationDeduction).toBeGreaterThan(0);
  });

  it('reviews each profit consumer when an asset is held and still returns dollars when none is held', async () => {
    const heldFields = { businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement' };
    const openFields = { category: 'computer', businessUsePercent: 100 };
    const expectReview = async (response: Response) => {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
      expect(body.error).toContain(message);
      expect(body).not.toHaveProperty('data');
      expect(body).not.toHaveProperty('form1040');
      expect(body).not.toHaveProperty('calculation');
      expect(body).not.toHaveProperty('netProfit');
      expect(body).not.toHaveProperty('totalEstimatedTax');
      expect(body).not.toHaveProperty('scheduleC');
      expect(body).not.toHaveProperty('deduction');
      expect(body).not.toHaveProperty('depreciation');
      expect(body).not.toHaveProperty('totalTax');
    };
    seed('camera', heldFields);
    await expectReview(await calculateScheduleC(json('tax/schedule-c/calculate?year=2026')));
    await expectReview(await scheduleSE(json('tax/schedule-se/auto?year=2026')));
    await expectReview(await compute1040(json('tax/compute-1040?year=2026')));
    await expectReview(await quarterlyReminders(json('tax/quarterly-reminders?year=2026&asOf=2026-07-15')));
    await expectReview(await homeOfficeWorksheet(json('tax/home-office?year=2026')));
    const sePdf = await exportForms(json('reports/export', { type: 'scheduleSE', year: 2026 }));
    expect(sePdf.status).toBe(422);
    expect(sePdf.headers.get('content-type')).not.toContain('pdf');
    expect(await sePdf.json()).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
    const formPdf = await exportForms(json('reports/export', { type: 'form4562', year: 2026 }));
    expect(formPdf.status).toBe(422);
    expect(formPdf.headers.get('content-type')).not.toContain('pdf');
    const worksheet = await form4562Worksheet(json('tax/form-4562?year=2026'));
    expect(worksheet.status).toBe(200);
    const worksheetBody = await worksheet.json();
    expect(worksheetBody.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'camera').totalDepreciation).toBe(0);
    expect(worksheetBody.calculation.heldAssets).toEqual([{ id: 'camera', name: 'camera', reason: 'review' }]);

    seed('laptop', openFields);
    const expected = profitFor('laptop', openFields);
    const scheduleC = await (await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'))).json();
    expect(scheduleC.data.depreciationDeduction).toBe(expected.depreciationDeduction);
    expect(scheduleC.data.netProfit).toBe(expected.netProfit);
    expect(scheduleC.data.netProfit).toBeGreaterThan(0);
    const se = await (await scheduleSE(json('tax/schedule-se/auto?year=2026'))).json();
    expect(se.calculation.netProfitFromScheduleC).toBe(expected.netProfit);
    expect(se.netProfit).toBe(expected.netProfit);
    const estimate = await (await compute1040(json('tax/compute-1040?year=2026'))).json();
    expect(estimate.depreciation.totalDepreciation).toBe(expected.depreciationDeduction);
    expect(estimate.income.scheduleCLine31NetProfit).toBe(expected.netProfit);
    expect(typeof estimate.form1040.totalTax).toBe('number');
    const planner = await (await quarterlyReminders(json('tax/quarterly-reminders?year=2026&asOf=2026-07-15'))).json();
    expect(planner.totalEstimatedTax).toBe(estimate.form1040.totalTax);
    expect(planner.totalEstimatedTax).toBeGreaterThan(0);
    const home = await (await homeOfficeWorksheet(json('tax/home-office?year=2026'))).json();
    expect(home.scheduleC.depreciationDeduction).toBe(expected.depreciationDeduction);
    expect(home.scheduleC.netProfit).toBe(expected.netProfit);
    const seFile = await exportForms(json('reports/export', { type: 'scheduleSE', year: 2026 }));
    expect(seFile.status).toBe(200);
    expect(seFile.headers.get('content-type')).toContain('application/pdf');
    expect((await seFile.arrayBuffer()).byteLength).toBeGreaterThan(100);
    const formFile = await exportForms(json('reports/export', { type: 'form4562', year: 2026 }));
    expect(formFile.status).toBe(200);
    expect(formFile.headers.get('content-type')).toContain('application/pdf');
  });
});

describe('equipment release answer', () => {
  const placed = new Date('2026-05-01T00:00:00.000Z');
  const message = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
  const clearAssets = () => { for (const key of [...store.docs.keys()]) if (key.includes('/assets/')) store.docs.delete(key); };
  const seed = (fields: Record<string, unknown>) => {
    clearAssets();
    seedAsset('camera', { description: 'Camera', datePlacedInService: { toDate: () => placed }, cost: 10000, businessUsePercent: 50, category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, listedEquipmentAnswer: 'yes', ...fields });
  };
  const patch = (body: Record<string, unknown>) => patchAsset(new NextRequest('http://localhost/api/settings/assets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 15, 12)));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects a bad release answer on create and on update', async () => {
    const created = await postAssets(json('settings/assets', { assets: [{ description: 'Camera', datePlacedInService: '2026-05-01', cost: 4000, businessUsePercent: 50, category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, listedEquipmentAnswer: 'yes', listedEquipmentReleaseAnswer: 'sometimes' }] }));
    expect(created.status).toBe(400);
    seed({});
    const updated = await patch({ assetId: 'camera', listedEquipmentReleaseAnswer: 'sometimes' });
    expect(updated.status).toBe(400);
  });

  it('keeps every profit consumer in review when the release answer is no', async () => {
    seed({ listedEquipmentKind: 'photo_audio_video_communication', listedEquipmentMainLineOfWork: 'no', listedEquipmentBusinessLocation: 'no', listedEquipmentReleaseAnswer: 'no' });
    const expectReview = async (response: Response) => {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
      expect(body.error).toContain(message);
      expect(body).not.toHaveProperty('data');
      expect(body).not.toHaveProperty('form1040');
      expect(body).not.toHaveProperty('calculation');
      expect(body).not.toHaveProperty('netProfit');
      expect(body).not.toHaveProperty('totalEstimatedTax');
      expect(body).not.toHaveProperty('scheduleC');
      expect(body).not.toHaveProperty('deduction');
      expect(body).not.toHaveProperty('depreciation');
      expect(body).not.toHaveProperty('totalTax');
    };
    await expectReview(await calculateScheduleC(json('tax/schedule-c/calculate?year=2026')));
    await expectReview(await scheduleSE(json('tax/schedule-se/auto?year=2026')));
    await expectReview(await compute1040(json('tax/compute-1040?year=2026')));
    await expectReview(await quarterlyReminders(json('tax/quarterly-reminders?year=2026&asOf=2026-07-15')));
    await expectReview(await homeOfficeWorksheet(json('tax/home-office?year=2026')));
    const sePdf = await exportForms(json('reports/export', { type: 'scheduleSE', year: 2026 }));
    expect(sePdf.status).toBe(422);
    expect(sePdf.headers.get('content-type')).not.toContain('pdf');
    const formPdf = await exportForms(json('reports/export', { type: 'form4562', year: 2026 }));
    expect(formPdf.status).toBe(422);
    expect(formPdf.headers.get('content-type')).not.toContain('pdf');
  });

  it('returns the helper depreciation from Schedule C calculate when photo gear is used in the main line of work', async () => {
    seed({ listedEquipmentKind: 'photo_audio_video_communication', listedEquipmentMainLineOfWork: 'yes', listedEquipmentReleaseAnswer: 'yes' });
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const reference = calc4562([asReleaseReference()], 100000, 2026);
    expect(body.data.depreciationDeduction).toBe(reference.totalDepreciation);
    expect(body.data.depreciationDeduction).toBeGreaterThan(0);
  });

  it('shows the named question, not the generic review message, for a saved asset with no kind', async () => {
    const sentence = 'PLACEHOLDER: We need one answer about Camera before we can show your estimate. What kind of equipment is it?';
    const generic = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
    const expectQuestion = async (response: Response) => {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
      expect(body.error).toContain(sentence);
      expect(body.error).not.toContain(generic);
      expect(body.error).not.toMatch(/\$\d/);
      expect(body.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
      expect(body).not.toHaveProperty('data');
      expect(body).not.toHaveProperty('form1040');
      expect(body).not.toHaveProperty('calculation');
      expect(body).not.toHaveProperty('netProfit');
      expect(body).not.toHaveProperty('totalEstimatedTax');
      expect(body).not.toHaveProperty('deduction');
      expect(body).not.toHaveProperty('depreciation');
    };
    for (const fields of [{ listedEquipmentAnswer: null }, { listedEquipmentAnswer: 'yes' }]) {
      seed(fields);
      await expectQuestion(await calculateScheduleC(json('tax/schedule-c/calculate?year=2026')));
      await expectQuestion(await scheduleSE(json('tax/schedule-se/auto?year=2026')));
      await expectQuestion(await compute1040(json('tax/compute-1040?year=2026')));
      await expectQuestion(await quarterlyReminders(json('tax/quarterly-reminders?year=2026&asOf=2026-07-15')));
      await expectQuestion(await homeOfficeWorksheet(json('tax/home-office?year=2026')));
      const worksheet = await form4562Worksheet(json('tax/form-4562?year=2026'));
      expect(worksheet.status).toBe(200);
      const worksheetBody = await worksheet.json();
      expect(worksheetBody.calculation.notes.join('\n')).toContain(sentence);
      expect(worksheetBody.calculation.notes.join('\n')).not.toContain(generic);
      expect(worksheetBody.calculation.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
      expect(worksheetBody.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'camera').regularDepreciation).toBe(0);
    }
  });

  it('shows the main line question for photo gear at 30 percent with no release answers', async () => {
    const sentence = 'PLACEHOLDER: We need one more answer about Camera. Do you use it in your main line of work?';
    const generic = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
    seed({ businessUsePercent: 30, listedEquipmentKind: 'photo_audio_video_communication', section179Requested: false, bonusEligible: false });
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
    expect(body.error).toContain(sentence);
    expect(body.error).not.toContain(generic);
    expect(body.error).not.toContain('What kind of equipment is it?');
    expect(body.error).not.toMatch(/\$\d/);
    expect(body.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question', ask: 'main_line' }]);
    expect(body).not.toHaveProperty('data');
    const worksheet = await form4562Worksheet(json('tax/form-4562?year=2026'));
    expect(worksheet.status).toBe(200);
    const worksheetBody = await worksheet.json();
    expect(worksheetBody.calculation.notes.join('\n')).toContain(sentence);
    expect(worksheetBody.calculation.notes.join('\n')).not.toContain(generic);
    expect(worksheetBody.calculation.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question', ask: 'main_line' }]);
    expect(worksheetBody.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'camera').regularDepreciation).toBe(0);
    expect(worksheetBody.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'camera').totalDepreciation).toBe(0);
  });

  it('shows the business location question when the main line answer is no and the location is blank', async () => {
    const sentence = 'PLACEHOLDER: We need one more answer about Camera. Do you use it only at your business location?';
    const generic = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
    seed({ businessUsePercent: 30, listedEquipmentKind: 'photo_audio_video_communication', listedEquipmentMainLineOfWork: 'no', section179Requested: false, bonusEligible: false });
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
    expect(body.error).toContain(sentence);
    expect(body.error).not.toContain(generic);
    expect(body.error).not.toContain('Do you use it in your main line of work?');
    expect(body.error).not.toMatch(/\$\d/);
    expect(body.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question', ask: 'location' }]);
    expect(body).not.toHaveProperty('data');
    const worksheet = await form4562Worksheet(json('tax/form-4562?year=2026'));
    expect(worksheet.status).toBe(200);
    const worksheetBody = await worksheet.json();
    expect(worksheetBody.calculation.notes.join('\n')).toContain(sentence);
    expect(worksheetBody.calculation.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question', ask: 'location' }]);
    expect(worksheetBody.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === 'camera').totalDepreciation).toBe(0);
  });

  it('shows the follow-up question when the business location is yes and the outside-home answer is blank', async () => {
    const sentence = 'PLACEHOLDER: We need one more answer about Camera. Is that a studio or office outside your home?';
    const generic = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
    seed({ businessUsePercent: 30, listedEquipmentKind: 'photo_audio_video_communication', listedEquipmentBusinessLocation: 'yes', section179Requested: false, bonusEligible: false });
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toContain(sentence);
    expect(body.error).not.toContain(generic);
    expect(body.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question', ask: 'follow_up' }]);
    expect(body).not.toHaveProperty('data');
  });

  it('rejects a bad gear kind and a bad release answer', async () => {
    const assetBody = { description: 'Camera', datePlacedInService: '2026-05-01', cost: 4000, businessUsePercent: 50, category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, listedEquipmentAnswer: 'yes' };
    expect((await postAssets(json('settings/assets', { assets: [{ ...assetBody, listedEquipmentKind: 'camera' }] }))).status).toBe(400);
    expect((await postAssets(json('settings/assets', { assets: [{ ...assetBody, listedEquipmentReleaseAnswer: 'sometimes' }] }))).status).toBe(400);
    seed({});
    expect((await patch({ assetId: 'camera', listedEquipmentKind: 'camera' })).status).toBe(400);
    expect((await patch({ assetId: 'camera', listedEquipmentReleaseAnswer: 'sometimes' })).status).toBe(400);
    expect((await patch({ assetId: 'camera', listedEquipmentMainLineOfWork: 'maybe' })).status).toBe(400);
    expect((await patch({ assetId: 'camera', listedEquipmentLocationFollowUp: 'garage' })).status).toBe(400);
  });

  it('releases an old asset after a kind is saved and the main line of work answer is yes', async () => {
    seed({ listedEquipmentAnswer: 'yes' });
    const kindPatch = typeof patchAsset === 'function'
      ? await patch({ assetId: 'camera', listedEquipmentKind: 'photo_audio_video_communication' })
      : { status: 0 };
    expect(kindPatch.status).toBe(200);
    const yesPatch = await patch({ assetId: 'camera', listedEquipmentMainLineOfWork: 'yes' });
    expect(yesPatch.status).toBe(200);
    const response = await calculateScheduleC(json('tax/schedule-c/calculate?year=2026'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const reference = calc4562([asReleaseReference()], 100000, 2026);
    expect(body.data.depreciationDeduction).toBe(reference.totalDepreciation);
    expect(body.data.depreciationDeduction).toBeGreaterThan(0);
  });
});

function asReleaseReference(): Asset {
  return {
    id: 'plain', description: 'plain', datePlacedInService: new Date('2026-05-01T00:00:00.000Z'), cost: 10000, businessUsePercent: 50,
    category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false,
  };
}
