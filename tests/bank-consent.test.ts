import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  BANK_CONSENT_CLOCK_ERROR, BANK_CONSENT_LOOKUP_ERROR, BANK_CONSENT_OUT_OF_DATE_ERROR, BANK_CONSENT_REQUIRED_ERROR, BANK_CONSENT_SAVE_ERROR,
  BANK_CONSENT_TEXT, BANK_CONSENT_VERSION,
} from '@/lib/onboarding/bank-consent-copy';
import { ACCEPT_LEGACY_BANK_DATA_CONSENT, hasCurrentBankConsent, legacyBankDataConsentStillCounts } from '@/lib/onboarding/bank-consent';
import { buildConsentRecord, withStoredBankDataConsent } from '@/lib/onboarding/consents';

const hash = createHash('sha256').update(BANK_CONSENT_TEXT, 'utf8').digest('hex');
const store = vi.hoisted(() => ({
  profile: undefined as Record<string, unknown> | undefined,
  bankConsents: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  failRead: false,
}));
const m = vi.hoisted(() => ({
  auth: vi.fn(), exchange: vi.fn(), accounts: vi.fn(), remove: vi.fn(), save: vi.fn(), sync: vi.fn(),
  begin: vi.fn(), retain: vi.fn(), finish: vi.fn(), unresolved: vi.fn(), owner: vi.fn(), quarantine: vi.fn(),
  historyReady: vi.fn(), reconnectCanLink: vi.fn(), saveReconnect: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    doc: () => ({
      get: async () => {
        if (store.failRead) throw new Error('unavailable');
        return { exists: store.profile !== undefined, data: () => store.profile };
      },
    }),
    collection: (path: string) => ({
      where: () => ({
        get: async () => {
          if (store.failRead) throw new Error('unavailable');
          return { docs: (path === 'plaid_connections' ? store.links : []).map(data => ({ data: () => data })) };
        },
      }),
      get: async () => {
        if (store.failRead) throw new Error('unavailable');
        const rows = path === 'plaid_connections' ? store.links : store.bankConsents;
        return { docs: rows.map(data => ({ data: () => data })) };
      },
      doc: () => ({ create: async (data: Record<string, unknown>) => { store.bankConsents.push({ ...data }); } }),
    }),
  },
  FieldValue: { serverTimestamp: () => 'server-time' },
}));
vi.mock('@/lib/security/rate-limit', () => ({
  enforceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { plaidSync: { scope: 'plaid.sync', limit: 20, windowMs: 1, onUnavailable: 'deny' } },
}));
vi.mock('@/lib/plaid/reconnect', () => ({ assertReconnectCanLink: m.reconnectCanLink, saveReconnectConnection: m.saveReconnect }));
vi.mock('@/lib/plaid/history-review', () => ({
  assertBankHistoryReadyForNewConnection: m.historyReady,
  BANK_HISTORY_REVIEW_REQUIRED: 'BANK_HISTORY_REVIEW_REQUIRED',
  BANK_HISTORY_REVIEW_MESSAGE: 'Review saved bank history with WriteOff support.',
}));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: m.auth }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { itemPublicTokenExchange: m.exchange, accountsGet: m.accounts, itemRemove: m.remove } }));
vi.mock('@/lib/plaid/connections', () => ({ assertPlaidTokenEncryptionConfigured() {}, savePlaidConnection: m.save }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactionsIncremental: m.sync }));
vi.mock('@/lib/plaid/link-operations', () => ({
  ACCOUNT_DELETION_IN_PROGRESS: 'ACCOUNT_DELETION_IN_PROGRESS', beginPlaidLinkOperation: m.begin,
  retainPlaidLinkRecovery: m.retain, finishPlaidLinkOperation: m.finish, markPlaidLinkOperationUnresolved: m.unresolved,
  existingPlaidLinkOwner: m.owner, quarantinePlaidLinkRecovery: m.quarantine,
}));

import { POST as exchangePublicToken } from '@/app/api/plaid/exchange-public-token/route';
import { POST as exchangeToken } from '@/app/api/plaid/exchange-token/route';
import { POST as saveBankConsent } from '@/app/api/onboarding/bank-consent/route';
import { POST as syncTransactions } from '@/app/api/plaid/sync-transactions/route';

