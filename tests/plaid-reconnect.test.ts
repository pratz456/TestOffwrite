import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rows: new Map<string, any>(), sync: vi.fn(), remove: vi.fn(), fetch: vi.fn(), item: vi.fn(), failPath: '', commitImages: [] as Array<Map<string, any>>, queue: Promise.resolve() }));
vi.mock('@/lib/plaid/legacy-migration', () => ({ migrateLegacyPlaidCredentials: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => {
  const apply = (path: string, value: any, merge = false) => {
    const next = merge ? { ...h.rows.get(path) } : {};
    for (const [key, entry] of Object.entries(value)) { if (entry === '__delete__') delete next[key]; else next[key] = entry; }
    h.rows.set(path, structuredClone(next));
  };
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ id: path.split('/').at(-1), exists: h.rows.has(path), data: () => structuredClone(h.rows.get(path)), ref: doc(path) }),
    set: async (data: any, options?: any) => apply(path, data, options?.merge), update: async (data: any) => apply(path, data, true) });
  const collection = (path: string, filters: any[] = []): any => ({ path, doc: (id: string) => doc(`${path}/${id}`),
    where: (key: string, op: string, value: any) => collection(path, [...filters, [key, op, value]]),
    get: async () => { const docs = await Promise.all([...h.rows].filter(([p, data]) => p.slice(0, p.lastIndexOf('/')) === path && filters.every(([key, op, value]) => op === '==' ? data[key] === value : op === '>=' ? data[key] >= value : data[key] < value)).map(([p]) => doc(p).get())); return { docs, size: docs.length, empty: !docs.length }; } });
  return { FieldValue: { delete: () => '__delete__' }, adminDb: { doc, collection, runTransaction: (work: any) => {
    const run = h.queue.then(async () => {
      const writes: any[] = [];
      const result = await work({ get: (ref: any) => { if (writes.length) throw new Error('Firestore reads must precede writes'); return ref.get(); },
        set: (ref: any, data: any, options?: any) => writes.push({ ref, data, merge: options?.merge }),
        update: (ref: any, data: any) => writes.push({ ref, data, merge: true }), create: (ref: any, data: any) => writes.push({ ref, data, create: true }) });
      if (h.failPath && writes.some(w => w.ref.path === h.failPath)) { h.failPath = ''; throw new Error('Synthetic interrupted write'); }
      if (writes.some(w => w.create && h.rows.has(w.ref.path))) throw new Error('Already exists');
      for (const w of writes) apply(w.ref.path, w.data, w.merge);
      h.commitImages.push(structuredClone(h.rows)); return result;
    });
    h.queue = run.then(() => undefined, () => undefined); return run;
  } } };
});
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { transactionsSync: h.sync, itemRemove: h.remove, itemGet: h.item } }));
vi.mock('@/lib/plaid/pagination', () => ({ fetchAllPlaidTransactions: h.fetch }));
vi.mock('@/lib/subscriptions/history-window', () => ({ getTransactionHistoryWindow: async () => ({ startDate: '2024-01-01', endDate: '2028-12-31', days: 730 }), isWithinHistoryWindow: (date: string) => date >= '2024-01-01' && date <= '2028-12-31' }));
import { actOnReconnect, backfillReconnectUnderLease, applyReconnectDecision, assertReconnectCanLink, getReconnectView, reconnectRecordVersion, saveReconnectConnection, stageReconnectRecord, startReconnect, syncReconnectUnderLease } from '@/lib/plaid/reconnect';
import { decryptPlaidToken, getPlaidConnection, listPlaidConnections, withPlaidConnection } from '@/lib/plaid/connections';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { readBankHistoryReviewSummary } from '@/lib/plaid/reconnect-summary';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
const uid = 'owner', sessionId = 'session', itemId = 'replacement';
const sessionPath = `user_profiles/${uid}/bank_reconnects/${sessionId}`;
const recordPath = (id = 'new') => `${sessionPath}/import_records/${id}`;
const destination = (id = 'new') => `user_profiles/${uid}/accounts/new-account/transactions/${id}`;
const oldPath = `user_profiles/${uid}/accounts/old-account/transactions/old`;
const row = (id = 'new', extra = {}): any => ({ transaction_id: id, account_id: 'new-account', date: '2026-08-01', amount: 40, name: 'Paper', merchant_name: 'Paper', category: ['Office Supplies'], iso_currency_code: 'USD', unofficial_currency_code: null, pending: false, ...extra });
const savedOld = () => h.rows.get(oldPath);
async function leased(work: (c: any, lease: string) => Promise<any>) { return withPlaidConnection(uid, itemId, work, false, true); }
async function stage(id = 'new', extra = {}, event: any = 'added') { await leased((c, lease) => stageReconnectRecord(uid, c, lease, event, row(id, extra))); }
const decision = (id = 'new', kind: any = 'duplicate') => ({ ...(h.rows.has(destination(id)) ? { previousVersion: reconnectRecordVersion(h.rows.get(destination(id))) } : {}), recordId: id, version: h.rows.get(recordPath(id)).version, decision: kind,
  ...(kind === 'duplicate' ? { canonicalReference: oldPath, canonicalVersion: reconnectRecordVersion(savedOld()) } : {}) });
