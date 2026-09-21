import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ records: new Map<string, Record<string, any>>(), remove: vi.fn(), accounts: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => {
  const apply = (path: string, data: Record<string, unknown>, merge = true) => {
    const next = merge ? { ...memory.records.get(path) } : {};
    for (const [key, value] of Object.entries(data)) { if (value === '__delete__') delete next[key]; else next[key] = value; }
    memory.records.set(path, next);
  };
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => query(`${path}/${name}`),
    get: async () => ({ id: path.split('/').at(-1), exists: memory.records.has(path), data: () => structuredClone(memory.records.get(path)), ref: ref(path) }),
    set: async (data: any, options?: any) => apply(path, data, options?.merge), update: async (data: any) => apply(path, data), delete: async () => memory.records.delete(path) });
  const query = (path: string, filters: Array<[string, unknown]> = [], maximum = Infinity): any => ({
    path, doc: (id: string) => ref(`${path}/${id}`), where: (key: string, _op: string, value: unknown) => query(path, [...filters, [key, value]], maximum),
    limit: (count: number) => query(path, filters, count), get: async () => {
      const entries = [...memory.records].filter(([key, data]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && filters.every(([field, value]) => data[field] === value)).slice(0, maximum);
      const docs = await Promise.all(entries.map(([key]) => ref(key).get()));
      return { docs, size: docs.length, empty: !docs.length, forEach: (callback: any) => docs.forEach(callback) };
    },
  });
  return { FieldValue: { delete: () => '__delete__' }, adminDb: { doc: ref, collection: query,
    runTransaction: async (work: any) => { const writes: (() => void)[] = [];
      const result = await work({ get: (reference: any) => reference.get(),
        set: (reference: any, data: any, options?: any) => writes.push(() => apply(reference.path, data, options?.merge)),
        update: (reference: any, data: any) => writes.push(() => apply(reference.path, data)),
        delete: (reference: any) => writes.push(() => memory.records.delete(reference.path)) });
      writes.forEach(write => write()); return result;
    } } };
});
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { itemRemove: memory.remove, accountsGet: memory.accounts } }));
import { encryptPlaidToken, decryptPlaidToken, savePlaidConnection, listPlaidConnections, listPlaidConnectionSummaries,
  migrateLegacyPlaidConnection, withPlaidConnection, updatePlaidConnection, markPlaidConnectionLoginRequired, getPlaidConnection } from '@/lib/plaid/connections';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { createAccountServer, updateAccountServer, deleteAccountServer } from '@/lib/firebase/accounts-server';
import { beginPlaidLinkOperation, retainPlaidLinkRecovery, finishPlaidLinkOperation, markPlaidLinkOperationUnresolved,
  recoverPendingPlaidLinks, quarantinePlaidLinkRecovery } from '@/lib/plaid/link-operations';
