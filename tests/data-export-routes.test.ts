import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mock = vi.hoisted(() => ({ uid: 'owner', auth: true, deny: false, rows: vi.fn(), archive: vi.fn(), se: vi.fn(), sePDF: vi.fn(), profile: vi.fn() }));
// The archive route's durable throttle runs against an in-memory store.
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: mock.auth ? { uid: mock.uid } : null, error: mock.auth ? null : 'Unauthorized' }) }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => { if (!mock.auth) throw Error(); return { uid: mock.uid }; } }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => mock.deny ? NextResponse.json({ code: 'SUBSCRIPTION_REQUIRED' }, { status: 403 }) : null }));
vi.mock('@/lib/reports/export-records', () => ({ readOwnedTransactions: mock.rows }));
vi.mock('@/lib/reports/data-export', () => ({ generateUserDataExport: mock.archive, validateExportData: () => ({ isValid: true, warnings: [] }), generateDataPackage: (data: unknown) => ({ json: data, csv: 'csv', readme: 'readme', summary: { counts: { transactions: 0 } } }) }));
vi.mock('@/lib/reports/load-schedule-se', () => ({ loadScheduleSEData: mock.se }));
vi.mock('@/lib/reports/scheduleSE', () => ({ generateScheduleSEPDF: mock.sePDF }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: mock.profile }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: vi.fn() }));
vi.mock('@/lib/firebase/settings-server', () => ({ getHomeOfficeSettings: vi.fn(), getAssetsSettings: vi.fn() }));
import { GET as csv } from '@/app/api/transactions/export-csv/route';
import { POST as pdf } from '@/app/api/reports/generate-pdf/route';
import { POST as forms } from '@/app/api/reports/export/route';
import { POST as archive, GET as status } from '@/app/api/user/export/route';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { RATE_LIMITS } from '@/lib/security/rate-limit';
import { exhaustRateLimit, failRateLimitStore, recordedRateLimitCount, resetRateLimitStore } from './fixtures/rate-limit-store';
let sequence = 0;
const request = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); resetRateLimitStore(); mock.uid = `owner-${++sequence}`; mock.auth = true; mock.deny = false;
  mock.rows.mockResolvedValue([{ date: '2026-01-01', amount: -99, merchant_name: 'Owned client', iso_currency_code: 'USD', is_deductible: false }]);
  mock.archive.mockResolvedValue({ exportInfo: { exportId: 'id', exportDate: '2026-01-01' } });
  mock.se.mockResolvedValue({ taxYear: 2026, calculation: { totalSelfEmploymentTax: 123 }, w2SocialSecurityWages: 5000 });
  mock.sePDF.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});
