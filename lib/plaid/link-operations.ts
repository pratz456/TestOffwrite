import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { decryptPlaidToken, encryptPlaidToken } from './connections';
import { plaidClient } from './client';

export const ACCOUNT_DELETION_IN_PROGRESS = 'ACCOUNT_DELETION_IN_PROGRESS';
export type PlaidLinkOperation = { startedAt: number; state: 'in_flight' | 'exchange_unknown' | 'revocation_pending' | 'ownership_conflict' };
const ledger = (uid: string) => {
  if (!uid || /[/\\]/.test(uid)) throw new Error('Invalid account');
  return adminDb.doc(`account_deletions/${uid}`);
};
const recovery = (uid: string, operationId: string) => ledger(uid).collection('plaid_revocations').doc(operationId);

/** A durable operation marker closes the gap between provider exchange and saving the Item. */
export async function beginPlaidLinkOperation(uid: string): Promise<string> {
  const id = randomUUID();
  await adminDb.runTransaction(async tx => {
    const ref = ledger(uid), data = (await tx.get(ref)).data();
    if (data?.deletionRequested === true) throw new Error(ACCOUNT_DELETION_IN_PROGRESS);
    const operations = data?.linkOperations ?? {};
    if (Object.keys(operations).length >= 5) throw new Error('BANK_CONNECTION_RECOVERY_REQUIRED');
    tx.set(ref, { linkOperations: { ...operations, [id]: { startedAt: Date.now(), state: 'in_flight' } } }, { merge: true });
  });
  return id;
}

/** Store before any account lookup/save that might fail. This collection is server-only. */
export async function retainPlaidLinkRecovery(uid: string, operationId: string, itemId: string, accessToken: string): Promise<void> {
  const encryptedAccessToken = encryptPlaidToken(uid, itemId, accessToken);
  await adminDb.runTransaction(async tx => {
    const ref = ledger(uid), data = (await tx.get(ref)).data();
    if (!data?.linkOperations?.[operationId]) throw new Error('Bank operation ownership could not be verified');
    tx.set(recovery(uid, operationId), { uid, itemId, encryptedAccessToken, clientId: process.env.PLAID_CLIENT_ID,
      environment: process.env.PLAID_ENV, status: 'revocation_pending', createdAt: new Date() });
  });
}

export async function markPlaidLinkOperationUnresolved(uid: string, operationId: string, hasRecovery: boolean): Promise<void> {
  await adminDb.runTransaction(async tx => {
    const ref = ledger(uid), data = (await tx.get(ref)).data();
    if (!data?.linkOperations?.[operationId]) return;
    tx.update(ref, { linkOperations: { ...data.linkOperations, [operationId]: { ...data.linkOperations[operationId],
      state: hasRecovery ? 'revocation_pending' : 'exchange_unknown' } } });
  });
}

/** Never revoke an existing Item based on a conflicting exchange request. */
export async function existingPlaidLinkOwner(uid: string, itemId: string, accessToken: string): Promise<'none' | 'owner' | 'conflict'> {
  if (!itemId || /[/\\]/.test(itemId)) throw new Error('Invalid bank item');
  const data = (await adminDb.doc(`plaid_connections/${itemId}`).get()).data();
  if (!data) return 'none';
  if (data.uid === uid && data.itemId === itemId && data.status === 'active' && data.clientId === process.env.PLAID_CLIENT_ID
    && data.environment === process.env.PLAID_ENV && decryptPlaidToken(uid, itemId, data.encryptedAccessToken) === accessToken) return 'owner';
  return 'conflict';
}

export async function quarantinePlaidLinkRecovery(uid: string, operationId: string): Promise<void> {
  await adminDb.runTransaction(async tx => {
    const ref = ledger(uid), saved = recovery(uid, operationId);
    const [snapshot, token] = await Promise.all([tx.get(ref), tx.get(saved)]);
    const data = snapshot.data();
    if (data?.linkOperations?.[operationId]) tx.update(ref, { linkOperations: { ...data.linkOperations,
      [operationId]: { ...data.linkOperations[operationId], state: 'ownership_conflict' } } });
    if (token.exists) tx.update(saved, { status: 'ownership_review' });
  });
}

/** No TTL cleanup: call only after the Item is durably saved or provider revocation is confirmed. */
export async function finishPlaidLinkOperation(uid: string, operationId: string): Promise<void> {
  await adminDb.runTransaction(async tx => {
    const ref = ledger(uid), data = (await tx.get(ref)).data();
    const operations = { ...data?.linkOperations };
    delete operations[operationId];
    if (data) tx.update(ref, { linkOperations: operations });
    tx.delete(recovery(uid, operationId));
  });
}

/** Called by deletion retries only after their durable deletionRequested marker is set. */
export async function recoverPendingPlaidLinks(uid: string): Promise<void> {
  const data = (await ledger(uid).get()).data();
  if (data?.deletionRequested !== true) throw new Error('Account deletion must be requested before recovery');
  for (const [operationId, operation] of Object.entries(data.linkOperations ?? {}) as [string, PlaidLinkOperation][]) {
    if (operation.state !== 'revocation_pending') continue;
    const saved = (await recovery(uid, operationId).get()).data();
    if (!saved || saved.uid !== uid || saved.status !== 'revocation_pending'
      || !process.env.PLAID_CLIENT_ID || saved.clientId !== process.env.PLAID_CLIENT_ID || saved.environment !== process.env.PLAID_ENV) continue;
    const accessToken = decryptPlaidToken(uid, saved.itemId, saved.encryptedAccessToken);
    const owner = await existingPlaidLinkOwner(uid, saved.itemId, accessToken);
    if (owner === 'owner') { await finishPlaidLinkOperation(uid, operationId); continue; }
    if (owner === 'conflict') { await quarantinePlaidLinkRecovery(uid, operationId); continue; }
    try { await plaidClient.itemRemove({ access_token: accessToken }); }
    catch (error) {
      const code = (error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;
      if (!['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(code ?? '')) throw new Error('Bank revocation must be retried');
    }
    await finishPlaidLinkOperation(uid, operationId);
  }
}
