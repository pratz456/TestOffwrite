import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ connections: [] as any[], records: new Map<string, any>(), sync: vi.fn(), item: vi.fn(), create: vi.fn(), modified: vi.fn(), update: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/plaid/connections', () => ({
  listPlaidConnections: async () => mock.connections,
  withPlaidConnection: async (_uid: string, itemId: string, work: any) => work(mock.connections.find(item => item.itemId === itemId), `lease-${itemId}`),
  updatePlaidConnection: mock.update, findPlaidConnectionByItemId: vi.fn(),
}));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { transactionsSync: mock.sync, itemGet: mock.item } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ createTransactionServer: mock.create }));
vi.mock('@/lib/ai/analysis-jobs', () => ({ updateImportedTransactionForAnalysis: mock.modified }));
vi.mock('@/lib/plaid/pagination', () => ({ fetchAllPlaidTransactions: mock.fetch }));
vi.mock('@/lib/subscriptions/history-window', () => ({ getTransactionHistoryWindow: async () => ({ startDate: '2026-01-01', endDate: '2026-12-31', days: 730 }),
  isWithinHistoryWindow: (date: string, window: any) => date >= window.startDate && date <= window.endDate }));
vi.mock('@/lib/firebase/admin', () => {
  const doc = (path: string): any => ({ path, get: async () => ({ exists: mock.records.has(path), data: () => mock.records.get(path), ref: doc(path) }),
    set: async (values: any) => mock.records.set(path, { ...mock.records.get(path), ...values }),
    update: async (values: any) => mock.records.set(path, { ...mock.records.get(path), ...values }) });
  return { adminDb: { doc, collection: (path: string) => ({ where: (field: string, _op: string, value: string) => ({ get: async () => ({
    docs: [...mock.records].filter(([key, data]) => key.startsWith(`${path}/`) && data[field] === value).map(([key]) => ({ ref: doc(key) })),
  }) }) }) } };
});
import { syncUserTransactionsIncremental } from '@/lib/plaid/sync-helper';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
const accountPath = (account = 'acc-a') => `user_profiles/owner/accounts/${account}`;
const tx = (id: string, account = 'acc-a', extra = {}) => ({ transaction_id: id, account_id: account, amount: 20, date: '2026-09-01', pending: false,
  name: 'Office purchase', merchant_name: 'Same merchant', category: ['Office Supplies'], iso_currency_code: 'USD', unofficial_currency_code: null, ...extra });
