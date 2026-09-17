import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactionsIncremental: mocks.sync }));
import { POST } from '../app/api/plaid/sync-transactions-internal/route';

function call(secret?: string, body: string = JSON.stringify({ userId: 'owner' })) {
  return POST(new Request('https://writeoffapp.com/api/plaid/sync-transactions-internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-cloud-function-secret': secret } : {}) },
    body,
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
  it('fails closed when the secret is not configured, and tells an anonymous caller nothing about it', async () => {
    vi.stubEnv('CLOUD_FUNCTION_SECRET', '');
    expect((await call()).status).toBe(401);
    const configured = await call('anything');
    expect(configured.status).toBe(503);
    expect(JSON.stringify(await configured.json())).not.toMatch(/config/i);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('answers 400 for a malformed body or an unusable user ID instead of syncing', async () => {
    vi.stubEnv('CLOUD_FUNCTION_SECRET', 'synthetic-scheduler-secret-never-live');
    const secret = 'synthetic-scheduler-secret-never-live';
    for (const body of ['', '{', '[]', JSON.stringify({}), JSON.stringify({ userId: 42 }), JSON.stringify({ userId: 'a/b' }), JSON.stringify({ userId: 'x'.repeat(129) })]) {
      expect((await call(secret, body)).status, body).toBe(400);
    }
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('does not echo the sync helper failure reason', async () => {
    vi.stubEnv('CLOUD_FUNCTION_SECRET', 'synthetic-scheduler-secret-never-live');
    mocks.sync.mockResolvedValueOnce({ success: false, error: 'private cursor detail at /srv/node_modules/plaid' });
    const response = await call('synthetic-scheduler-secret-never-live');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private cursor detail');
  });
});
