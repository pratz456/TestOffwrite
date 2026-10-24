import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CONTRACT_OWNER, OWNER_ID_TOKEN, installApiRouteMocks } from './fixtures/api-route-harness';
import { recordedRateLimitCount } from './fixtures/rate-limit-store';

const limits = async () => (await import('@/lib/security/rate-limit')).RATE_LIMITS;

const harness = installApiRouteMocks();
const owner = CONTRACT_OWNER.uid;
const profilePath = `user_profiles/${owner}`;
const transactionPath = `${profilePath}/accounts/acct/transactions/tx1`;
const commits: string[] = [];
const originalBatch = harness.db.batch.bind(harness.db);

function partialBody(): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode('{"scope":');
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoded);
        return;
      }
      controller.error(new Error('stopped'));
    },
  });
}

function request(url: string, body: BodyInit) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${OWNER_ID_TOKEN}`, 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit);
}

async function expectNoFollowUpWork() {
  const profile = harness.db.records.get(profilePath);
  expect(profile?.plaid_import_in_progress).toBeUndefined();
  expect(profile?.trialStart).toBeUndefined();
  expect(profile?.subscriptionStatus).toBe('none');
  const policies = await limits();
  expect(recordedRateLimitCount(policies.plaidSync.scope)).toBe(0);
  expect(recordedRateLimitCount(policies.plaidLinkToken.scope)).toBe(0);
  expect(harness.plaidCalls).toEqual([]);
  expect(commits).toEqual([]);
  expect(harness.db.records.get(transactionPath)?.is_deductible).toBe(true);
}

beforeEach(async () => {
  await harness.reset();
  commits.length = 0;
  harness.db.batch = () => {
    const writer = originalBatch();
    const commit = writer.commit.bind(writer);
    writer.commit = async () => {
      commits.push('commit');
      return commit();
    };
    return writer;
  };
  harness.seedOwnerProfile({
    subscriptionStatus: 'none', trialStart: undefined, trialEnd: undefined, hasHistoricalAccess: false,
  });
  harness.db.records.set(`${profilePath}/accounts/acct`, { name: 'Checking' });
  harness.db.records.set(transactionPath, { auto_classified: true, is_deductible: true, amount: 10 });
  vi.stubEnv('WRITEOFF_ENV', 'test');
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'test');
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('consistent request validation', () => {
  it.each([
    ['partial JSON', partialBody()],
    ['malformed JSON', '{'],
  ])('rejects a sync request with %s', async (_label, body) => {
    const { POST } = await import('../app/api/plaid/sync-transactions/route');
    const response = await POST(request('https://writeoff-contract.example.test/api/plaid/sync-transactions', body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    await expectNoFollowUpWork();
  });

  it('accepts a valid sync request', async () => {
    const { POST } = await import('../app/api/plaid/sync-transactions/route');
    const response = await POST(request('https://writeoff-contract.example.test/api/plaid/sync-transactions', '{}'));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'No bank connection found' });
    expect(recordedRateLimitCount((await limits()).plaidSync.scope)).toBe(1);
    expect(harness.db.records.get(profilePath)?.plaid_import_in_progress).toBe(false);
    expect(harness.plaidCalls).toEqual([]);
    expect(commits).toEqual([]);
  });

  it.each([
    ['partial JSON', partialBody()],
    ['malformed JSON', '{'],
  ])('rejects a link token request with %s', async (_label, body) => {
    const { POST } = await import('../app/api/plaid/create-link-token/route');
    const response = await POST(request('https://writeoff-contract.example.test/api/plaid/create-link-token', body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    await expectNoFollowUpWork();
  });

  it('accepts a valid link token request', async () => {
    const { POST } = await import('../app/api/plaid/create-link-token/route');
    const response = await POST(request('https://writeoff-contract.example.test/api/plaid/create-link-token', '{}'));
    expect(response.status).toBe(503);
    expect(recordedRateLimitCount((await limits()).plaidLinkToken.scope)).toBe(1);
    expect(harness.plaidCalls).toEqual(['linkTokenCreate']);
    expect(harness.db.records.get(profilePath)?.subscriptionStatus).toBe('trial');
    expect(harness.db.records.get(profilePath)?.plaid_import_in_progress).toBeUndefined();
    expect(commits).toEqual([]);
  });

  it.each([
    ['partial JSON', partialBody()],
    ['malformed JSON', '{'],
  ])('rejects a classification reset request with %s', async (_label, body) => {
    const { POST } = await import('../app/api/transactions/reset-unreviewed-classifications/route');
    const response = await POST(request('https://writeoff-contract.example.test/api/transactions/reset-unreviewed-classifications', body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    await expectNoFollowUpWork();
  });

  it('accepts a valid classification reset request', async () => {
    const { POST } = await import('../app/api/transactions/reset-unreviewed-classifications/route');
    const response = await POST(request('https://writeoff-contract.example.test/api/transactions/reset-unreviewed-classifications', '{}'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, scope: 'learning_only', resetCount: 1 });
    expect(commits).toEqual(['commit']);
    expect(harness.db.records.get(transactionPath)?.is_deductible).toBeNull();
    expect(recordedRateLimitCount((await limits()).plaidSync.scope)).toBe(0);
    expect(recordedRateLimitCount((await limits()).plaidLinkToken.scope)).toBe(0);
    expect(harness.plaidCalls).toEqual([]);
  });
});
