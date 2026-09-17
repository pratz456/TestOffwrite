import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), verifySessionCookie: vi.fn(), transaction: vi.fn(),
  collection: vi.fn(), doc: vi.fn(), create: vi.fn(), get: vi.fn(),
  bucket: vi.fn(), file: vi.fn(), save: vi.fn(), deleteFile: vi.fn(), metadata: vi.fn(), download: vi.fn(),
  storageOptions: {} as { storageBucket?: string },
  adminApp: { name: 'firebase-frameworks' }, getStorage: vi.fn(),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminApp: mocks.adminApp,
  adminAuth: { verifyIdToken: mocks.verifyIdToken, verifySessionCookie: mocks.verifySessionCookie },
  adminDb: { collection: mocks.collection },
}));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionServer: mocks.transaction }));
vi.mock('firebase-admin/storage', () => ({ getStorage: mocks.getStorage }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { POST } from '../app/api/upload-receipt/route';
import { GET } from '../app/api/receipts/[filename]/route';
import { GET as getLegacyReceipt } from '../app/api/receipts/[...legacyPath]/route';
import { MAX_RECEIPT_BYTES, receiptBucket, receiptUser } from '../lib/firebase/receipt-security';
import { RATE_LIMITS } from '../lib/security/rate-limit';
import { exhaustRateLimit, failRateLimitStore, resetRateLimitStore } from './fixtures/rate-limit-store';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const userId = 'receipt-test-owner';
const transactionId = 'tx-123';
const auth = { authorization: 'Bearer test-id-token' };
const storedReceipt = { userId, transactionId, mimeType: 'image/png', originalName: 'receipt.png', storagePath: `receipts/${userId}/${transactionId}/receipt-id` };
function upload({ headers = auth as HeadersInit, file = new File([PNG], 'receipt.png', { type: 'image/png' }), id = transactionId, duplicate = false } = {}) {
  const body = new FormData();
  body.append('file', file);
  if (duplicate) body.append('file', file);
  body.append('transactionId', id);
  body.append('userId', 'ignored-attacker-supplied-owner');
  return new NextRequest('https://writeoff.example/api/upload-receipt', { method: 'POST', body, headers });
}
function getReceipt(filename = 'receipt-id', headers: HeadersInit = auth) {
  return GET(new NextRequest('https://writeoff.example/api/receipts/receipt-id', { headers }), { params: Promise.resolve({ filename }) });
}
function receipt(data = storedReceipt, exists = true) { mocks.get.mockResolvedValue({ exists, data: () => data }); }

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimitStore();
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', '');
  vi.stubEnv('FIREBASE_CONFIG', '');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'demo-receipts.appspot.com');
  delete mocks.storageOptions.storageBucket;
  mocks.getStorage.mockImplementation(app => {
    if (app !== mocks.adminApp) throw new Error('The default Firebase app does not exist');
    return { bucket: mocks.bucket, app: { options: mocks.storageOptions } };
  });
  mocks.verifyIdToken.mockResolvedValue({ uid: userId });
  mocks.verifySessionCookie.mockResolvedValue({ uid: userId });
  mocks.transaction.mockResolvedValue({ data: { trans_id: transactionId, userId }, error: null });
  mocks.collection.mockReturnValue({ doc: mocks.doc });
  mocks.doc.mockReturnValue({ create: mocks.create, get: mocks.get });
  mocks.bucket.mockReturnValue({ file: mocks.file });
  mocks.file.mockReturnValue({ save: mocks.save, delete: mocks.deleteFile, getMetadata: mocks.metadata, download: mocks.download });
  mocks.save.mockResolvedValue(undefined);
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue(undefined);
  mocks.metadata.mockResolvedValue([{ size: String(PNG.length) }]);
  mocks.download.mockResolvedValue([PNG]);
  receipt();
});
afterEach(() => vi.unstubAllEnvs());

