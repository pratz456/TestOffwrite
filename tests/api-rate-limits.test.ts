/**
 * Costly routes (model calls, bank provider calls, full-history exports, team
 * email) refuse with 429 and Retry-After once the owner's durable window is
 * spent, before any provider or full read happens, and fail closed with 503
 * while the limiter store is unreachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractRequest, CONTRACT_OWNER, installApiRouteMocks } from './fixtures/api-route-harness';
import { exhaustRateLimit, failRateLimitStore } from './fixtures/rate-limit-store';

const harness = installApiRouteMocks();
// Imported after the harness mocks so the limiter binds to the in-memory store.
const limits = async () => (await import('@/lib/security/rate-limit')).RATE_LIMITS;

interface Case { path: string; method?: string; body?: Record<string, unknown> | null; policy: string; importRoute: () => Promise<{ [method: string]: unknown }> }

const CASES: Case[] = [
  { path: '/api/ai/parse-voice-command', body: { text: 'add a twenty dollar coffee expense' }, policy: 'aiVoiceCommand', importRoute: () => import('../app/api/ai/parse-voice-command/route') },
  { path: '/api/ai/tax-assistant', body: { message: 'Can I deduct my home office?' }, policy: 'aiTaxAssistant', importRoute: () => import('../app/api/ai/tax-assistant/route') },
  { path: '/api/tax/import-bank-statement', body: null, policy: 'taxStatementImport', importRoute: () => import('../app/api/tax/import-bank-statement/route') },
  { path: '/api/cpa-question', body: { userId: CONTRACT_OWNER.uid, transactionId: 'tx-1', merchantName: 'Acme', amount: 42, date: '2025-03-01', category: 'Software', question: 'Deductible?' }, policy: 'cpaQuestion', importRoute: () => import('../app/api/cpa-question/route') },
  { path: '/api/reports/generate-pdf', body: { year: 2025 }, policy: 'reportExport', importRoute: () => import('../app/api/reports/generate-pdf/route') },
  { path: '/api/reports/export', body: { type: 'scheduleSE', year: 2025 }, policy: 'reportExport', importRoute: () => import('../app/api/reports/export/route') },
  { path: '/api/reports/audit-support?year=2025&format=json', method: 'GET', policy: 'reportExport', importRoute: () => import('../app/api/reports/audit-support/route') },
  { path: '/api/transactions/export-csv?year=2025', method: 'GET', policy: 'reportExport', importRoute: () => import('../app/api/transactions/export-csv/route') },
  { path: '/api/tax/schedule-c/export', body: { year: 2025 }, policy: 'reportExport', importRoute: () => import('../app/api/tax/schedule-c/export/route') },
  { path: '/api/tax/form-1040', body: { year: 2025 }, policy: 'reportExport', importRoute: () => import('../app/api/tax/form-1040/route') },
  { path: '/api/plaid/sync-transactions', body: {}, policy: 'plaidSync', importRoute: () => import('../app/api/plaid/sync-transactions/route') },
  { path: '/api/plaid/import-transactions', body: { account_id: 'acct-1' }, policy: 'plaidSync', importRoute: () => import('../app/api/plaid/import-transactions/route') },
  { path: '/api/plaid/refresh-balances', body: null, policy: 'plaidSync', importRoute: () => import('../app/api/plaid/refresh-balances/route') },
  { path: '/api/plaid/recurring-transactions', body: null, policy: 'plaidSync', importRoute: () => import('../app/api/plaid/recurring-transactions/route') },
  { path: '/api/plaid/auto-analyze', body: { accountId: 'acct-1' }, policy: 'analysisCatchUp', importRoute: () => import('../app/api/plaid/auto-analyze/route') },
];

async function call(testCase: Case) {
  const method = testCase.method ?? 'POST';
  const routeModule = await testCase.importRoute();
  const handler = routeModule[method] as (request: Request) => Promise<Response>;
  const response = await handler(contractRequest(testCase.path, { method, auth: 'owner', body: testCase.body }));
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeEach(async () => {
  await harness.reset();
  harness.seedOwnerProfile();
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('per-owner rate limits on costly routes', () => {
  it.each(CASES.map(testCase => [`${testCase.method ?? 'POST'} ${testCase.path}`, testCase] as const))('%s answers 429 with Retry-After once the window is spent', async (_label, testCase) => {
    const policy = (await limits())[testCase.policy as keyof Awaited<ReturnType<typeof limits>>];
    await exhaustRateLimit(policy, CONTRACT_OWNER.uid);
    const { response, body } = await call(testCase);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.code).toBe('RATE_LIMITED');
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.plaidCalls).toEqual([]);
  });

  it('a different owner is not affected by a spent window', async () => {
    const policy = (await limits()).aiVoiceCommand;
    await exhaustRateLimit(policy, 'someone-else');
    const { response } = await call(CASES[0]);
    expect(response.status).not.toBe(429);
  });

  it('fails closed with 503 while the limiter store is unreachable', async () => {
    failRateLimitStore();
    const { response, body } = await call(CASES[0]);
    expect(response.status).toBe(503);
    expect(body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(harness.fetch).not.toHaveBeenCalled();
  });
});
