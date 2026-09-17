import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPlaidWebhookVerifier } from '@/lib/plaid/webhook-verification';

const now = 1_800_000_000_000;
const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'sandbox-item' }, null, 2);
const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const otherPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'ES256', use: 'sig', created_at: now / 1000 - 60, expired_at: null };
function jwt(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}, privateKey = pair.privateKey) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'ES256', kid: jwk.kid, typ: 'JWT', ...header })}.${encode({ iat: now / 1000,
    request_body_sha256: createHash('sha256').update(body).digest('hex'), ...payload })}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function setup(key: unknown = jwk) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key }), { status: 200 }));
  let currentTime = now;
  const verify = createPlaidWebhookVerifier({ fetcher, now: () => currentTime,
    config: () => ({ plaidClientId: 'sandbox-client', plaidSecret: 'sandbox-secret', plaidEnv: 'sandbox' }) });
  return { verify, fetcher, setTime: (value: number) => { currentTime = value; } };
}

describe('Plaid ES256 webhook verification', () => {
  it('accepts a real ES256 JWT against Plaid’s JWK response and caches the verified key', async () => {
    const test = setup();
    expect(await test.verify(body, jwt())).toBe(true);
    expect(await test.verify(body, jwt())).toBe(true);
    expect(test.fetcher).toHaveBeenCalledTimes(1);
    expect(test.fetcher.mock.calls[0][0]).toBe('https://sandbox.plaid.com/webhook_verification_key/get');
    expect(JSON.parse(test.fetcher.mock.calls[0][1].body)).toEqual({ client_id: 'sandbox-client', secret: 'sandbox-secret', key_id: 'test-key' });
  });
  it('rejects a signature from another private key', async () => {
    expect(await setup().verify(body, jwt({}, {}, otherPair.privateKey))).toBe(false);
  });
  it('rejects changed body bytes, including whitespace', async () => {
    const test = setup();
    expect(await test.verify(`${body}\n`, jwt())).toBe(false);
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '1800000000', now / 1000 - 301, now / 1000 + 1])('rejects invalid or stale/future iat %s', async iat => {
    const test = setup();
    expect(await test.verify(body, jwt({ iat }))).toBe(false);
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it('accepts the five-minute age boundary', async () => {
    expect(await setup().verify(body, jwt({ iat: now / 1000 - 300 }))).toBe(true);
  });
  it.each(['none', 'HS256', 'RS256'])('rejects the wrong algorithm %s before key lookup', async alg => {
    const test = setup();
    expect(await test.verify(body, jwt({}, { alg }))).toBe(false);
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it.each([now / 1000 - 1, now / 1000, undefined, 'expired'])('rejects an expired or invalid key expiry %s', async expired_at => {
    expect(await setup({ ...jwk, expired_at }).verify(body, jwt())).toBe(false);
  });
  it('rechecks a cached key’s expiry on later requests', async () => {
    const test = setup({ ...jwk, expired_at: now / 1000 + 30 });
    expect(await test.verify(body, jwt())).toBe(true);
    test.setTime(now + 30_000);
    expect(await test.verify(body, jwt({ iat: now / 1000 + 30 }))).toBe(false);
    expect(test.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ kid: 'wrong-key' }, { crv: 'P-384' }, { alg: 'HS256' }, { kty: 'RSA' }, { use: 'enc' }])('rejects inconsistent JWK metadata %j', async patch => {
    expect(await setup({ ...jwk, ...patch }).verify(body, jwt())).toBe(false);
  });
  it.each([null, '', 'not.a.jwt', 'e30.e30.AAAA', 'a.b.c.d'])('rejects missing/malformed signatures %s', async token => {
    expect(await setup().verify(body, token)).toBe(false);
  });
  it.each([{ exp: now / 1000 }, { nbf: now / 1000 + 1 }, { request_body_sha256: 'bad' }])('rejects invalid claims %j', async claims => {
    expect(await setup().verify(body, jwt(claims))).toBe(false);
  });
  it('fails closed when the provider key lookup fails', async () => {
    const test = setup();
    test.fetcher.mockResolvedValue(new Response('{}', { status: 500 }));
    expect(await test.verify(body, jwt())).toBe(false);
    test.fetcher.mockRejectedValue(new Error('unavailable'));
    expect(await test.verify(body, jwt())).toBe(false);
  });
});
