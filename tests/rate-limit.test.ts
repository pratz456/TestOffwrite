import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ failure: null as Error | null }));
vi.mock('@/lib/firebase/admin', async () => {
  const { createFakeFirestore } = await import('./fixtures/fake-firestore');
  return { adminDb: createFakeFirestore({ failure: () => state.failure }) };
});
import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import {
  anonymousRateLimitKey, clearRateLimitMemory, enforceRateLimit, peekRateLimit, RATE_LIMIT_COLLECTION, RATE_LIMITS,
  rateLimitKeyHash, rateLimitResponse, refundRateLimit, type RateLimitOptions,
} from '@/lib/security/rate-limit';

const db = adminDb as unknown as FakeFirestore;
const start = new Date('2026-09-17T12:00:00.000Z');
let sequence = 0;
function options(overrides: Partial<RateLimitOptions> = {}): RateLimitOptions {
  return { scope: 'test.scope', key: `owner-${++sequence}`, limit: 3, windowMs: 60_000, onUnavailable: 'deny', ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
  state.failure = null;
  db.records.clear();
  clearRateLimitMemory();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('rate limit keys', () => {
  it('hashes scope and owner into a stable 64-hex document ID that never contains the raw key', () => {
    const hash = rateLimitKeyHash('auth.session', 'ip:203.0.113.9');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(rateLimitKeyHash('auth.session', 'ip:203.0.113.9'));
    expect(hash).not.toBe(rateLimitKeyHash('receipt.upload', 'ip:203.0.113.9'));
    expect(hash).not.toBe(rateLimitKeyHash('auth.session', 'ip:203.0.113.10'));
    expect(hash).not.toContain('203.0.113');
  });
  it('uses an HMAC when RATE_LIMIT_HASH_SECRET is configured', () => {
    const plain = rateLimitKeyHash('auth.session', 'owner');
    vi.stubEnv('RATE_LIMIT_HASH_SECRET', 'synthetic-secret');
    const keyed = rateLimitKeyHash('auth.session', 'owner');
    expect(keyed).toMatch(/^[a-f0-9]{64}$/);
    expect(keyed).not.toBe(plain);
  });
  it('derives anonymous keys from a hashed forwarded address', () => {
    const key = anonymousRateLimitKey(new Request('https://writeoff.test/api/auth/session', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }));
    expect(key).toMatch(/^ip:[a-f0-9]{32}$/);
    expect(key).not.toContain('203.0.113.9');
    expect(key).toBe(anonymousRateLimitKey(new Request('https://writeoff.test/', { headers: { 'x-forwarded-for': '203.0.113.9' } })));
    expect(key).not.toBe(anonymousRateLimitKey(new Request('https://writeoff.test/', { headers: { 'x-real-ip': '203.0.113.10' } })));
    expect(anonymousRateLimitKey(new Request('https://writeoff.test/'))).toBe(anonymousRateLimitKey(new Request('https://writeoff.test/other')));
  });
  it('rejects unusable configuration instead of silently allowing everything', async () => {
    await expect(enforceRateLimit(options({ limit: 0 }))).rejects.toThrow('positive integer');
    await expect(enforceRateLimit(options({ windowMs: 10 }))).rejects.toThrow('one second');
    await expect(enforceRateLimit(options({ key: '' }))).rejects.toThrow('key');
    await expect(enforceRateLimit({ ...options(), onUnavailable: 'sometimes' as never })).rejects.toThrow('policy');
  });
  it('ships every route policy with a valid limit, window and explicit unavailability policy', () => {
    for (const policy of Object.values(RATE_LIMITS)) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowMs).toBeGreaterThanOrEqual(60_000);
      expect(['allow', 'memory', 'deny']).toContain(policy.onUnavailable);
    }
    expect(RATE_LIMITS.sessionCreate.onUnavailable).toBe('memory');
    for (const name of ['receiptUpload', 'receiptProcess', 'aiAnalyzeTransaction', 'userExport', 'userDelete', 'stripeCheckout', 'stripePortal', 'plaidLinkToken'] as const) {
      expect(RATE_LIMITS[name].onUnavailable).toBe('deny');
    }
  });
});

