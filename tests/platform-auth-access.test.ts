import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => ({ verifyIdToken: vi.fn(), verifySessionCookie: vi.fn(), createSessionCookie: vi.fn(), get: vi.fn(), set: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ adminAuth: mock, adminDb: { doc: vi.fn(() => ({ get: mock.get, update: mock.update })), runTransaction: mock.transaction }, FieldValue: { serverTimestamp: () => 'server-time', delete: () => 'delete-field' } }));
vi.mock('@/lib/plaid/connections', () => ({ migrateLegacyPlaidConnection: vi.fn() }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { POST as session } from '@/app/api/auth/session/route';
import { GET as profileGet, POST as profilePost } from '@/app/api/database/profiles/route';
import { anonymousRateLimitKey, clearRateLimitMemory, RATE_LIMITS } from '@/lib/security/rate-limit';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';
import { DOCUMENT_IMPORT_CONSENT_VERSION } from '@/lib/onboarding/document-import-consent';
import { exhaustRateLimit, failRateLimitStore, fakeRateLimitFirestore, recordedRateLimitCount, resetRateLimitStore } from './fixtures/rate-limit-store';

function request(headers: Record<string, string> = {}, method = 'GET', body?: unknown) {
  return new NextRequest('https://writeoff.test/api/test', { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitStore();
  clearRateLimitMemory();
  mock.verifyIdToken.mockResolvedValue({ uid: 'owner', email_verified: true });
  mock.verifySessionCookie.mockResolvedValue({ uid: 'session-owner', email_verified: true });
  mock.createSessionCookie.mockResolvedValue('verified-session');
  mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner', stripeCustomerId: 'secret-customer', plaid_token: 'secret-bank-token' }) });
});
afterEach(() => vi.unstubAllEnvs());

function useRealAccountPreview() {
  for (const [name, value] of Object.entries({
    NODE_ENV: 'development', WRITEOFF_LOCAL_ACCOUNT_PREVIEW: 'true',
    WRITEOFF_ENV: 'local-account-preview', NEXT_PUBLIC_APP_ENV: 'local-account-preview',
    NEXT_PUBLIC_AUTO_SYNC_ON_VISIT: 'false', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-23910',
    FIREBASE_ADMIN_PROJECT_ID: 'writeoff-23910', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3002',
    WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL: 'owner@example.com', SSN_ENCRYPTION_KEY: '',
  })) vi.stubEnv(name, value);
  mock.verifyIdToken.mockResolvedValue({ uid: 'owner', email: 'owner@example.com', email_verified: true });
}

describe('verified API credentials and browser sessions', () => {
  it('verifies the hosting session cookie with revocation checking', async () => {
    expect((await getAuthenticatedUser(request({ cookie: '__session=session-cookie' }))).user?.uid).toBe('session-owner');
    expect(mock.verifySessionCookie).toHaveBeenCalledWith('session-cookie', true);
    expect(mock.verifyIdToken).not.toHaveBeenCalled();
  });
  it('uses an explicit bearer before a different session account', async () => {
    expect((await getAuthenticatedUser(request({ authorization: 'Bearer id', cookie: '__session=other' }))).user?.uid).toBe('owner');
    expect(mock.verifyIdToken).toHaveBeenCalledWith('id', true);
    expect(mock.verifySessionCookie).not.toHaveBeenCalled();
  });
  it.each(['', 'Basic id', 'Bearer ', 'Bearer a b'])('does not fall back from malformed explicit header %j', async authorization => {
    expect((await getAuthenticatedUser(request({ authorization, cookie: '__session=valid' }))).user).toBeNull();
    expect(mock.verifySessionCookie).not.toHaveBeenCalled();
  });
  it('does not fall back from a revoked bearer or expired session', async () => {
    mock.verifyIdToken.mockRejectedValue(new Error('revoked private diagnostic'));
    expect((await getAuthenticatedUser(request({ authorization: 'Bearer revoked', cookie: '__session=valid' }))).user).toBeNull();
    expect(mock.verifySessionCookie).not.toHaveBeenCalled();
    mock.verifySessionCookie.mockRejectedValue(new Error('expired'));
    expect((await getAuthenticatedUser(request({ cookie: '__session=expired; firebase-auth-token=valid' }))).user).toBeNull();
  });
  it('supports the legacy short-lived ID-token cookie', async () => {
    expect((await getAuthenticatedUser(request({ cookie: 'firebase-auth-token=id' }))).user?.uid).toBe('owner');
  });
  it('rejects cookie mutations from another origin', async () => {
    expect((await getAuthenticatedUser(request({ cookie: '__session=valid', origin: 'https://attacker.test' }, 'POST', {}))).user).toBeNull();
    expect(mock.verifySessionCookie).not.toHaveBeenCalled();
  });
  it('shares session support with legacy route helper', async () => {
    expect(await getUserFromReqOrThrow(request({ cookie: '__session=valid' }))).toEqual({ uid: 'session-owner' });
    await expect(getUserFromReqOrThrow(request())).rejects.toThrow('Authorization');
  });
  it('rejects unverified identities on protected APIs and session exchange', async () => {
    mock.verifyIdToken.mockResolvedValue({ uid: 'unverified', email_verified: false });
    expect((await getAuthenticatedUser(request({ authorization: 'Bearer id' }))).user).toBeNull();
    expect((await session(request({}, 'POST', { idToken: 'id' }))).status).toBe(403);
    expect(mock.createSessionCookie).not.toHaveBeenCalled();
  });
  it('creates only an HttpOnly long-lived session and clears the readable duplicate', async () => {
    const response = await session(request({ origin: 'https://writeoff.test' }, 'POST', { idToken: 'id' }));
    expect(response.status).toBe(200);
    expect(response.cookies.get('__session')).toMatchObject({ value: 'verified-session', httpOnly: true, sameSite: 'lax' });
    expect(response.cookies.get('firebase-auth-token')?.value).toBe('');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects cross-site login and malformed or invalid tokens', async () => {
    expect((await session(request({ origin: 'https://attacker.test' }, 'POST', { idToken: 'id' }))).status).toBe(403);
    expect((await session(request({}, 'POST', { idToken: {} }))).status).toBe(400);
    mock.verifyIdToken.mockRejectedValue(new Error('invalid'));
    expect((await session(request({}, 'POST', { idToken: 'invalid' }))).status).toBe(401);
  });
  it('returns a retryable error if session creation fails; no unverified fallback', async () => {
    mock.createSessionCookie.mockRejectedValue(new Error('service unavailable'));
    const response = await session(request({}, 'POST', { idToken: 'id' }));
    expect(response.status).toBe(503);
    expect(response.cookies.get('__session')).toBeUndefined();
  });
  it('throttles session minting per hashed client address across instances, before token verification', async () => {
    const attacker = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    await exhaustRateLimit(RATE_LIMITS.sessionCreate, anonymousRateLimitKey(request(attacker)));
    const response = await session(request(attacker, 'POST', { idToken: 'id' }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(mock.verifyIdToken).not.toHaveBeenCalled();
    expect(mock.createSessionCookie).not.toHaveBeenCalled();
    // Other addresses keep signing in, and the raw address is never persisted.
    expect((await session(request({ 'x-forwarded-for': '198.51.100.7' }, 'POST', { idToken: 'id' }))).status).toBe(200);
    expect(fakeRateLimitFirestore.records.size).toBe(2);
    expect(JSON.stringify([...fakeRateLimitFirestore.records])).not.toMatch(/203\.0\.113\.9|198\.51\.100\.7|10\.0\.0\.1/);
  });
  it('keeps sign-in available on a per-instance memory window when the limiter store is unreachable', async () => {
    failRateLimitStore();
    for (let attempt = 0; attempt < RATE_LIMITS.sessionCreate.limit; attempt += 1) {
      expect((await session(request({ 'x-forwarded-for': '192.0.2.44' }, 'POST', { idToken: 'id' }))).status).toBe(200);
    }
    expect((await session(request({ 'x-forwarded-for': '192.0.2.44' }, 'POST', { idToken: 'id' }))).status).toBe(429);
    expect(recordedRateLimitCount(RATE_LIMITS.sessionCreate.scope)).toBe(0);
  });
});

describe('server profile API boundaries', () => {
  it('reads a masked legacy EIN in real-account preview without migrating or writing it', async () => {
    useRealAccountPreview();
    mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner', ein: '12-3456789' }) });

    const response = await profileGet(request({ authorization: 'Bearer id' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, profile: { id: 'owner', name: 'Owner', ein: '**-***6789' } });
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.set).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('refuses EIN encryption without a real key in preview while allowing ordinary profile edits', async () => {
    useRealAccountPreview();
    mock.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => callback({ get: mock.get, set: mock.set }));
    mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner' }) });

    expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { ein: '12-3456789' }))).status).toBe(503);
    expect(mock.set).not.toHaveBeenCalled();
    expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { profession: 'Designer' }))).status).toBe(200);
    expect(mock.set).toHaveBeenCalledExactlyOnceWith(expect.anything(), { profession: 'Designer', updated_at: 'server-time' }, { merge: true });
  });
  it('preserves legacy EIN migration outside real-account preview using the configured key', async () => {
    vi.stubEnv('SSN_ENCRYPTION_KEY', '11'.repeat(32));
    mock.get.mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Owner', ein: '12-3456789' }) })
      .mockResolvedValue({ exists: true, data: () => ({ name: 'Owner', ein_last4: '6789' }) });

    const response = await profileGet(request({ authorization: 'Bearer id' }));

    expect(response.status).toBe(200);
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ ein: 'delete-field', ein_last4: '6789', ein_encrypted: expect.any(String) });
    expect(JSON.stringify(mock.update.mock.calls)).not.toContain('123456789');
    expect(await response.json()).toEqual({ success: true, profile: { id: 'owner', name: 'Owner', ein: '**-***6789' } });
  });
  it('returns editable fields without bank or billing credentials', async () => {
    const response = await profileGet(request({ authorization: 'Bearer id' }));
    expect(await response.json()).toEqual({ success: true, profile: { id: 'owner', name: 'Owner' } });
  });
  it.each(['subscriptionStatus', 'subscriptionPlan', 'stripeSubscriptionStatus', 'trialEnd', 'hasHistoricalAccess', 'plaid_token', 'userId'])('rejects client edits to %s before writes', async field => {
    expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { [field]: 'attacker-value' }))).status).toBe(400);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('represents a first-time profile as null and read failures as retryable errors', async () => {
    mock.get.mockResolvedValue({ exists: false });
    expect(await (await profileGet(request({ authorization: 'Bearer id' }))).json()).toEqual({ success: true, profile: null });
    mock.get.mockRejectedValue(new Error('private error'));
    expect((await profileGet(request({ authorization: 'Bearer id' }))).status).toBe(503);
  });
  it('encrypts a new EIN, returns only its mask, and never writes the plaintext field', async () => {
    vi.stubEnv('SSN_ENCRYPTION_KEY', '11'.repeat(32));
    mock.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => callback({ get: mock.get, set: mock.set }));
    mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner' }) });
    const response = await profilePost(request({ authorization: 'Bearer id' }, 'POST', { ein: '12-3456789' }));
    expect(response.status).toBe(200);
    const written = mock.set.mock.calls[0][1];
    expect(written.ein).toBe('delete-field');
    expect(written.ein_last4).toBe('6789');
    expect(written.ein_encrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(JSON.stringify(written)).not.toContain('123456789');

    mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner', ein_last4: '6789', ein_encrypted: written.ein_encrypted }) });
    expect(await (await profileGet(request({ authorization: 'Bearer id' }))).json()).toEqual({
      success: true,
      profile: { id: 'owner', name: 'Owner', ein: '**-***6789' },
    });
    vi.unstubAllEnvs();
  });

  describe('sign-up consent record', () => {
    const consents = { version: CONSENT_TERMS_VERSION, source: 'profile-setup', accepted_at: '2026-09-17T12:00:00Z', terms: true, bank_data: true, ai_review: true, communications: false };
    beforeEach(() => {
      mock.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<void>) => callback({ get: mock.get, set: mock.set }));
    });
    it('stores a validated record with a server timestamp on a first-time profile', async () => {
      mock.get.mockResolvedValue({ exists: false });
      const response = await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents }));
      expect(response.status).toBe(200);
      expect(mock.set).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        consents: { ...consents, accepted_at: '2026-09-17T12:00:00.000Z', document_import: false },
        consents_recorded_at: 'server-time', updated_at: 'server-time', created_at: 'server-time',
      }, { merge: true });
    });
    it('stores a signed §7216 document consent and removes the signature again on withdrawal', async () => {
      const signature = { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: '2026-09-18T09:00:00.000Z' };
      mock.get.mockResolvedValue({ exists: true, data: () => ({ consents }) });
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: { ...consents, document_import: true, document_import_signature: signature } }))).status).toBe(200);
      expect(mock.set).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
        consents: { ...consents, accepted_at: '2026-09-17T12:00:00.000Z', document_import: true, document_import_signature: signature },
      }), { merge: true });
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: { ...consents, document_import: true } }))).status).toBe(400);
      mock.get.mockResolvedValue({ exists: true, data: () => ({ consents: { ...consents, document_import: true, document_import_signature: signature } }) });
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: { ...consents, document_import: false } }))).status).toBe(200);
      expect(mock.set).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
        consents: { ...consents, accepted_at: '2026-09-17T12:00:00.000Z', document_import: false, document_import_signature: 'delete-field' },
      }), { merge: true });
    });
    it('carries a current §7216 signature into a re-acknowledgment of updated terms, but not into a same-version withdrawal', async () => {
      const signature = { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: '2026-09-18T09:00:00.000Z' };
      const previousTerms = { ...consents, version: '2026-09-17', terms: undefined, document_import: true, document_import_signature: signature };
      mock.get.mockResolvedValue({ exists: true, data: () => ({ consents: previousTerms }) });
      const reacknowledged = { ...consents, source: 'reacknowledgment', document_import: false };
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: reacknowledged }))).status).toBe(200);
      expect(mock.set).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
        consents: { ...reacknowledged, accepted_at: '2026-09-17T12:00:00.000Z', document_import: true, document_import_signature: signature },
      }), { merge: true });
      // A stale signature (earlier consent text) is not revived.
      mock.get.mockResolvedValue({ exists: true, data: () => ({ consents: { ...previousTerms, document_import_signature: { ...signature, version: '2025-01-01' } } }) });
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: reacknowledged }))).status).toBe(200);
      expect(mock.set).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
        consents: { ...reacknowledged, accepted_at: '2026-09-17T12:00:00.000Z', document_import: false, document_import_signature: 'delete-field' },
      }), { merge: true });
      // Same terms version: omitting the signature is the Settings withdrawal.
      mock.get.mockResolvedValue({ exists: true, data: () => ({ consents: { ...consents, source: 'reacknowledgment', document_import: true, document_import_signature: signature } }) });
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: reacknowledged }))).status).toBe(200);
      expect(mock.set).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
        consents: { ...reacknowledged, accepted_at: '2026-09-17T12:00:00.000Z', document_import: false, document_import_signature: 'delete-field' },
      }), { merge: true });
    });
    it.each([
      ['a missing required acknowledgment', { ...consents, ai_review: undefined }],
      ['a declined required acknowledgment', { ...consents, bank_data: false }],
      ['an unknown nested field', { ...consents, marketing_partner: true }],
      ['a stale terms version', { ...consents, version: '2025-01-01' }],
      ['a non-object value', 'agreed'],
    ])('rejects %s before any write', async (_label, value) => {
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents: value }))).status).toBe(400);
      expect(mock.transaction).not.toHaveBeenCalled();
    });
    it('never accepts the server timestamp from a client and returns the record with it', async () => {
      expect((await profilePost(request({ authorization: 'Bearer id' }, 'POST', { consents, consents_recorded_at: 'forged' }))).status).toBe(400);
      mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner', consents, consents_recorded_at: 'stamped', stripeCustomerId: 'secret-customer' }) });
      expect(await (await profileGet(request({ authorization: 'Bearer id' }))).json())
        .toEqual({ success: true, profile: { id: 'owner', name: 'Owner', consents, consents_recorded_at: 'stamped' } });
    });
  });
});
