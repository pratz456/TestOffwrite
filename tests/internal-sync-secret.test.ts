import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactionsIncremental: mocks.sync }));
import { POST } from '../app/api/plaid/sync-transactions-internal/route';

function call(secret?: string) {
  return POST(new Request('https://writeoffapp.com/api/plaid/sync-transactions-internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-cloud-function-secret': secret } : {}) },
    body: JSON.stringify({ userId: 'owner' }),
  }) as never);
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('scheduled sync shared-secret authentication', () => {
  it('rejects a missing, partial or different secret without syncing', async () => {
    vi.stubEnv('CLOUD_FUNCTION_SECRET', 'synthetic-scheduler-secret-never-live');
    for (const provided of [undefined, 'synthetic-scheduler-secret', 'synthetic-scheduler-secret-never-live-extra', 'x']) {
      expect((await call(provided)).status).toBe(401);
    }
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('accepts the exact secret and never echoes internal error details', async () => {
    vi.stubEnv('CLOUD_FUNCTION_SECRET', 'synthetic-scheduler-secret-never-live');
    mocks.sync.mockRejectedValueOnce(new Error('private provider detail'));
    const failed = await call('synthetic-scheduler-secret-never-live');
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('private provider detail');
    mocks.sync.mockResolvedValueOnce({ success: true, transactionsSaved: 2 });
    const ok = await call('synthetic-scheduler-secret-never-live');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, transactions_saved: 2 });
  });
  it('fails closed when the secret is not configured', async () => {
    vi.stubEnv('CLOUD_FUNCTION_SECRET', '');
    expect((await call('anything')).status).toBe(500);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
