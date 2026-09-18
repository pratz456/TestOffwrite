import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
const mock = vi.hoisted(() => ({ uid: 'owner', auth: true, deny: false, gate: vi.fn(), rows: vi.fn(), collections: {} as Record<string, Record<string, unknown>[]>, reads: [] as string[], fail: '' }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: mock.auth ? { uid: mock.uid } : null, error: mock.auth ? null : 'Unauthorized' }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async (uid: string, feature: string) => { mock.gate(uid, feature); return mock.deny ? NextResponse.json({ error: 'This feature requires an active trial or Premium subscription.', code: 'SUBSCRIPTION_REQUIRED', feature }, { status: 403 }) : null; } }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: (uid: string) => mock.rows(uid) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (path: string) => {
  const filters: [string, unknown][] = [];
  const query = { where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; }, get: async () => {
    mock.reads.push(path); if (mock.fail === path) throw new Error('private Firestore failure');
    const docs = (mock.collections[path] ?? []).filter(row => filters.every(([field, value]) => row[field] === value));
    return { empty: !docs.length, docs: docs.map((row, index) => ({ id: String(row.id ?? `doc-${index}`), ref: { path: `${path}/${row.id ?? index}` }, data: () => row })) };
  } };
  return query;
} } }));
import { GET } from '@/app/api/reports/audit-support/route';
const request = (query: string) => new NextRequest(`http://localhost/api/reports/audit-support${query}`);
const lodging = { userId: 'owner', trans_id: 'PROVIDER-ID', id: 'doc-1', recordPath: 'user_profiles/owner/accounts/a/transactions/doc-1', exportReference: 'transaction-abc', date: '2026-03-10', amount: 180, iso_currency_code: 'USD',
  merchant_name: 'SYNTHETIC-LODGING', category: 'TRAVEL_LODGING', is_deductible: true, review_status: 'confirmed', review_source: 'user_corrected', reviewed_at: '2026-04-01T12:00:00.000Z', access_token: 'SECRET_TOKEN' };
beforeEach(() => {
  vi.clearAllMocks(); vi.restoreAllMocks(); resetRateLimitStore(); mock.auth = true; mock.deny = false; mock.fail = ''; mock.reads = [];
  mock.rows.mockResolvedValue([lodging, { ...lodging, trans_id: 'other', id: 'doc-2', recordPath: 'user_profiles/owner/accounts/a/transactions/doc-2', exportReference: 'transaction-def', merchant_name: 'UNCONFIRMED-MARKER', review_status: undefined }]);
  mock.collections = { 'user_profiles/owner/mileage_trips': [{ id: 'trip-1', date: '2026-03-10', startLocation: 'Home office', endLocation: 'Client site', miles: 100, roundTrip: true, businessPurpose: 'Client kickoff' }],
    receipts: [{ id: 'receipt-1', userId: 'owner', transactionId: 'PROVIDER-ID', filename: 'hotel.pdf', originalName: 'hotel.pdf', mimeType: 'application/pdf', storagePath: 'receipts/owner/PROVIDER-ID/receipt-1' }] };
});

