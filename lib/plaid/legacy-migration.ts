import type { DocumentData, DocumentReference, FieldValue as AdminFieldValue, Firestore } from 'firebase-admin/firestore';
import { encryptPlaidToken, isCurrent, validId } from './connection-primitives';

/**
 * The single implementation of the legacy Plaid credential migration. The
 * lazy per-user handshake (`migrateLegacyPlaidConnection`) and the
 * administrative bulk script both call `migrateLegacyPlaidCredentials`; they
 * differ only in the Firestore handle they pass and in whether profiles with
 * more than `LEGACY_ACCOUNT_TRANSACTION_LIMIT` accounts may be cleaned in
 * follow-up transactions.
 */

/** Firestore allows 500 writes per transaction; profile + connection + this many accounts stays under it. */
export const LEGACY_ACCOUNT_TRANSACTION_LIMIT = 400;
export const LEGACY_PROFILE_FIELDS = Object.freeze(['plaid_token', 'access_token', 'plaid_item_id', 'plaid_transactions_cursor'] as const);

type FieldValueStatic = Pick<typeof AdminFieldValue, 'delete'>;

export interface LegacyPlaidMigrationOptions {
  /**
   * Clean account tokens beyond the single-transaction limit in follow-up
   * transactions of at most `LEGACY_ACCOUNT_TRANSACTION_LIMIT` writes. Off by
   * default so a request-scoped handshake never performs a multi-step cleanup.
   */
  paginateAccounts?: boolean;
}

export interface LegacyPlaidMigrationResult {
  outcome: 'missing' | 'already_migrated' | 'migrated';
  /** A legacy token was encrypted into a new private `relink_required` connection. */
  tokenMoved: boolean;
  accountTokensCleared: number;
  paginated: boolean;
}

/** Key presence, not truthiness: the rules deny reads while either key exists at all. */
export const hasLegacyPlaidToken = (data: DocumentData | undefined): boolean =>
  Boolean(data) && ('plaid_token' in data! || 'access_token' in data!);

export function legacyPlaidToken(profile: DocumentData): string | null {
  return typeof profile.plaid_token === 'string' && profile.plaid_token ? profile.plaid_token
    : typeof profile.access_token === 'string' && profile.access_token ? profile.access_token : null;
}

export function legacyPlaidItemId(uid: string, profile: DocumentData): string {
  return typeof profile.plaid_item_id === 'string' && profile.plaid_item_id && !profile.plaid_item_id.includes('/')
    ? validId(profile.plaid_item_id) : `legacy-${uid}`;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export async function refreshBankConnectionProjection(db: Firestore, uid: string): Promise<void> {
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(db.collection('plaid_connections').where('uid', '==', uid));
    const bankConnected = snapshot.docs.some(doc => doc.data().status === 'active' && isCurrent(doc.data()));
    tx.update(db.doc(`user_profiles/${uid}`), { bankConnected });
  });
}

/** Retire public legacy secrets without trying them against a different Plaid client. */
export async function migrateLegacyPlaidCredentials(db: Firestore, FieldValue: FieldValueStatic, uid: string,
  options: LegacyPlaidMigrationOptions = {}): Promise<LegacyPlaidMigrationResult> {
  validId(uid);
  const profileRef = db.doc(`user_profiles/${uid}`);
  const profile = (await profileRef.get()).data();
  if (!profile) return { outcome: 'missing', tokenMoved: false, accountTokensCleared: 0, paginated: false };
  if (profile.plaid_credentials_migrated === true && !hasLegacyPlaidToken(profile)) {
    await refreshBankConnectionProjection(db, uid);
    return { outcome: 'already_migrated', tokenMoved: false, accountTokensCleared: 0, paginated: false };
  }
  const token = legacyPlaidToken(profile);
  const itemId = legacyPlaidItemId(uid, profile);
  const ref = db.collection('plaid_connections').doc(itemId);
  const encryptedAccessToken = token ? encryptPlaidToken(uid, itemId, token) : null;
  const clearTokens = { access_token: FieldValue.delete(), plaid_token: FieldValue.delete() };
  // Old profiles did not record a verified client identity. Never guess it or send
  // their token with the new client's credentials. Their saved records remain intact.
  const first = await db.runTransaction(async tx => {
    const [fresh, existing, accounts] = await Promise.all([
      tx.get(profileRef), tx.get(ref), tx.get(profileRef.collection('accounts')),
    ]);
    if (fresh.data()?.plaid_token !== profile.plaid_token || fresh.data()?.access_token !== profile.access_token || fresh.data()?.plaid_item_id !== profile.plaid_item_id) throw new Error('Bank connection changed during migration');
    if (token && existing.exists && existing.data()?.uid !== uid) throw new Error('Bank connection ownership mismatch');
    const paginated = accounts.size > LEGACY_ACCOUNT_TRANSACTION_LIMIT;
    if (paginated && !options.paginateAccounts) throw new Error('Bank migration requires a paginated administrative cleanup');
    const accountIds = accounts.docs.filter(account => account.data().plaid_item_id === itemId).map(account => account.id);
    const tokenAccounts = accounts.docs.filter(account => hasLegacyPlaidToken(account.data())).map(account => account.ref);
    const deferred = paginated ? tokenAccounts : [];
    if (token && !existing.exists) tx.set(ref, { uid, itemId, encryptedAccessToken, accountIds,
      clientId: null, environment: null, institutionId: null, status: 'relink_required',
      cursor: typeof profile.plaid_transactions_cursor === 'string' ? profile.plaid_transactions_cursor : null,
      connectedAt: profile.plaid_connected_at ?? new Date(), updatedAt: new Date() });
    if (!paginated) for (const account of tokenAccounts) tx.update(account, clearTokens);
    // With deferred account cleanups the completion marker is written last, so an
    // interrupted run is simply resumed by running the migration again.
    tx.update(profileRef, { plaid_token: FieldValue.delete(), access_token: FieldValue.delete(), plaid_item_id: FieldValue.delete(),
      plaid_transactions_cursor: FieldValue.delete(), ...(deferred.length ? {} : { plaid_credentials_migrated: true }),
      ...(token ? { bankConnected: existing.exists && existing.data()?.status === 'active' && isCurrent(existing.data()!) } : {}) });
    return { tokenMoved: Boolean(token) && !existing.exists, cleared: paginated ? 0 : tokenAccounts.length, paginated, deferred };
  });
  let cleared = first.cleared;
  if (first.deferred.length) {
    for (const references of chunk(first.deferred as DocumentReference[], LEGACY_ACCOUNT_TRANSACTION_LIMIT)) {
      cleared += await db.runTransaction(async tx => {
        const snapshots = await tx.getAll(...references);
        let count = 0;
        for (const snapshot of snapshots) {
          if (snapshot.exists && hasLegacyPlaidToken(snapshot.data())) { tx.update(snapshot.ref, clearTokens); count++; }
        }
        return count;
      });
    }
    await db.runTransaction(async tx => {
      const [current, accounts] = await Promise.all([tx.get(profileRef), tx.get(profileRef.collection('accounts'))]);
      if (!current.exists || hasLegacyPlaidToken(current.data()) || accounts.docs.some(account => hasLegacyPlaidToken(account.data()))) {
        throw new Error('Bank connection changed during migration');
      }
      tx.update(profileRef, { plaid_credentials_migrated: true });
    });
  }
  await refreshBankConnectionProjection(db, uid);
  return { outcome: 'migrated', tokenMoved: first.tokenMoved, accountTokensCleared: cleared, paginated: first.paginated };
}
