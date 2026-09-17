import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => ({ verifyIdToken: vi.fn(), verifySessionCookie: vi.fn(), createSessionCookie: vi.fn(), get: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ adminAuth: mock, adminDb: { doc: vi.fn(() => ({ get: mock.get })), runTransaction: mock.transaction }, FieldValue: { serverTimestamp: () => 'server-time' } }));
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { POST as session } from '@/app/api/auth/session/route';
import { GET as profileGet, POST as profilePost } from '@/app/api/database/profiles/route';

function request(headers: Record<string, string> = {}, method = 'GET', body?: unknown) {
  return new NextRequest('https://writeoff.test/api/test', { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.verifyIdToken.mockResolvedValue({ uid: 'owner', email_verified: true });
  mock.verifySessionCookie.mockResolvedValue({ uid: 'session-owner', email_verified: true });
  mock.createSessionCookie.mockResolvedValue('verified-session');
  mock.get.mockResolvedValue({ exists: true, data: () => ({ name: 'Owner', stripeCustomerId: 'secret-customer', plaid_token: 'secret-bank-token' }) });
});

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
});

describe('server profile API boundaries', () => {
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
});