describe('data and report export HTTP contracts', () => {
  it('rejects unauthenticated archive, CSV and PDF before reading data', async () => {
    mock.auth = false;
    expect((await csv(request('transactions/export-csv'))).status).toBe(401);
    expect((await pdf(request('reports/generate-pdf', { year: 2026 }))).status).toBe(401);
    expect((await archive(request('user/export', {}))).status).toBe(401);
    expect(mock.rows).not.toHaveBeenCalled(); expect(mock.archive).not.toHaveBeenCalled();
  });
  it('gates paid formats but leaves owned archive available on a free plan', async () => {
    mock.deny = true;
    expect((await csv(request('transactions/export-csv'))).status).toBe(403);
    expect((await pdf(request('reports/generate-pdf', { year: 2026 }))).status).toBe(403);
    expect((await archive(request('user/export', { year: 2026 }))).status).toBe(200);
    expect(mock.archive).toHaveBeenCalledWith(mock.uid, 2026);
  });
  it('loads only authenticated owner records, selected year, and returns a signed private CSV', async () => {
    mock.rows.mockResolvedValueOnce([{ date: '2025-01-01', amount: 500 }, { date: '2026-01-01', amount: -99, merchant_name: 'Owned client' }]);
    const response = await csv(request('transactions/export-csv?year=2026'));
    expect(response.status).toBe(200); expect(mock.rows).toHaveBeenCalledWith(mock.uid);
    const body = await response.text(); expect(body).toContain('-99,Inflow'); expect(body).not.toContain('2025-01-01');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['year=2026junk', 'year=2026.5', 'filter=arbitrary'])('rejects malformed CSV query %s', async query => {
    expect((await csv(request(`transactions/export-csv?${query}`))).status).toBe(400); expect(mock.rows).not.toHaveBeenCalled();
  });
  it('filters legacy deductible flags consistently with the recorded CSV classification', async () => {
    mock.rows.mockResolvedValue([{ date: '2026-01-01', amount: 10, deductible: true, merchant_name: 'Legacy true' }, { date: '2026-01-01', amount: 20, is_deductible: false, deductible: true, merchant_name: 'Explicit false' }]);
    const response = await csv(request('transactions/export-csv?year=2026&filter=deductible'));
    expect(response.status).toBe(200); const body = await response.text(); expect(body).toContain('Legacy true'); expect(body).not.toContain('Explicit false');
  });
  it('rejects forged client totals and owner fields instead of creating a PDF from them', async () => {
    expect((await pdf(request('reports/generate-pdf', { year: 2026, summary: { refund: 9999 }, userId: 'victim' }))).status).toBe(400);
    expect(mock.rows).not.toHaveBeenCalled();
    expect((await pdf(request('reports/generate-pdf', { year: 2026 }))).status).toBe(200);
    expect(mock.rows).toHaveBeenCalledWith(mock.uid);
  });
  it('never returns an apparently complete CSV/PDF when its source read fails', async () => {
    mock.rows.mockRejectedValue(Error('secret provider credential'));
    for (const response of [await csv(request('transactions/export-csv')), await pdf(request('reports/generate-pdf', { year: 2026 }))]) {
      expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
    }
  });
  it('returns typed422 for a selected-year review requirement', async () => {
    mock.rows.mockResolvedValue([{ amount: 100 }]);
    const response = await csv(request('transactions/export-csv?year=2026'));
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
  });
  it('uses reconciled live Schedule SE data with the authenticated owner and selected year', async () => {
    const response = await forms(request('reports/export', { type: 'scheduleSE', year: 2026 }));
    expect(response.status).toBe(200); expect(mock.se).toHaveBeenCalledWith(mock.uid, 2026);
    expect(mock.sePDF).toHaveBeenCalledWith(expect.objectContaining({ calculation: { totalSelfEmploymentTax: 123 }, w2SocialSecurityWages: 5000 }));
    expect(mock.profile).not.toHaveBeenCalled();
    expect((await forms(request('reports/export', { type: 'scheduleSE', year: '2026x' }))).status).toBe(400);
  });
  it('propagates Schedule SE review422 and maps raw data errors to safe503', async () => {
    mock.se.mockRejectedValueOnce(Object.assign(Error('Reconcile income'), { code: 'INCOME_RECONCILIATION_REQUIRED' }));
    expect((await forms(request('reports/export', { type: 'scheduleSE', year: 2026 }))).status).toBe(422);
    mock.se.mockRejectedValueOnce(Error('secret provider error'));
    const response = await forms(request('reports/export', { type: 'scheduleSE', year: 2026 })); expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
  });
  it('allows retry after failed archive and applies throttle only after a complete success', async () => {
    mock.archive.mockRejectedValueOnce(Error('secret'));
    expect((await archive(request('user/export', {}))).status).toBe(503);
    expect(await (await status(request('user/export'))).json()).toMatchObject({ canExport: true });
    expect((await archive(request('user/export', {}))).status).toBe(200);
    expect((await archive(request('user/export', {}))).status).toBe(429);
  });
  it('answers a throttled archive with Retry-After, a stable code and a durable status window', async () => {
    expect((await archive(request('user/export', {}))).status).toBe(200);
    const response = await archive(request('user/export', {}));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(3500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
    expect(await (await status(request('user/export'))).json()).toMatchObject({ canExport: false, timeRemaining: 60, rateLimitHours: 1 });
    expect(mock.archive).toHaveBeenCalledTimes(1);
    // The completed archive is the only recorded use; the failed attempt limit counts both tries.
    expect(recordedRateLimitCount(RATE_LIMITS.userExport.scope)).toBe(1);
    expect(recordedRateLimitCount(RATE_LIMITS.userExportAttempts.scope)).toBe(2);
  });
  it('bounds repeated failing archive attempts even though each failure is refunded', async () => {
    await exhaustRateLimit(RATE_LIMITS.userExportAttempts, mock.uid);
    const response = await archive(request('user/export', {}));
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(mock.archive).not.toHaveBeenCalled();
  });
  it('fails closed on archive creation but keeps the status read available when the limiter store is unreachable', async () => {
    failRateLimitStore();
    const response = await archive(request('user/export', {}));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' });
    expect(mock.archive).not.toHaveBeenCalled();
    expect(await (await status(request('user/export'))).json()).toMatchObject({ canExport: true });
  });
  it('rejects cross-owner archive parameters and preserves typed review errors', async () => {
    expect((await archive(request('user/export', { userId: 'victim' }))).status).toBe(400); expect(mock.archive).not.toHaveBeenCalled();
    mock.archive.mockRejectedValueOnce(new ExportReviewRequiredError('Correct missing date'));
    const response = await archive(request('user/export', { year: 2026 })); expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
  });
  it('blocks a duplicate in-flight archive request', async () => {
    let release!: (value: unknown) => void;
    mock.archive.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const first = archive(request('user/export', {}));
    await vi.waitFor(() => expect(mock.archive).toHaveBeenCalled());
    expect((await archive(request('user/export', {}))).status).toBe(429);
    release({ exportInfo: { exportId: 'one', exportDate: '2026-01-01' } }); expect((await first).status).toBe(200);
  });
  it('acquires the archive lock atomically when both requests start before either body finishes', async () => {
    let release!: (value: unknown) => void;
    mock.archive.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const first = archive(request('user/export', {})); const second = archive(request('user/export', {}));
    await vi.waitFor(() => expect(mock.archive).toHaveBeenCalledTimes(1));
    expect((await second).status).toBe(429);
    release({ exportInfo: { exportId: 'one', exportDate: '2026-01-01' } }); expect((await first).status).toBe(200);
    expect(mock.archive).toHaveBeenCalledTimes(1);
  });
});
