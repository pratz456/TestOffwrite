import { createHash, randomUUID } from 'node:crypto';
import { type DocumentData, type Transaction as DbTransaction } from 'firebase-admin/firestore';
import type { AccountBase, Transaction as BankTransaction } from 'plaid';
import { adminDb } from '@/lib/firebase/admin';
import { configuredIdentity, encryptPlaidToken, isCurrent, validId } from './connection-primitives';
import { migrateLegacyPlaidConnection, withPlaidConnection, updatePlaidConnection, type PlaidConnection } from './connections';
import { plaidClient } from './client';
import { fetchAllPlaidTransactions } from './pagination';
import { staleAnalysisUpdate } from '@/lib/ai/analysis-jobs';
import { getTransactionHistoryWindow, isWithinHistoryWindow } from '@/lib/subscriptions/history-window';
import { overlapKey, overlapRecordOwner, overlapRecordScope, parseTransactionRecordPath, planHistoricalOverlapDecision } from '@/lib/transactions/historical-overlap';
import type { ReconnectAccount, ReconnectAction, ReconnectDecision, ReconnectView } from './reconnect-contract';

export class ReconnectError extends Error {}
const sessions = (uid: string) => adminDb.collection(`user_profiles/${validId(uid)}/bank_reconnects`);
const sessionRef = (uid: string, id: string) => sessions(uid).doc(validId(id));
const itemRef = (id: string) => adminDb.doc(`plaid_connections/${validId(id)}`);
const records = (uid: string, id: string) => sessionRef(uid, id).collection('import_records');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const reconnectRecordVersion = (data: DocumentData) => hash(data);
const owned = (uid: string, data?: DocumentData) => { if (!data || data.uid !== uid) throw new ReconnectError('Bank review not found'); return data; };
const accountView = (id: string, data: DocumentData): ReconnectAccount => ({ id, name: data.name || data.official_name || 'Saved bank account', mask: data.mask ?? null, type: data.type || 'depository', currency: data.iso_currency_code ?? null });
const viewFields = (data: DocumentData) => ({ date: String(data.date).slice(0, 10), amount: Number(data.amount), merchant: String(data.merchant_name || data.description || ''), currency: data.iso_currency_code || data.unofficial_currency_code || null });
const counts = (docs: Array<{ data(): DocumentData }>) => docs.reduce((sum, doc) => { const s = doc.data().status; if (s === 'pending') sum.pendingCount++; else if (s === 'deferred') sum.deferredCount++; else sum.resolvedCount++; return sum; }, { pendingCount: 0, deferredCount: 0, resolvedCount: 0 });

