import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { BANK_CONSENT_LOOKUP_ERROR, BANK_CONSENT_REQUIRED_ERROR, BANK_CONSENT_TEXT, BANK_CONSENT_VERSION } from '@/lib/onboarding/bank-consent-copy';

const hash = createHash('sha256').update(BANK_CONSENT_TEXT, 'utf8').digest('hex');
const store = vi.hoisted(() => ({
  profile: { subscriptionStatus: 'none', trialStart: null, trialEnd: null, hasHistoricalAccess: false } as Record<string, unknown>,
  bankConsents: [] as Record<string, unknown>[],
  writes: [] as string[],
  failRead: false,
}));
const mock = vi.hoisted(() => ({
  auth: vi.fn(), link: vi.fn(), trial: vi.fn(), history: vi.fn(), historyReady: vi.fn(), reconnectCanLink: vi.fn(), connection: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    doc: () => ({
      get: async () => {
        if (store.failRead) throw new Error('unavailable');
        return { exists: true, data: () => store.profile };
      },
      update: async () => { store.writes.push('profile-update'); },
      set: async () => { store.writes.push('profile-set'); },
    }),
    collection: () => ({
      get: async () => {
        if (store.failRead) throw new Error('unavailable');
        return { docs: store.bankConsents.map(data => ({ data: () => data })) };
      },
      doc: () => ({ create: async () => { store.writes.push('bank-consent'); } }),
    }),
    runTransaction: async () => { store.writes.push('transaction'); },
  },
  FieldValue: { serverTimestamp: () => 'server-time' },
}));
vi.mock('@/lib/plaid/reconnect', () => ({ assertReconnectCanLink: mock.reconnectCanLink }));
vi.mock('@/lib/plaid/history-review', () => ({
  assertBankHistoryReadyForNewConnection: mock.historyReady,
  BANK_HISTORY_REVIEW_REQUIRED: 'BANK_HISTORY_REVIEW_REQUIRED',
  BANK_HISTORY_REVIEW_MESSAGE: 'Review saved bank history with WriteOff support.',
}));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: mock.auth }));
vi.mock('@/lib/plaid/connections', () => ({ getPlaidConnection: mock.connection }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { linkTokenCreate: mock.link } }));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ startFreeTrial: mock.trial }));
vi.mock('@/lib/subscriptions/history-window', () => ({ getTransactionHistoryWindow: mock.history }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));

import { POST } from '@/app/api/plaid/create-link-token/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const req = (body: Record<string, unknown> = {}) => new NextRequest('https://staging.example.test/api/plaid/create-link-token', {
  method: 'POST', body: JSON.stringify(body),
});
const currentRecord = {
  version: BANK_CONSENT_VERSION, source: 'bank-connect', wording_hash: hash, accepted_at: '2026-10-22T12:00:00.000Z',
};

beforeEach(() => {
  store.profile = { subscriptionStatus: 'none', trialStart: null, trialEnd: null, hasHistoricalAccess: false };
  store.bankConsents = [];
  store.writes = [];
  store.failRead = false;
  vi.clearAllMocks();
  resetRateLimitStore();
  mock.auth.mockResolvedValue({ uid: 'owner' });
  mock.link.mockResolvedValue({ data: { link_token: 'public-link-token' } });
  mock.trial.mockResolvedValue({ success: true });
  mock.history.mockResolvedValue({ days: 90 });
  mock.historyReady.mockResolvedValue(undefined);
  mock.connection.mockResolvedValue(null);
  vi.stubEnv('PLAID_ENV', 'sandbox');
  vi.stubEnv('PLAID_WEBHOOK_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.test');
  vi.stubEnv('VERCEL_URL', '');
  vi.stubEnv('PLAID_REDIRECT_URI', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('link token before a bank acknowledgment', () => {
  it('moves no financial data, writes no acknowledgment, and does not start a trial', async () => {
    const before = { ...store.profile };
    const response = await POST(req());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: BANK_CONSENT_REQUIRED_ERROR });
    expect(mock.trial).not.toHaveBeenCalled();
    expect(mock.link).not.toHaveBeenCalled();
    expect(mock.history).not.toHaveBeenCalled();
    expect(store.bankConsents).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(store.profile).toEqual(before);
  });

  it('does not start a trial when the acknowledgment cannot be read', async () => {
    store.failRead = true;
    const response = await POST(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: BANK_CONSENT_LOOKUP_ERROR });
    expect(mock.trial).not.toHaveBeenCalled();
    expect(mock.link).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it('starts the trial only after a current acknowledgment is stored', async () => {
    store.bankConsents.push(currentRecord);
    expect((await POST(req())).status).toBe(200);
    expect(mock.trial).toHaveBeenCalledWith('owner');
    expect(mock.link).toHaveBeenCalledOnce();
    expect(store.writes).toEqual([]);
  });

  it('repairs an existing item without a trial or a new acknowledgment', async () => {
    mock.connection.mockResolvedValue({ uid: 'owner', itemId: 'owned-item', accessToken: 'synthetic-private-token' });
    expect((await POST(req({ itemId: 'owned-item' }))).status).toBe(200);
    expect(mock.trial).not.toHaveBeenCalled();
    expect(mock.link).toHaveBeenCalledOnce();
    expect(store.writes).toEqual([]);
    expect(store.bankConsents).toEqual([]);
  });
});
