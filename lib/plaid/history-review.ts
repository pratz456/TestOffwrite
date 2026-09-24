import type { DocumentData, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { isCurrent, validId } from './connection-primitives';

export const BANK_HISTORY_REVIEW_REQUIRED = 'BANK_HISTORY_REVIEW_REQUIRED';
export const BANK_HISTORY_REVIEW_MESSAGE = 'Your saved bank history needs a review before adding a new connection, so the same transactions are not counted twice. Your existing records are safe. Contact WriteOff support to review your bank history.';

const hasLegacyTokenField = (data: DocumentData) => 'plaid_token' in data || 'access_token' in data;

/** No token decryption, migration, or client-writable approval flag belongs in this check. */
export async function assertBankHistoryReadyForNewConnection(uid: string, transaction?: Transaction): Promise<void> {
  validId(uid);
  const profileRef = adminDb.doc(`user_profiles/${uid}`);
  const connectionQuery = adminDb.collection('plaid_connections').where('uid', '==', uid);
  const accountQuery = profileRef.collection('accounts');
  const [profile, connections, accounts] = transaction
    ? await Promise.all([transaction.get(profileRef), transaction.get(connectionQuery), transaction.get(accountQuery)])
    : await Promise.all([profileRef.get(), connectionQuery.get(), accountQuery.get()]);
  const profileData = profile.data() ?? {};
  const ownedConnections = connections.docs.map(doc => doc.data());
  // Disconnection retains history. Its status must not erase the old-provider footprint.
  const legacyConnection = ownedConnections.some(connection => !isCurrent(connection));
  const currentItems = new Set(ownedConnections.filter(isCurrent).map(connection => connection.itemId));
  const currentAccounts = new Set(ownedConnections.filter(isCurrent).flatMap(connection =>
    Array.isArray(connection.accountIds) ? connection.accountIds : []));
  const legacyAccount = accounts.docs.some(account => {
    const data = account.data();
    if (hasLegacyTokenField(data)) return true;
    if (data.plaid_item_id) return !currentItems.has(data.plaid_item_id) || !currentAccounts.has(account.id);
    return data.source === 'plaid' && !currentAccounts.has(account.id);
  });
  if (hasLegacyTokenField(profileData) || legacyConnection || legacyAccount ||
    (profileData.plaid_item_id && !currentItems.has(profileData.plaid_item_id))) {
    throw new Error(BANK_HISTORY_REVIEW_REQUIRED);
  }
}