const record = (path: string) => memory.records.get(path)!;
const profile = 'user_profiles/owner';
async function bank(itemId = 'bank-a', accountId = 'acc-a', uid = 'owner') {
  await savePlaidConnection({ uid, itemId, accessToken: `synthetic-secret-${itemId}`, accountIds: [accountId], institutionId: 'same-institution' });
}
beforeEach(() => { vi.clearAllMocks(); memory.records.clear(); memory.records.set(profile, { name: 'Owner', plaid_credentials_migrated: true });
  vi.stubEnv('PLAID_TOKEN_ENCRYPTION_KEY', '1'.repeat(64)); vi.stubEnv('PLAID_CLIENT_ID', 'new-client'); vi.stubEnv('PLAID_ENV', 'sandbox'); memory.remove.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('private bank credentials and item ownership', () => {
  it('rejects saving a connection after a durable deletion request even when the profile was removed', async () => {
    memory.records.set('account_deletions/owner', { deletionRequested: true });
    memory.records.delete(profile);
    await expect(bank()).rejects.toThrow('ACCOUNT_DELETION_IN_PROGRESS');
    expect(memory.records.has('plaid_connections/bank-a')).toBe(false);
    expect(memory.records.has(`${profile}/accounts/acc-a`)).toBe(false);
    expect(memory.records.has(profile)).toBe(false);
  });
  it('shows the exact Item needing repair while preserving its token for update mode and clearing only after provider verification', async () => {
    await bank(); await bank('bank-b', 'acc-b');
    const encrypted = record('plaid_connections/bank-a').encryptedAccessToken;
    expect(await markPlaidConnectionLoginRequired('bank-a')).toBe(true);
    expect(await listPlaidConnectionSummaries('owner')).toMatchObject([
      { itemId: 'bank-a', status: 'relink_required' }, { itemId: 'bank-b', status: 'active' },
    ]);
    expect((await getPlaidConnection('owner', 'bank-a'))?.accessToken).toBe('synthetic-secret-bank-a');
    await withPlaidConnection('owner', 'bank-a', async (_connection, lease) => {
      await updatePlaidConnection('owner', 'bank-a', {}, lease);
      expect(record('plaid_connections/bank-a').reauthenticationRequired).toBe(true);
      await updatePlaidConnection('owner', 'bank-a', { lastSync: Date.now() }, lease);
      expect(record('plaid_connections/bank-a').reauthenticationRequired).toBe(true);
      await updatePlaidConnection('owner', 'bank-a', { reauthenticationRequired: false }, lease);
    });
    expect((await listPlaidConnectionSummaries('owner'))[0].status).toBe('active');
    expect(record('plaid_connections/bank-a').encryptedAccessToken).toBe(encrypted);
  });
  it('never marks or reactivates unknown, old-provider or disconnected Items after a provider error', async () => {
    expect(await markPlaidConnectionLoginRequired('missing')).toBe(false);
    await bank(); vi.stubEnv('PLAID_CLIENT_ID', 'other-client');
    expect(await markPlaidConnectionLoginRequired('bank-a')).toBe(false);
    vi.stubEnv('PLAID_CLIENT_ID', 'new-client');
    await disconnectPlaidItem('owner', 'bank-a');
    expect(await markPlaidConnectionLoginRequired('bank-a')).toBe(false);
    expect(record('plaid_connections/bank-a').status).toBe('disconnected');
  });
  it('encrypts with random IVs, round trips, and binds ciphertext to the owner and item', () => {
    const encrypted = encryptPlaidToken('owner', 'bank-a', 'synthetic-secret');
    expect(encrypted).not.toContain('synthetic-secret');
    expect(encrypted).not.toEqual(encryptPlaidToken('owner', 'bank-a', 'synthetic-secret'));
    expect(decryptPlaidToken('owner', 'bank-a', encrypted)).toBe('synthetic-secret');
    expect(() => decryptPlaidToken('other', 'bank-a', encrypted)).toThrow();
    expect(() => decryptPlaidToken('owner', 'bank-b', encrypted)).toThrow();
    expect(() => decryptPlaidToken('owner', 'bank-a', encrypted.replace('v1.', 'v2.'))).toThrow();
  });
  it('rejects absent or malformed encryption keys before persisting anything', async () => {
    vi.stubEnv('PLAID_TOKEN_ENCRYPTION_KEY', 'wrong');
    await expect(bank()).rejects.toThrow('encryption');
    expect(memory.records.size).toBe(1);
  });
  it('links two accounts from the same institution without overwriting either encrypted token or cursor', async () => {
    await bank(); await bank('bank-b', 'acc-b');
    await withPlaidConnection('owner', 'bank-a', async (_connection, lease) => updatePlaidConnection('owner', 'bank-a', { cursor: 'cursor-a' }, lease));
    await withPlaidConnection('owner', 'bank-b', async (_connection, lease) => updatePlaidConnection('owner', 'bank-b', { cursor: 'cursor-b' }, lease));
    const all = await listPlaidConnections('owner');
    expect(all.map(item => [item.itemId, item.cursor])).toEqual([['bank-a', 'cursor-a'], ['bank-b', 'cursor-b']]);
    expect(record(profile)).not.toHaveProperty('plaid_token');
    expect(record(profile).bankConnected).toBe(true);
    expect(record(`${profile}/accounts/acc-a`).plaid_item_id).toBe('bank-a');
    expect(record('plaid_connections/bank-a')).not.toHaveProperty('accessToken');
    expect(JSON.stringify(await listPlaidConnectionSummaries('owner'))).not.toContain('secret');
  });
  it('rejects duplicate items/accounts and cross-owner item claims atomically', async () => {
    await bank();
    await expect(bank('bank-a', 'different', 'other')).rejects.toThrow('BANK_ALREADY_CONNECTED');
    await expect(bank('bank-b', 'acc-a')).rejects.toThrow('BANK_ALREADY_CONNECTED');
    expect(memory.records.has('plaid_connections/bank-b')).toBe(false);
    expect((await listPlaidConnections('other'))).toEqual([]);
  });
  it('serializes an item lease while another bank can sync', async () => {
    await bank(); await bank('bank-b', 'acc-b');
    await withPlaidConnection('owner', 'bank-a', async () => {
      await expect(withPlaidConnection('owner', 'bank-a', async () => {})).rejects.toThrow('busy');
      await expect(withPlaidConnection('owner', 'bank-b', async () => 'other works')).resolves.toBe('other works');
    });
    expect(record('plaid_connections/bank-a')).not.toHaveProperty('leaseId');
  });
  it('marks mismatched client/environment connections for relink without calling Plaid', async () => {
    await bank(); vi.stubEnv('PLAID_CLIENT_ID', 'replacement-client');
    expect(await listPlaidConnections('owner')).toEqual([]);
    expect(await listPlaidConnectionSummaries('owner')).toMatchObject([{ itemId: 'bank-a', relinkRequired: true }]);
    expect(record(profile).bankConnected).toBe(false);
    expect(memory.accounts).not.toHaveBeenCalled();
  });
  it('migrates legacy public secrets atomically without using the new provider credentials or changing saved records', async () => {
    memory.records.set(profile, { name: 'Owner', plaid_token: 'old-secret', plaid_item_id: 'old-bank', plaid_transactions_cursor: 'old-cursor' });
    memory.records.set(`${profile}/accounts/old`, { name: 'Old account', plaid_item_id: 'old-bank', access_token: 'old-secret' });
    memory.records.set(`${profile}/accounts/manual`, { name: 'Manual', source: 'manual' });
    memory.records.set(`${profile}/accounts/old/transactions/tx`, { amount: 42, review_status: 'confirmed' });
    await migrateLegacyPlaidConnection('owner');
    expect(record(profile)).not.toHaveProperty('plaid_token'); expect(record(profile)).not.toHaveProperty('plaid_transactions_cursor');
    expect(record('plaid_connections/old-bank')).toMatchObject({ status: 'relink_required', cursor: 'old-cursor', clientId: null });
    expect(record(`${profile}/accounts/old`)).not.toHaveProperty('access_token');
    expect(record(`${profile}/accounts/old/transactions/tx`)).toEqual({ amount: 42, review_status: 'confirmed' });
    expect(record(`${profile}/accounts/manual`)).toEqual({ name: 'Manual', source: 'manual' });
    expect(memory.accounts).not.toHaveBeenCalled();
  });
  it('keeps legacy public data intact if encryption is unavailable, so migration can be retried', async () => {
    memory.records.set(profile, { plaid_token: 'old-secret', plaid_item_id: 'old-bank' });
    vi.stubEnv('PLAID_TOKEN_ENCRYPTION_KEY', '');
    await expect(migrateLegacyPlaidConnection('owner')).rejects.toThrow();
    expect(record(profile).plaid_token).toBe('old-secret');
    expect(memory.records.has('plaid_connections/old-bank')).toBe(false);
  });
  it('removes the alternate public access_token field even on a previously marked profile', async () => {
    memory.records.set(profile, { name: 'Owner', plaid_credentials_migrated: true, access_token: 'alternate-secret' });
    await migrateLegacyPlaidConnection('owner');
    expect(record(profile)).not.toHaveProperty('access_token');
    expect(record('plaid_connections/legacy-owner').status).toBe('relink_required');
    expect(memory.accounts).not.toHaveBeenCalled();
  });
  it('preserves unknown bank balance and currency as unknown', async () => {
    await bank();
    expect(record(`${profile}/accounts/acc-a`)).toMatchObject({ balance: null, iso_currency_code: null });
  });
  it('removes empty legacy secret fields instead of leaving the profile unreadable under rules', async () => {
    memory.records.set(profile, { plaid_credentials_migrated: true, plaid_token: null, access_token: '' });
    await migrateLegacyPlaidConnection('owner');
    expect(record(profile)).not.toHaveProperty('plaid_token');
    expect(record(profile)).not.toHaveProperty('access_token');
    expect(memory.accounts).not.toHaveBeenCalled();
  });
});

describe('durable bank exchange and deletion coordination', () => {
  const tombstone = 'account_deletions/owner';
  const revocation = (id: string) => `${tombstone}/plaid_revocations/${id}`;
  it('registers an operation before provider work and refuses every new operation after deletion is requested', async () => {
    const id = await beginPlaidLinkOperation('owner');
    expect(record(tombstone).linkOperations[id].state).toBe('in_flight');
    record(tombstone).deletionRequested = true;
    await expect(beginPlaidLinkOperation('owner')).rejects.toThrow('ACCOUNT_DELETION_IN_PROGRESS');
    expect(Object.keys(record(tombstone).linkOperations)).toEqual([id]);
  });
  it('retains an encrypted recovery credential without enabling normal bank sync', async () => {
    const id = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'new-item', 'synthetic-secret');
    expect(record(revocation(id))).toMatchObject({ uid: 'owner', itemId: 'new-item', status: 'revocation_pending' });
    expect(JSON.stringify(record(revocation(id)))).not.toContain('synthetic-secret');
    expect(memory.records.has('plaid_connections/new-item')).toBe(false);
    expect(await listPlaidConnections('owner')).toEqual([]);
  });
  it('retries a pending revocation and clears only its operation while retaining the deletion tombstone', async () => {
    const id = await beginPlaidLinkOperation('owner'); const other = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'new-item', 'synthetic-secret');
    await markPlaidLinkOperationUnresolved('owner', id, true);
    record(tombstone).deletionRequested = true;
    await recoverPendingPlaidLinks('owner');
    expect(memory.remove).toHaveBeenCalledExactlyOnceWith({ access_token: 'synthetic-secret' });
    expect(record(tombstone)).toMatchObject({ deletionRequested: true, linkOperations: { [other]: { state: 'in_flight' } } });
    expect(record(tombstone).linkOperations[id]).toBeUndefined(); expect(memory.records.has(revocation(id))).toBe(false);
  });
  it('retains pending credentials and operation when the provider cannot revoke', async () => {
    const id = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'new-item', 'synthetic-secret'); await markPlaidLinkOperationUnresolved('owner', id, true);
    record(tombstone).deletionRequested = true; memory.remove.mockRejectedValue(new Error('unavailable'));
    await expect(recoverPendingPlaidLinks('owner')).rejects.toThrow('retried');
    expect(record(revocation(id)).encryptedAccessToken).toBeTruthy(); expect(record(tombstone).linkOperations[id]).toBeTruthy();
  });
  it.each(['in_flight', 'exchange_unknown', 'ownership_conflict'])('never expires or revokes an ambiguous %s operation', async state => {
    const id = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'new-item', 'synthetic-secret');
    Object.assign(record(tombstone).linkOperations[id], { state, startedAt: 1 }); record(tombstone).deletionRequested = true;
    await recoverPendingPlaidLinks('owner');
    expect(memory.remove).not.toHaveBeenCalled(); expect(record(tombstone).linkOperations[id]).toBeTruthy();
  });
  it('does not send an old-provider recovery token to the new client', async () => {
    const id = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'new-item', 'synthetic-secret'); await markPlaidLinkOperationUnresolved('owner', id, true);
    record(tombstone).deletionRequested = true; vi.stubEnv('PLAID_CLIENT_ID', 'another-client');
    await recoverPendingPlaidLinks('owner');
    expect(memory.remove).not.toHaveBeenCalled(); expect(record(revocation(id)).encryptedAccessToken).toBeTruthy();
  });
  it('quarantines a conflicting existing Item without revoking another user bank', async () => {
    await bank('bank-a', 'acc-a', 'other');
    const id = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'bank-a', 'synthetic-secret-bank-a'); await markPlaidLinkOperationUnresolved('owner', id, true);
    record(tombstone).deletionRequested = true; await recoverPendingPlaidLinks('owner');
    expect(memory.remove).not.toHaveBeenCalled();
    expect(record('plaid_connections/bank-a').uid).toBe('other');
    expect(record(revocation(id)).status).toBe('ownership_review');
    expect(record(tombstone).linkOperations[id].state).toBe('ownership_conflict');
  });
  it('releases recovery for an already durably saved owned Item without revoking the active connection', async () => {
    await bank(); const id = await beginPlaidLinkOperation('owner');
    await retainPlaidLinkRecovery('owner', id, 'bank-a', 'synthetic-secret-bank-a'); await markPlaidLinkOperationUnresolved('owner', id, true);
    record(tombstone).deletionRequested = true; await recoverPendingPlaidLinks('owner');
    expect(memory.remove).not.toHaveBeenCalled(); expect(record(tombstone).linkOperations).toEqual({});
    expect(record('plaid_connections/bank-a').encryptedAccessToken).toBeTruthy();
  });
  it('finishing one operation preserves concurrent provider operations and the durable deletion marker', async () => {
    const id = await beginPlaidLinkOperation('owner'); const other = await beginPlaidLinkOperation('owner');
    record(tombstone).deletionRequested = true; record(tombstone).billingOperations = { 'billing-fixture': { state: 'in_flight' } };
    await finishPlaidLinkOperation('owner', id);
    expect(record(tombstone).linkOperations[id]).toBeUndefined(); expect(record(tombstone).linkOperations[other]).toBeTruthy();
    expect(record(tombstone).billingOperations).toEqual({ 'billing-fixture': { state: 'in_flight' } }); expect(record(tombstone).deletionRequested).toBe(true);
  });
});

