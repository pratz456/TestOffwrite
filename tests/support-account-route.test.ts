import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => ({ user: null as null | { uid: string; admin?: boolean }, getUser: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: mock.user, error: mock.user ? null : 'Unauthorized' }) }));
vi.mock('@/lib/firebase/admin', async () => ({
  adminDb: (await import('./fixtures/fake-firestore')).createFakeFirestore(), adminAuth: { getUser: mock.getUser },
}));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import { exhaustRateLimit, resetRateLimitStore } from './fixtures/rate-limit-store';
import { GET } from '@/app/api/support/account/[uid]/route';
import { RATE_LIMITS } from '@/lib/security/rate-limit';
import { isSupportAdmin, SUPPORT_AUDIT_COLLECTION, supportAdminUids } from '@/lib/support/access';
import { assertRedacted, FORBIDDEN_DIAGNOSTIC_KEY, maskEmail } from '@/lib/support/account-diagnostics';

const db = adminDb as unknown as FakeFirestore;
const admin = 'support-admin-uid';
const subject = 'customer-uid';
const now = new Date('2026-09-17T12:00:00Z');
// Synthetic sensitive values that must never appear anywhere in a support response.
const SECRETS = ['access-sandbox-synthetic-token', 'ciphertext-synthetic-encrypted', 'cursor-synthetic-position', '123-45-6789', 'sk_test_synthetic', 'whsec_synthetic', '4321.99', '-1500.25', 'Synthetic Client Payment'];

