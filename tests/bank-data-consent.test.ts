import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const records = new Map<string, Record<string, any>>();
  const updates: Array<{ path: string; values: Record<string, unknown> }> = [];
  const serverTime = { __server: true };
  const deleteField = { __delete: true };
  function apply(target: Record<string, any>, values: Record<string, any>) {
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.');
      let cursor = target;
      for (const part of parts.slice(0, -1)) {
        if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {};
        cursor = cursor[part];
      }
      const leaf = parts[parts.length - 1];
      if (value && typeof value === 'object' && value.__delete) delete cursor[leaf];
      else if (value && typeof value === 'object' && value.__server) cursor[leaf] = 'server-time';
      else cursor[leaf] = value;
    }
  }
  function doc(path: string): any {
    return {
      path,
      get: async () => ({ exists: records.has(path), data: () => records.get(path), ref: doc(path) }),
      set: async (values: any, options?: { merge?: boolean }) => {
        const next = options?.merge && records.has(path) ? structuredClone(records.get(path)) : {};
        apply(next, values);
        records.set(path, next);
      },
      update: async (values: any) => {
        updates.push({ path, values });
        const next = structuredClone(records.get(path) ?? {});
        apply(next, values);
        records.set(path, next);
      },
      collection: (name: string) => collection(`${path}/${name}`),
    };
  }
  function collection(path: string): any {
    return { doc: (id: string) => doc(`${path}/${id}`) };
  }
  const plaid = {
    linkTokenCreate: vi.fn(), itemPublicTokenExchange: vi.fn(), accountsGet: vi.fn(), transactionsSync: vi.fn(), itemRemove: vi.fn(),
  };
  return {
    records, updates, plaid,
    auth: { verifyIdToken: vi.fn(), verifySessionCookie: vi.fn() },
    adminDb: {
      doc, collection,
      runTransaction: async (work: (transaction: any) => Promise<void>) => work({
        get: async (ref: any) => ref.get(),
        set: (ref: any, values: any, options?: { merge?: boolean }) => { void ref.set(values, options); },
        update: (ref: any, values: any) => { void ref.update(values); },
      }),
    },
    FieldValue: { serverTimestamp: () => serverTime, delete: () => deleteField },
  };
});

vi.mock('@/lib/firebase/admin', () => ({ adminAuth: h.auth, adminDb: h.adminDb, FieldValue: h.FieldValue }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: h.plaid }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ startFreeTrial: async () => ({ success: true }) }));
vi.mock('@/lib/subscriptions/history-window', () => ({
  getTransactionHistoryWindow: async () => ({ startDate: '2026-01-01', endDate: '2026-12-31', days: 90 }),
  isWithinHistoryWindow: () => true,
}));
vi.mock('@/lib/plaid/history-review', () => ({
  assertBankHistoryReadyForNewConnection: async () => {},
  BANK_HISTORY_REVIEW_REQUIRED: 'BANK_HISTORY_REVIEW_REQUIRED',
  BANK_HISTORY_REVIEW_MESSAGE: 'Review saved bank history.',
}));
vi.mock('@/lib/plaid/reconnect', () => ({ assertReconnectCanLink: async () => {}, saveReconnectConnection: async () => {} }));
vi.mock('@/lib/plaid/link-operations', () => ({
  ACCOUNT_DELETION_IN_PROGRESS: 'ACCOUNT_DELETION_IN_PROGRESS',
  beginPlaidLinkOperation: async () => 'operation',
  retainPlaidLinkRecovery: async () => {},
  finishPlaidLinkOperation: async () => {},
  markPlaidLinkOperationUnresolved: async () => {},
  existingPlaidLinkOwner: async () => 'none',
  quarantinePlaidLinkRecovery: async () => {},
}));
vi.mock('@/lib/plaid/connections', () => ({
  migrateLegacyPlaidConnection: async () => {},
  getPlaidConnection: async () => null,
  assertPlaidTokenEncryptionConfigured() {},
  savePlaidConnection: async () => {},
  listPlaidConnections: async () => [{ uid: 'owner', itemId: 'item-1', accessToken: 'secret', accountIds: ['acct-1'], cursor: '' }],
  updatePlaidConnection: async () => {},
  findPlaidConnectionByItemId: async () => null,
  withPlaidConnection: async (_uid: string, _item: string, work: (connection: any, lease: string) => Promise<number>) => work({
    uid: 'owner', itemId: 'item-1', accessToken: 'secret', accountIds: ['acct-1'], cursor: '',
  }, 'lease'),
}));

