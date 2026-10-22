import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BANK_CONSENT_TEXT, BANK_CONSENT_VERSION } from '@/lib/onboarding/bank-consent-copy';

const hash = createHash('sha256').update(BANK_CONSENT_TEXT, 'utf8').digest('hex');
const store = vi.hoisted(() => ({
  profile: undefined as Record<string, unknown> | undefined,
  bankConsents: [] as Record<string, unknown>[],
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
    collection: () => ({
      get: async () => {
        if (store.failRead) throw new Error('unavailable');
        return { docs: store.bankConsents.map(data => ({ data: () => data })) };
      },
      doc: () => ({ create: async (data: Record<string, unknown>) => { store.bankConsents.push({ ...data }); } }),
    }),
  },
  FieldValue: { serverTimestamp: () => 'server-time' },
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

  it('exchanges when an older profile record has bank_data true', async () => {
    store.profile = { consents: { version: '2026-09-17', source: 'sign-up', bank_data: true, terms: true, ai_review: true } };
    const response = await exchangeToken(new Request('https://writeoff.test/api/plaid/exchange-token', {
      method: 'POST', body: JSON.stringify({ publicToken: 'public-sandbox-test' }),
    }));
    expect(response.status).toBe(200);
    expect(m.exchange).toHaveBeenCalledOnce();
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