describe('GET /api/reports/audit-support', () => {
  it('rejects unauthenticated requests for every format before reading records or checking the plan', async () => {
    mock.auth = false;
    for (const format of ['json', 'csv', 'pdf']) expect((await GET(request(`?year=2026&format=${format}`))).status).toBe(401);
    expect(mock.rows).not.toHaveBeenCalled(); expect(mock.gate).not.toHaveBeenCalled(); expect(mock.reads).toEqual([]);
  });
  it('keeps JSON and CSV available on every plan and gates only the PDF behind the reports feature', async () => {
    mock.deny = true;
    expect((await GET(request('?year=2026'))).status).toBe(200);
    expect((await GET(request('?year=2026&format=csv'))).status).toBe(200);
    expect(mock.gate).not.toHaveBeenCalled();
    const denied = await GET(request('?year=2026&format=pdf'));
    expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', feature: 'reports' });
    expect(mock.gate).toHaveBeenCalledWith('owner', 'reports'); expect(mock.rows).toHaveBeenCalledTimes(2);
  });
  it.each(['', '?year=', '?year=2026junk', '?year=2026.5', '?year=1999', '?year=2026&format=xml', '?year=2026&userId=victim'])('rejects malformed query %s before reading records', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(mock.rows).not.toHaveBeenCalled();
  });
  it('returns the owner packet as JSON with confirmed records only, private receipt references and no-store caching', async () => {
    const response = await GET(request('?year=2026&format=json'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mock.rows).toHaveBeenCalledWith('owner'); expect(mock.reads).toEqual(expect.arrayContaining(['user_profiles/owner/mileage_trips', 'receipts']));
    const body = await response.json();
    expect(body.packetInfo).toMatchObject({ title: 'Audit support records - Tax year 2026', taxYear: 2026, receiptBinariesIncluded: false });
    expect(body.deductions).toHaveLength(1);
    expect(body.deductions[0]).toMatchObject({ merchant: 'SYNTHETIC-LODGING', reference: 'transaction-abc', transactionId: 'PROVIDER-ID', detailPath: '/protected?screen=transaction-detail&transactionId=PROVIDER-ID&from=reports',
      substantiation: { category: 'lodging', status: 'needs_records', missing: ['business purpose', 'travel destination', 'travel dates (departure and return)'] },
      receipts: [{ path: '/api/receipts/receipt-1', filename: 'hotel.pdf', source: 'uploaded' }], linkedTrips: 1 });
    expect(body.summary).toMatchObject({ deductionCount: 1, byStatus: { complete: { count: 0, amount: 0 }, needs_records: { count: 1, amount: 180 } }, excluded: { notConfirmed: 1 }, mileage: { tripCount: 1, standardMileageAmount: 72.5 } });
    expect(body.retention.rows[0]).toMatchObject({ period: '3 years', keepUntil: '2030-04-15' });
    expect(JSON.stringify(body)).not.toMatch(/SECRET_TOKEN|UNCONFIRMED-MARKER|storagePath|receipts\/owner/);
  });
  it('serves the CSV as an attachment with hashed references and both record types', async () => {
    const response = await GET(request('?year=2026&format=csv'));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="writeoff-audit-support-records-2026.csv"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const csv = await response.text();
    expect(csv).toContain('Confirmed deduction,transaction-abc,2026-03-10,SYNTHETIC-LODGING,180,TRAVEL_LODGING,24a,Lodging while traveling,Needs records,');
    expect(csv).toContain('Mileage trip,'); expect(csv).toContain('/api/receipts/receipt-1'); expect(csv).not.toContain('PROVIDER-ID'); expect(csv).not.toContain('SECRET_TOKEN');
  });
  it('serves a Premium PDF whose text carries the cover note and a deduction line with its missing records', async () => {
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const response = await GET(request('?year=2026&format=pdf'));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="writeoff-audit-support-records-2026.pdf"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))).getPageCount()).toBeGreaterThanOrEqual(2);
    const text = spy.mock.calls.map(call => call[0]).join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Audit support records - Tax year 2026');
    expect(text).toContain('It is a records packet, not audit representation, legal or tax advice, or a guarantee that any deduction will be allowed.');
    expect(text).toContain('2026-03-10 SYNTHETIC-LODGING transaction-abc $180.00 Lodging while traveling Travel Needs records: business purpose; travel destination; travel dates (departure and return)');
    expect(text).toContain('Receipt: hotel.pdf (private link)'); expect(text).toContain('Home office -> Client site (round trip)');
    expect(text).not.toMatch(/PROVIDER-ID|SECRET_TOKEN|UNCONFIRMED-MARKER|audit defense|audit protection/i);
  });
  it('returns a typed 422 when records need review and a safe 503 when a source read fails', async () => {
    mock.rows.mockResolvedValueOnce([lodging, { ...lodging, trans_id: 'undated', id: 'doc-3', exportReference: 'transaction-ghi', date: undefined, is_deductible: false }]);
    const review = await GET(request('?year=2026'));
    expect(review.status).toBe(422); expect(await review.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
    mock.rows.mockRejectedValueOnce(new Error('secret provider credential'));
    const failed = await GET(request('?year=2026&format=csv'));
    expect(failed.status).toBe(503); const failedBody = await failed.text();
    expect(failedBody).not.toContain('secret'); expect(JSON.parse(failedBody)).toMatchObject({ code: 'EXPORT_DATA_UNAVAILABLE' });
    mock.fail = 'receipts'; const create = vi.spyOn(PDFDocument, 'create');
    const unreadable = await GET(request('?year=2026&format=pdf'));
    expect(unreadable.status).toBe(503); const unreadableBody = await unreadable.text();
    expect(JSON.parse(unreadableBody)).toMatchObject({ code: 'EXPORT_DATA_UNAVAILABLE' }); expect(unreadableBody).not.toContain('private Firestore'); expect(create).not.toHaveBeenCalled();
  });
});