const currentRecord = {
  version: BANK_CONSENT_VERSION, source: 'bank-connect', wording_hash: hash,
  accepted_at: '2026-10-22T12:00:00.000Z', recorded_at: 'server-time',
};
const exchangeBody = (body: Record<string, unknown>) => new Request('https://writeoff.test/api/plaid/exchange-public-token', { method: 'POST', body: JSON.stringify(body) });
const saveBody = (body: unknown) => new Request('https://writeoff.test/api/onboarding/bank-consent', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
});

beforeEach(() => {
  store.profile = undefined;
  store.bankConsents = [];
  store.links = [];
  store.failRead = false;
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ uid: 'owner' });
  m.begin.mockResolvedValue('operation');
  m.exchange.mockResolvedValue({ data: { access_token: 'access-sandbox-test', item_id: 'created-item' } });
  m.accounts.mockResolvedValue({ data: { item: { item_id: 'created-item', institution_id: 'institution' }, accounts: [{ account_id: 'account' }] } });
  m.save.mockResolvedValue(undefined);
  m.sync.mockResolvedValue({ success: true, transactionsSaved: 0 });
  m.owner.mockResolvedValue('none');
});

describe('bank acknowledgment records', () => {
  it('appends a bank-connect record with version, wording hash, client time, and server time', async () => {
    const accepted = '2026-10-22T15:04:00.000Z';
    expect((await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: accepted }))).status).toBe(200);
    expect((await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: '2026-10-22T16:04:00.000Z' }))).status).toBe(200);
    expect(store.bankConsents).toHaveLength(2);
    expect(store.bankConsents[0]).toEqual({
      version: BANK_CONSENT_VERSION, wording_hash: hash, accepted_at: accepted, recorded_at: 'server-time', source: 'bank-connect',
    });
    expect(store.bankConsents[1]).toMatchObject({ accepted_at: '2026-10-22T16:04:00.000Z', source: 'bank-connect' });
    expect(store.bankConsents[0]).not.toBe(store.bankConsents[1]);
  });

  it('rejects a missing, empty, or client-stamped record before writing', async () => {
    expect((await saveBankConsent(saveBody(''))).status).toBe(400);
    expect((await saveBankConsent(saveBody({}))).status).toBe(400);
    expect((await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: '2026-10-22T15:04:00.000Z', recorded_at: 'forged' }))).status).toBe(400);
    m.auth.mockRejectedValue(new Error('nope'));
    expect((await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: '2026-10-22T15:04:00.000Z' }))).status).toBe(401);
    expect(store.bankConsents).toHaveLength(0);
  });

  it('uses one save sentence for a rejected acknowledgment, and the clock sentence when the device time is ahead', async () => {
    const extra = await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: '2026-10-22T15:04:00.000Z', extra: true }));
    expect(extra.status).toBe(400);
    expect(await extra.json()).toEqual({ error: BANK_CONSENT_SAVE_ERROR });
    const missingTime = await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: 'not-a-time' }));
    expect(missingTime.status).toBe(400);
    expect(await missingTime.json()).toEqual({ error: BANK_CONSENT_SAVE_ERROR });
    const stale = await saveBankConsent(saveBody({ version: '2026-10-22', accepted_at: '2026-10-22T15:04:00.000Z' }));
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({ error: BANK_CONSENT_OUT_OF_DATE_ERROR });
    const clock = await saveBankConsent(saveBody({ version: BANK_CONSENT_VERSION, accepted_at: '2999-01-01T00:00:00.000Z' }));
    expect(clock.status).toBe(400);
    expect(await clock.json()).toEqual({ error: BANK_CONSENT_CLOCK_ERROR });
    expect(store.bankConsents).toHaveLength(0);
  });
});

