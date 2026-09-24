import { randomUUID } from 'node:crypto';
import type { AccountBase } from 'plaid';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { configuredIdentity, decryptPlaidToken, encryptPlaidToken, isCurrent, validId } from './connection-primitives';
import { migrateLegacyPlaidCredentials } from './legacy-migration';
import { assertBankHistoryReadyForNewConnection } from './history-review';

export { assertPlaidTokenEncryptionConfigured, decryptPlaidToken, encryptPlaidToken } from './connection-primitives';

/** Admin SDK only. This collection must never be readable or writable by clients. */
export interface PlaidConnection {
  uid: string;
  itemId: string;
  accessToken: string;
  accountIds: string[];
  institutionId: string | null;
  clientId: string;
  environment: string;
  cursor?: string;
  connectedAt?: unknown;
  lastSync?: number;
  reauthenticationRequired?: boolean;
}
const collection = () => adminDb.collection('plaid_connections');
const connectionRef = (itemId: string) => collection().doc(validId(itemId));
function decode(data: FirebaseFirestore.DocumentData): PlaidConnection {
  return { uid: data.uid, itemId: data.itemId, accessToken: decryptPlaidToken(data.uid, data.itemId, data.encryptedAccessToken),
    accountIds: data.accountIds ?? [], institutionId: data.institutionId ?? null, cursor: data.cursor,
    clientId: data.clientId, environment: data.environment, connectedAt: data.connectedAt, lastSync: data.lastSync,
    reauthenticationRequired: data.reauthenticationRequired === true };
}
/**
 * Retire public legacy secrets without trying them against a different Plaid client.
 * Request-scoped: profiles above the single-transaction account limit are left to
 * the administrative bulk migration (`npm run production:plaid-migration`).
 */
export async function migrateLegacyPlaidConnection(uid: string): Promise<void> {
  await migrateLegacyPlaidCredentials(adminDb, FieldValue, uid);
}

export async function listPlaidConnectionSummaries(uid: string) {
  await migrateLegacyPlaidConnection(uid);
  const snapshot = await collection().where('uid', '==', uid).get();
  return snapshot.docs.filter(doc => doc.data().status !== 'disconnected').map(doc => {
    const data = doc.data();
    const active = data.status === 'active' && isCurrent(data) && data.reauthenticationRequired !== true;
    return { itemId: data.itemId as string, accountIds: (data.accountIds ?? []) as string[], institutionId: data.institutionId ?? null,
      connectedAt: data.connectedAt ?? null, lastSync: data.lastSync ?? null,
      status: active ? 'active' : 'relink_required', relinkRequired: !active,
      reauthenticationRequired: data.status === 'active' && isCurrent(data) && data.reauthenticationRequired === true };
  });
}
export async function listPlaidConnections(uid: string): Promise<PlaidConnection[]> {
  await migrateLegacyPlaidConnection(uid);
  const snapshot = await collection().where('uid', '==', uid).get();
  return snapshot.docs.filter(doc => doc.data().status === 'active' && isCurrent(doc.data())).map(doc => decode(doc.data()));
}
export async function getPlaidConnection(uid: string, itemId?: string): Promise<PlaidConnection | null> {
  const connections = await listPlaidConnections(uid);
  if (itemId) return connections.find(connection => connection.itemId === itemId) ?? null;
  if (connections.length > 1) throw new Error('Choose the bank connection to manage');
  return connections[0] ?? null;
}
export async function findPlaidConnectionByItemId(itemId: string): Promise<PlaidConnection | null> {
  const existing = await connectionRef(itemId).get();
  if (existing.exists) return existing.data()?.status === 'active' && isCurrent(existing.data()!) ? decode(existing.data()!) : null;
  const legacy = await adminDb.collection('user_profiles').where('plaid_item_id', '==', itemId).limit(2).get();
  if (legacy.size !== 1) return null;
  await migrateLegacyPlaidConnection(legacy.docs[0].id);
  const migrated = await connectionRef(itemId).get();
  return migrated.exists && migrated.data()?.status === 'active' && isCurrent(migrated.data()!) ? decode(migrated.data()!) : null;
}
export async function savePlaidConnection(input: Omit<PlaidConnection, 'cursor' | 'clientId' | 'environment'> & { accounts?: AccountBase[] }): Promise<void> {
  validId(input.uid); validId(input.itemId);
  const accountIds = [...new Set(input.accountIds.map(validId))];
  if (!accountIds.length || accountIds.length > 200) throw new Error('Invalid bank account list');
  const identity = configuredIdentity();
  if (!identity.clientId || !['sandbox', 'production'].includes(identity.environment)) throw new Error('Bank provider identity is not configured');
  const encryptedAccessToken = encryptPlaidToken(input.uid, input.itemId, input.accessToken);
  await migrateLegacyPlaidConnection(input.uid);
  const ref = connectionRef(input.itemId);
  await adminDb.runTransaction(async tx => {
    const deletion = await tx.get(adminDb.doc(`account_deletions/${input.uid}`));
    if (deletion.data()?.deletionRequested === true) throw new Error('ACCOUNT_DELETION_IN_PROGRESS');
    const existing = await tx.get(ref);
    const accounts = await Promise.all(accountIds.map(id => tx.get(adminDb.doc(`user_profiles/${input.uid}/accounts/${id}`))));
    if (existing.exists) throw new Error('BANK_ALREADY_CONNECTED');
    if (accounts.some(account => account.exists)) throw new Error('BANK_ALREADY_CONNECTED');
    // Recheck atomically: history may have changed while the provider exchange ran.
    await assertBankHistoryReadyForNewConnection(input.uid, tx);
    tx.set(ref, { uid: input.uid, itemId: input.itemId, encryptedAccessToken, accountIds, institutionId: input.institutionId ?? null,
      ...identity, status: 'active', connectedAt: new Date(), updatedAt: new Date(), cursor: null });
    for (const accountId of accountIds) {
      const account = input.accounts?.find(value => value.account_id === accountId);
      const balances = account?.balances;
      const balance = account?.type === 'credit'
        ? balances?.available ?? (balances?.limit != null && balances?.current != null ? Math.max(0, balances.limit - Math.abs(balances.current)) : null)
        : balances?.available ?? balances?.current ?? null;
      tx.set(adminDb.doc(`user_profiles/${input.uid}/accounts/${accountId}`), {
        id: accountId, account_id: accountId, user_id: input.uid, plaid_item_id: input.itemId, source: 'plaid',
        name: account?.name || account?.official_name || 'Bank account', mask: account?.mask ?? null,
        type: account?.type ?? 'depository', subtype: account?.subtype ?? null, institution_id: input.institutionId ?? '',
        balance, available_balance: balances?.available ?? null, current_balance: balances?.current ?? null, limit: balances?.limit ?? null,
        iso_currency_code: balances?.iso_currency_code ?? null, unofficial_currency_code: balances?.unofficial_currency_code ?? null,
        balance_last_updated: new Date().toISOString(), created_at: new Date(), updated_at: new Date(),
      });
    }
    tx.set(adminDb.doc(`user_profiles/${input.uid}`), { bankConnected: true, plaid_credentials_migrated: true }, { merge: true });
  });
}