async function decide(value = decision()) { return leased((c, lease) => applyReconnectDecision(uid, c, lease, value)); }
beforeEach(async () => {
  h.rows.clear(); h.commitImages = []; h.failPath = ''; h.queue = Promise.resolve(); vi.clearAllMocks();
  vi.stubEnv('PLAID_CLIENT_ID', 'current'); vi.stubEnv('PLAID_ENV', 'sandbox'); vi.stubEnv('PLAID_TOKEN_ENCRYPTION_KEY', '1'.repeat(64));
  h.rows.set(`user_profiles/${uid}`, { plaid_credentials_migrated: true });
  h.rows.set(`user_profiles/${uid}/accounts/old-account`, { user_id: uid, source: 'plaid', name: 'Old checking' });
  h.rows.set(oldPath, { user_id: uid, account_id: 'old-account', date: '2026-08-01', amount: 40, merchant_name: 'Paper', iso_currency_code: 'USD', category: 'Office Supplies', is_deductible: true, review_status: 'confirmed', notes: 'Preserve this' });
  h.rows.set(sessionPath, { uid, phase: 'awaiting_link', itemId: null, createdAt: 1, accounts: [], legacyAccounts: [{ id: 'old-account', name: 'Old checking', mask: null, type: 'depository', currency: 'USD' }], mappings: {}, mappingComplete: false, historyReady: false, cutoverDate: '2026-09-24', reviewVersion: 0 });
  await saveReconnectConnection({ uid, sessionId, itemId, accessToken: 'synthetic', institutionId: 'bank', accounts: [{ account_id: 'new-account', name: 'Checking', mask: '1234', type: 'depository' }] as any });
  h.rows.set(sessionPath, { ...h.rows.get(sessionPath), mappings: { 'new-account': ['old-account'] }, mappingComplete: true });
  h.sync.mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: 'next', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } });
  h.remove.mockResolvedValue({}); h.fetch.mockResolvedValue({ transactions: [], plaidTotalTransactions: 0 });
});
afterEach(() => vi.unstubAllEnvs());
describe('private owner guided bank reconnect', () => {
  it('saves only an encrypted pending Item, returns no token, and excludes it from normal credential readers', async () => {
    const bank = h.rows.get(`plaid_connections/${itemId}`);
    expect(bank.status).toBe('pending_history_review'); expect(decryptPlaidToken(uid, itemId, bank.encryptedAccessToken)).toBe('synthetic');
    expect(await listPlaidConnections(uid)).toEqual([]);
    expect(await listPlaidConnections(uid, true)).toHaveLength(1);
    expect(await getPlaidConnection(uid, itemId, true)).toMatchObject({ itemId, accessToken: 'synthetic' });
    expect(await getPlaidConnection(uid, itemId)).toBeNull();
    expect(JSON.stringify(await getReconnectView(uid, sessionId))).not.toContain('synthetic');
    expect(h.rows.has('user_profiles/owner/accounts/new-account')).toBe(false);
  });
  it('rejects another owner session and resumes the existing owner session', async () => {
    await expect(getReconnectView('other', sessionId)).rejects.toThrow('not found');
    await expect(assertReconnectCanLink('other', sessionId)).rejects.toThrow('not found');
    expect(await startReconnect(uid)).toBe(sessionId);
  });
  it('private stages never enter a transactions collection or Schedule C', async () => {
    await stage();
    expect(h.rows.has(destination())).toBe(false);
    expect([...h.rows].filter(([path]) => path.split('/').at(-2) === 'transactions')).toHaveLength(1);
    const before = structuredClone(savedOld());
    await decide();
    expect(savedOld()).toEqual(before);
    expect(h.rows.get(destination())).toMatchObject({ superseded_by: oldPath, is_deductible: null, review_status: 'unreviewed' });
    for (const snapshot of h.commitImages) if (snapshot.has(destination())) expect(snapshot.get(destination()).superseded_by).toBe(oldPath);
    expect(aggregateScheduleC([savedOld(), h.rows.get(destination())], '2026', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(40);
  });
  it('rejects stale provider versions and canonical edits before any promotion', async () => {
    await stage(); const selected = decision();
    await stage('new', { amount: 41 }, 'modified');
    await expect(decide(selected)).rejects.toThrow('Bank record changed');
    const fresh = decision(); h.rows.set(oldPath, { ...savedOld(), notes: 'Owner edited' });
    await expect(decide(fresh)).rejects.toThrow('Saved record changed');
    expect(h.rows.has(destination())).toBe(false);
  });
  it('rejects foreign/root-owner conflicts and unmapped canonical references', async () => {
    await stage();
    h.rows.set('transactions/foreign', { ...savedOld(), user_id: 'other', account_id: 'old-account' });
    await expect(decide({ ...decision(), canonicalReference: 'transactions/foreign', canonicalVersion: reconnectRecordVersion(h.rows.get('transactions/foreign')) })).rejects.toThrow('mapped bank history');
    h.rows.set(oldPath, { ...savedOld(), userId: 'other' });
    await expect(decide()).rejects.toThrow('mapped bank history');
    expect(h.rows.has(destination())).toBe(false);
  });
  it('requires explicit acknowledgment for changed details and keeps legacy confirmations', async () => {
    await stage('new', { merchant_name: 'Paper Co' });
    await expect(decide()).rejects.toThrow('Confirm the different');
    await decide({ ...decision(), confirmDifferentDetails: true });
    expect(h.rows.get(destination()).superseded_by).toBe(oldPath); expect(savedOld().review_status).toBe('confirmed');
  });
  it('resumes an interrupted decision batch without duplicating or changing the earlier decision', async () => {
    await stage('one'); await stage('two');
    const action: any = { action: 'decide', sessionId, decisions: [decision('one', 'distinct'), decision('two', 'distinct')] };
    h.failPath = destination('two');
    await expect(actOnReconnect(uid, action)).rejects.toThrow('interrupted');
    expect(h.rows.has(destination('one'))).toBe(true); expect(h.rows.has(destination('two'))).toBe(false);
    const first = structuredClone(h.rows.get(destination('one')));
    await actOnReconnect(uid, action);
    expect(h.rows.get(destination('one'))).toEqual(first); expect(h.rows.get(destination('two')).is_deductible).toBeNull();
  });
  it('serializes review with Item sync and rejects expired leases', async () => {
    await stage();
    await leased(async (c, lease) => {
      await expect(leased(async () => undefined)).rejects.toThrow('busy');
      h.rows.get(`plaid_connections/${itemId}`).leaseExpiresAt = 0;
      await expect(applyReconnectDecision(uid, c, lease, decision())).rejects.toThrow('changed');
    });
    expect(h.rows.has(destination())).toBe(false);
  });
  it('blocks activation before complete history and retains deferred records privately after activation', async () => {
    await stage(); await decide(decision('new', 'defer'));
    await expect(actOnReconnect(uid, { action: 'activate', sessionId, acknowledgeDeferred: true })).rejects.toThrow('Finish reviewing');
    await actOnReconnect(uid, { action: 'sync', sessionId });
    await expect(actOnReconnect(uid, { action: 'activate', sessionId, acknowledgeDeferred: false })).rejects.toThrow('Finish reviewing');
    await actOnReconnect(uid, { action: 'activate', sessionId, acknowledgeDeferred: true });
    expect(h.rows.has(destination())).toBe(false); expect(h.rows.get(`plaid_connections/${itemId}`).status).toBe('active');
    expect(await readBankHistoryReviewSummary(uid, 2026)).toMatchObject({ ready: false, deferredRecords: 1 });
  });
  it('keeps historical backfills private while new post-boundary purchases are unconfirmed normal records', async () => {
    h.rows.set(sessionPath, { ...h.rows.get(sessionPath), phase: 'active', historyReady: true });
    await stage('late', { date: '2026-07-01' }); await stage('future', { date: '2026-09-25' });
    expect(h.rows.has(destination('late'))).toBe(false); expect(h.rows.get(destination('future'))).toMatchObject({ is_deductible: null, review_status: 'unreviewed' });
    expect(h.rows.get(recordPath('late')).status).toBe('pending');
  });
  it('returns changed linked duplicates to review and never edits their old canonical amount', async () => {
    await stage(); await decide(); const old = structuredClone(savedOld()), replacement = structuredClone(h.rows.get(destination()));
    await stage('new', { amount: 49 }, 'modified');
    expect((await getReconnectView(uid, sessionId)).records[0]).toMatchObject({ correction: true, canApplyCorrection: false, canChooseDistinct: false });
    await expect(decide(decision('new', 'apply_correction'))).rejects.toThrow('separately');
    await decide(decision('new', 'keep_existing'));
    expect(savedOld()).toEqual(old); expect(h.rows.get(destination())).toEqual(replacement);
  });
  it('applies accepted corrections only to distinct replacement records and clears their confirmation', async () => {
    await stage(); await decide(decision('new', 'distinct'));
    h.rows.get(destination()).is_deductible = true; h.rows.get(destination()).review_status = 'confirmed';
    await stage('new', { amount: 49 }, 'modified');
    expect(h.rows.get(destination()).amount).toBe(40);
    await decide(decision('new', 'apply_correction'));
    expect(h.rows.get(destination())).toMatchObject({ amount: 49, is_deductible: null, review_status: 'unreviewed' }); expect(savedOld().amount).toBe(40);
    await stage('new', {}, 'removed'); await decide(decision('new', 'apply_correction'));
    expect(h.rows.get(destination()).bank_removed).toBe(true);
  });
  it('restarts mutated pagination before staging and advances cursor only after durable imports', async () => {
    h.sync.mockResolvedValueOnce({ data: { added: [row('obsolete')], modified: [], removed: [], next_cursor: 'mid', has_more: true } })
      .mockRejectedValueOnce({ response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } })
      .mockResolvedValueOnce({ data: { added: [row('final')], modified: [], removed: [], next_cursor: 'end', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } });
    h.failPath = recordPath('final');
    await expect(leased((c, lease) => syncReconnectUnderLease(uid, c, lease))).rejects.toThrow('interrupted');
    expect(h.rows.has(recordPath('obsolete'))).toBe(false); expect(h.rows.get(`plaid_connections/${itemId}`).cursor).toBeNull();
  });
  it('revokes pending current-client Items while retaining private history and legacy records', async () => {
    await stage();
    expect(await disconnectPlaidItem(uid, itemId)).toMatchObject({ success: true, plaidRemoved: true });
    expect(h.remove).toHaveBeenCalledWith({ access_token: 'synthetic' });
    expect(h.rows.get(`plaid_connections/${itemId}`).encryptedAccessToken).toBeUndefined();
    expect(h.rows.has(recordPath())).toBe(true); expect(savedOld().review_status).toBe('confirmed');
  });
});

describe('reconnect races, replay and multiple banks', () => {
  it('starts a second bank after activation and coalesces concurrent starts', async () => {
    await actOnReconnect(uid, { action: 'sync', sessionId });
    await actOnReconnect(uid, { action: 'activate', sessionId, acknowledgeDeferred: false });
    const [a, b] = await Promise.all([startReconnect(uid), startReconnect(uid)]);
    expect(a).toBe(b); expect(a).not.toBe(sessionId);
    expect((await getReconnectView(uid, sessionId)).phase).toBe('active');
    expect((await getReconnectView(uid, a)).phase).toBe('awaiting_link');
  });
  it('rejects injected account IDs without writing imports or advancing the Item cursor', async () => {
    h.sync.mockResolvedValue({ data: { added: [row('spoof', { account_id: 'somebody-else' })], modified: [], removed: [], next_cursor: 'unsafe', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } });
    await expect(leased((c, lease) => syncReconnectUnderLease(uid, c, lease))).rejects.toThrow('Unknown bank account');
    expect(h.rows.has(recordPath('spoof'))).toBe(false); expect(h.rows.get(`plaid_connections/${itemId}`).cursor).toBeNull();
  });
  it('deduplicates multi-page repeats and replayed decisions without changing the canonical', async () => {
    const page = (cursor: string, more: boolean) => ({ data: { added: [row()], modified: [], removed: [], next_cursor: cursor, has_more: more, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' } });
    h.sync.mockResolvedValueOnce(page('middle', true)).mockResolvedValueOnce(page('end', false));
    expect(await leased((c, lease) => syncReconnectUnderLease(uid, c, lease))).toBe(0);
    expect([...h.rows.keys()].filter(path => path.startsWith(`${sessionPath}/import_records/`))).toHaveLength(1);
    const choice = decision(); await decide(choice); const saved = structuredClone(h.rows.get(destination()));
    await decide(choice);
    expect(h.rows.get(destination())).toEqual(saved); expect(savedOld().review_status).toBe('confirmed');
  });
  it('cannot activate while the Item has an in-flight import', async () => {
    h.rows.get(sessionPath).historyReady = true;
    await leased(async () => { await expect(actOnReconnect(uid, { action: 'activate', sessionId, acknowledgeDeferred: false })).rejects.toThrow('busy'); });
    expect(h.rows.get(`plaid_connections/${itemId}`).status).toBe('pending_history_review');
  });
  it('freezes account mapping, rejects duplicate assignment, and prevents review after deletion starts', async () => {
    await expect(actOnReconnect(uid, { action: 'map', sessionId, mappings: { 'new-account': [] }, confirmAccountMapping: true })).rejects.toThrow('frozen');
    h.rows.get(sessionPath).mappingComplete = false;
    await expect(actOnReconnect(uid, { action: 'map', sessionId, mappings: { injected: [] }, confirmAccountMapping: true })).rejects.toThrow('Map every new account');
    h.rows.get(sessionPath).mappingComplete = true;
    await stage(); h.rows.set('account_deletions/owner', { deletionRequested: true });
    await expect(decide()).rejects.toThrow('ACCOUNT_DELETION_IN_PROGRESS');
    expect(h.rows.has(destination())).toBe(false);
  });
  it('resolves a removed never-promoted import privately and leaves no countable row', async () => {
    await stage(); await stage('new', {}, 'removed');
    expect(h.rows.get(recordPath())).toMatchObject({ status: 'resolved', decision: 'withdrawn_before_promotion' });
    expect(h.rows.has(destination())).toBe(false);
  });
  it('requires re-review when a previously promoted record changes during correction review', async () => {
    await stage(); await decide(decision('new', 'distinct')); await stage('new', { amount: 44 }, 'modified');
    const choice = decision('new', 'apply_correction');
    h.rows.get(destination()).notes = 'New owner note';
    await expect(decide(choice)).rejects.toThrow('Previously saved record changed');
    expect(h.rows.get(destination())).toMatchObject({ amount: 40, notes: 'New owner note' });
  });
});

describe('reconnect review regression boundaries', () => {
  it('stages modifications of existing records even when bank changes their date outside entitlement', async () => {
    await stage(); await decide(decision('new', 'distinct'));
    h.sync.mockResolvedValue({ data: { added: [], modified: [row('new', { date: '2023-01-01', amount: 70 })], removed: [], next_cursor: 'next', has_more: false } });
    await leased((c, lease) => syncReconnectUnderLease(uid, c, lease));
    expect(h.rows.get(recordPath())).toMatchObject({ status: 'pending', correction: true, payload: { date: '2023-01-01', amount: 70 } });
    expect(h.rows.get(destination()).amount).toBe(40);
  });
  it('lets a later reconnect deduplicate against distinct retained records from a prior cancelled review', async () => {
    const prior = 'user_profiles/owner/accounts/prior-account/transactions/prior';
    h.rows.set('user_profiles/owner/accounts/prior-account', { user_id: uid, reconnect_session_id: 'previous', name: 'Prior replacement' });
    h.rows.set(prior, { ...savedOld(), account_id: 'prior-account', reconnect_session_id: 'previous' });
    h.rows.get(sessionPath).mappings['new-account'] = ['prior-account'];
    await stage();
    expect((await getReconnectView(uid, sessionId)).records[0].candidates.some(c => c.reference === prior)).toBe(true);
    await decide({ ...decision(), canonicalReference: prior, canonicalVersion: reconnectRecordVersion(h.rows.get(prior)) });
    expect(h.rows.get(destination()).superseded_by).toBe(prior);
    expect(h.rows.get(prior).review_status).toBe('confirmed');
  });
  it('keeps ambiguous post-cutover purchases private if mapped saved history already contains a possible overlap', async () => {
    h.rows.get(sessionPath).phase = 'active'; h.rows.get(sessionPath).historyReady = true;
    h.rows.set(oldPath, { ...savedOld(), date: '2026-09-25' });
    await stage('future-overlap', { date: '2026-09-25' });
    expect(h.rows.has(destination('future-overlap'))).toBe(false);
    expect(h.rows.get(recordPath('future-overlap')).status).toBe('pending');
  });
  it('normalizes numeric legacy amount strings for the public review contract', async () => {
    h.rows.set(oldPath, { ...savedOld(), amount: '40.00' }); await stage();
    expect((await getReconnectView(uid, sessionId)).records[0].candidates[0].amount).toBe(40);
  });
  it('distinguishes a stale/cancelled Link session from an actual saved Item collision', async () => {
    h.rows.get(sessionPath).phase = 'cancelled';
    await expect(saveReconnectConnection({ uid, sessionId, itemId: 'orphan', accessToken: 'synthetic', institutionId: null, accounts: [{ account_id: 'unused' }] as any })).rejects.toThrow('BANK_REVIEW_SESSION_CHANGED');
    expect(h.rows.has('plaid_connections/orphan')).toBe(false);
  });
});

 describe('history backfill and pending Item login repair', () => {
  it('stages a plan-upgrade historical backfill through the private review boundary', async () => {
    h.rows.get(sessionPath).phase = 'active'; h.rows.get(sessionPath).historyReady = true;
    h.fetch.mockResolvedValue({ transactions: [row('older')], plaidTotalTransactions: 1 });
    expect(await leased((c, lease) => backfillReconnectUnderLease(uid, c, lease))).toBe(0);
    expect(h.rows.get(recordPath('older')).status).toBe('pending'); expect(h.rows.has(destination('older'))).toBe(false);
    expect(h.fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ start_date: '2024-01-01', end_date: '2028-12-31' }), expect.any(String));
  });
  it('does not activate or trust cached history while a pending Item requires bank sign-in', async () => {
    h.rows.get(sessionPath).historyReady = true; h.rows.get(`plaid_connections/${itemId}`).reauthenticationRequired = true;
    h.item.mockResolvedValue({ data: { item: { item_id: itemId, error: { error_code: 'ITEM_LOGIN_REQUIRED' } } } });
    await expect(actOnReconnect(uid, { action: 'sync', sessionId })).rejects.toThrow('Repair your bank sign-in');
    expect(h.sync).not.toHaveBeenCalled();
    await expect(actOnReconnect(uid, { action: 'activate', sessionId, acknowledgeDeferred: false })).rejects.toThrow('Finish reviewing');
    h.item.mockResolvedValue({ data: { item: { item_id: itemId, error: null } } });
    await actOnReconnect(uid, { action: 'sync', sessionId });
    expect(h.rows.get(`plaid_connections/${itemId}`).reauthenticationRequired).toBeUndefined();
  });
 });

 it('cancellation retries return the saved cancelled session without another revocation', async () => {
  expect((await actOnReconnect(uid, { action: 'cancel', sessionId })).phase).toBe('cancelled');
  expect((await actOnReconnect(uid, { action: 'cancel', sessionId })).phase).toBe('cancelled');
  expect(h.remove).toHaveBeenCalledOnce();
 });