/** Includes root legacy records; only verified owner paths become selectable candidates. */
async function legacyRecords(uid: string, excludeSessionId?: string) {
  const accounts = await adminDb.collection(`user_profiles/${uid}/accounts`).get();
  const snapshots = await Promise.all(accounts.docs.map(a => a.ref.collection('transactions').get()));
  const roots = await Promise.all(['user_id', 'userId'].map(field => adminDb.collection('transactions').where(field, '==', uid).get()));
  return [...new Map([...snapshots, ...roots].flatMap(s => s.docs.map(d => [d.ref.path, { path: d.ref.path, data: d.data() }] as const))).values()]
    .filter(r => overlapRecordOwner(r) === uid && (!excludeSessionId || r.data.reconnect_session_id !== excludeSessionId));
}
async function legacyAccounts(uid: string): Promise<ReconnectAccount[]> {
  const saved = await adminDb.collection(`user_profiles/${uid}/accounts`).get();
  const result = saved.docs.map(d => accountView(d.id, d.data()));
  for (const record of await legacyRecords(uid)) {
    const scope = overlapRecordScope(record)!;
    if (!result.some(a => a.id === scope)) {
      const original = result.find(a => a.id === scope.replace(/^root:/, ''));
      result.push(original ? { ...original, id: scope, name: `${original.name} (older records)` } : { id: scope, name: `Saved history ${scope.replace(/^root:/, '')}`, mask: null, type: 'legacy', currency: record.data.iso_currency_code as string || null });
    }
  }
  return result;
}
export async function latestReconnectSession(uid: string): Promise<string | null> {
  const known = await sessions(uid).get();
  return known.docs.filter(d => d.data().phase !== 'cancelled').sort((a, b) => b.data().createdAt - a.data().createdAt)[0]?.id ?? null;
}
export async function startReconnect(uid: string): Promise<string> {
  await migrateLegacyPlaidConnection(uid);
  const known = await sessions(uid).get();
  const existing = known.docs.filter(d => ['awaiting_link', 'review'].includes(d.data().phase)).sort((a, b) => b.data().createdAt - a.data().createdAt)[0];
  if (existing) return existing.id;
  const id = randomUUID();
  const oldAccounts = await legacyAccounts(uid);
  // One owner-bound session pointer serializes concurrent start calls.
  return adminDb.runTransaction(async tx => {
    const profile = adminDb.doc(`user_profiles/${uid}`), deletion = adminDb.doc(`account_deletions/${uid}`);
    const [p, d] = await Promise.all([tx.get(profile), tx.get(deletion)]);
    if (d.data()?.deletionRequested) throw new ReconnectError('ACCOUNT_DELETION_IN_PROGRESS');
    const prior = p.data()?.bank_reconnect_session_id;
    if (typeof prior === 'string') {
      const s = await tx.get(sessionRef(uid, prior));
      if (s.exists && ['awaiting_link', 'review'].includes(s.data()?.phase)) return prior;
    }
    tx.create(sessionRef(uid, id), { uid, phase: 'awaiting_link', itemId: null, createdAt: Date.now(), accounts: [], legacyAccounts: oldAccounts,
      mappings: {}, mappingComplete: false, historyReady: false, cutoverDate: new Date().toISOString().slice(0, 10), reviewVersion: 0 });
    tx.set(profile, { bank_reconnect_session_id: id }, { merge: true });
    return id;
  });
}
export async function assertReconnectCanLink(uid: string, id: unknown): Promise<void> {
  if (typeof id !== 'string') throw new ReconnectError('Invalid bank review');
  const data = owned(uid, (await sessionRef(uid, id).get()).data());
  if (data.phase !== 'awaiting_link' || data.itemId) throw new ReconnectError('Bank review already has a connection');
  if ((await adminDb.doc(`account_deletions/${uid}`).get()).data()?.deletionRequested) throw new ReconnectError('ACCOUNT_DELETION_IN_PROGRESS');
}
export async function saveReconnectConnection(input: { uid: string; sessionId: string; itemId: string; accessToken: string; accounts: AccountBase[]; institutionId: string | null }) {
  const { uid, sessionId, itemId } = input;
  const identity = configuredIdentity();
  if (!identity.clientId || !['sandbox', 'production'].includes(identity.environment)) throw new ReconnectError('Bank provider unavailable');
  const accountIds = input.accounts.map(a => validId(a.account_id));
  if (!accountIds.length || accountIds.length > 200 || new Set(accountIds).size !== accountIds.length) throw new ReconnectError('Invalid bank accounts');
  const encryptedAccessToken = encryptPlaidToken(uid, itemId, input.accessToken);
  await adminDb.runTransaction(async tx => {
    const ref = sessionRef(uid, sessionId);
    const [session, existing, deletion, ...accounts] = await Promise.all([tx.get(ref), tx.get(itemRef(itemId)), tx.get(adminDb.doc(`account_deletions/${uid}`)),
      ...accountIds.map(id => tx.get(adminDb.doc(`user_profiles/${uid}/accounts/${id}`)))]);
    const data = owned(uid, session.data());
    if (deletion.data()?.deletionRequested) throw new ReconnectError('ACCOUNT_DELETION_IN_PROGRESS');
    if (data.phase !== 'awaiting_link' || data.itemId) throw new ReconnectError('BANK_REVIEW_SESSION_CHANGED');
    if (existing.exists || accounts.some(a => a.exists)) throw new ReconnectError('BANK_ALREADY_CONNECTED');
    tx.create(itemRef(itemId), { uid, itemId, ...identity, encryptedAccessToken, accountIds, institutionId: input.institutionId,
      reconnectSessionId: sessionId, status: 'pending_history_review', cursor: null, connectedAt: new Date(), updatedAt: new Date() });
    tx.update(ref, { phase: 'review', itemId, accounts: input.accounts.map(a => accountView(a.account_id, a as unknown as DocumentData)) });
  });
}

