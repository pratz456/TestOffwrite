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
        update: (reference: any, data: any) => writes.push(() => apply(reference.path, data)) });
      writes.forEach(write => write()); return result;
    } } };
});
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { itemRemove: memory.remove, accountsGet: memory.accounts } }));
import { encryptPlaidToken, decryptPlaidToken, savePlaidConnection, listPlaidConnections, listPlaidConnectionSummaries,
  migrateLegacyPlaidConnection, withPlaidConnection, updatePlaidConnection } from '@/lib/plaid/connections';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { createAccountServer, updateAccountServer, deleteAccountServer } from '@/lib/firebase/accounts-server';
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
  it('retires a mismatched old connection locally without sending its token to the new account', async () => {
    await bank(); vi.stubEnv('PLAID_ENV', 'production');
    expect((await disconnectPlaidItem('owner', 'bank-a')).success).toBe(true);
    expect(memory.remove).not.toHaveBeenCalled();
    expect(record('plaid_connections/bank-a')).not.toHaveProperty('encryptedAccessToken');
  });
  it('blocks public account API writes from forging bank bindings or changing active bank ownership', async () => {
    await bank();
    expect((await createAccountServer('owner', { account_id: 'forged', plaid_item_id: 'bank-a' } as any)).error).toBeTruthy();
    expect((await updateAccountServer('owner', 'acc-a', { plaid_item_id: 'bank-b' })).error).toBeTruthy();
    expect((await deleteAccountServer('owner', 'acc-a')).success).toBe(false);
    expect(record(`${profile}/accounts/acc-a`).plaid_item_id).toBe('bank-a');
  });
});
