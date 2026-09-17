import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), process: vi.fn(), account: vi.fn(), auth: vi.fn(), transactions: vi.fn(), jobs: vi.fn(), configured: true }));
vi.mock('@/lib/ai/analysis-jobs', () => ({ enqueueBankTransactionAnalysis: mocks.enqueue, processAnalysisTask: mocks.process, enqueueAccountAnalysis: mocks.account,
  validAnalysisId: (value: unknown) => typeof value === 'string' && /^[^/\\\u0000-\u001f]{1,256}$/.test(value) && !['.', '..'].includes(value),
}));
vi.mock('@/lib/ai/provider-status', () => ({ getAIProviderStatus: () => ({ configured: mocks.configured }) }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: mocks.auth }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'synthetic-owner' }, error: null }) }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: mocks.transactions }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: () => ({ where: () => ({ get: mocks.jobs }) }) } }));
import { POST as internal } from '../app/api/internal/analysis-worker/route';
import { POST as catchup } from '../app/api/plaid/auto-analyze/route';
import { GET as status } from '../app/api/transactions/analysis-status/route';
const secret = 'synthetic-worker-test-secret-not-live';
const task = { action: 'process', taskId: 'a'.repeat(64), generation: 'synthetic-generation' };
function request(body: unknown = task, supplied = secret) { return new NextRequest('http://localhost/api/internal/analysis-worker', {
  method: 'POST', headers: { 'x-analysis-worker-secret': supplied, 'content-type': 'application/json' }, body: JSON.stringify(body),
}); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('ANALYSIS_WORKER_SECRET', secret); mocks.configured = true;
  mocks.auth.mockResolvedValue({ uid: 'synthetic-owner' });
  mocks.account.mockResolvedValue({ status: 'queued', queued: 3, jobId: 'synthetic-owner_bank' });
  mocks.process.mockResolvedValue({ status: 'completed', retry: false });
  mocks.enqueue.mockResolvedValue({ status: 'queued', taskId: task.taskId });
  mocks.jobs.mockResolvedValue({ empty: true, docs: [] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('analysis worker authentication and queue boundaries', () => {
  it.each(['', 'incorrect-secret'])('rejects the wrong service credential before reading data (%s)', async supplied => {
    expect((await internal(request(task, supplied))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('fails closed if worker secret is not configured', async () => {
    vi.stubEnv('ANALYSIS_WORKER_SECRET', '');
    expect((await internal(request())).status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('tells an anonymous caller nothing about configuration: 401 even when the secret is missing', async () => {
    vi.stubEnv('ANALYSIS_WORKER_SECRET', '');
    const response = await internal(request(task, ''));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('WORKER_UNAVAILABLE');
  });
  it.each([{ action: 'process', taskId: 'bad', generation: 'x' }, { action: 'enqueue', userId: 'owner/other', accountId: 'bank', transactionId: 'tx' }, { ...task, token: 'forged' }])('rejects invalid identifiers or extra payload %j', async body => {
    expect((await internal(request(body))).status).toBe(400);
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('awaits completed work and signals only retryable delivery failures to Eventarc', async () => {
    expect((await internal(request())).status).toBe(200);
    expect(mocks.process).toHaveBeenCalledWith(task.taskId, task.generation);
    mocks.process.mockResolvedValue({ status: 'retry_wait', retry: true });
    expect((await internal(request())).status).toBe(503);
    mocks.process.mockResolvedValue({ status: 'paused', retry: false, code: 'AI_UNAVAILABLE' });
    expect((await internal(request())).status).toBe(200);
    mocks.process.mockRejectedValue(new Error('sensitive provider data'));
    const failed = await internal(request());
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('sensitive');
  });
  it('queues only the address in the validated service request', async () => {
    expect((await internal(request({ action: 'enqueue', userId: 'owner', accountId: 'bank', transactionId: 'posted' }))).status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith({ userId: 'owner', accountId: 'bank', transactionId: 'posted' });
  });
  it('requires user authentication before catch-up and never trusts supplied userId', async () => {
    const body = { accountId: 'bank', userId: 'other-owner' };
    expect((await catchup(request(body))).status).toBe(200);
    expect(mocks.account).toHaveBeenCalledWith('synthetic-owner', 'bank');
    mocks.auth.mockRejectedValue(new Error('Unauthorized')); mocks.account.mockClear();
    expect((await catchup(request(body))).status).toBe(401);
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it('returns queued rather than completed and reports missing configuration without starting work', async () => {
    const response = await catchup(request({ accountId: 'bank' }));
    expect(await response.json()).toMatchObject({ status: 'queued', queued: 3 });
    expect(mocks.process).not.toHaveBeenCalled();
    mocks.configured = false; mocks.account.mockClear();
    const paused = await catchup(request({ accountId: 'bank' }));
    expect(paused.status).toBe(503); expect((await paused.json()).code).toBe('AI_UNAVAILABLE');
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it('reports credits and refunds as needing analysis while pending bank entries wait', async () => {
    mocks.transactions.mockResolvedValue({ data: [
      { amount: -100, type: 'income', analysisStatus: 'pending' },
      { amount: -20, analysisStatus: 'pending' },
      { amount: 45, pending: true, analysisStatus: 'pending' },
      { amount: 35, analysisStatus: 'failed' },
    ], error: null });
    const response = await status(new NextRequest('http://localhost/api/transactions/analysis-status'));
    expect((await response.json()).data).toMatchObject({ overallStatus: 'failed', breakdown: { pending: 2, running: 0, completed: 0, failed: 1, skipped: 1 } });
  });

  it('reports existing unanalysed records with no job as awaiting analysis, not active work', async () => {
    mocks.transactions.mockResolvedValue({ data: [
      { amount: 75, analyzed: false, analysisStatus: 'pending' },
      { amount: 25, analyzed: false },
      { amount: 30, analysisStatus: 'running' },
    ], error: null });
    const response = await status(new NextRequest('http://localhost/api/transactions/analysis-status'));
    expect((await response.json()).data).toMatchObject({ overallStatus: 'needs_analysis',
      progress: { current: 0, total: 3, percentage: 0 }, breakdown: { pending: 3, running: 0, completed: 0, failed: 0 },
      currentlyAnalyzing: null, summary: { analyzedTransactions: 0, remainingTransactions: 3 } });
  });

  it('never counts failed attempts as successfully analyzed records or completion percentage', async () => {
    mocks.transactions.mockResolvedValue({ data: [
      { amount: 75, analyzed: false, analysisStatus: 'failed' },
      { amount: 25, analyzed: true, analysisStatus: 'completed', ai_suggestion: { id: 'saved' } },
    ], error: null });
    const response = await status(new NextRequest('http://localhost/api/transactions/analysis-status'));
    expect((await response.json()).data).toMatchObject({ overallStatus: 'failed',
      progress: { current: 1, total: 2, percentage: 50 }, summary: { analyzedTransactions: 1, successRate: 50 } });
  });

  it('requires a live lease to describe an unqueued running record as active', async () => {
    mocks.transactions.mockResolvedValue({ data: [
      { id: 'live', amount: 75, analysisStatus: 'running', analysisLeaseToken: 'active-lease', analysisLeaseExpiresAt: Date.now() + 60_000 },
      { id: 'expired', amount: 25, analysisStatus: 'running', analysisLeaseToken: 'expired-lease', analysisLeaseExpiresAt: Date.now() - 1 },
    ], error: null });
    const response = await status(new NextRequest('http://localhost/api/transactions/analysis-status'));
    expect((await response.json()).data).toMatchObject({ overallStatus: 'analyzing',
      breakdown: { running: 1, pending: 1, completed: 0 }, currentlyAnalyzing: { id: 'live' }, progress: { current: 0 } });
  });

  it.each([
    { status: 'running', total: 5, processed: 0 },
    { version: 1, batchId: 'expired-batch', status: 'running', total: 5, processed: 0, lastUpdate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  ])('does not trust an abandoned job as active %j', async job => {
    mocks.jobs.mockResolvedValue({ docs: [{ id: 'old-job', data: () => job }] });
    mocks.transactions.mockResolvedValue({ data: [{ amount: 50, analyzed: false, analysisStatus: 'pending' }], error: null });
    expect((await (await status(new NextRequest('http://localhost/api/transactions/analysis-status'))).json()).data.overallStatus).toBe('needs_analysis');
  });

  it('honors terminal durable failures instead of interpreting stale pending records as ongoing work', async () => {
    mocks.jobs.mockResolvedValue({ docs: [{ id: 'paused-job', data: () => ({ version: 1, status: 'failed', lastErrorCode: 'AI_UNAVAILABLE', lastUpdate: new Date() }) }] });
    mocks.transactions.mockResolvedValue({ data: [{ amount: 50, analyzed: false, analysisStatus: 'pending' }], error: null });
    const response = await status(new NextRequest('http://localhost/api/transactions/analysis-status'));
    expect((await response.json()).data).toMatchObject({ overallStatus: 'failed', jobId: 'paused-job', lastErrorCode: 'AI_UNAVAILABLE', progress: { current: 0 } });
  });

  it('keeps a recent durable queue active while counting only successful outcomes as analyzed', async () => {
    mocks.jobs.mockResolvedValue({ docs: [{ id: 'active-job', data: () => ({ version: 1, batchId: 'active-batch', status: 'running', phase: 'queued',
      total: 4, processed: 2, succeeded: 1, failed: 1, lastUpdate: new Date() }) }] });
    const response = await status(new NextRequest('http://localhost/api/transactions/analysis-status'));
    expect((await response.json()).data).toMatchObject({ overallStatus: 'analyzing', phase: 'queued',
      progress: { current: 1, total: 4, percentage: 25 }, breakdown: { pending: 2, completed: 1, failed: 1 },
      summary: { analyzedTransactions: 1, remainingTransactions: 2, successRate: 25 } });
    expect(mocks.transactions).not.toHaveBeenCalled();
  });
});
