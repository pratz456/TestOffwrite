import { describe, expect, it, vi } from 'vitest';
import { callAnalysisWorker, shouldProcessTask, shouldQueueBankWrite } from '../functions-analysis/src/bridge';

const posted = { amount: 40, pending: false, analysisStatus: 'pending' };
describe('Firebase analysis event bridge', () => {
  it('queues created posted expenses and pending-to-posted changes, not workflow writes', () => {
    expect(shouldQueueBankWrite(undefined, posted)).toBe(true);
    expect(shouldQueueBankWrite({ ...posted, pending: true }, posted)).toBe(true);
    expect(shouldQueueBankWrite(posted, { ...posted, analysisStatus: 'running' })).toBe(false);
    expect(shouldQueueBankWrite(posted, { ...posted, notes: 'Edited' })).toBe(false);
    expect(shouldQueueBankWrite(posted, { ...posted, analysisInputRevision: 'bank-correction-revision' })).toBe(true);
    expect(shouldQueueBankWrite(posted, undefined)).toBe(false);
  });
  it.each([{ ...posted, pending: true }, { ...posted, amount: NaN }, { ...posted, amount: Infinity }, { ...posted, analyzed: true, ai_suggestion: { id: 'saved' } }])('does not queue ineligible records %j', after => {
    expect(shouldQueueBankWrite(undefined, after)).toBe(false);
  });
  it('queues an imported legacy analyzed record without the current suggestion contract', () => {
    expect(shouldQueueBankWrite(undefined, { ...posted, analyzed: true, analysisStatus: 'completed' })).toBe(true);
  });
  it.each([{ amount: -40 }, { amount: 0 }, { amount: -500, type: 'income' }, { category: 'TRANSFER' }])('queues posted credits and other kinds for analysis %j', value => {
    expect(shouldQueueBankWrite(undefined, { ...posted, ...value })).toBe(true);
  });
  it.each(['manual', 'receipt'])('also queues saved %s expenses without an HTTP background request', source => {
    expect(shouldQueueBankWrite(undefined, { ...posted, source })).toBe(true);
  });
  it('starts only a new persisted task generation, not its own running/retry/status updates', () => {
    const queued = { status: 'queued', generation: 'new-run' };
    expect(shouldProcessTask(undefined, queued)).toBe(true);
    expect(shouldProcessTask({ status: 'paused', generation: 'old-run' }, queued)).toBe(true);
    expect(shouldProcessTask(queued, { ...queued, status: 'running' })).toBe(false);
    expect(shouldProcessTask(queued, { ...queued, status: 'retry_wait' })).toBe(false);
    expect(shouldProcessTask(queued, queued)).toBe(false);
  });
  const options = () => ({ project: 'writeoff-production-testing', origin: 'https://writeoff-production-testing.web.app',
    secret: 'synthetic-test-secret-never-used-live', eventTime: new Date().toISOString(), fetcher: vi.fn().mockResolvedValue(new Response('{}')) });
  it.each([{ project: 'writeoff-23910' }, { origin: 'https://writeoffapp.com' }, { origin: 'https://attacker.example' }, { secret: '' },
    { project: 'demo-writeoff-security', origin: 'http://127.0.0.1:3000' },
    { project: 'demo-writeoff-security', origin: 'http://localhost:3000', emulator: 'true' },
    { project: 'writeoff-23910', origin: 'http://127.0.0.1:3000', emulator: 'true' },
  ])('fails closed on cross-project/misconfigured dispatch %j', async override => {
    const config = { ...options(), ...override };
    await expect(callAnalysisWorker({ action: 'process' }, config)).rejects.toThrow('CONFIGURATION_REQUIRED');
    expect(config.fetcher).not.toHaveBeenCalled();
  });
  it('permits only the explicit demo emulator and exact local origin with a worker secret', async () => {
    const config = { ...options(), project: 'demo-writeoff-security', origin: 'http://127.0.0.1:3000', emulator: 'true' };
    await callAnalysisWorker({ action: 'process' }, config);
    expect(config.fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/internal/analysis-worker', expect.any(Object));
  });
  it('awaits the authenticated dispatch and throws on retryable HTTP work', async () => {
    const config = options();
    config.fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(callAnalysisWorker({ action: 'process', taskId: 'synthetic' }, config)).rejects.toThrow('RETRY_REQUIRED');
    expect(config.fetcher).toHaveBeenCalledWith('https://writeoff-production-testing.web.app/api/internal/analysis-worker', expect.objectContaining({
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-analysis-worker-secret': config.secret },
    }));
  });
  it('does not dispatch events outside its bounded retry window', async () => {
    const config = options(); config.eventTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await callAnalysisWorker({ action: 'process' }, config);
    expect(config.fetcher).not.toHaveBeenCalled();
  });
});