import { POST as createLink } from '@/app/api/plaid/create-link-token/route';
import { POST as legacyLink } from '@/app/api/plaid/link-token/route';
import { POST as exchange } from '@/app/api/plaid/exchange-public-token/route';
import { POST as legacyExchange } from '@/app/api/plaid/exchange-token/route';
import { POST as accounts } from '@/app/api/plaid/get-accounts/route';
import { POST as profilePost } from '@/app/api/database/profiles/route';
import { POST as manualPost } from '@/app/api/transactions/manual/route';
import { grantBankDataConsent, withdrawBankDataConsent } from '@/lib/onboarding/bank-consent';
import { buildConsentRecord, hasAcknowledgedRequiredConsents, parseConsentRecord, CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';
import { syncUserTransactionsIncremental } from '@/lib/plaid/sync-helper';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const base = {
  version: CONSENT_TERMS_VERSION, source: 'sign-up' as const, accepted_at: '2026-09-18T00:00:00.000Z',
  terms: true, ai_review: true, communications: false, document_import: false,
};
const post = (url: string, body?: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(() => {
  h.records.clear();
  h.updates.length = 0;
  vi.clearAllMocks();
  resetRateLimitStore();
  h.auth.verifyIdToken.mockResolvedValue({ uid: 'owner', email: 'owner@example.test', email_verified: true });
  h.plaid.linkTokenCreate.mockResolvedValue({ data: { link_token: 'link-sandbox' } });
  h.plaid.itemPublicTokenExchange.mockResolvedValue({ data: { access_token: 'access-sandbox', item_id: 'item-1' } });
  h.plaid.accountsGet.mockResolvedValue({ data: { item: { item_id: 'item-1', institution_id: null }, accounts: [{ account_id: 'acct-1' }] } });
  h.plaid.transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: 'cursor', has_more: false } });
  vi.stubEnv('PLAID_ENV', 'sandbox');
  vi.stubEnv('PLAID_WEBHOOK_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.test');
  vi.stubEnv('VERCEL_URL', '');
  vi.stubEnv('PLAID_REDIRECT_URI', '');
});

function seed(bankData: boolean) {
  h.records.set('user_profiles/owner', { consents: { ...base, bank_data: bankData } });
}

describe('bank data consent record', () => {
  it('keeps an existing bank grant valid and accepts a new record without bank data', () => {
    expect(parseConsentRecord({ ...base, bank_data: true })).toMatchObject({ bank_data: true, terms: true, ai_review: true });
    expect(hasAcknowledgedRequiredConsents({ ...base, bank_data: true })).toBe(true);
    const withoutBank = { ...base };
    delete (withoutBank as { bank_data?: boolean }).bank_data;
    expect(parseConsentRecord(withoutBank)).toMatchObject({ bank_data: false, terms: true });
    expect(parseConsentRecord({ ...base, bank_data: false })).toMatchObject({ bank_data: false });
    expect(hasAcknowledgedRequiredConsents({ ...base, bank_data: false })).toBe(true);
    expect(buildConsentRecord({ ...base, bank_data: true }, 'sign-up', new Date('2026-10-24T12:00:00.000Z'))).toMatchObject({ bank_data: false, terms: true, ai_review: true });
  });

  it('writes only bank data, its timestamp, and the signing zone', async () => {
    seed(false);
    const granted = await grantBankDataConsent('owner', 'America/Los_Angeles', new Date('2026-10-24T15:04:00.000Z'));
    expect(granted).toEqual({ bank_data: true, timeZone: 'America/Los_Angeles', bank_data_signed_at: '2026-10-24T15:04:00.000Z' });
    expect(h.updates).toEqual([{ path: 'user_profiles/owner', values: {
      'consents.bank_data': true,
      'consents.bank_data_signed_at': '2026-10-24T15:04:00.000Z',
      'consents.timeZone': 'America/Los_Angeles',
    } }]);
    expect(h.records.get('user_profiles/owner')?.consents).toMatchObject({
      terms: true, ai_review: true, communications: false, bank_data: true, timeZone: 'America/Los_Angeles',
    });
    h.updates.length = 0;
    const again = buildConsentRecord({ terms: true, bank_data: false, ai_review: true, communications: true, document_import: false }, 'reacknowledgment', new Date('2026-10-24T16:00:00.000Z'));
    expect((await profilePost(post('https://writeoff.test/api/database/profiles', { consents: again }))).status).toBe(200);
    expect(h.records.get('user_profiles/owner')?.consents).toMatchObject({
      bank_data: true, communications: true, timeZone: 'America/Los_Angeles', bank_data_signed_at: '2026-10-24T15:04:00.000Z',
    });
    expect(h.updates).toEqual([]);
  });

  it('does not let the first profile save grant bank data', async () => {
    const forged = { ...base, bank_data: true, bank_data_signed_at: '2026-01-01T00:00:00.000Z', timeZone: 'UTC' };
    expect((await profilePost(post('https://writeoff.test/api/database/profiles', { consents: forged }))).status).toBe(200);
    expect(h.records.get('user_profiles/owner')?.consents.bank_data).toBe(false);
    expect(h.records.get('user_profiles/owner')?.consents.bank_data_signed_at).toBeUndefined();
    expect(h.records.get('user_profiles/owner')?.consents.timeZone).toBeUndefined();
  });
});