function lookup(uid = subject) {
  return GET(new NextRequest(`https://writeoff.test/api/support/account/${encodeURIComponent(uid)}`), { params: Promise.resolve({ uid }) });
}
function seedSubject() {
  db.records.set(`user_profiles/${subject}`, {
    email: 'customer@example.test', name: 'Synthetic Customer', ssn: '123-45-6789', taxId: '123-45-6789', bankConnected: true,
    plaid_token: 'access-sandbox-synthetic-token', plaid_credentials_migrated: true,
    subscriptionStatus: 'active', subscriptionPlan: 'premium', stripeCustomerId: 'cus_synthetic', stripeSubscriptionId: 'sub_synthetic',
    stripeSubscriptionStatus: 'active', subscriptionEnd: new Date('2026-12-01T00:00:00Z'), hasHistoricalAccess: true,
    last_sync: new Date('2026-09-16T08:00:00Z'), last_sync_source: 'plaid_webhook', last_import_timeframe: '2years',
  });
  db.records.set(`user_profiles/${subject}/stripe_sync/state`, { revision: 7, eventId: 'evt_synthetic', eventCreated: 1_789_000_000, webhookSecret: 'whsec_synthetic' });
  db.records.set(`user_profiles/${subject}/accounts/acc/transactions/t1`, { amount: 4321.99, merchant_name: 'Synthetic Client Payment', userId: subject });
  db.records.set('plaid_connections/item-legacy', { uid: subject, itemId: 'item-legacy', institutionId: 'ins_1', status: 'revocation_required', clientId: 'old-client',
    environment: 'production', encryptedAccessToken: 'ciphertext-synthetic-encrypted', accountIds: ['a1', 'a2'], cursor: 'cursor-synthetic-position', lastSync: new Date('2026-09-01T00:00:00Z') });
  db.records.set('plaid_connections/item-current', { uid: subject, itemId: 'item-current', institutionId: 'ins_2', status: 'relink_required', clientId: 'current-client',
    environment: 'sandbox', reauthenticationRequired: true, accountIds: ['a3'], leaseExpiresAt: now.getTime() + 60_000, connectedAt: new Date('2026-08-01T00:00:00Z') });
  db.records.set('plaid_connections/item-other', { uid: 'someone-else', itemId: 'item-other', status: 'active', encryptedAccessToken: 'other-ciphertext' });
  db.records.set(`account_deletions/${subject}`, { deletionRequested: true,
    linkOperations: { op1: { state: 'exchange_unknown', startedAt: 1_757_000_000_000, publicToken: 'public-sandbox-synthetic' } },
    billingOperations: { bill1: { state: 'customer_create_unknown', startedAt: 1_757_000_100_000, customerId: 'cus_pending', recoveryRequired: true, stripeSecret: 'sk_test_synthetic' } } });
  db.records.set(`account_deletions/${subject}/plaid_revocations/rev1`, { status: 'revocation_pending', itemId: 'item-legacy', clientId: 'old-client', environment: 'production',
    encryptedAccessToken: 'ciphertext-synthetic-encrypted', createdAt: new Date('2026-09-10T00:00:00Z') });
  for (const [id, status, code] of [['t1', 'queued', null], ['t2', 'running', null], ['t3', 'failed', 'AI_UNAVAILABLE'], ['t4', 'failed', 'AI_TIMEOUT'], ['t5', 'completed', null], ['t6', 'retry_wait', 'AI_TIMEOUT']] as const) {
    db.records.set(`analysis_tasks/${id}`, { userId: subject, status, lastErrorCode: code, amount: -1500.25 });
  }
  db.records.set('analysis_tasks/foreign', { userId: 'someone-else', status: 'failed', lastErrorCode: 'FOREIGN_CODE' });
  db.records.set(`analysis_jobs/${subject}_acc`, { userId: subject, status: 'running' });
  db.records.set(`analysis_jobs/${subject}_old`, { userId: subject, status: 'done' });
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  db.records.clear(); resetRateLimitStore();
  vi.stubEnv('SUPPORT_ADMIN_UIDS', ` ${admin}, second-admin ,, `);
  vi.stubEnv('PLAID_CLIENT_ID', 'current-client'); vi.stubEnv('PLAID_ENV', 'sandbox');
  mock.user = { uid: admin, admin: true };
  mock.getUser.mockResolvedValue({ uid: subject, email: 'customer@example.test', emailVerified: true, disabled: false,
    providerData: [{ providerId: 'password' }, { providerId: 'google.com' }],
    metadata: { creationTime: 'Mon, 01 Jun 2026 00:00:00 GMT', lastSignInTime: 'Tue, 15 Sep 2026 09:30:00 GMT' } });
  seedSubject();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const auditEntries = () => [...db.records].filter(([path]) => path.startsWith(`${SUPPORT_AUDIT_COLLECTION}/`)).map(([, data]) => data);

describe('support account diagnostics route', () => {
  it('does not exist when no support allowlist is configured, even for a caller with the admin claim', async () => {
    for (const configured of ['', '   ', ',,', 'bad/uid']) {
      vi.stubEnv('SUPPORT_ADMIN_UIDS', configured);
      const response = await lookup();
      expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Not found' });
    }
    expect(mock.getUser).not.toHaveBeenCalled(); expect(auditEntries()).toEqual([]);
  });
  it.each([
    ['an anonymous caller', null],
    ['an allowlisted caller without the admin claim', { uid: admin }],
    ['an allowlisted caller with a false claim', { uid: admin, admin: false }],
    ['a claim-bearing caller outside the allowlist', { uid: 'other-staff', admin: true }],
    ['the account owner', { uid: subject, admin: true }],
  ])('hides the route from %s', async (_label, user) => {
    mock.user = user;
    const response = await lookup();
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mock.getUser).not.toHaveBeenCalled(); expect(auditEntries()).toEqual([]);
  });
  it('returns a redacted summary of plan, banks, deletion gate, sync and analysis state to an allowlisted admin', async () => {
    const response = await lookup();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { diagnostics } = await response.json();
    expect(diagnostics).toMatchObject({
      uid: subject,
      auth: { exists: true, emailMasked: 'c***@example.test', emailVerified: true, disabled: false, providers: ['password', 'google.com'],
        createdAt: '2026-06-01T00:00:00.000Z', lastSignInAt: '2026-09-15T09:30:00.000Z' },
      profile: { exists: true, emailMasked: 'c***@example.test', bankConnected: true, legacyCredentialsPresent: true, legacyCredentialsMigrated: true,
        lastSync: '2026-09-16T08:00:00.000Z', lastSyncSource: 'plaid_webhook', lastImportTimeframe: '2years' },
      entitlement: { plan: 'premium', status: 'active', reason: 'paid_active', hasAccess: true, isPaid: true, isTrial: false, subscriptionEnd: '2026-12-01T00:00:00.000Z' },
      billing: { stripeCustomerId: 'cus_synthetic', stripeSubscriptionId: 'sub_synthetic', stripeSubscriptionStatus: 'active', subscriptionPlan: 'premium',
        hasHistoricalAccess: true, syncRevision: 7, lastWebhookEventId: 'evt_synthetic', lastWebhookEventAt: new Date(1_789_000_000_000).toISOString() },
      deletion: { requested: true, blockedByOperations: true,
        linkOperations: [{ id: 'op1', state: 'exchange_unknown', startedAt: new Date(1_757_000_000_000).toISOString() }],
        billingOperations: [{ id: 'bill1', state: 'customer_create_unknown', customerId: 'cus_pending', recoveryRequired: true }],
        revocationRecords: [{ id: 'rev1', status: 'revocation_pending', itemId: 'item-legacy', currentProvider: false, createdAt: '2026-09-10T00:00:00.000Z' }] },
      analysis: { tasks: { queued: 1, running: 1, retry_wait: 1, paused: 0, failed: 2, completed: 1, skipped: 0 }, truncated: false,
        lastErrorCodes: ['AI_TIMEOUT', 'AI_UNAVAILABLE'], activeJobs: 1 },
    });
    expect(diagnostics.bankConnections).toEqual([
      expect.objectContaining({ itemId: 'item-current', status: 'relink_required', currentProvider: true, reauthenticationRequired: true, accountCount: 1,
        hasEncryptedToken: false, hasCursor: false, leaseActive: true, connectedAt: '2026-08-01T00:00:00.000Z' }),
      expect.objectContaining({ itemId: 'item-legacy', status: 'revocation_required', currentProvider: false, reauthenticationRequired: false, accountCount: 2,
        hasEncryptedToken: true, hasCursor: true, leaseActive: false, lastSync: '2026-09-01T00:00:00.000Z' }),
    ]);
    expect(diagnostics.bankConnections.map((bank: { itemId: string }) => bank.itemId)).not.toContain('item-other');
    expect(diagnostics.analysis.lastErrorCodes).not.toContain('FOREIGN_CODE');
  });
  it('never includes tokens, taxpayer identifiers, cursors, Stripe secrets or transaction amounts, and records the access', async () => {
    const response = await lookup();
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain('customer@example.test');
    const keys = new Set<string>();
    JSON.parse(text, (key, value) => { keys.add(key); return value; });
    const leaked = [...keys].filter(key => FORBIDDEN_DIAGNOSTIC_KEY.test(key) && !/^has[A-Z]/.test(key));
    expect(leaked).toEqual([]);
    expect(auditEntries()).toEqual([{ actorUid: admin, subjectUid: subject, action: 'account-diagnostics', at: now }]);
    expect(JSON.stringify(auditEntries())).not.toContain('cus_synthetic');
  });
  it('reports a missing account without inventing records', async () => {
    db.records.clear();
    mock.getUser.mockRejectedValue(Object.assign(new Error('There is no user record'), { code: 'auth/user-not-found' }));
    const response = await lookup('never-registered');
    expect(response.status).toBe(200);
    const { diagnostics } = await response.json();
    expect(diagnostics).toMatchObject({ auth: { exists: false, emailMasked: null }, profile: { exists: false, legacyCredentialsPresent: false },
      entitlement: { plan: 'free', hasAccess: false }, bankConnections: [], deletion: { requested: false, blockedByOperations: false, linkOperations: [], billingOperations: [] },
      analysis: { activeJobs: 0, lastErrorCodes: [] } });
  });
  it('rejects malformed account identifiers before any lookup', async () => {
    for (const uid of ['', '../other', 'a/b', 'x'.repeat(129)]) {
      expect((await lookup(uid)).status).toBe(400);
    }
    expect(mock.getUser).not.toHaveBeenCalled(); expect(auditEntries()).toEqual([]);
  });
  it('throttles support lookups per admin with Retry-After', async () => {
    await exhaustRateLimit(RATE_LIMITS.supportAccountLookup, admin);
    const response = await lookup();
    expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(mock.getUser).not.toHaveBeenCalled(); expect(auditEntries()).toEqual([]);
  });
  it('withholds the summary when the lookup or its audit record fails, without leaking the cause', async () => {
    mock.getUser.mockRejectedValue(new Error('private admin sdk failure'));
    let response = await lookup();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private admin sdk');
    expect(auditEntries()).toEqual([]);
    mock.getUser.mockResolvedValue({ uid: subject, email: null, emailVerified: false, disabled: false, providerData: [], metadata: {} });
    const original = db.collection;
    db.collection = ((path: string) => path === SUPPORT_AUDIT_COLLECTION
      ? { add: async () => { throw new Error('audit unavailable'); } } : original(path)) as typeof db.collection;
    try { response = await lookup(); } finally { db.collection = original; }
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('cus_synthetic');
  });
});

