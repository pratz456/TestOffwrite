import {setGlobalOptions} from 'firebase-functions/v2/options';
import {defineSecret, defineString} from 'firebase-functions/params';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import {assertScheduledBankConfig, currentBankUsers, PER_USER_TIMEOUT_MS, RUN_TIME_BUDGET_MS, SYNC_CONCURRENCY,
  SYNC_FETCH_TIMEOUT_MS, SYNC_FUNCTION_TIMEOUT_SECONDS, SYNC_STATE_DOC, type ScheduledBankConfig} from './sync-config';
import {createTimeBudget, nextCursor, orderFromCursor, runWithConcurrency, withTimeout} from './scheduler';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
// No production URL or provider-account fallback. These parameters must be set
// deliberately for the project when this separate codebase is deployed.
const siteUrl = defineString('SITE_URL', {default: ''});
const clientId = defineString('PLAID_CLIENT_ID', {default: ''});
const environment = defineString('PLAID_ENV', {default: ''});
const workerSecret = defineSecret('CLOUD_FUNCTION_SECRET');
setGlobalOptions({maxInstances: 10});

async function syncUser(uid: string, config: ScheduledBankConfig): Promise<number> {
  const profile = db.doc(`user_profiles/${uid}`);
  try {
    await profile.update({last_scheduled_sync: admin.firestore.FieldValue.serverTimestamp(), last_scheduled_sync_status: 'in_progress'});
    const response = await fetch(`${new URL(config.origin).origin}/api/plaid/sync-transactions-internal`, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Cloud-Function-Secret': config.secret},
      body: JSON.stringify({userId: uid}), redirect: 'error', signal: AbortSignal.timeout(SYNC_FETCH_TIMEOUT_MS),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== 'object' || !('success' in result) || result.success !== true ||
        !('transactions_saved' in result) || typeof result.transactions_saved !== 'number' || !Number.isFinite(result.transactions_saved)) {
      throw new Error('BANK_SYNC_RETRY_REQUIRED');
    }
    await profile.update({last_scheduled_sync_status: 'success', last_scheduled_sync_transactions: result.transactions_saved});
    return result.transactions_saved;
  } catch (error) {
    await profile.update({last_scheduled_sync_status: 'error', last_scheduled_sync_error: 'Bank synchronization needs retry.'}).catch(() => {});
    throw error;
  }
}

/**
 * Webhooks are primary; this explicit-project job retries missed bank updates.
 * Users are processed in a deterministic order, SYNC_CONCURRENCY at a time, each under a per-user
 * timeout, until RUN_TIME_BUDGET_MS is spent. The last started user is stored as a cursor so a
 * user base larger than one run can cover is finished across consecutive runs (and by the retry).
 */
export const syncAllUsersTransactions = onSchedule({
  schedule: 'every 2 hours', timeZone: 'America/New_York', retryCount: 1,
  maxInstances: 1, timeoutSeconds: SYNC_FUNCTION_TIMEOUT_SECONDS, secrets: [workerSecret],
}, async () => {
  const budget = createTimeBudget(RUN_TIME_BUDGET_MS);
  const config = {project: process.env.GCLOUD_PROJECT, origin: siteUrl.value(), clientId: clientId.value().trim(),
    environment: environment.value(), secret: workerSecret.value()};
  assertScheduledBankConfig(config);
  // Select safe routing metadata only. The server's connection store decrypts
  // the token after verifying ownership and the currently configured account.
  const [snapshot, state] = await Promise.all([
    db.collection('plaid_connections').where('status', '==', 'active').select('uid', 'status', 'clientId', 'environment').get(),
    db.doc(SYNC_STATE_DOC).get(),
  ]);
  const previousCursor = typeof state.data()?.cursor === 'string' ? state.data()!.cursor as string : null;
  const users = orderFromCursor(currentBankUsers(snapshot.docs.map(doc => doc.data()), config), previousCursor);

  const run = await runWithConcurrency(users, SYNC_CONCURRENCY,
    uid => withTimeout(syncUser(uid, config), PER_USER_TIMEOUT_MS, 'BANK_SYNC_USER_TIMEOUT'),
    {shouldStart: () => budget.canStart(PER_USER_TIMEOUT_MS)});
  const started = run.outcomes.map(outcome => outcome.item);
  const succeeded = run.outcomes.filter(outcome => outcome.status === 'fulfilled').length;
  const failed = run.started - succeeded;
  const cursor = nextCursor(started, run.skipped, previousCursor);

  await db.doc(SYNC_STATE_DOC).set({
    cursor, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastRun: {users: users.length, started: run.started, skipped: run.skipped, succeeded, failed, complete: run.skipped === 0, elapsedMs: budget.elapsed()},
  }, {merge: true});
  logger.info('Scheduled bank synchronization completed', {users: users.length, started: run.started, skipped: run.skipped, succeeded, failed, elapsedMs: budget.elapsed(), cursor});
  if (failed) throw new Error('BANK_SYNC_RETRY_REQUIRED');
});