async function guard(tx: DbTransaction, uid: string, id: string, itemId: string, leaseId: string): Promise<DocumentData> {
  const [s, c, d] = await Promise.all([tx.get(sessionRef(uid, id)), tx.get(itemRef(itemId)), tx.get(adminDb.doc(`account_deletions/${uid}`))]);
  const session = owned(uid, s.data()), connection = owned(uid, c.data());
  if (d.data()?.deletionRequested) throw new ReconnectError('ACCOUNT_DELETION_IN_PROGRESS');
  if (session.itemId !== itemId || session.phase === 'cancelled' || connection.reconnectSessionId !== id || connection.leaseId !== leaseId || connection.leaseExpiresAt <= Date.now() || !isCurrent(connection) || !['pending_history_review', 'active'].includes(connection.status)) throw new ReconnectError('Bank review changed. Refresh and retry.');
  return { ...session, reauthenticationRequired: connection.reauthenticationRequired === true };
}
function bankFields(transaction: BankTransaction) {
  if (!Number.isFinite(transaction.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date) || typeof transaction.name !== 'string') throw new ReconnectError('Bank returned invalid transaction details');
  return { trans_id: validId(transaction.transaction_id), account_id: validId(transaction.account_id), date: transaction.date, amount: transaction.amount,
    merchant_name: transaction.merchant_name || transaction.name, description: transaction.name,
    category: transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other',
    iso_currency_code: transaction.iso_currency_code, unofficial_currency_code: transaction.unofficial_currency_code, pending: transaction.pending };
}
const promotedFields = (uid: string, id: string, data: DocumentData) => ({ ...data, userId: uid, user_id: uid, reconnect_session_id: id, is_deductible: null,
  review_status: 'unreviewed', tax_review_required: true, analyzed: false, analysis_status: 'pending', analysisStatus: 'pending', created_at: new Date(), updated_at: new Date() });

/** Check mapped saved history in the same transaction as automatic post-cutover promotion. */
async function hasPossibleSavedOverlap(tx: DbTransaction, uid: string, scopes: string[], payload: DocumentData) {
  const nested = scopes.filter(scope => !scope.startsWith('root:'));
  const queries = nested.map(scope => adminDb.collection(`user_profiles/${uid}/accounts/${validId(scope)}/transactions`)
    .where('date', '>=', payload.date).where('date', '<', `${payload.date}~`));
  if (scopes.some(scope => scope.startsWith('root:'))) for (const ownerField of ['user_id', 'userId']) queries.push(adminDb.collection('transactions').where(ownerField, '==', uid));
  const snapshots = await Promise.all(queries.map(query => tx.get(query)));
  return snapshots.some(snapshot => snapshot.docs.some(doc => {
    const record = { path: doc.ref.path, data: doc.data() };
    return overlapRecordOwner(record) === uid && scopes.includes(overlapRecordScope(record)!) && !record.data.superseded_by && !record.data.bank_removed && !record.data.pending &&
      String(record.data.date).slice(0, 10) === payload.date && Math.round(Number(record.data.amount) * 100) === Math.round(payload.amount * 100);
  }));
}