describe('bank provider routes use the real consent check', () => {
  it.each([
    ['link token', createLink, 'https://writeoff.test/api/plaid/create-link-token', () => h.plaid.linkTokenCreate],
    ['legacy link token', legacyLink, 'https://writeoff.test/api/plaid/link-token', () => h.plaid.linkTokenCreate],
    ['public token exchange', exchange, 'https://writeoff.test/api/plaid/exchange-public-token', () => h.plaid.itemPublicTokenExchange],
    ['legacy exchange', legacyExchange, 'https://writeoff.test/api/plaid/exchange-token', () => h.plaid.itemPublicTokenExchange],
    ['accounts alias', accounts, 'https://writeoff.test/api/plaid/get-accounts', () => h.plaid.itemPublicTokenExchange],
  ] as const)('refuses %s with CONSENT_REQUIRED and makes no provider call', async (_name, handler, url, provider) => {
    seed(false);
    const body = url.includes('exchange') || url.includes('accounts') ? { public_token: 'public-sandbox' } : {};
    const response = await handler(post(url, body));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(provider()).not.toHaveBeenCalled();
  });

  it('asks for a link token when bank data consent is already true', async () => {
    seed(true);
    const response = await createLink(post('https://writeoff.test/api/plaid/create-link-token', {}));
    expect(response.status).toBe(200);
    expect(h.plaid.linkTokenCreate).toHaveBeenCalledOnce();
  });

  it('exchanges a public token when bank data consent is already true', async () => {
    seed(true);
    const response = await exchange(post('https://writeoff.test/api/plaid/exchange-public-token', { public_token: 'public-sandbox' }));
    expect(response.status).toBe(200);
    expect(h.plaid.itemPublicTokenExchange).toHaveBeenCalledOnce();
  });
});

describe('withdrawal and manual entry', () => {
  it('stops a new sync after withdrawal and keeps the saved transaction', async () => {
    seed(true);
    h.records.set('user_profiles/owner/accounts/acct-1/transactions/tx-1', { amount: 12, merchant_name: 'Cafe' });
    await syncUserTransactionsIncremental('owner');
    expect(h.plaid.transactionsSync).toHaveBeenCalled();
    h.plaid.transactionsSync.mockClear();
    await withdrawBankDataConsent('owner', new Date('2026-10-24T00:00:00.000Z'));
    const saved = h.records.get('user_profiles/owner/accounts/acct-1/transactions/tx-1');
    expect(saved).toMatchObject({ amount: 12, merchant_name: 'Cafe' });
    expect(await syncUserTransactionsIncremental('owner')).toMatchObject({ success: false, transactionsSaved: 0, code: 'CONSENT_REQUIRED' });
    expect(h.plaid.transactionsSync).not.toHaveBeenCalled();
    expect(h.records.get('user_profiles/owner/accounts/acct-1/transactions/tx-1')).toEqual(saved);
    expect(h.updates.at(-1)?.values).toEqual({
      'consents.bank_data': false,
      'consents.bank_data_withdrawn_at': '2026-10-24T00:00:00.000Z',
    });
  });

  it('reaches the first manual expense from sign up without bank data', async () => {
    const record = buildConsentRecord({ terms: true, bank_data: false, ai_review: true, communications: false, document_import: false }, 'sign-up', new Date('2026-10-24T12:00:00.000Z'));
    expect(record).toMatchObject({ bank_data: false, terms: true, ai_review: true });
    expect((await profilePost(post('https://writeoff.test/api/database/profiles', { consents: record }))).status).toBe(200);
    expect(h.records.get('user_profiles/owner')?.consents.bank_data).not.toBe(true);
    const created = await manualPost(post('https://writeoff.test/api/transactions/manual', {
      merchant_name: 'Paper notebook', amount: 12.5, date: '2026-10-24', type: 'expense',
    }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(h.records.get(`user_profiles/owner/accounts/manual/transactions/${body.trans_id}`)).toMatchObject({
      merchant_name: 'Paper notebook', source: 'manual',
    });
    expect(h.plaid.linkTokenCreate).not.toHaveBeenCalled();
    expect(h.plaid.itemPublicTokenExchange).not.toHaveBeenCalled();
    expect(h.plaid.transactionsSync).not.toHaveBeenCalled();
  });
});