/** Serializes sync/import/disconnect for one item; other banks remain independent. */
export async function withPlaidConnection<T>(uid: string, itemId: string,
  work: (connection: PlaidConnection, leaseId: string) => Promise<T>, allowRelink = false): Promise<T> {
  const ref = connectionRef(itemId);
  const leaseId = randomUUID();
  const connection = await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.uid !== uid || data.status === 'disconnected' || (!allowRelink && (data.status !== 'active' || !isCurrent(data)))) throw new Error('Bank connection not found');
    if (data.leaseExpiresAt > Date.now()) throw new Error('Bank connection is busy. Please retry.');
    tx.update(ref, { leaseId, leaseExpiresAt: Date.now() + 20 * 60_000 });
    return isCurrent(data) && data.status === 'active' ? decode(data) : { ...data, accessToken: '' } as PlaidConnection;
  });
  try { return await work(connection, leaseId); }
  finally {
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.data()?.leaseId === leaseId) tx.update(ref, { leaseId: FieldValue.delete(), leaseExpiresAt: FieldValue.delete() });
    });
  }
}
export async function updatePlaidConnection(uid: string, itemId: string,
  patch: { cursor?: string; lastSync?: number; status?: 'active' | 'disconnecting' | 'revocation_required'; reauthenticationRequired?: false }, leaseId: string): Promise<void> {
  const ref = connectionRef(itemId);
  await adminDb.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (data?.uid !== uid || data.leaseId !== leaseId || data.status === 'disconnected') throw new Error('Bank connection changed');
    tx.update(ref, { ...patch, ...(patch.reauthenticationRequired === false ? { reauthenticationRequired: FieldValue.delete() } : {}),
      updatedAt: new Date(), leaseExpiresAt: Date.now() + 20 * 60_000 });
  });
}

/** A signed provider error flags only a current Item; keep its token available for Link update mode. */
export async function markPlaidConnectionLoginRequired(itemId: string): Promise<boolean> {
  const ref = connectionRef(itemId);
  return adminDb.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status !== 'active' || !isCurrent(data)) return false;
    tx.update(ref, { reauthenticationRequired: true, updatedAt: new Date() });
    return true;
  });
}
export async function removePlaidConnection(uid: string, itemId: string, leaseId: string): Promise<void> {
  const ref = connectionRef(itemId);
  await adminDb.runTransaction(async tx => {
    const [snapshot, others] = await Promise.all([tx.get(ref), tx.get(collection().where('uid', '==', uid))]);
    if (snapshot.data()?.uid !== uid || snapshot.data()?.leaseId !== leaseId) throw new Error('Bank connection changed');
    tx.update(ref, { status: 'disconnected', encryptedAccessToken: FieldValue.delete(), cursor: FieldValue.delete(), updatedAt: new Date() });
    tx.set(adminDb.doc(`user_profiles/${uid}`), { bankConnected: others.docs.some(doc => doc.id !== itemId && doc.data().status === 'active' && isCurrent(doc.data())) }, { merge: true });
  });
}