describe('Plaid exchange requires a bank acknowledgment', () => {
  it('returns 403 from both exchange routes when none is stored', async () => {
    expect((await exchangePublicToken(exchangeBody({ public_token: 'public-sandbox-test' }))).status).toBe(403);
    expect((await exchangeToken(exchangeBody({ publicToken: 'public-sandbox-test' }))).status).toBe(403);
    expect(m.exchange).not.toHaveBeenCalled();
    expect(m.begin).not.toHaveBeenCalled();
  });

  it('exchanges when a current bank-connect record is stored', async () => {
    store.bankConsents.push(currentRecord);
    expect((await exchangePublicToken(exchangeBody({ public_token: 'public-sandbox-test' }))).status).toBe(200);
    expect(m.exchange).toHaveBeenCalledOnce();
  });

  it('still requires the bank acknowledgment when a new signup sends bank_data true and has no saved bank link', async () => {
    const submitted = { ...buildConsentRecord({ terms: true, ai_review: true, communications: false, document_import: false }, 'sign-up')!, bank_data: true };
    expect(withStoredBankDataConsent(submitted, undefined).bank_data).toBeUndefined();
    store.profile = { consents: { version: '2026-09-17', source: 'sign-up', bank_data: true, terms: true, ai_review: true } };
    store.links = [{ uid: 'owner', itemId: 'retired-item', status: 'disconnected' }];
    expect(await hasCurrentBankConsent('owner')).toBe(false);
    store.links = [];
    const response = await exchangePublicToken(exchangeBody({ public_token: 'public-sandbox-test' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: BANK_CONSENT_REQUIRED_ERROR });
    expect((await exchangeToken(new Request('https://writeoff.test/api/plaid/exchange-token', {
      method: 'POST', body: JSON.stringify({ publicToken: 'public-sandbox-test' }),
    }))).status).toBe(403);
    expect(m.exchange).not.toHaveBeenCalled();
    expect(store.bankConsents).toEqual([]);
  });

  it('keeps refreshing an existing saved bank link when bank_data is true, without a new consent record', async () => {
    store.profile = { consents: { version: '2026-09-17', source: 'sign-up', bank_data: true, terms: true, ai_review: true }, plaid_item_id: 'item-1', plaid_token: 'stored-access' };
    expect(await hasCurrentBankConsent('owner')).toBe(true);
    store.profile = { consents: store.profile.consents };
    store.links = [{ uid: 'owner', itemId: 'item-1', encryptedAccessToken: 'stored-access', status: 'active' }];
    expect(legacyBankDataConsentStillCounts(store.profile.consents, ACCEPT_LEGACY_BANK_DATA_CONSENT, true)).toBe(true);
    expect(await hasCurrentBankConsent('owner')).toBe(true);
    m.sync.mockResolvedValue({ success: true, transactionsSaved: 2, accountsProcessed: 1 });
    const response = await syncTransactions(new Request('https://writeoff.test/api/plaid/sync-transactions', {
      method: 'POST', body: JSON.stringify({ incremental: true, itemId: 'item-1' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, transactions_saved: 2 });
    expect(m.sync).toHaveBeenCalledWith('owner', 'item-1');
    expect(store.bankConsents).toEqual([]);
    expect(m.exchange).not.toHaveBeenCalled();
  });

  it('uses the lookup sentence only when the stored acknowledgment cannot be read', async () => {
    store.failRead = true;
    const response = await exchangePublicToken(exchangeBody({ public_token: 'public-sandbox-test' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: BANK_CONSENT_LOOKUP_ERROR });
    expect(m.exchange).not.toHaveBeenCalled();
  });

  it('keeps an older bank_data acknowledgment behind one switch and a saved bank link', () => {
    expect(ACCEPT_LEGACY_BANK_DATA_CONSENT).toBe(true);
    expect(legacyBankDataConsentStillCounts({ bank_data: true }, true, true)).toBe(true);
    expect(legacyBankDataConsentStillCounts({ bank_data: true })).toBe(false);
    expect(legacyBankDataConsentStillCounts({ bank_data: true }, false, true)).toBe(false);
    expect(legacyBankDataConsentStillCounts({ bank_data: true }, true, false)).toBe(false);
    expect(legacyBankDataConsentStillCounts({ bank_data: false }, true, true)).toBe(false);
    expect(legacyBankDataConsentStillCounts(undefined, true, true)).toBe(false);
  });

  it('does not treat bank_data false or a different wording hash as a current acknowledgment', async () => {
    store.profile = { consents: { version: '2026-10-11', source: 'sign-up', bank_data: false, terms: true, ai_review: true } };
    expect((await exchangePublicToken(exchangeBody({ public_token: 'public-sandbox-test' }))).status).toBe(403);
    store.profile = undefined;
    store.bankConsents.push({ ...currentRecord, wording_hash: 'different-wording' });
    expect((await exchangePublicToken(exchangeBody({ public_token: 'public-sandbox-test' }))).status).toBe(403);
    expect(m.exchange).not.toHaveBeenCalled();
  });
});