describe('durable fixed window', () => {
  it('counts down remaining requests and denies with a Retry-After for the rest of the window', async () => {
    const config = options();
    const results = [];
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(new Date(start.getTime() + i * 1_000));
      results.push(await enforceRateLimit(config));
    }
    expect(results.map(result => [result.allowed, result.remaining, result.retryAfterSeconds])).toEqual([
      [true, 2, 0], [true, 1, 0], [true, 0, 0], [false, 0, 57],
    ]);
    expect(results.every(result => result.source === 'firestore' && !result.unavailable && result.limit === 3)).toBe(true);
    expect(results.every(result => result.resetAt === start.getTime() + 60_000)).toBe(true);
  });
  it('stores only hashed IDs, counts and a TTL timestamp; never the owner key', async () => {
    const config = options({ key: 'ip:203.0.113.9' });
    await enforceRateLimit(config);
    const [path, document] = [...db.records][0];
    expect(path).toBe(`${RATE_LIMIT_COLLECTION}/${rateLimitKeyHash(config.scope, config.key)}`);
    expect(Object.keys(document).sort()).toEqual(['count', 'expiresAt', 'scope', 'updatedAt', 'windowStart']);
    expect(document).toMatchObject({ scope: 'test.scope', windowStart: start.getTime(), count: 1 });
    expect(document.expiresAt).toBeInstanceOf(Date);
    expect(document.expiresAt.getTime()).toBeGreaterThanOrEqual(start.getTime() + config.windowMs);
    expect(JSON.stringify(document)).not.toContain('203.0.113');
  });
  it('starts a fresh window after rollover instead of carrying the exhausted count', async () => {
    const config = options();
    for (let i = 0; i < 3; i++) await enforceRateLimit(config);
    expect((await enforceRateLimit(config)).allowed).toBe(false);
    vi.setSystemTime(new Date(start.getTime() + config.windowMs));
    const fresh = await enforceRateLimit(config);
    expect(fresh).toMatchObject({ allowed: true, remaining: 2, resetAt: start.getTime() + 2 * config.windowMs });
  });
  it('isolates scopes and owners', async () => {
    const owner = options({ limit: 1 });
    await enforceRateLimit(owner);
    expect((await enforceRateLimit(owner)).allowed).toBe(false);
    expect((await enforceRateLimit({ ...owner, key: 'someone-else' })).allowed).toBe(true);
    expect((await enforceRateLimit({ ...owner, scope: 'other.scope' })).allowed).toBe(true);
  });
  it('peeks without consuming and reports the same window', async () => {
    const config = options({ limit: 2 });
    expect(await peekRateLimit(config)).toMatchObject({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
    expect(db.records.size).toBe(0);
    await enforceRateLimit(config); await enforceRateLimit(config);
    vi.setSystemTime(new Date(start.getTime() + 30_000));
    expect(await peekRateLimit(config)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    expect((await enforceRateLimit(config)).allowed).toBe(false);
  });
  it('refunds a consumed request only within the same window', async () => {
    const config = options({ limit: 1 });
    const consumed = await enforceRateLimit(config);
    expect((await enforceRateLimit(config)).allowed).toBe(false);
    expect(await refundRateLimit(config, consumed)).toBe(true);
    expect((await peekRateLimit(config)).remaining).toBe(1);
    const second = await enforceRateLimit(config);
    vi.setSystemTime(new Date(start.getTime() + config.windowMs + 1_000));
    const next = await enforceRateLimit(config);
    expect(await refundRateLimit(config, second)).toBe(true);
    expect((await peekRateLimit(config))).toMatchObject({ remaining: 0, resetAt: next.resetAt });
    expect(await refundRateLimit(config, { ...next, allowed: false })).toBe(false);
  });
});

describe('store unavailability policies', () => {
  it('fails closed for deny with a bounded retry and marks the decision as a policy result', async () => {
    state.failure = new Error('firestore unavailable');
    const result = await enforceRateLimit(options({ onUnavailable: 'deny' }));
    expect(result).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 30, source: 'policy', unavailable: true });
    expect(db.records.size).toBe(0);
  });
  it('fails open for allow', async () => {
    state.failure = new Error('firestore unavailable');
    expect(await enforceRateLimit(options({ onUnavailable: 'allow' }))).toMatchObject({ allowed: true, remaining: 3, source: 'policy', unavailable: true });
    expect(await peekRateLimit(options({ onUnavailable: 'allow' }))).toMatchObject({ allowed: true, source: 'policy', unavailable: true });
  });
  it('keeps a per-instance memory window for memory, then resumes the durable store', async () => {
    state.failure = new Error('firestore unavailable');
    const config = options({ onUnavailable: 'memory', limit: 2 });
    expect(await enforceRateLimit(config)).toMatchObject({ allowed: true, remaining: 1, source: 'memory', unavailable: true });
    expect(await enforceRateLimit(config)).toMatchObject({ allowed: true, remaining: 0, source: 'memory' });
    expect(await enforceRateLimit(config)).toMatchObject({ allowed: false, retryAfterSeconds: 60, source: 'memory' });
    state.failure = null;
    expect(await enforceRateLimit(config)).toMatchObject({ allowed: true, remaining: 1, source: 'firestore', unavailable: false });
  });
  it('treats a malformed store answer or a hung transaction as unavailable', async () => {
    const original = db.runTransaction;
    db.runTransaction = (async () => undefined) as typeof db.runTransaction;
    try {
      expect(await enforceRateLimit(options({ onUnavailable: 'deny' }))).toMatchObject({ allowed: false, source: 'policy', unavailable: true });
    } finally { db.runTransaction = original; }
    const doc = db.doc;
    db.doc = (() => { throw new TypeError('adminDb.doc is not a function'); }) as typeof db.doc;
    try {
      expect(await enforceRateLimit(options({ onUnavailable: 'memory' }))).toMatchObject({ allowed: true, source: 'memory', unavailable: true });
    } finally { db.doc = doc; }
  });
  it('never refunds a policy decision', async () => {
    state.failure = new Error('firestore unavailable');
    const result = await enforceRateLimit(options({ onUnavailable: 'allow' }));
    expect(await refundRateLimit(options(), result)).toBe(false);
  });
});

describe('rate limit responses', () => {
  it('returns 429 RATE_LIMITED with Retry-After and no owner material', async () => {
    const config = options({ limit: 1, key: 'ip:203.0.113.9' });
    await enforceRateLimit(config);
    vi.setSystemTime(new Date(start.getTime() + 15_500));
    const response = rateLimitResponse(await enforceRateLimit(config));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toEqual({ code: 'RATE_LIMITED', error: 'Too many requests. Please try again later.', retryAfter: 45 });
    expect(JSON.stringify(body)).not.toContain('203.0.113');
  });
  it('keeps route-specific codes and messages', async () => {
    const config = options({ limit: 1 });
    await enforceRateLimit(config);
    const response = rateLimitResponse(await enforceRateLimit(config), { code: 'AI_RATE_LIMITED', error: 'Analysis request limit reached.' });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'AI_RATE_LIMITED', error: 'Analysis request limit reached.' });
  });
  it('returns 503 RATE_LIMIT_UNAVAILABLE when a deny policy refused without a store answer', async () => {
    state.failure = new Error('firestore unavailable');
    const response = rateLimitResponse(await enforceRateLimit(options({ onUnavailable: 'deny' })));
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE', retryAfter: 30 });
  });
});
