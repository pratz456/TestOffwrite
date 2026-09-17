import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { callAnalysisWorker, shouldProcessTask, shouldQueueBankWrite } from './bridge';

const workerSecret = defineSecret('ANALYSIS_WORKER_SECRET');
const workerOrigin = defineString('ANALYSIS_WORKER_ORIGIN', { default: '' });
const options = { region: 'us-central1', retry: true, timeoutSeconds: 120,
  maxInstances: 2, concurrency: 2, memory: '256MiB' as const, secrets: [workerSecret] };
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
