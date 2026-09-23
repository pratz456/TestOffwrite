import { hasAnalysisProfileChange } from './profile-fields';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import { callAnalysisWorker, shouldProcessTask, shouldQueueBankWrite } from './bridge';

const workerSecret = defineSecret('ANALYSIS_WORKER_SECRET');
const workerOrigin = defineString('ANALYSIS_WORKER_ORIGIN', { default: '' });
// maxInstances × concurrency bounds the model calls in flight (each worker call is one OpenAI request).
// Raise only together with the OpenAI organization's rate-limit tier; see docs/PRODUCTION_SCALE_2026-09-17.md §5.
const maxInstances = defineInt('ANALYSIS_MAX_INSTANCES', { default: 2 });
const concurrency = defineInt('ANALYSIS_CONCURRENCY', { default: 2 });
const options = { region: 'us-central1', retry: true, timeoutSeconds: 120,
  maxInstances, concurrency, memory: '256MiB' as const, secrets: [workerSecret] };
function settings(eventTime: string) {
  return { project: process.env.GCLOUD_PROJECT, origin: workerOrigin.value(), secret: workerSecret.value(), eventTime, emulator: process.env.FUNCTIONS_EMULATOR };
}

export const queueBankTransactionAnalysis = onDocumentWritten({ ...options,
  document: 'user_profiles/{userId}/accounts/{accountId}/transactions/{transactionId}',
}, async event => {
  if (!shouldQueueBankWrite(event.data?.before.data(), event.data?.after.data())) return;
  await callAnalysisWorker({ action: 'enqueue', userId: event.params.userId,
    accountId: event.params.accountId, transactionId: event.params.transactionId }, settings(event.time));
});

export const processBankTransactionAnalysis = onDocumentWritten({ ...options, document: 'analysis_tasks/{taskId}' }, async event => {
  const after = event.data?.after.data();
  if (!shouldProcessTask(event.data?.before.data(), after)) return;
  await callAnalysisWorker({ action: 'process', taskId: event.params.taskId, generation: after!.generation }, settings(event.time));
});

// Tax/business facts only: names, emails, billing and sync metadata never trigger model work.
export const queueProfileAnalysisRefresh = onDocumentWritten({ ...options, document: 'user_profiles/{userId}' }, async event => {
  if (!hasAnalysisProfileChange(event.data?.before.data(), event.data?.after.data())) return;
  await callAnalysisWorker({ action: 'enqueue-profile-refresh', userId: event.params.userId }, settings(event.time));
});

export const processProfileAnalysisRefresh = onDocumentWritten({ ...options, document: 'profile_analysis_refresh/{userId}' }, async event => {
  const after = event.data?.after.data();
  if (!shouldProcessTask(event.data?.before.data(), after)) return;
  await callAnalysisWorker({ action: 'process-profile-refresh', userId: event.params.userId, generation: after!.generation }, settings(event.time));
});
