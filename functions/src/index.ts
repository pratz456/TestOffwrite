import {setGlobalOptions} from 'firebase-functions/v2/options';
import {defineSecret, defineString} from 'firebase-functions/params';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import {assertScheduledBankConfig, currentBankUsers} from './sync-config';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
// No production URL or provider-account fallback. These parameters must be set
// deliberately for the project when this separate codebase is deployed.
const siteUrl = defineString('SITE_URL', {default: ''});
const clientId = defineString('PLAID_CLIENT_ID', {default: ''});
const environment = defineString('PLAID_ENV', {default: ''});
const workerSecret = defineSecret('CLOUD_FUNCTION_SECRET');
setGlobalOptions({maxInstances: 10});

/** Webhooks are primary; this explicit-project job retries missed bank updates. */
export const syncAllUsersTransactions = onSchedule({
  schedule: 'every 2 hours', timeZone: 'America/New_York', retryCount: 1,
  maxInstances: 1, timeoutSeconds: 540, secrets: [workerSecret],
}, async () => {
  const config = {project: process.env.GCLOUD_PROJECT, origin: siteUrl.value(), clientId: clientId.value().trim(),
    environment: environment.value(), secret: workerSecret.value()};
  assertScheduledBankConfig(config);
  // Select safe routing metadata only. The server's connection store decrypts
  // the token after verifying ownership and the currently configured account.
  const snapshot = await db.collection('plaid_connections').where('status', '==', 'active')
    .select('uid', 'status', 'clientId', 'environment').get();
  const users = currentBankUsers(snapshot.docs.map(doc => doc.data()), config);
  let succeeded = 0;
  let failed = 0;
  for (const uid of users) {
    const profile = db.doc(`user_profiles/${uid}`);
    try {
      await profile.update({last_scheduled_sync: admin.firestore.FieldValue.serverTimestamp(), last_scheduled_sync_status: 'in_progress'});
      const response = await fetch(`${new URL(config.origin).origin}/api/plaid/sync-transactions-internal`, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-Cloud-Function-Secret': config.secret},
        body: JSON.stringify({userId: uid}), redirect: 'error', signal: AbortSignal.timeout(90_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result !== 'object' || !('success' in result) || result.success !== true ||
          !('transactions_saved' in result) || typeof result.transactions_saved !== 'number' || !Number.isFinite(result.transactions_saved)) {
        throw new Error('BANK_SYNC_RETRY_REQUIRED');
      }
      await profile.update({last_scheduled_sync_status: 'success', last_scheduled_sync_transactions: result.transactions_saved});
      succeeded++;
    } catch {
      failed++;
      await profile.update({last_scheduled_sync_status: 'error', last_scheduled_sync_error: 'Bank synchronization needs retry.'}).catch(() => {});
    }
  }
  logger.info('Scheduled bank synchronization completed', {users: users.length, succeeded, failed});
  if (failed) throw new Error('BANK_SYNC_RETRY_REQUIRED');
});