const page = (added: any[] = [], modified: any[] = [], removed: any[] = [], cursor = 'next') => ({ data: { added, modified, removed, next_cursor: cursor, has_more: false } });
beforeEach(() => {
  vi.clearAllMocks(); mock.records.clear();
  mock.connections = ['a', 'b'].map(id => ({ uid: 'owner', itemId: `bank-${id}`, accessToken: `secret-${id}`, accountIds: [`acc-${id}`], cursor: `cursor-${id}` }));
  for (const connection of mock.connections) mock.records.set(accountPath(connection.accountIds[0]), { user_id: 'owner', plaid_item_id: connection.itemId });
  mock.create.mockImplementation(async (_uid: string, account: string, fields: any) => { const path = `${accountPath(account)}/transactions/${fields.trans_id}`; mock.records.set(path, fields); return { data: fields, error: null }; });
  mock.modified.mockImplementation(async (address: any, fields: any) => { const path = `${accountPath(address.accountId)}/transactions/${address.transactionId}`;
    if (!mock.records.has(path)) return { updated: false };
    mock.records.set(path, { ...mock.records.get(path), ...fields }); return { updated: true };
  });
  mock.sync.mockResolvedValue(page()); mock.update.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
const cursorWrites = () => mock.update.mock.calls.filter(call => 'cursor' in call[2]);

describe('per-item transaction sync', () => {
  it('verifies a repaired provider Item before clearing its login-required flag and syncing', async () => {
    mock.connections[0].reauthenticationRequired = true;
    mock.item.mockResolvedValue({ data: { item: { item_id: 'bank-a', error: null } } });
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).success).toBe(true);
    expect(mock.item).toHaveBeenCalledExactlyOnceWith({ access_token: 'secret-a' });
    expect(mock.update).toHaveBeenCalledWith('owner', 'bank-a', { reauthenticationRequired: false }, 'lease-bank-a');
    expect(mock.sync).toHaveBeenCalledOnce();
  });
  it.each([null, { item_id: 'bank-a', error: { error_code: 'ITEM_LOGIN_REQUIRED' } }, { item_id: 'wrong-item', error: null }])('keeps unresolved login errors flagged without trusting a cached sync response (%j)', item => {
    mock.connections[0].reauthenticationRequired = true;
    mock.item.mockResolvedValue({ data: { item } });
    return syncUserTransactionsIncremental('owner', 'bank-a').then(result => {
      expect(result.success).toBe(false); expect(mock.sync).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    });
  });
  it('sends only the selected item token/cursor and commits only that cursor', async () => {
    mock.sync.mockResolvedValue(page([tx('new-b', 'acc-b')], [], [], 'next-b'));
    expect(await syncUserTransactionsIncremental('owner', 'bank-b')).toMatchObject({ success: true, transactionsSaved: 1 });
    expect(mock.sync).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ access_token: 'secret-b', cursor: 'cursor-b' }));
    expect(cursorWrites()).toEqual([['owner', 'bank-b', { cursor: 'next-b', lastSync: expect.any(Number) }, 'lease-bank-b']]);
    expect(mock.records.has(`${accountPath('acc-a')}/transactions/new-b`)).toBe(false);
  });
  it('does not advance a failed bank cursor while another bank can complete', async () => {
    mock.sync.mockImplementation(async ({ access_token }) => page([tx(access_token, access_token === 'secret-a' ? 'acc-a' : 'acc-b')]));
    mock.create.mockImplementation(async (_uid, account) => account === 'acc-a' ? { data: null, error: new Error('write failure') } : { data: { trans_id: 'b' }, error: null });
    expect((await syncUserTransactionsIncremental('owner')).success).toBe(false);
    expect(cursorWrites().map(call => call[1])).toEqual(['bank-b']);
  });
  it('retains two distinct purchases with the same merchant, amount and date; retries count no new rows', async () => {
    mock.sync.mockResolvedValue(page([tx('distinct-1'), tx('distinct-2')]));
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).transactionsSaved).toBe(2);
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).transactionsSaved).toBe(0);
    expect(mock.create).toHaveBeenCalledTimes(2);
  });
  it('imports a previously skipped pending transaction that becomes posted in modified only', async () => {
    mock.sync.mockResolvedValueOnce(page([tx('pending-first', 'acc-a', { pending: true })]));
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).transactionsSaved).toBe(0);
    mock.sync.mockResolvedValueOnce(page([], [tx('pending-first')]));
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).transactionsSaved).toBe(1);
    expect(mock.records.get(`${accountPath()}/transactions/pending-first`).pending).toBe(false);
  });
  it('restarts pagination from the saved cursor after a mutation error', async () => {
    mock.sync.mockResolvedValueOnce({ data: { ...page([tx('stale-page')]).data, next_cursor: 'mid-page', has_more: true } })
      .mockRejectedValueOnce({ response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } })
      .mockResolvedValueOnce(page([tx('fresh-page')], [], [], 'final-page'));
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).success).toBe(true);
    expect(mock.sync.mock.calls.map(call => call[0].cursor)).toEqual(['cursor-a', 'mid-page', 'cursor-a']);
    expect(mock.records.has(`${accountPath()}/transactions/stale-page`)).toBe(false);
    expect(cursorWrites()[0][2].cursor).toBe('final-page');
  });
  it('rejects a provider account outside the selected bank before writing or committing its cursor', async () => {
    mock.sync.mockResolvedValue(page([tx('wrong-bank', 'acc-b')]));
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).success).toBe(false);
    expect(mock.create).not.toHaveBeenCalled(); expect(cursorWrites()).toEqual([]);
  });
  it('retains removed transaction decisions and attachments while excluding the row from current Schedule C', async () => {
    const original = { id: 'removed', trans_id: 'removed', account_id: 'acc-a', user_id: 'owner', date: '2026-09-01', amount: 20,
      merchant_name: 'Office purchase', category: 'Office Supplies', is_deductible: true, review_status: 'confirmed', notes: 'Keep audit note', receipt_url: '/receipt', pending: false };
    const path = `${accountPath()}/transactions/removed`; mock.records.set(path, original);
    const otherPath = `${accountPath('acc-b')}/transactions/removed`; mock.records.set(otherPath, { ...original, account_id: 'acc-b' });
    mock.sync.mockResolvedValue(page([], [], [{ transaction_id: 'removed', account_id: 'acc-a' }]));
    expect((await syncUserTransactionsIncremental('owner', 'bank-a')).success).toBe(true);
    const stored = mock.records.get(path);
    expect(stored).toMatchObject({ is_deductible: true, review_status: 'confirmed', notes: 'Keep audit note', receipt_url: '/receipt', bank_removed: true, pending: true });
    expect(mock.records.get(otherPath).pending).toBe(false);
    expect(aggregateScheduleC([stored], '2026', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
    mock.sync.mockResolvedValue(page([tx('removed')]));
    await syncUserTransactionsIncremental('owner', 'bank-a');
    expect(mock.records.get(path)).toMatchObject({ is_deductible: true, review_status: 'confirmed', notes: 'Keep audit note', pending: false, bank_removed: false });
  });
});