/** Stages one provider version atomically. Nothing private is ever named transactions. */
export async function stageReconnectRecord(uid: string, connection: PlaidConnection, leaseId: string, event: 'added' | 'modified' | 'removed', source: BankTransaction | { transaction_id: string; account_id?: string }): Promise<number> {
  const id = connection.reconnectSessionId!;
  const ref = records(uid, id).doc(validId(source.transaction_id));
  return adminDb.runTransaction(async tx => {
    const session = await guard(tx, uid, id, connection.itemId, leaseId);
    const prior = (await tx.get(ref)).data();
    if (event === 'removed' && !prior) return 0;
    const accountId = source.account_id || prior?.payload.account_id;
    if (!accountId || !connection.accountIds.includes(accountId)) throw new ReconnectError('Unknown bank account in import');
    const data = event === 'removed' ? prior?.payload : bankFields(source as BankTransaction);
    if (!data) return 0; // A removed never-imported provider row has no totals to affect.
    const payload = { ...data, bank_removed: event === 'removed' };
    const version = hash(payload);
    if (prior?.version === version) return 0;
    if (!prior && payload.pending) return 0;
    const destination = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}/transactions/${source.transaction_id}`);
    const existing = await tx.get(destination);
    if (existing.exists && existing.data()?.reconnect_session_id !== id) throw new ReconnectError('Bank record ownership conflict');
    const correction = existing.exists;
    const withdrawn = event === 'removed' && !existing.exists;
    // Only genuinely new purchases after the frozen historical boundary flow normally.
    const eligibleForAutomatic = !prior && !correction && event !== 'removed' && !payload.pending && session.phase === 'active' && session.mappingComplete && payload.date > session.cutoverDate;
    const automatic = eligibleForAutomatic && !await hasPossibleSavedOverlap(tx, uid, session.mappings[accountId] || [], payload);
    if (automatic) tx.create(destination, promotedFields(uid, id, payload));
    tx.set(ref, { uid, payload, version, event, correction, status: automatic || withdrawn ? 'resolved' : 'pending',
      promotedPath: existing.exists || automatic ? destination.path : null, updatedAt: Date.now(),
      ...(automatic || withdrawn ? { decision: withdrawn ? 'withdrawn_before_promotion' : 'distinct', reviewedVersion: version } : {}) });
    tx.update(sessionRef(uid, id), { reviewVersion: (session.reviewVersion || 0) + 1 });
    return automatic ? 1 : 0;
  });
}

/** Dedicated cursor importer for pending Items and every later update of a replacement Item. */
export async function syncReconnectUnderLease(uid: string, connection: PlaidConnection, leaseId: string): Promise<number> {
  if (connection.reauthenticationRequired) {
    const { data } = await plaidClient.itemGet({ access_token: connection.accessToken });
    if (data.item.item_id !== connection.itemId || data.item.error !== null) throw new ReconnectError('Repair your bank sign-in before continuing the history sync');
    await updatePlaidConnection(uid, connection.itemId, { reauthenticationRequired: false }, leaseId);
  }
  let events: Array<{ event: 'added' | 'modified' | 'removed'; row: BankTransaction | { transaction_id: string; account_id?: string } }> = [];
  let cursor = connection.cursor || undefined, historyReady = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    events = []; cursor = connection.cursor || undefined; historyReady = false;
    try {
      for (let pages = 0; ; pages++) {
        if (pages >= 1000) throw new ReconnectError('Bank pagination limit');
        const { data } = await plaidClient.transactionsSync({ access_token: connection.accessToken, cursor, count: 500, options: { include_personal_finance_category: true } });
        events.push(...data.added.map(row => ({ event: 'added' as const, row })), ...data.modified.map(row => ({ event: 'modified' as const, row })), ...data.removed.map(row => ({ event: 'removed' as const, row })));
        cursor = data.next_cursor;
        historyReady = data.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE';
        await updatePlaidConnection(uid, connection.itemId, {}, leaseId);
        if (!data.has_more) break;
      }
      break;
    } catch (error) {
      if ((error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue;
      throw error;
    }
  }
  const window = await getTransactionHistoryWindow(uid);
  let saved = 0;
  for (const event of events) {
    if (event.event !== 'removed' && !isWithinHistoryWindow((event.row as BankTransaction).date, window) && !(await records(uid, connection.reconnectSessionId!).doc(validId(event.row.transaction_id)).get()).exists) continue;
    await updatePlaidConnection(uid, connection.itemId, {}, leaseId);
    saved += await stageReconnectRecord(uid, connection, leaseId, event.event, event.row);
  }
  await adminDb.runTransaction(async tx => {
    const session = await guard(tx, uid, connection.reconnectSessionId!, connection.itemId, leaseId);
    tx.update(itemRef(connection.itemId), { cursor: cursor || '', lastSync: Date.now() });
    tx.update(sessionRef(uid, connection.reconnectSessionId!), { historyReady: session.historyReady || historyReady, lastSync: Date.now() });
  });
  return saved;
}

/** Plan upgrades/backfill retain the same review boundary and record-version checks. */
export async function backfillReconnectUnderLease(uid: string, connection: PlaidConnection, leaseId: string, accountId?: string): Promise<number> {
  if (accountId && !connection.accountIds.includes(accountId)) throw new ReconnectError('Bank account not found');
  const synced = await syncReconnectUnderLease(uid, connection, leaseId);
  const window = await getTransactionHistoryWindow(uid);
  const result = await fetchAllPlaidTransactions(plaidClient, { access_token: connection.accessToken, start_date: window.startDate, end_date: window.endDate,
    options: { account_ids: accountId ? [accountId] : connection.accountIds, include_personal_finance_category: true } }, '[Bank history review]');
  if (result.plaidTotalTransactions !== undefined && result.transactions.length < result.plaidTotalTransactions) throw new ReconnectError('Bank history is still incomplete. Please retry.');
  let saved = synced;
  for (const transaction of result.transactions) {
    if (!isWithinHistoryWindow(transaction.date, window) && !(await records(uid, connection.reconnectSessionId!).doc(validId(transaction.transaction_id)).get()).exists) continue;
    await updatePlaidConnection(uid, connection.itemId, {}, leaseId);
    saved += await stageReconnectRecord(uid, connection, leaseId, 'added', transaction);
  }
  return saved;
}

export async function getReconnectView(uid: string, id: string, cursor?: string): Promise<ReconnectView> {
  const session = owned(uid, (await sessionRef(uid, id).get()).data());
  const all = await records(uid, id).get();
  const pending = all.docs.filter(d => d.data().status !== 'resolved').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const after = cursor ? pending.filter(d => d.id > validId(cursor)) : pending;
  const page = after.slice(0, 25), old = await legacyRecords(uid, id);
  const views = await Promise.all(page.map(async doc => {
    const row = doc.data(), payload = row.payload;
    const promoted = row.promotedPath ? (await adminDb.doc(row.promotedPath).get()).data() : undefined;
    const scoped = old.filter(r => Number.isFinite(Number(r.data.amount)) && /^\d{4}-\d{2}-\d{2}/.test(String(r.data.date)) && (session.mappings[payload.account_id] || []).includes(overlapRecordScope(r)) && !r.data.superseded_by && r.data.pending !== true && r.data.bank_removed !== true);
    const candidates = scoped.filter(r => !promoted || promoted.superseded_by === r.path).filter(r => overlapKey(r.data) === overlapKey(payload) || (r.data.date === payload.date && Math.round(Number(r.data.amount) * 100) === Math.round(Number(payload.amount) * 100)) || r.path === promoted?.superseded_by)
      .slice(0, 30).map(r => ({ reference: r.path, version: reconnectRecordVersion(r.data), accountId: overlapRecordScope(r)!, ...viewFields(r.data),
        confirmed: r.data.review_status === 'confirmed', exact: overlapKey(r.data) === overlapKey(payload) }));
    return { id: doc.id, version: row.version, accountId: payload.account_id, ...viewFields(payload), status: row.status, event: row.event, correction: row.correction,
      canApplyCorrection: Boolean(promoted && !promoted.superseded_by), canChooseDistinct: !promoted,
      ...(promoted ? { previousRecord: { reference: row.promotedPath, version: reconnectRecordVersion(promoted), accountId: payload.account_id, ...viewFields(promoted), confirmed: promoted.review_status === 'confirmed' } } : {}), candidates };
  }));
  return { sessionId: id, phase: session.phase, itemId: session.itemId, accounts: session.accounts, legacyAccounts: session.legacyAccounts, mappings: session.mappings,
    historyReady: session.historyReady, mappingComplete: session.mappingComplete, ...counts(all.docs), records: views, nextCursor: after.length > 25 ? page.at(-1)!.id : null, cutoverDate: session.cutoverDate };
}

export async function applyReconnectDecision(uid: string, connection: PlaidConnection, leaseId: string, decision: ReconnectDecision) {
  const id = connection.reconnectSessionId!, ref = records(uid, id).doc(validId(decision.recordId));
  await adminDb.runTransaction(async tx => {
    const session = await guard(tx, uid, id, connection.itemId, leaseId);
    if (!session.mappingComplete) throw new ReconnectError('Map the bank accounts before reviewing history');
    const row = owned(uid, (await tx.get(ref)).data());
    if (row.version !== decision.version) throw new ReconnectError('Bank record changed. Refresh and review again.');
    const decisionId = hash(decision);
    if (row.status === 'resolved') {
      if (row.decisionId === decisionId) return;
      throw new ReconnectError('This bank record was already reviewed');
    }
    const payload = row.payload;
    if (!connection.accountIds.includes(payload.account_id)) throw new ReconnectError('Bank record ownership conflict');
    const path = `user_profiles/${uid}/accounts/${payload.account_id}/transactions/${decision.recordId}`;
    const destination = adminDb.doc(path), existing = await tx.get(destination);
    let patch: DocumentData | null = null;
    if (existing.exists && decision.decision !== 'defer' && reconnectRecordVersion(existing.data()!) !== decision.previousVersion) throw new ReconnectError('Previously saved record changed. Refresh and review again.');
    if (decision.decision === 'defer') {
      tx.update(ref, { status: 'deferred', decisionId }); return;
    }
    if (decision.decision === 'keep_existing') {
      if (!existing.exists || existing.data()?.reconnect_session_id !== id) throw new ReconnectError('No previous reviewed record');
    } else if (decision.decision === 'apply_correction') {
      if (!existing.exists || existing.data()?.reconnect_session_id !== id || existing.data()?.superseded_by) throw new ReconnectError('Review the linked saved record separately');
      patch = { ...payload, ...staleAnalysisUpdate(existing.data()!), pending: payload.bank_removed === true || payload.pending === true, is_deductible: null, review_status: 'unreviewed', tax_review_required: true, analyzed: false,
        analysis_status: 'pending', analysisStatus: 'pending', updated_at: new Date() };
    } else if (decision.decision === 'duplicate' || decision.decision === 'distinct') {
      if (payload.pending || payload.bank_removed) throw new ReconnectError('Wait for a posted transaction or keep the existing record');
      if (existing.exists && (decision.decision !== 'duplicate' || existing.data()?.superseded_by !== decision.canonicalReference)) throw new ReconnectError('Use correction review for a previously saved record');
      patch = promotedFields(uid, id, payload);
      if (decision.decision === 'duplicate') {
        const parsed = parseTransactionRecordPath(decision.canonicalReference);
        if (!parsed || (parsed.kind === 'account' && parsed.uid !== uid)) throw new ReconnectError('Invalid saved record');
        const canonical = await tx.get(adminDb.doc(decision.canonicalReference!));
        const canonicalData = canonical.data();
        const record = { path: canonical.ref.path, data: canonicalData || {} };
        if (!canonicalData || overlapRecordOwner(record) !== uid || !session.mappings[payload.account_id]?.includes(overlapRecordScope(record)) || canonicalData.reconnect_session_id === id || canonicalData.pending || canonicalData.bank_removed || canonicalData.superseded_by) throw new ReconnectError('Saved record does not belong to the mapped bank history');
        if (reconnectRecordVersion(canonicalData) !== decision.canonicalVersion) throw new ReconnectError('Saved record changed. Refresh and review again.');
        if (overlapKey(canonicalData) === overlapKey(payload)) {
          patch = { ...patch, ...planHistoricalOverlapDecision({ canonical: canonical.ref.path, candidate: path, decision: 'duplicate' },
            { canonical: record, candidate: { path, data: patch } }, { decisionId, now: new Date() }).update };
        } else {
          if (decision.confirmDifferentDetails !== true) throw new ReconnectError('Confirm the different bank details before linking these records');
          patch = { ...patch, superseded_by: canonical.ref.path, superseded_at: new Date().toISOString(), superseded_reason: 'historical_overlap_owner_review', superseded_decision_id: decisionId };
        }
      } else patch = { ...patch, overlap_reviewed: true, overlap_reviewed_at: new Date().toISOString(), overlap_reviewed_decision_id: decisionId };
    } else throw new ReconnectError('Invalid review decision');
    // Account metadata and the first transaction write happen together. There is no countable intermediate duplicate.
    const account = session.accounts.find((a: ReconnectAccount) => a.id === payload.account_id);
    if (patch) {
      tx.set(adminDb.doc(`user_profiles/${uid}/accounts/${payload.account_id}`), { id: payload.account_id, account_id: payload.account_id, user_id: uid,
        plaid_item_id: connection.itemId, source: 'plaid', reconnect_session_id: id, name: account?.name || 'Bank account', mask: account?.mask ?? null,
        type: account?.type || 'depository', iso_currency_code: account?.currency ?? null }, { merge: true });
      if (existing.exists) tx.update(destination, patch); else tx.create(destination, patch);
    }
    tx.update(ref, { status: 'resolved', decision: decision.decision, decisionId, reviewedVersion: row.version, promotedPath: existing.exists || patch ? path : null, reviewedAt: Date.now() });
  });
}

export async function actOnReconnect(uid: string, action: ReconnectAction): Promise<ReconnectView> {
  if (action.action === 'start') return getReconnectView(uid, await startReconnect(uid));
  const ref = sessionRef(uid, action.sessionId), session = owned(uid, (await ref.get()).data());
  if (action.action === 'cancel' && session.phase === 'cancelled') return getReconnectView(uid, action.sessionId);
  if (action.action === 'cancel' && !session.itemId) {
    await adminDb.runTransaction(async tx => {
      const current = owned(uid, (await tx.get(ref)).data());
      if (current.itemId) throw new ReconnectError('Bank connection changed. Refresh and retry cancellation.');
      tx.update(ref, { phase: 'cancelled' });
    });
    return getReconnectView(uid, action.sessionId);
  }
  if (!session.itemId) throw new ReconnectError('Connect the replacement bank first');
  if (action.action === 'cancel') {
    const { disconnectPlaidItem } = await import('./delete-item');
    const result = await disconnectPlaidItem(uid, session.itemId);
    if (!result.success) throw new ReconnectError(result.error?.message || 'Bank could not be disconnected');
    await ref.update({ phase: 'cancelled' });
    return getReconnectView(uid, action.sessionId);
  }
  await withPlaidConnection(uid, session.itemId, async (connection, leaseId) => {
    if (connection.reconnectSessionId !== action.sessionId) throw new ReconnectError('Bank review ownership conflict');
    if (action.action === 'sync') { await syncReconnectUnderLease(uid, connection, leaseId); return; }
    if (action.action === 'decide') {
      if (!Array.isArray(action.decisions) || !action.decisions.length || action.decisions.length > 25) throw new ReconnectError('Review up to 25 records at a time');
      for (const decision of action.decisions) { await updatePlaidConnection(uid, connection.itemId, {}, leaseId); await applyReconnectDecision(uid, connection, leaseId, decision); }
      return;
    }
    await adminDb.runTransaction(async tx => {
      const current = await guard(tx, uid, action.sessionId, connection.itemId, leaseId);
      const imported = await tx.get(records(uid, action.sessionId));
      if (action.action === 'map') {
        if (action.confirmAccountMapping !== true || !action.mappings || typeof action.mappings !== 'object' || Array.isArray(action.mappings)) throw new ReconnectError('Confirm each account mapping');
        if (current.mappingComplete) {
          if (hash(current.mappings) === hash(action.mappings)) return;
          throw new ReconnectError('Account mappings are frozen. Disconnect and start a new review to change them.');
        }
        const allowed = new Set(current.legacyAccounts.map((a: ReconnectAccount) => a.id));
        const entries = Object.entries(action.mappings);
        if (entries.length !== connection.accountIds.length || entries.some(([key, values]) => !connection.accountIds.includes(key) || !Array.isArray(values) || values.some(value => typeof value !== 'string' || !allowed.has(value)) || new Set(values).size !== values.length)) throw new ReconnectError('Map every new account to saved history or explicitly mark it different');
        const assigned = entries.flatMap(([, values]) => values);
        if (new Set(assigned).size !== assigned.length) throw new ReconnectError('Saved history cannot map to two replacement accounts');
        tx.update(ref, { mappings: action.mappings, mappingComplete: true });
      } else if (action.action === 'activate') {
        const summary = counts(imported.docs);
        if (current.reauthenticationRequired || !current.mappingComplete || !current.historyReady || summary.pendingCount || (summary.deferredCount && action.acknowledgeDeferred !== true)) throw new ReconnectError('Finish reviewing history or explicitly defer unresolved records before activation');
        tx.update(itemRef(connection.itemId), { status: 'active' });
        tx.update(ref, { phase: 'active', activatedAt: Date.now() });
        for (const account of current.accounts as ReconnectAccount[]) tx.set(adminDb.doc(`user_profiles/${uid}/accounts/${account.id}`), {
          id: account.id, account_id: account.id, user_id: uid, name: account.name, mask: account.mask, type: account.type,
          iso_currency_code: account.currency, plaid_item_id: connection.itemId, source: 'plaid', reconnect_session_id: action.sessionId }, { merge: true });
        tx.set(adminDb.doc(`user_profiles/${uid}`), { bankConnected: true }, { merge: true });
      } else throw new ReconnectError('Invalid bank review action');
    });
  }, false, true);
  return getReconnectView(uid, action.sessionId);
}
