import { adminAuth, adminDb } from './admin';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { listPlaidConnectionSummaries } from '@/lib/plaid/connections';
import { recoverPendingPlaidLinks } from '@/lib/plaid/link-operations';
import { deleteQueryBatch } from './delete-helpers';
import { receiptBucket } from './receipt-security';
import { cancelUserStripeSubscriptions } from '@/lib/stripe/cancel-subscription';

export class AccountDeletionError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable: boolean, public readonly status = 503) {
    super(message);
  }
}

const OWNED_COLLECTIONS: Record<string, string[]> = {
  categories: ['user_id'], rules: ['user_id'], budgets: ['user_id'], exports: ['user_id'], audit_logs: ['user_id'],
  analysis_jobs: ['userId', 'user_id'], analysis_tasks: ['userId'], analysis_status: ['userId', 'user_id'],
  transactions: ['userId', 'user_id'], receipts: ['userId', 'user_id'], plaid_connections: ['uid'], processed_webhooks: ['user_id'],
  gross_receipts: ['userId', 'user_id'], income_1099: ['userId', 'user_id'], w2_income: ['userId', 'user_id'],
  tax_deductions: ['userId', 'user_id'], tax_organizers: ['userId', 'user_id'], user_corrections: ['userId'],
};

/** Revoke bank access first; retain the login and recovery metadata whenever cleanup fails. */
export async function deleteUserData(uid: string): Promise<{ error?: AccountDeletionError }> {
  try {
    // The UID becomes a Firestore document segment and an exact Storage prefix.
    if (!uid || uid.length > 128 || /[\/\\\u0000-\u001f\u007f]/.test(uid) || ['.', '..'].includes(uid)) {
      throw new AccountDeletionError('Account identity could not be verified.', 'INVALID_ACCOUNT', false, 400);
    }
    // Provider operations acquire a lease against this same document. Keeping
    // the marker outside the profile also blocks already-issued authentication
    // tokens from creating new bank/billing access after the profile is erased.
    const deletionRef = adminDb.doc(`account_deletions/${uid}`);
    await adminDb.runTransaction(async tx => {
      await tx.get(deletionRef);
      tx.set(deletionRef, { deletionRequested: true }, { merge: true });
    });
    try { await recoverPendingPlaidLinks(uid); }
    catch {
      throw new AccountDeletionError('A pending bank connection could not be revoked. Your account has not been deleted. Please retry.', 'BANK_LINK_RECOVERY_REQUIRED', true);
    }
    const deletion = (await deletionRef.get()).data();
    if (Object.keys(deletion?.linkOperations ?? {}).length || Object.keys(deletion?.billingOperations ?? {}).length) {
      throw new AccountDeletionError(
        'A bank or billing operation is still unresolved. Your account has not been deleted. Retry after it finishes, or contact support if it persists.',
        'ACCOUNT_OPERATION_PENDING', true, 409);
    }
    const profileRef = adminDb.doc(`user_profiles/${uid}`);
    const connections = await listPlaidConnectionSummaries(uid);
    const privateConnections = await adminDb.collection('plaid_connections').where('uid', '==', uid).get();
    // Retain old-provider credentials for manual revocation. Never try them with
    // the replacement Plaid account or erase the only remaining recovery record.
    const unresolved = privateConnections.docs.some(doc => {
      const bank = doc.data();
      return bank.status !== 'disconnected' && (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_ENV ||
        bank.clientId !== process.env.PLAID_CLIENT_ID || bank.environment !== process.env.PLAID_ENV || bank.status !== 'active');
    });
    if (unresolved) throw new AccountDeletionError(
      'An older bank connection needs manual revocation before your account can be deleted. Contact support to complete the deletion request; your account and bank recovery information have been retained.',
      'LEGACY_BANK_REVOCATION_REQUIRED', false, 409);

    for (const connection of connections) {
      const result = await disconnectPlaidItem(uid, connection.itemId);
      if (!result.success) throw new AccountDeletionError(
        'A bank connection could not be revoked. Your account has not been deleted. Please retry.', 'BANK_REVOCATION_FAILED', true);
    }
    // A completed individual disconnect removes its encrypted token. Refuse to
    // erase recovery information if a connection appeared or changed mid-run.
    const remaining = await adminDb.collection('plaid_connections').where('uid', '==', uid).get();
    if (remaining.docs.some(doc => doc.data().status !== 'disconnected' || doc.data().encryptedAccessToken)) {
      throw new AccountDeletionError('Bank cleanup is incomplete. Your account has not been deleted. Please retry.', 'BANK_REVOCATION_FAILED', true);
    }

    const billing = await cancelUserStripeSubscriptions(uid);
    if (!billing.success) throw new AccountDeletionError(
      'Billing could not be closed. Your account has not been deleted. Please retry.', 'BILLING_CLEANUP_FAILED', true);

    try {
      // Trailing slash prevents deleting another user's similarly prefixed UID.
      await receiptBucket().deleteFiles({ prefix: `receipts/${uid}/` });
    } catch {
      throw new AccountDeletionError('Receipt cleanup could not finish. Your account has not been deleted. Please retry.', 'RECEIPT_CLEANUP_FAILED', true);
    }

    // Missing collections yield empty queries. Database errors must propagate.
    for (const [collection, ownerFields] of Object.entries(OWNED_COLLECTIONS)) {
      for (const field of ownerFields) await deleteQueryBatch(adminDb.collection(collection).where(field, '==', uid), 500, data => {
        if (['userId', 'user_id', 'uid'].some(owner => data[owner] != null && data[owner] !== uid)) {
          throw new AccountDeletionError('A record ownership conflict needs support review before deletion can finish.', 'ACCOUNT_OWNERSHIP_CONFLICT', false, 409);
        }
        if (collection === 'plaid_connections' && (data.status !== 'disconnected' || data.encryptedAccessToken)) {
          throw new AccountDeletionError('Bank cleanup is incomplete. Your account has not been deleted. Please retry.', 'BANK_REVOCATION_FAILED', true);
        }
      });
    }
    for (const collection of ['learning_patterns', 'filing_security_metadata', 'tax_filing_connections']) {
      await adminDb.doc(`${collection}/${uid}`).delete();
    }
    // Includes nested accounts/transactions, mileage, settings, assets, and payments.
    await adminDb.recursiveDelete(profileRef);

    try { await adminAuth.deleteUser(uid); }
    catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }
    return {};
  } catch (error) {
    return { error: error instanceof AccountDeletionError ? error : new AccountDeletionError(
      'Account cleanup could not finish. Please retry or contact support.', 'ACCOUNT_CLEANUP_FAILED', true) };
  }
}