describe('receipt authentication and upload boundaries', () => {
  it('uses the shared named Admin app when no default app exists', () => {
    receiptBucket();
    expect(mocks.getStorage).toHaveBeenCalledWith(mocks.adminApp);
    expect(mocks.bucket).toHaveBeenCalledWith('demo-receipts.appspot.com');
  });
  it('requires authentication before parsing or touching private data', async () => {
    expect((await POST(upload({ headers: {} }))).status).toBe(401);
    expect((await getReceipt('receipt-id', {})).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it('verifies browser session cookies with revocation checks', async () => {
    const response = await POST(upload({ headers: { cookie: '__session=test-session', origin: 'https://writeoff.example' } }));
    expect(response.status).toBe(200);
    expect(mocks.verifySessionCookie).toHaveBeenCalledWith('test-session', true);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect((await getReceipt('receipt-id', { cookie: '__session=test-session' })).status).toBe(200);
  });
  it('rejects invalid credentials rather than falling back to another identity', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('private token diagnostics'));
    const response = await POST(upload({ headers: { ...auth, cookie: '__session=test-session' } }));
    expect(response.status).toBe(401);
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('diagnostics');
  });
  it.each(['https://attacker.example', 'null'])('blocks cross-site cookie uploads from %s', async origin => {
    expect((await POST(upload({ headers: { cookie: '__session=test-session', origin } }))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('also rejects cross-site fetch metadata without an Origin header', async () => {
    expect((await POST(upload({ headers: { cookie: '__session=test-session', 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
  });
  it('returns 401 for malformed Bearer headers and revoked sessions', async () => {
    expect(await receiptUser(new NextRequest('https://writeoff.example', { headers: { authorization: 'Basic ignored' } }))).toBeNull();
    mocks.verifySessionCookie.mockRejectedValue(new Error('revoked'));
    expect((await getReceipt('receipt-id', { cookie: '__session=revoked' })).status).toBe(401);
  });
  it('checks ownership using the authenticated UID and never writes for someone else’s transaction', async () => {
    mocks.transaction.mockResolvedValue({ data: null, error: null });
    expect((await POST(upload())).status).toBe(404);
    expect(mocks.transaction).toHaveBeenCalledWith(userId, transactionId);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('fails closed when transaction lookup fails', async () => {
    mocks.transaction.mockResolvedValue({ data: null, error: new Error('database credentials') });
    const response = await POST(upload());
    expect(response.status).toBe(503);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('credentials');
  });
  it('refuses uploads over the durable per-owner window with Retry-After before reading the file', async () => {
    await exhaustRateLimit(RATE_LIMITS.receiptUpload, userId);
    const response = await POST(upload());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', error: expect.stringContaining('Too many receipt uploads') });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    // Another owner's window is untouched.
    mocks.verifyIdToken.mockResolvedValue({ uid: 'other-receipt-owner' });
    mocks.transaction.mockResolvedValue({ data: { trans_id: transactionId, userId: 'other-receipt-owner' }, error: null });
    expect((await POST(upload())).status).toBe(200);
  });
  it('refuses uploads rather than running unmetered when the limiter store is unreachable', async () => {
    failRateLimitStore();
    const response = await POST(upload());
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['../another/user', '', 'x'.repeat(257)])('rejects an invalid transaction identifier', async id => {
    expect((await POST(upload({ id }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects multiple files and mislabeled active content', async () => {
    expect((await POST(upload({ duplicate: true }))).status).toBe(400);
    const spoof = new File(['<script>alert(1)</script>'], 'receipt.png', { type: 'image/png' });
    expect((await POST(upload({ file: spoof }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects empty, unsupported and excessive files', async () => {
    expect((await POST(upload({ file: new File([], 'empty.png', { type: 'image/png' }) }))).status).toBe(400);
    expect((await POST(upload({ file: new File(['<svg/>'], 'receipt.svg', { type: 'image/svg+xml' }) }))).status).toBe(400);
    expect((await POST(upload({ file: new File([Buffer.alloc(MAX_RECEIPT_BYTES + 1)], 'large.png', { type: 'image/png' }) }))).status).toBe(413);
  });
  it('bounds actual request bytes without Content-Length and rejects malformed multipart', async () => {
    const response = await POST(new NextRequest('https://writeoff.example/api/upload-receipt', {
      method: 'POST', headers: { ...auth, 'content-type': 'multipart/form-data; boundary=receipt' }, body: Buffer.alloc(MAX_RECEIPT_BYTES + 128 * 1024 + 1),
    }));
    expect(response.status).toBe(413);
    const invalid = await POST(new NextRequest('https://writeoff.example/api/upload-receipt', { method: 'POST', headers: { ...auth, 'content-type': 'multipart/form-data; boundary=receipt' }, body: 'broken' }));
    expect(invalid.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('stores bytes privately and returns one route segment with metadata-only Firestore storage', async () => {
    const response = await POST(upload());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.receiptUrl).toMatch(/^\/api\/receipts\/[0-9a-f-]{36}$/);
    expect(mocks.bucket).toHaveBeenCalledWith('demo-receipts.appspot.com');
    expect(mocks.save).toHaveBeenCalledWith(PNG, expect.objectContaining({ metadata: expect.objectContaining({ cacheControl: 'private, no-store, max-age=0' }) }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId, transactionId, storagePath: expect.stringContaining(`receipts/${userId}/${transactionId}/`) }));
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('dataUrl');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('cleans up the stored object when its metadata cannot be saved', async () => {
    mocks.create.mockRejectedValue(new Error('sensitive internal payload'));
    const response = await POST(upload());
    expect(response.status).toBe(500);
    expect(mocks.deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(await response.text()).not.toContain('sensitive');
  });
});

describe('private receipt downloads', () => {
  it('never reads bytes for another owner, even when the receipt ID is known', async () => {
    receipt({ ...storedReceipt, userId: 'other-owner' });
    expect((await getReceipt()).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('returns private, non-sniffable owner downloads with sanitized filenames', async () => {
    receipt({ ...storedReceipt, originalName: 'receipt"\r\nX-Evil: yes.png' });
    const response = await getReceipt();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('vary')).toBe('Cookie, Authorization');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-evil')).toBeNull();
    expect(mocks.download).toHaveBeenCalledWith({ start: 0, end: MAX_RECEIPT_BYTES });
  });
  it('preserves existing base64 receipt reads', async () => {
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ userId, transactionId, mimeType: 'image/png', originalName: 'legacy.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }) });
    const response = await getReceipt();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(mocks.bucket).not.toHaveBeenCalled();
  });
  it.each(['../secret', 'other-user/tx/receipt.png', 'receipts/other-user/tx/receipt.png'])('rejects unauthorized or malformed legacy paths %s', async filename => {
    expect((await getReceipt(filename)).status).toBe(404);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it('rejects Storage path ownership mismatches even in an owned metadata record', async () => {
    receipt({ ...storedReceipt, storagePath: 'receipts/other-owner/tx/file' });
    expect((await getReceipt()).status).toBe(404);
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it('rejects over-limit stored objects and invalid legacy content', async () => {
    mocks.metadata.mockResolvedValue([{ size: MAX_RECEIPT_BYTES + 1 }]);
    expect((await getReceipt()).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ userId, mimeType: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from('<html>private</html>').toString('base64')}` }) });
    expect((await getReceipt()).status).toBe(404);
  });
});


describe('receipt bucket configuration and legacy URL compatibility', () => {
  it('fails closed without bucket configuration instead of choosing production', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', '');
    vi.stubEnv('GCLOUD_PROJECT', 'demo-writeoff-testing');
    expect(() => receiptBucket()).toThrow('Receipt storage is not configured');
    expect(mocks.bucket).not.toHaveBeenCalled();
    expect((await POST(upload())).status).toBe(503);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('supports the initialized Admin app bucket and Hosting FIREBASE_CONFIG', () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', '');
    mocks.storageOptions.storageBucket = 'demo-admin.appspot.com';
    receiptBucket();
    expect(mocks.bucket).toHaveBeenLastCalledWith('demo-admin.appspot.com');
    delete mocks.storageOptions.storageBucket;
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-hosting', storageBucket: 'demo-hosting.firebasestorage.app' }));
    receiptBucket();
    expect(mocks.bucket).toHaveBeenLastCalledWith('demo-hosting.firebasestorage.app');
  });
  it('forwards existing three-segment receipt URLs through the owner-checked download handler', async () => {
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ userId, transactionId, mimeType: 'image/png', originalName: 'legacy.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }) });
    const response = await getLegacyReceipt(new NextRequest('https://writeoff.example/api/receipts/legacy', { headers: auth }), { params: Promise.resolve({ legacyPath: [userId, transactionId, 'legacy.png'] }) });
    expect(response.status).toBe(200);
    expect(mocks.doc).toHaveBeenCalledWith(`${userId}/${transactionId}/legacy.png`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects another user’s legacy path before looking up receipt metadata', async () => {
    const response = await getLegacyReceipt(new NextRequest('https://writeoff.example/api/receipts/legacy', { headers: auth }), { params: Promise.resolve({ legacyPath: ['other-user', transactionId, 'legacy.png'] }) });
    expect(response.status).toBe(404);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it('rejects malformed legacy paths and unauthenticated legacy downloads', async () => {
    expect((await getLegacyReceipt(new NextRequest('https://writeoff.example', { headers: auth }), { params: Promise.resolve({ legacyPath: [userId, 'file'] }) })).status).toBe(404);
    expect((await getLegacyReceipt(new NextRequest('https://writeoff.example'), { params: Promise.resolve({ legacyPath: [userId, transactionId, 'legacy.png'] }) })).status).toBe(401);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
});
