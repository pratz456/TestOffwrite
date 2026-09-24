import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { isLocalAccountPreview, localAccountPreviewBlocksBankRequest } from '@/lib/firebase/local-account-preview';
import { migrateLegacyPlaidCredentials, refreshBankConnectionProjection } from '@/lib/plaid/legacy-migration';
import { createFakeFirestore, fakeFieldValue } from './fixtures/fake-firestore';

const preview = {
  WRITEOFF_LOCAL_ACCOUNT_PREVIEW: 'true', NODE_ENV: 'development',
  WRITEOFF_ENV: 'local-account-preview', NEXT_PUBLIC_APP_ENV: 'local-account-preview',
  NEXT_PUBLIC_AUTO_SYNC_ON_VISIT: 'false', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-23910',
  FIREBASE_ADMIN_PROJECT_ID: 'writeoff-23910', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3003',
  WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL: 'owner@example.com',
};
afterEach(() => vi.unstubAllEnvs());

describe('explicit local real-account preview', () => {
  it('leaves every normal deployed environment unchanged', () => {
    expect(isLocalAccountPreview({ NODE_ENV: 'production' })).toBe(false);
    expect(isLocalAccountPreview({ WRITEOFF_LOCAL_ACCOUNT_PREVIEW: 'false' })).toBe(false);
    expect(localAccountPreviewBlocksBankRequest({ url: 'https://writeoffapp.com/api/plaid/sync-transactions' }, {})).toBe(false);
  });
  it.each(['http://localhost:3003', 'http://127.0.0.1:3003', 'http://[::1]:3003'])('allows explicit loopback preview at %s', site => {
    expect(isLocalAccountPreview({ ...preview, NEXT_PUBLIC_SITE_URL: site })).toBe(true);
  });
  it.each([
    { WRITEOFF_LOCAL_ACCOUNT_PREVIEW: 'yes' }, { NODE_ENV: 'production' }, { WRITEOFF_ENV: 'production' },
    { NEXT_PUBLIC_APP_ENV: 'local' }, { NEXT_PUBLIC_AUTO_SYNC_ON_VISIT: 'true' },
    { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production-testing' }, { FIREBASE_ADMIN_PROJECT_ID: '' },
    { GCLOUD_PROJECT: 'another-project' }, { NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' }, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9299' }, { FUNCTIONS_EMULATOR: 'true' },
    { NEXT_PUBLIC_SITE_URL: 'https://writeoffapp.com' }, { NEXT_PUBLIC_SITE_URL: 'http://localhost.evil.example' },
    { NEXT_PUBLIC_SITE_URL: 'http://user:password@localhost:3003' }, { NEXT_PUBLIC_SITE_URL: 'http://localhost:3003/path' },
    { NEXT_PUBLIC_SITE_URL: 'http://localhost:3003?preview=true' },
    { WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL: '' }, { WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL: 'not-an-email' },
  ])('rejects an ambiguous or unsafe mode: %j', change => {
    expect(() => isLocalAccountPreview({ ...preview, ...change })).toThrow();
  });
  it.each(['sync-transactions', 'exchange-token', 'link-token', 'items/bank', 'webhook', 'sync-transactions-internal', 'import-status'])('blocks every Plaid path including %s', endpoint => {
    expect(localAccountPreviewBlocksBankRequest({ url: `http://localhost:3003/api/plaid/${endpoint}` }, preview)).toBe(true);
  });
  it('retains account reads and deliberate transaction analysis', () => {
    for (const pathname of ['/api/accounts', '/api/database/profiles', '/api/ai/analyze-transaction', '/api/plaid-lookalike']) {
      expect(localAccountPreviewBlocksBankRequest({ url: `http://localhost:3003${pathname}` }, preview)).toBe(false);
    }
  });
  it('preserves legacy credentials, bank connection state, accounts and decisions without any database access', async () => {
    for (const [name, value] of Object.entries(preview)) vi.stubEnv(name, value);
    const db = createFakeFirestore();
    db.records.set('user_profiles/owner', { bankConnected: true, plaid_token: 'synthetic-old-token', plaid_item_id: 'old-bank' });
    db.records.set('user_profiles/owner/accounts/bank', { access_token: 'synthetic-account-token', balance: 100 });
    db.records.set('user_profiles/owner/accounts/bank/transactions/t1', { review_status: 'confirmed', is_deductible: true });
    const before = structuredClone(Object.fromEntries(db.records));
    const doc = vi.spyOn(db, 'doc'); const transaction = vi.spyOn(db, 'runTransaction');
    expect(await migrateLegacyPlaidCredentials(db as unknown as Firestore, fakeFieldValue, 'owner')).toEqual({
      outcome: 'preview_read_only', tokenMoved: false, accountTokensCleared: 0, paginated: false,
    });
    await refreshBankConnectionProjection(db as unknown as Firestore, 'owner');
    expect(doc).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
    expect(Object.fromEntries(db.records)).toEqual(before);
  });
  it('fails before database access if a preview flag reaches production', async () => {
    for (const [name, value] of Object.entries({ ...preview, NODE_ENV: 'production' })) vi.stubEnv(name, value);
    const db = createFakeFirestore(); const doc = vi.spyOn(db, 'doc');
    await expect(migrateLegacyPlaidCredentials(db as unknown as Firestore, fakeFieldValue, 'owner')).rejects.toThrow();
    expect(doc).not.toHaveBeenCalled();
  });
});
