/**
 * One-off maintenance routes (analysis fix and migration passes) hide
 * themselves in production like the debug routes, answer 404 before reading
 * any record, and outside production never echo a store error to the caller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractRequest, installApiRouteMocks } from './fixtures/api-route-harness';

const harness = installApiRouteMocks();
const ROUTES = [
  ['/api/fix-transaction-analysis', () => import('../app/api/fix-transaction-analysis/route')],
  ['/api/migrate-ai-analysis', () => import('../app/api/migrate-ai-analysis/route')],
] as const;

beforeEach(async () => {
  await harness.reset();
  harness.seedOwnerProfile();
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.stubEnv('NODE_ENV', 'test'); });

describe.each(ROUTES)('POST %s', (path, importRoute) => {
  it('answers 404 in production for anonymous and signed-in callers without touching the store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { POST } = await importRoute();
    for (const auth of ['anonymous', 'owner'] as const) {
      const response = await POST(contractRequest(path, { method: 'POST', auth, body: '{}' }));
      expect(response.status, auth).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    }
    expect(harness.auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it('runs for the owner outside production and reports a failing update without its detail', async () => {
    const marker = 'store-detail-51c2 at /srv/node_modules/firebase-admin/lib/index.js:1:1';
    // A record each pass wants to rewrite: analysed but missing the field the pass backfills.
    const transaction = { trans_id: 'tx-1', merchant_name: 'Acme', amount: 12, date: '2025-03-01', is_deductible: null, deduction_score: 80, deductible_reason: '', ai_analysis: undefined };
    vi.resetModules();
    vi.doMock('@/lib/firebase/transactions-server', () => ({
      getTransactionsServer: async () => ({ data: [{ ...transaction, deductible_reason: path.includes('migrate') ? 'Ordinary and necessary' : '' }], error: null }),
      updateTransactionServerWithUserId: async () => ({ error: new Error(marker) }),
    }));
    try {
      const { POST } = await importRoute();
      const response = await POST(contractRequest(path, { method: 'POST', auth: 'owner', body: '{}' }));
      expect(response.status).toBe(200);
      const body = await response.json() as { results: Array<{ status: string; error?: string }> };
      expect(body.results.map(result => result.status)).toContain('error');
      expect(body.results.find(result => result.status === 'error')?.error).toBe('update_failed');
      expect(JSON.stringify(body)).not.toContain(marker);
    } finally {
      vi.doUnmock('@/lib/firebase/transactions-server');
      vi.resetModules();
    }
  });
});
