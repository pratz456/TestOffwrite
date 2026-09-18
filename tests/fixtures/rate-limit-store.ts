/**
 * In-memory replacement for `@/lib/security/rate-limit-store`, so route tests
 * exercise the real limiter against a store that is independent of the route's
 * own Admin SDK doubles. Mock it with:
 *
 *   vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
 *
 * Import the same module from the test to inspect or reset the windows.
 */
import { createFakeFirestore, type FakeFirestore } from './fake-firestore';

const state: { failure: Error | null } = { failure: null };

/** Fresh windows per test file; `resetRateLimitStore()` clears them between tests. */
export const fakeRateLimitFirestore: FakeFirestore = createFakeFirestore({ failure: () => state.failure });

export async function rateLimitStore(): Promise<FakeFirestore> {
  return fakeRateLimitFirestore;
}

export function resetRateLimitStore(): void {
  fakeRateLimitFirestore.records.clear();
  state.failure = null;
}

/** Makes every store read and transaction throw, simulating an unreachable database. */
export function failRateLimitStore(error: Error | null = new Error('rate limit store unavailable')): void {
  state.failure = error;
}

/**
 * Seeds an owner's current window at its limit so the next request is refused,
 * without replaying `limit` requests through the route.
 */
export async function exhaustRateLimit(policy: { scope: string; limit: number; windowMs: number }, key: string, now = Date.now()): Promise<void> {
  // Imported on demand: this module is loaded from inside the limiter's own import graph.
  const { rateLimitKeyHash } = await import('@/lib/security/rate-limit');
  fakeRateLimitFirestore.records.set(`rate_limits/${rateLimitKeyHash(policy.scope, key)}`, {
    scope: policy.scope, windowStart: now, count: policy.limit, expiresAt: new Date(now + policy.windowMs), updatedAt: new Date(now),
  });
}

/** Number of consumed requests recorded for a scope across all owners. */
export function recordedRateLimitCount(scope: string): number {
  let total = 0;
  for (const [path, data] of fakeRateLimitFirestore.records) {
    if (path.startsWith('rate_limits/') && data.scope === scope) total += Number(data.count) || 0;
  }
  return total;
}
