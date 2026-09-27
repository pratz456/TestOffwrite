import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({ records: new Map<string, Record<string, any>>(), files: new Set<string>(), events: [] as string[],
  handoff: vi.fn(), disconnect: vi.fn(), recovery: vi.fn(), billing: vi.fn(), storage: vi.fn(), authDelete: vi.fn(), failBatch: false, authUser: 'owner' as string | null }));
vi.mock('@/lib/firebase/admin', () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1),
    get: async () => ({ exists: h.records.has(path), data: () => h.records.get(path), ref: ref(path) }),
    delete: async () => { h.events.push(`delete:${path}`); h.records.delete(path); },
    collection: (name: string) => query(`${path}/${name}`),
  });
  const query = (path: string, filters: Array<[string, unknown]> = [], maximum = 500): any => ({ path,
    doc: (id: string) => ref(`${path}/${id}`), where: (field: string, _op: string, value: unknown) => query(path, [...filters, [field, value]], maximum),
    limit: (count: number) => query(path, filters, count), startAfter: () => query(path, filters, maximum),
    get: async () => { const paths = [...h.records].filter(([key, data]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && filters.every(([field, value]) => data[field] === value)).slice(0, maximum);
      const docs = paths.map(([key, data]) => ({ ref: ref(key), data: () => data })); return { docs, empty: !docs.length }; },
  });
  return { adminAuth: { deleteUser: h.authDelete }, adminDb: { doc: ref, collection: query,
    recursiveDelete: async (reference: any) => { h.events.push(`tree:${reference.path}`); for (const key of h.records.keys()) if (key === reference.path || key.startsWith(`${reference.path}/`)) h.records.delete(key); },
    runTransaction: async (work: any) => { const writes: Array<() => void> = []; const result = await work({ get: (r: any) => r.get(),
      set: (r: any, data: any, options?: any) => writes.push(() => h.records.set(r.path, { ...(options?.merge ? h.records.get(r.path) : {}), ...data })),
      update: (r: any, data: any) => writes.push(() => h.records.set(r.path, { ...h.records.get(r.path), ...data })) }); writes.forEach(write => write()); return result; },
    batch: () => { const rows: string[] = []; return { delete: (r: any) => rows.push(r.path), commit: async () => { if (h.failBatch) throw new Error('database unavailable'); rows.forEach(path => { h.events.push(`delete:${path}`); h.records.delete(path); }); } }; },
  } };
});
vi.mock('@/lib/preparer/handoffs', () => ({ deletePreparerHandoffsForUser: h.handoff }));
vi.mock('@/lib/plaid/connections', () => ({ listPlaidConnectionSummaries: async (uid: string) => [...h.records].filter(([key, data]) => key.startsWith('plaid_connections/') && data.uid === uid && data.status !== 'disconnected').map(([key, data]) => ({ itemId: key.split('/')[1], reauthenticationRequired: data.reauthenticationRequired })) }));
vi.mock('@/lib/plaid/delete-item', () => ({ disconnectPlaidItem: h.disconnect }));
vi.mock('@/lib/plaid/link-operations', () => ({ recoverPendingPlaidLinks: h.recovery }));
vi.mock('@/lib/stripe/cancel-subscription', () => ({ cancelUserStripeSubscriptions: h.billing }));
vi.mock('@/lib/firebase/receipt-security', () => ({ receiptBucket: () => ({ deleteFiles: h.storage }) }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: h.authUser ? { uid: h.authUser } : null }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { deleteUserData } from '@/lib/firebase/delete-user-data';
import { DELETE } from '@/app/api/user/delete/route';
import { RATE_LIMITS } from '@/lib/security/rate-limit';
import { exhaustRateLimit, failRateLimitStore, resetRateLimitStore } from './fixtures/rate-limit-store';

function bank(id: string, extra = {}) { h.records.set(`plaid_connections/${id}`, { uid: 'owner', status: 'active', clientId: 'current-client', environment: 'sandbox', encryptedAccessToken: 'synthetic-ciphertext', ...extra }); }
beforeEach(() => {
  vi.clearAllMocks(); resetRateLimitStore(); h.records.clear(); h.files.clear(); h.events = []; h.failBatch = false; h.authUser = 'owner';
  vi.stubEnv('PLAID_CLIENT_ID', 'current-client'); vi.stubEnv('PLAID_ENV', 'sandbox');
  h.records.set('user_profiles/owner', { name: 'Synthetic owner' });
  h.disconnect.mockImplementation(async (uid: string, itemId: string) => { const record = h.records.get(`plaid_connections/${itemId}`)!; expect(record.uid).toBe(uid);
    h.events.push(`revoke:${itemId}`); record.status = 'disconnected'; delete record.encryptedAccessToken; return { success: true, plaidRemoved: true }; });
  h.billing.mockImplementation(async () => { h.events.push('billing'); return { success: true }; });
  h.handoff.mockImplementation(async () => { h.events.push('handoff'); });
  h.recovery.mockImplementation(async (uid: string) => { expect(h.records.get(`account_deletions/${uid}`)?.deletionRequested).toBe(true); });
  h.storage.mockImplementation(async ({ prefix }: { prefix: string }) => { h.events.push('storage'); for (const key of h.files) if (key.startsWith(prefix)) h.files.delete(key); });
  h.authDelete.mockImplementation(async () => { h.events.push('auth'); });
});
afterEach(() => vi.unstubAllEnvs());

describe('account deletion boundaries', () => {
  it('retains identity and records when shared package cleanup fails', async () => {
    h.handoff.mockRejectedValueOnce(new Error('storage failure'));
    expect((await deleteUserData('owner')).error).toMatchObject({ code: 'HANDOFF_CLEANUP_FAILED', retryable: true });
    expect(h.billing).not.toHaveBeenCalled();
    expect(h.authDelete).not.toHaveBeenCalled();
    expect(h.records.has('user_profiles/owner')).toBe(true);
  });
  it('revokes every owned bank including reauthentication items, deletes scoped receipts/data, and deletes Auth last', async () => {
    bank('a'); bank('b', { reauthenticationRequired: true }); bank('foreign', { uid: 'other' });
    for (const [path, data] of [
      ['user_profiles/owner/accounts/a/transactions/x', { amount: 20 }], ['user_profiles/owner/settings/taxSummary', { private: true }],
      ['receipts/mine', { userId: 'owner' }], ['receipts/legacy', { user_id: 'owner' }], ['tax_organizers/mine', { userId: 'owner' }],
      ['analysis_tasks/mine', { userId: 'owner' }], ['w2_income/mine', { user_id: 'owner' }],
      ['cpa_questions/mine', { userId: 'owner' }],
      ['receipts/other', { userId: 'owner-other' }], ['user_profiles/owner-other', { name: 'Other' }],
    ] as const) h.records.set(path, data);
    h.files.add('receipts/owner/tx/file'); h.files.add('receipts/owner-other/tx/file');
    expect(await deleteUserData('owner')).toEqual({});
    expect(h.disconnect.mock.calls).toEqual([['owner', 'a'], ['owner', 'b']]);
    expect(h.handoff).toHaveBeenCalledExactlyOnceWith('owner');
    expect(h.events.indexOf('handoff')).toBeLessThan(h.events.indexOf('billing'));
    expect(h.storage).toHaveBeenCalledExactlyOnceWith({ prefix: 'receipts/owner/' });
    expect(h.files).toEqual(new Set(['receipts/owner-other/tx/file']));
    expect([...h.records.keys()].filter(key => !key.startsWith('account_deletions/'))).toEqual(['plaid_connections/foreign', 'receipts/other', 'user_profiles/owner-other']);
    expect(h.events.at(-1)).toBe('auth');
    expect(h.records.get('account_deletions/owner')).toEqual({ deletionRequested: true });
  });
  it.each(['in_flight', 'exchange_unknown', 'ownership_conflict'])('retains unresolved %s bank operations without expiring their protection', async state => {
    bank('a');
    h.records.set('account_deletions/owner', { linkOperations: { oldOperation: { state, startedAt: 1 } }, deletionRequested: false });
    expect((await deleteUserData('owner')).error).toMatchObject({ code: 'ACCOUNT_OPERATION_PENDING', status: 409 });
    expect(h.records.get('account_deletions/owner')).toMatchObject({ deletionRequested: true, linkOperations: { oldOperation: { state, startedAt: 1 } } });
    expect(h.disconnect).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled();
    expect(h.records.has('user_profiles/owner')).toBe(true); expect(h.authDelete).not.toHaveBeenCalled();
  });
  it('recovers a known pending bank revocation before retrying deletion and retains its durable tombstone', async () => {
    h.records.set('account_deletions/owner', { deletionRequested: true, linkOperations: { recoverable: { state: 'revocation_pending', startedAt: 1 } } });
    h.records.set('account_deletions/owner/plaid_revocations/recoverable', { encryptedAccessToken: 'synthetic' });
    h.recovery.mockImplementationOnce(async () => {
      h.records.get('account_deletions/owner')!.linkOperations = {};
      h.records.delete('account_deletions/owner/plaid_revocations/recoverable');
    });
    expect(await deleteUserData('owner')).toEqual({});
    expect(h.records.get('account_deletions/owner')).toEqual({ deletionRequested: true, linkOperations: {} });
    expect(h.records.has('user_profiles/owner')).toBe(false); expect(h.authDelete).toHaveBeenCalledExactlyOnceWith('owner');
  });
  it('retains encrypted recovery information and identity when provider compensation fails', async () => {
    const operation = { deletionRequested: true, linkOperations: { pending: { state: 'revocation_pending', startedAt: 1 } } };
    h.records.set('account_deletions/owner', operation);
    h.records.set('account_deletions/owner/plaid_revocations/pending', { encryptedAccessToken: 'synthetic' });
    h.recovery.mockRejectedValueOnce(new Error('private provider failure'));
    expect((await deleteUserData('owner')).error).toMatchObject({ code: 'BANK_LINK_RECOVERY_REQUIRED', retryable: true });
    expect(h.records.get('account_deletions/owner')).toEqual(operation);
    expect(h.records.has('account_deletions/owner/plaid_revocations/pending')).toBe(true);
    expect(h.authDelete).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled();
  });
  it.each(['in_flight', 'customer_create_unknown', 'customer_cleanup_required'])('blocks unresolved %s billing operations and preserves recovery details', async state => {
    const billingOperations = { pending: { state, startedAt: 1, customerId: 'synthetic-customer' } };
    h.records.set('account_deletions/owner', { billingOperations });
    expect((await deleteUserData('owner')).error).toMatchObject({ code: 'ACCOUNT_OPERATION_PENDING', status: 409 });
    expect(h.records.get('account_deletions/owner')).toEqual({ billingOperations, deletionRequested: true });
    expect(h.authDelete).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled();
  });
  it('retains the account when the second revocation fails and retries only the remaining bank', async () => {
    bank('a'); bank('b'); const revoke = h.disconnect.getMockImplementation()!;
    h.disconnect.mockImplementationOnce(revoke).mockResolvedValueOnce({ success: false });
    expect((await deleteUserData('owner')).error).toMatchObject({ code: 'BANK_REVOCATION_FAILED', retryable: true });
    expect(h.records.has('user_profiles/owner')).toBe(true); expect(h.records.get('plaid_connections/b')?.encryptedAccessToken).toBeTruthy();
    expect(h.authDelete).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled();
    expect(await deleteUserData('owner')).toEqual({});
    expect(h.disconnect.mock.calls).toEqual([['owner', 'a'], ['owner', 'b'], ['owner', 'b']]);
  });
  it.each([{ clientId: 'old-client' }, { clientId: null }, { environment: 'production' }, { status: 'revocation_required' }])('retains legacy revocation metadata and never sends it with new keys: %j', async extra => {
    bank('legacy', extra);
    const response = await DELETE(new NextRequest('https://writeoff.test/api/user/delete', { method: 'DELETE' }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'LEGACY_BANK_REVOCATION_REQUIRED', retryable: false });
    expect(h.disconnect).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled();
    expect(h.records.get('plaid_connections/legacy')?.encryptedAccessToken).toBe('synthetic-ciphertext'); expect(h.authDelete).not.toHaveBeenCalled();
  });
  it('requires the disconnected state and token erasure even if a helper claims success', async () => {
    bank('a'); h.disconnect.mockResolvedValue({ success: true });
    expect((await deleteUserData('owner')).error?.code).toBe('BANK_REVOCATION_FAILED'); expect(h.authDelete).not.toHaveBeenCalled();
  });
  it('retains an unexpected unrevoked bank record that appears during later cleanup', async () => {
    h.storage.mockImplementationOnce(async () => { bank('late'); });
    expect((await deleteUserData('owner')).error?.code).toBe('BANK_REVOCATION_FAILED');
    expect(h.records.get('plaid_connections/late')?.encryptedAccessToken).toBe('synthetic-ciphertext');
    expect(h.authDelete).not.toHaveBeenCalled(); expect(h.records.has('user_profiles/owner')).toBe(true);
  });
  it.each(['billing', 'storage', 'database'])('does not delete Auth when %s cleanup fails', async step => {
    h.records.set('receipts/mine', { userId: 'owner' });
    if (step === 'billing') h.billing.mockResolvedValue({ success: false });
    if (step === 'storage') h.storage.mockRejectedValue(new Error('private provider details'));
    if (step === 'database') h.failBatch = true;
    const result = await deleteUserData('owner');
    expect(result.error?.retryable).toBe(true); expect(result.error?.message).not.toContain('private provider details');
    expect(h.authDelete).not.toHaveBeenCalled(); expect(h.records.has('user_profiles/owner')).toBe(true); expect(h.records.has('receipts/mine')).toBe(true);
  });
  it('stops on conflicting owner fields instead of deleting another owner’s record', async () => {
    h.records.set('receipts/conflict', { userId: 'owner', user_id: 'other' });
    expect((await deleteUserData('owner')).error?.code).toBe('ACCOUNT_OWNERSHIP_CONFLICT');
    expect(h.records.has('receipts/conflict')).toBe(true); expect(h.authDelete).not.toHaveBeenCalled();
  });
  it.each(['', '../other', 'owner/other', 'owner\\other'])('refuses unsafe storage prefixes for UID %s', async uid => {
    expect((await deleteUserData(uid)).error?.code).toBe('INVALID_ACCOUNT'); expect(h.storage).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated deletion before any cleanup', async () => {
    h.authUser = null;
    expect((await DELETE(new NextRequest('https://writeoff.test/api/user/delete', { method: 'DELETE' }))).status).toBe(401);
    expect(h.disconnect).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled();
  });
  it('bounds deletion retries per owner with Retry-After and touches nothing when throttled', async () => {
    bank('a'); h.records.set('receipts/mine', { userId: 'owner' });
    await exhaustRateLimit(RATE_LIMITS.userDelete, 'owner');
    const response = await DELETE(new NextRequest('https://writeoff.test/api/user/delete', { method: 'DELETE' }));
    expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', error: expect.stringContaining('deletion attempts') });
    expect(h.disconnect).not.toHaveBeenCalled(); expect(h.billing).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled(); expect(h.authDelete).not.toHaveBeenCalled();
    expect(h.records.has('user_profiles/owner')).toBe(true); expect(h.records.has('receipts/mine')).toBe(true); expect(h.records.has('account_deletions/owner')).toBe(false);
  });
  it('fails closed on deletion when the limiter store is unreachable, leaving the account intact', async () => {
    failRateLimitStore();
    const response = await DELETE(new NextRequest('https://writeoff.test/api/user/delete', { method: 'DELETE' }));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' });
    expect(h.authDelete).not.toHaveBeenCalled(); expect(h.records.has('user_profiles/owner')).toBe(true);
  });
});

 it('revokes pending current-client history review before recursive deletion', async () => {
  bank('pending', { status: 'pending_history_review' });
  h.records.set('user_profiles/owner/bank_reconnects/review/import_records/private', { uid: 'owner', amount: 10 });
  const result = await deleteUserData('owner');
  expect(result.error).toBeUndefined();
  expect(h.disconnect).toHaveBeenCalledWith('owner', 'pending');
  expect(h.records.has('user_profiles/owner/bank_reconnects/review/import_records/private')).toBe(false);
 });
