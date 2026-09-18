/**
 * POST /api/plaid/auto-analyze is the "Retry analysis" action for paused or failed
 * records. It must be owner-scoped (the account is read under the caller's uid),
 * bounded per owner, and must re-queue only records without a saved suggestion.
 * Runs the real enqueue code against the fake Firestore; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractRequest, CONTRACT_OWNER, installApiRouteMocks } from './fixtures/api-route-harness';
import { exhaustRateLimit, failRateLimitStore, recordedRateLimitCount } from './fixtures/rate-limit-store';

const harness = installApiRouteMocks();
const route = () => import('../app/api/plaid/auto-analyze/route');
const limits = async () => (await import('@/lib/security/rate-limit')).RATE_LIMITS;
const ACCOUNT = 'checking-1';
const accountPath = (uid: string, accountId = ACCOUNT) => `user_profiles/${uid}/accounts/${accountId}`;

function seedAccount(uid: string, rows: Array<Record<string, unknown>>, accountId = ACCOUNT) {
  harness.db.records.set(accountPath(uid, accountId), { userId: uid, type: 'depository', usageType: 'business', name: 'Checking' });
  rows.forEach((row, index) => harness.db.records.set(`${accountPath(uid, accountId)}/transactions/tx-${index + 1}`, {
    userId: uid, account_id: accountId, amount: 25 + index, date: '2026-09-01', merchant_name: `Merchant ${index + 1}`, category: 'GENERAL_MERCHANDISE',
    iso_currency_code: 'USD', pending: false, ...row,
  }));
}

async function call(init: Parameters<typeof contractRequest>[1] = {}) {
  const { POST } = await route();
  const response = await POST(contractRequest('/api/plaid/auto-analyze', { method: 'POST', auth: 'owner', body: { accountId: ACCOUNT }, ...init }));
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeEach(async () => {
  await harness.reset();
  harness.seedOwnerProfile({ profession: 'Photographer' });
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
// The harness owns the other stubbed variables, so only the flag this file sets is cleared.
afterEach(() => { vi.restoreAllMocks(); delete process.env.AI_ANALYSIS_ENABLED; });

describe('analysis catch-up (Retry analysis) route', () => {
  it('requires a signed-in owner before reading any account', async () => {
    seedAccount(CONTRACT_OWNER.uid, [{}]);
    for (const auth of ['anonymous', 'invalid-token'] as const) {
      const { response } = await call({ auth });
      expect(response.status).toBe(401);
    }
    expect([...harness.db.records.keys()].some(path => path.startsWith('analysis_tasks/'))).toBe(false);
  });

  it('rejects a missing or malformed account id without touching the queue', async () => {
    for (const body of [{}, { accountId: '' }, { accountId: 'a/b' }, { accountId: 'x'.repeat(300) }]) {
      const { response } = await call({ body });
      expect(response.status).toBe(400);
    }
    expect(recordedRateLimitCount((await limits()).analysisCatchUp.scope)).toBe(0);
  });

  it('only sees accounts under the caller: another owner\'s account is not found and nothing is queued', async () => {
    seedAccount('someone-else', [{}, {}]);
    const { response, body } = await call();
    expect(response.status).toBe(404);
    expect(body.error).toBe('Account not found');
    expect([...harness.db.records.keys()].some(path => path.startsWith('analysis_tasks/'))).toBe(false);
  });

  it('re-queues paused and failed records, skips saved suggestions, and reports the owner-scoped job id', async () => {
    const stale = Date.now() - 5 * 60_000;
    seedAccount(CONTRACT_OWNER.uid, [
      { analysis_status: 'failed', analysisStatus: 'failed', analysisErrorCode: 'PROFILE_REQUIRED' },
      { analysis_status: 'failed', analysisStatus: 'failed', analysisErrorCode: 'AI_RETRY_LIMIT' },
      { analysis_status: 'completed', analysisStatus: 'completed', analyzed: true, ai_suggestion: { id: 'saved-suggestion' } },
    ]);
    // Existing paused/failed tasks older than a minute are eligible for a user-requested retry.
    const { analysisTaskId } = await import('@/lib/ai/analysis-jobs');
    for (const [transactionId, status, code] of [['tx-1', 'paused', 'PROFILE_REQUIRED'], ['tx-2', 'failed', 'AI_RETRY_LIMIT']] as const) {
      harness.db.records.set(`analysis_tasks/${analysisTaskId({ userId: CONTRACT_OWNER.uid, accountId: ACCOUNT, transactionId })}`,
        { userId: CONTRACT_OWNER.uid, accountId: ACCOUNT, transactionId, status, lastErrorCode: code, requestedAt: stale, attempts: 3, inputHash: 'stale-hash' });
    }
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({ status: 'queued', queued: 2, jobId: `${CONTRACT_OWNER.uid}_${ACCOUNT}` });
    const tasks = [...harness.db.records.entries()].filter(([path]) => path.startsWith('analysis_tasks/')).map(([, data]) => data);
    expect(tasks).toHaveLength(2);
    expect(tasks.every(task => task.status === 'queued' && task.attempts === 0 && task.lastErrorCode === null)).toBe(true);
    for (const id of ['tx-1', 'tx-2']) expect(harness.db.records.get(`${accountPath(CONTRACT_OWNER.uid)}/transactions/${id}`)).toMatchObject({ analysisStatus: 'pending', analysisErrorCode: null });
    expect(harness.db.records.get(`${accountPath(CONTRACT_OWNER.uid)}/transactions/tx-3`)).toMatchObject({ analysisStatus: 'completed', ai_suggestion: { id: 'saved-suggestion' } });
    expect(harness.db.records.get(`analysis_jobs/${CONTRACT_OWNER.uid}_${ACCOUNT}`)).toMatchObject({ userId: CONTRACT_OWNER.uid, accountId: ACCOUNT, total: 2, processed: 0, status: 'running' });
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('answers idle when every record already has a suggestion or was retried less than a minute ago', async () => {
    seedAccount(CONTRACT_OWNER.uid, [{ analysis_status: 'completed', analysisStatus: 'completed', analyzed: true, ai_suggestion: { id: 'saved' } }]);
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'idle', queued: 0 });
  });

  it('refuses with 429 and Retry-After once the owner\'s window is spent, before reading the account', async () => {
    seedAccount(CONTRACT_OWNER.uid, [{ analysis_status: 'failed', analysisStatus: 'failed', analysisErrorCode: 'AI_FAILED' }]);
    await exhaustRateLimit((await limits()).analysisCatchUp, CONTRACT_OWNER.uid);
    const { response, body } = await call();
    expect(response.status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect([...harness.db.records.keys()].some(path => path.startsWith('analysis_tasks/'))).toBe(false);
  });

  it('fails closed with 503 while the limiter store is unreachable', async () => {
    seedAccount(CONTRACT_OWNER.uid, [{}]);
    failRateLimitStore();
    const { response, body } = await call();
    expect(response.status).toBe(503);
    expect(body.code).toBe('RATE_LIMIT_UNAVAILABLE');
  });

  it('reports AI as unavailable without spending the owner\'s window or queueing work', async () => {
    process.env.AI_ANALYSIS_ENABLED = 'false';
    seedAccount(CONTRACT_OWNER.uid, [{}]);
    const { response, body } = await call();
    expect(response.status).toBe(503);
    expect(body.code).toBe('AI_UNAVAILABLE');
    expect(recordedRateLimitCount((await limits()).analysisCatchUp.scope)).toBe(0);
    expect([...harness.db.records.keys()].some(path => path.startsWith('analysis_tasks/'))).toBe(false);
  });

  it('never echoes a database failure', async () => {
    seedAccount(CONTRACT_OWNER.uid, [{}]);
    harness.failDatabase(new Error('internal-marker-4c1e at /srv/node_modules/firebase-admin/lib/firestore.js:1:1'));
    const { response, body } = await call();
    const text = JSON.stringify(body);
    expect(response.status).toBe(503);
    expect(body.code).toBe('ANALYSIS_QUEUE_UNAVAILABLE');
    expect(text).not.toContain('internal-marker-4c1e');
    expect(text).not.toContain('node_modules');
  });
});
