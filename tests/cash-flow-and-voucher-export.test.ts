import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
const fixture = vi.hoisted(() => ({ user: 'cash-flow-owner' as string | null, denied: false, records: [] as Record<string, unknown>[], read: vi.fn(), feature: vi.fn(), fail: false }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: fixture.user ? { uid: fixture.user } : null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async (...args: unknown[]) => { fixture.feature(...args); return fixture.denied ? NextResponse.json({ code: 'SUBSCRIPTION_REQUIRED' }, { status: 403 }) : null; } }));
vi.mock('@/lib/reports/export-records', () => ({ readOwnedTransactions: async (uid: string) => { fixture.read(uid); if (fixture.fail) throw new Error('private read failure'); return fixture.records; } }));
import { POST, GET } from '../app/api/reports/profit-loss/route';
import { POST as voucher } from '../app/api/tax/generate-1040es/route';
const post = (body: unknown = { year: 2026 }) => new NextRequest('https://localhost/api/reports/profit-loss', { method: 'POST', body: JSON.stringify(body) });
const get = (query = 'format=pdf&year=2026') => new NextRequest(`https://localhost/api/reports/profit-loss?${query}`);
const tx = (amount: number, extra = {}) => ({ amount, date: '2026-09-01', iso_currency_code: 'USD', merchant_name: 'Synthetic record', category: 'Uncategorized', ...extra });
beforeEach(() => { vi.restoreAllMocks(); fixture.user = 'cash-flow-owner'; fixture.denied = false; fixture.fail = false; fixture.records = []; fixture.read.mockReset(); fixture.feature.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('recorded cash-flow JSON/PDF uses complete verified records without tax claims', () => {
  it('sums literal cash directions, includes personal/unreviewed movements with disclosure, excludes pending and emits null tax fields', async () => {
    fixture.records = [tx(-1000), tx(-200, { category: 'transfer' }), tx(100, { is_deductible: true }), tx(25, { is_deductible: false }), tx(20, { is_deductible: null }), tx(500, { pending: true }), tx(900, { date: '2025-09-01' })];
    const result = await POST(post()); expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('private, no-store');
    const data = await result.json();
    expect(data).toMatchObject({ reportType: 'recorded_cash_flow', currency: 'USD', totalIncome: 1200, totalExpenses: 145, netProfit: 1055, transactionCount: 5, excludedPendingCount: 1, effectiveTaxRate: null, incomeTax: null, selfEmploymentTax: null, costOfGoodsSold: null, grossProfit: null });
    expect(data.scope).toContain('including personal, transfer and unreviewed'); expect(data.scope).toContain('not business profit');
    expect(fixture.read).toHaveBeenCalledWith('cash-flow-owner');
  });
  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])('uses recorded calendar dates at year/month boundaries in %s', async timezone => {
    vi.stubEnv('TZ', timezone);
    fixture.records = [tx(-100, { date: '2026-01-01T00:00:00.000Z' }), tx(-20, { date: '2025-12-31' }), tx(-300, { date: '2026-02-01' })];
    const data = await (await POST(post({ year: 2026, month: 1 }))).json();
    expect(data).toMatchObject({ totalIncome: 100, periodLabel: '2026-01', priorPeriod: { totalIncome: 20 } });
  });
  it.each([{ amount: '' }, { amount: 'not-an-amount' }, { amount: null }, { amount: 1e308 }, { date: '' }, { date: '2026-02-30' }, { iso_currency_code: undefined }, { iso_currency_code: 'EUR' }, { unofficial_currency_code: 'BTC' }])('blocks unverifiable input instead of printing plausible USD totals: %j', async invalid => {
    fixture.records = [tx(100, invalid)]; const create = vi.spyOn(PDFDocument, 'create');
    for (const response of [await POST(post()), await GET(get())]) {
      expect(response.status).toBe(422); const data = await response.json(); expect(data.code).toBe('EXPORT_REVIEW_REQUIRED'); expect(data).not.toHaveProperty('netProfit');
    }
    expect(create).not.toHaveBeenCalled();
  });
  it('does not combine USD and foreign/unknown currency, even for amounts marked deductible', async () => {
    fixture.records = [tx(-1000), tx(100, { iso_currency_code: 'CAD', is_deductible: true })];
    expect((await POST(post())).status).toBe(422);
    fixture.records[1].iso_currency_code = undefined; expect((await POST(post())).status).toBe(422);
  });
  it('blocks duplicate logical account/transaction references stored in separate legacy and current documents', async () => {
    fixture.records = [tx(-100, { trans_id: 'provider-tx', account_id: 'bank', recordPath: 'legacy/transactions/a' }), tx(-100, { trans_id: 'provider-tx', accountId: 'bank', recordPath: 'current/transactions/b' })];
    for (const result of [await POST(post()), await GET(get())]) {
      expect(result.status).toBe(422); expect(await result.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED', error: expect.stringContaining('Duplicate transaction') });
    }
  });
  it('keeps different accounts distinct and excludes pending duplicates before calculating posted cash-flow', async () => {
    fixture.records = [tx(-100, { trans_id: 'same-id', account_id: 'bank-a' }), tx(-50, { trans_id: 'same-id', account_id: 'bank-b' }), tx(-100, { trans_id: 'same-id', account_id: 'bank-a', pending: true })];
    const data = await (await POST(post())).json(); expect(data).toMatchObject({ totalIncome: 150, transactionCount: 2, excludedPendingCount: 1 });
  });
  it('withholds an invalid prior-period comparison without replacing it by zero or withholding a valid current period', async () => {
    fixture.records = [tx(-1000), tx(-200, { date: '2025-01-01', iso_currency_code: undefined })];
    const data = await (await POST(post())).json();
    expect(data).toMatchObject({ totalIncome: 1000, priorPeriod: null, priorPeriodReviewRequired: true });
  });
  it('handles prototype-like names safely, and PDF matches JSON totals with long Unicode sources on multiple pages', async () => {
    fixture.records = Array.from({ length: 80 }, (_, i) => tx(-100, { merchant_name: `SOURCE-${String(i).padStart(3, '0')} ${'long source '.repeat(5)} Café 中文 🚗` }));
    fixture.records.push(tx(-25, { merchant_name: '__proto__' }), tx(50, { category: 'constructor' }));
    const data = await (await POST(post())).json(); expect(data.totalIncome).toBe(8025); expect(data.netProfit).toBe(7975);
    const text = vi.spyOn(PDFPage.prototype, 'drawText'); const result = await GET(get()); expect(result.status).toBe(200);
    const bytes = new Uint8Array(await result.arrayBuffer()); const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBeGreaterThan(2);
    const printed = text.mock.calls.map(([value]) => value).join('\n');
    expect(printed).toContain('NOT FOR FILING'); expect(printed).toContain('$8,025.00'); expect(printed).toContain('$50.00'); expect(printed).toContain('$7,975.00');
    for (let i = 0; i < 80; i++) expect(printed).toContain(`SOURCE-${String(i).padStart(3, '0')}`);
    for (const [value, options] of text.mock.calls) {
      expect(options!.y!, value).toBeGreaterThanOrEqual(20);
      expect(options!.x! + options!.font!.widthOfTextAtSize(value, options!.size!), value).toBeLessThanOrEqual(571);
    }
    expect(printed).not.toContain('Effective Tax Rate');
    if (process.env.TAX_EXPORT_ARTIFACT_DIR) { mkdirSync(process.env.TAX_EXPORT_ARTIFACT_DIR, { recursive: true }); writeFileSync(`${process.env.TAX_EXPORT_ARTIFACT_DIR}/recorded-cash-flow-long.pdf`, bytes); }
  });
  it.each([{ year: '2026junk' }, { year: 2026.5 }, { year: -1 }, { month: 0 }, { month: 13 }, { month: '1junk' }, []])('rejects invalid report periods before reading data: %j', async body => {
    expect((await POST(post(body))).status).toBe(400); expect(fixture.read).not.toHaveBeenCalled();
  });
  it('rejects GET partial parsing and returns503 rather than empty/partial PDF on data failure', async () => {
    expect((await GET(get('format=pdf&year=2026junk'))).status).toBe(400); expect(fixture.read).not.toHaveBeenCalled();
    fixture.fail = true; const response = await GET(get()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private read failure');
  });
  it('auth and plan gates run before any record read or PDF generation', async () => {
    const create = vi.spyOn(PDFDocument, 'create'); fixture.user = null;
    expect((await POST(post())).status).toBe(401); expect((await GET(get())).status).toBe(401);
    fixture.user = 'cash-flow-owner'; fixture.denied = true;
    expect((await POST(post())).status).toBe(403); expect((await GET(get())).status).toBe(403);
    expect(fixture.feature).toHaveBeenCalledWith('cash-flow-owner', 'reports'); expect(fixture.feature).toHaveBeenCalledWith('cash-flow-owner', 'exports');
    expect(fixture.read).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});

describe('quarterly references cannot masquerade as calculated or completed IRS vouchers', () => {
  it.each([2024, 2025, 2026])('keeps %s review required, ignores client tax totals and links the correct IRS reference year', async taxYear => {
    const create = vi.spyOn(PDFDocument, 'create');
    const result = await voucher(post({ quarter: 1, taxYear, taxCalculation: { quarterlyAmount: 0, refund: 999999 } }));
    expect(result.status).toBe(422); const data = await result.json();
    expect(data).toMatchObject({ code: 'QUARTERLY_REVIEW_REQUIRED', taxYear, officialFormTaxYear: taxYear, documentGenerated: false });
    expect(data.officialFormUrl).toBe(taxYear === 2026 ? 'https://www.irs.gov/pub/irs-pdf/f1040es.pdf' : `https://www.irs.gov/pub/irs-prior/f1040es--${taxYear}.pdf`);
    expect(data).not.toHaveProperty('refund'); expect(data).not.toHaveProperty('quarterlyAmount'); expect(create).not.toHaveBeenCalled();
  });
  it.each([{ quarter: 1 }, { quarter: 0, taxYear: 2026 }, { quarter: 5, taxYear: 2026 }, { quarter: 1, taxYear: 2027 }, { quarter: 1, taxYear: '2026' }, { quarter: 1, taxYear: 2026, year: 2025 }])('requires explicit consistent supported year/quarter: %j', async body => { expect((await voucher(post(body))).status).toBe(400); });
  it('preserves auth and export-plan gates', async () => {
    fixture.user = null; expect((await voucher(post({ quarter: 1, taxYear: 2026 }))).status).toBe(401);
    fixture.user = 'cash-flow-owner'; fixture.denied = true; expect((await voucher(post({ quarter: 1, taxYear: 2026 }))).status).toBe(403);
  });
});