describe('bank disconnect retains imported records', () => {
  it('disconnects only one bank and preserves its records, the other bank, and manual data', async () => {
    await bank(); await bank('bank-b', 'acc-b');
    memory.records.set(`${profile}/accounts/manual`, { source: 'manual', name: 'Cash' });
    memory.records.set(`${profile}/accounts/acc-a/transactions/a`, { amount: 10, notes: 'Keep me' });
    memory.records.set(`${profile}/accounts/acc-b/transactions/b`, { amount: 20 });
    const result = await disconnectPlaidItem('owner', 'bank-b');
    expect(result).toMatchObject({ success: true, deletedCounts: { accounts: 0, transactions: 0 } });
    expect(memory.remove).toHaveBeenCalledExactlyOnceWith({ access_token: 'synthetic-secret-bank-b' });
    expect(record('plaid_connections/bank-b')).not.toHaveProperty('encryptedAccessToken');
    expect(record(`${profile}/accounts/acc-b`).plaid_connection_status).toBe('disconnected');
    expect(record(`${profile}/accounts/acc-a`)).not.toHaveProperty('plaid_connection_status');
    expect(record(`${profile}/accounts/acc-a/transactions/a`)).toEqual({ amount: 10, notes: 'Keep me' });
    expect(record(`${profile}/accounts/acc-b/transactions/b`)).toEqual({ amount: 20 });
    expect(record(`${profile}/accounts/manual`).name).toBe('Cash');
    expect(record(profile).bankConnected).toBe(true);
    expect((await listPlaidConnections('owner')).map(item => item.itemId)).toEqual(['bank-a']);
    await disconnectPlaidItem('owner', 'bank-a'); expect(record(profile).bankConnected).toBe(false);
  });
  it('refuses ambiguous/cross-owner disconnect before any provider action', async () => {
    await bank(); await bank('bank-b', 'acc-b');
    expect((await disconnectPlaidItem('owner')).success).toBe(false);
    expect((await disconnectPlaidItem('other', 'bank-a')).success).toBe(false);
    expect(memory.remove).not.toHaveBeenCalled();
  });
  it('retains credentials for a retry when provider removal fails', async () => {
    await bank(); memory.remove.mockRejectedValue(new Error('provider outage'));
    expect((await disconnectPlaidItem('owner', 'bank-a')).success).toBe(false);
    expect(record('plaid_connections/bank-a').status).toBe('active');
    expect(record('plaid_connections/bank-a').encryptedAccessToken).toBeTruthy();
    expect(record(`${profile}/accounts/acc-a`)).not.toHaveProperty('plaid_connection_status');
  });
  it('retains an old connection for manual revocation instead of allowing local disconnect to bypass deletion safeguards', async () => {
    await bank(); const encrypted = record('plaid_connections/bank-a').encryptedAccessToken; vi.stubEnv('PLAID_ENV', 'production');
    const result = await disconnectPlaidItem('owner', 'bank-a');
    expect(result.success).toBe(false); expect(result.error?.message).toContain('manual revocation');
    expect(memory.remove).not.toHaveBeenCalled();
    expect(record('plaid_connections/bank-a')).toMatchObject({ status: 'revocation_required', encryptedAccessToken: encrypted });
    expect(record(`${profile}/accounts/acc-a`)).not.toHaveProperty('plaid_connection_status');
    expect((await disconnectPlaidItem('owner', 'bank-a')).success).toBe(false);
    expect(record('plaid_connections/bank-a').encryptedAccessToken).toBe(encrypted);
  });
  it('blocks public account API writes from forging bank bindings or changing active bank ownership', async () => {
    await bank();
    expect((await createAccountServer('owner', { account_id: 'forged', plaid_item_id: 'bank-a' } as any)).error).toBeTruthy();
    expect((await updateAccountServer('owner', 'acc-a', { plaid_item_id: 'bank-b' })).error).toBeTruthy();
    expect((await deleteAccountServer('owner', 'acc-a')).success).toBe(false);
    expect(record(`${profile}/accounts/acc-a`).plaid_item_id).toBe('bank-a');
  });
});
