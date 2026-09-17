import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ sync: vi.fn(), findUser: vi.fn(), doc: vi.fn(), receiptSet: vi.fn(), receipts: new Map<string, unknown>() }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactionsIncremental: mock.sync, findUserByPlaidItemId: mock.findUser }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: mock.doc } }));
vi.mock('@/lib/plaid/config', () => ({ getPlaidConfig: () => ({ plaidClientId: 'test-client', plaidSecret: 'test-secret', plaidEnv: 'sandbox' }) }));
import { POST } from '@/app/api/plaid/webhook/route';

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'route-test-key', alg: 'ES256', use: 'sig', expired_at: null };
const payload = { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'sandbox-item' };
function request(body: string, signedBody?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signedBody !== undefined) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'ES256', kid: key.kid })}.${encode({ iat: Math.floor(Date.now() / 1000), request_body_sha256: createHash('sha256').update(signedBody).digest('hex') })}`;
    headers['plaid-verification'] = `${input}.${sign('sha256', Buffer.from(input), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  return new NextRequest('https://writeoff.test/api/plaid/webhook', { method: 'POST', body, headers });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.receipts.clear();
  mock.doc.mockImplementation((path: string) => ({
    get: async () => ({ exists: mock.receipts.has(path) }),
    set: async (data: unknown) => { mock.receiptSet(path, data); mock.receipts.set(path, data); },
  }));
  mock.findUser.mockResolvedValue('test-user');
  mock.sync.mockResolvedValue({ success: true, transactionsSaved: 2 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ key }))));
});
afterEach(() => vi.unstubAllGlobals());
describe('Plaid webhook authentication boundary', () => {
  it('syncs the verified item after validating an authentic ES256 JWK signature', async () => {
    const body = JSON.stringify(payload);
    const response = await POST(request(body, body));
    expect(response.status).toBe(200);
    expect(mock.findUser).toHaveBeenCalledWith('sandbox-item');
    expect(mock.sync).toHaveBeenCalledWith('test-user', 'sandbox-item');
  });
  it('rejects unsigned requests before item lookup or data writes, including development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(401);
    vi.unstubAllEnvs();
    expect(mock.findUser).not.toHaveBeenCalled();
    expect(mock.sync).not.toHaveBeenCalled();
    expect(mock.doc).not.toHaveBeenCalled();
  });
  it('rejects tampered payloads before item lookup or sync', async () => {
    expect((await POST(request(JSON.stringify({ ...payload, item_id: 'different-item' }), JSON.stringify(payload)))).status).toBe(401);
    expect(mock.findUser).not.toHaveBeenCalled();
    expect(mock.sync).not.toHaveBeenCalled();
  });
  it.each(['INITIAL_UPDATE', 'HISTORICAL_UPDATE', 'DEFAULT_UPDATE'])('syncs the exact item for %s', async webhook_code => {
    const body = JSON.stringify({ ...payload, webhook_code });
    expect((await POST(request(body, body))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledWith('test-user', 'sandbox-item');
    expect(mock.receiptSet.mock.calls[0][1]).toMatchObject({ webhook_code, signature_verified: true });
  });
  it('stores a safe receipt without webhook_id and skips replay of the same signed delivery', async () => {
    const body = JSON.stringify(payload);
    const firstRequest = request(body, body);
    const headers = new Headers(firstRequest.headers);
    expect((await POST(firstRequest)).status).toBe(200);
    expect((await POST(new NextRequest('https://writeoff.test/api/plaid/webhook', { method: 'POST', body, headers }))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledTimes(1);
    expect(mock.receiptSet).toHaveBeenCalledTimes(1);
    const [path, receipt] = mock.receiptSet.mock.calls[0];
    expect(path).toMatch(/^processed_webhooks\/plaid_[a-f0-9]{64}$/);
    expect(receipt).toEqual({ provider: 'plaid', signature_verified: true, processed_at: expect.any(Number),
      item_id: 'sandbox-item', user_id: 'test-user', webhook_code: 'SYNC_UPDATES_AVAILABLE', transactions_saved: 2 });
    expect(JSON.stringify(receipt)).not.toContain(headers.get('plaid-verification'));
  });
  it.each([undefined, 'provider-delivery'])('retries failed sync before recording receipt (webhook_id=%s)', async webhook_id => {
    const body = JSON.stringify({ ...payload, webhook_id });
    const signed = request(body, body);
    const headers = new Headers(signed.headers);
    mock.sync.mockResolvedValueOnce({ success: false, transactionsSaved: 0, error: 'Temporary failure' });
    expect((await POST(signed)).status).toBe(500);
    expect(mock.receiptSet).not.toHaveBeenCalled();
    expect((await POST(new NextRequest('https://writeoff.test/api/plaid/webhook', { method: 'POST', body, headers }))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledTimes(2);
    expect(mock.receiptSet).toHaveBeenCalledTimes(1);
  });
  it('allows later independently signed updates with the same body to sync', async () => {
    const body = JSON.stringify(payload);
    expect((await POST(request(body, body))).status).toBe(200);
    expect((await POST(request(body, body))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledTimes(2);
    expect(mock.receiptSet).toHaveBeenCalledTimes(2);
  });
  it('deduplicates a provider webhook_id even when delivery is re-signed', async () => {
    const body = JSON.stringify({ ...payload, webhook_id: 'provider-delivery' });
    expect((await POST(request(body, body))).status).toBe(200);
    expect((await POST(request(body, body))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledTimes(1);
  });
  it('keeps a delivery retryable if saving its success receipt fails', async () => {
    const body = JSON.stringify({ ...payload, webhook_id: 'receipt-write-retry' });
    mock.receiptSet.mockImplementationOnce(() => { throw new Error('Temporary database failure'); });
    expect((await POST(request(body, body))).status).toBe(500);
    expect(mock.receipts.size).toBe(0);
    expect((await POST(request(body, body))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledTimes(2);
    expect(mock.receipts.size).toBe(1);
  });
});