describe('support access helpers', () => {
  it('parses the allowlist strictly and requires both the allowlist and the verified claim', () => {
    expect([...supportAdminUids(' a ,b,,c/d, e f ,g')]).toEqual(['a', 'b', 'g']);
    expect(supportAdminUids('').size).toBe(0);
    vi.stubEnv('SUPPORT_ADMIN_UIDS', ''); expect(supportAdminUids().size).toBe(0);
    const allowlist = new Set(['a']);
    expect(isSupportAdmin({ uid: 'a', admin: true }, allowlist)).toBe(true);
    expect(isSupportAdmin({ uid: 'a' }, allowlist)).toBe(false);
    expect(isSupportAdmin({ uid: 'b', admin: true }, allowlist)).toBe(false);
    expect(isSupportAdmin({ uid: 'a', admin: true }, new Set())).toBe(false);
    expect(isSupportAdmin(null, allowlist)).toBe(false);
  });
  it('masks emails and rejects forbidden fields while allowing boolean presence flags', () => {
    expect(maskEmail('customer@example.test')).toBe('c***@example.test');
    expect(maskEmail('not-an-email')).toBeNull(); expect(maskEmail(undefined)).toBeNull();
    expect(() => assertRedacted({ bankConnections: [{ hasEncryptedToken: true, hasCursor: false }] })).not.toThrow();
    expect(() => assertRedacted({ bankConnections: [{ hasEncryptedToken: 'ciphertext' }] })).toThrow(/hasEncryptedToken/);
    for (const key of ['accessToken', 'encryptedAccessToken', 'ssn', 'cursor', 'amount', 'stripeSecret', 'password', 'privateKey']) {
      expect(() => assertRedacted({ nested: [{ [key]: 'value' }] })).toThrow(new RegExp(key));
    }
  });
});
