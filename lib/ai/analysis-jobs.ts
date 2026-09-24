import { createHash, randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import { analyzeTransactionWithRetry, convertToEnhancedContext, findMissingUserFields, type TransactionInput } from './analyzeTransaction';
import { getAIProviderStatus } from './provider-status';
import { analysisProfileHash } from './profile-context';
import { loadTaxpayerContext } from './taxpayer-context-server';
import { analysisInputHash, analysisLeaseUpdate, analysisSuggestionUpdate, createAnalysisLease,
  hasActiveAnalysisLease, isAnalysisLeaseCurrent } from './analysis-persistence';

const MAX_ATTEMPTS = 3;
const TASK_MAX_AGE_MS = 23 * 60 * 60 * 1000;
const ID = /^[^/\\\u0000-\u001f\u007f]{1,256}$/;
type Data = Record<string, any>;
export interface AnalysisTaskAddress { userId: string; accountId: string; transactionId: string }
export function validAnalysisId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && value !== '.' && value !== '..';
}
export function analysisTaskId(address: AnalysisTaskAddress) {
  return createHash('sha256').update(JSON.stringify([address.userId, address.accountId, address.transactionId])).digest('hex');
}
function owned(data: Data, uid: string) {
  return [data.userId, data.user_id].some(value => value === uid) &&
    [data.userId, data.user_id].every(value => value == null || value === uid);
}
function hasStructuredAnalysis(data: Data, profileHash?: string | null) {
  return data.ai_suggestion && typeof data.ai_suggestion.id === 'string' &&
    (profileHash === undefined || !!profileHash && data.ai_suggestion.profileHash === profileHash) &&
    data.analysisStatus !== 'failed' && data.analysis_status !== 'failed' &&
    (data.analyzed === true || data.analysisStatus === 'completed' || data.analysis_status === 'completed');
}

/** Remove AI-owned assertions while retaining every user-confirmed bookkeeping field. */
export function staleAnalysisUpdate(data: Data) {
  return {
    ...Object.fromEntries(Object.keys(data).filter(key => key.startsWith('ai_')).map(key => [key, null])),
    ai: null, analyzed: false, deductionStatus: 'Analysis pending', confidence: null, reasoning: null,
    irsPublication: null, irsSection: null, analysis_status: 'pending', analysisStatus: 'pending',
    analysisLeaseToken: null, analysisLeaseExpiresAt: null, analysisErrorCode: null,
  };
}
function eligibleBankTransaction(data: Data, account: Data, address: AnalysisTaskAddress) {
  const savedRecord = ['manual', 'receipt'].includes(data.source);
  const bankRecord = !['manual', 'receipt'].includes(data.source) &&
    ['depository', 'credit', 'loan', 'investment', 'brokerage', 'other'].includes(account.type);
  // A superseded duplicate is excluded from totals and review, so it never earns an AI suggestion.
  return owned(account, address.userId) && owned(data, address.userId) && (savedRecord || bankRecord) && Number.isFinite(data.amount) &&
    data.pending !== true && !isSupersededRecord(data) &&
    [data.account_id, data.accountId].every(value => value == null || value === address.accountId);
}
function refs(address: AnalysisTaskAddress) {
  return {
    account: adminDb.doc(`user_profiles/${address.userId}/accounts/${address.accountId}`),
    transaction: adminDb.doc(`user_profiles/${address.userId}/accounts/${address.accountId}/transactions/${address.transactionId}`),
    task: adminDb.doc(`analysis_tasks/${analysisTaskId(address)}`),
    job: adminDb.doc(`analysis_jobs/${address.userId}_${address.accountId}`),
    profile: adminDb.doc(`user_profiles/${address.userId}`),
  };
}

/** Durable queue only. Model work belongs to the retrying task trigger, never an HTTP tail. */
export async function enqueueBankTransactionAnalysis(address: AnalysisTaskAddress, retryFailed = false,
  options: { refreshProfile?: boolean } = {}) {
  if (!Object.values(address).every(validAnalysisId)) return { status: 'invalid' as const };
  const ref = refs(address);
  return adminDb.runTransaction(async tx => {
    const [account, record, task, job, profile] = await Promise.all([tx.get(ref.account), tx.get(ref.transaction), tx.get(ref.task), tx.get(ref.job), tx.get(ref.profile)]);
    if (!record.exists || !account.exists || !eligibleBankTransaction(record.data()!, account.data()!, address)) return { status: 'skipped' as const };
    const data = record.data()!;
    const profileHash = profile.exists ? analysisProfileHash(profile.data()!, data.date) : null;
    if (hasStructuredAnalysis(data, options.refreshProfile ? profileHash : undefined)) return { status: 'completed' as const };
    const old = task.data();
    const oldActive = old && ['queued', 'running', 'retry_wait'].includes(old.status);
    // A bank removal/restoration can invalidate a suggestion while returning to
    // the exact original financial input. Its revision still needs a fresh task.
    const changedInput = old && (old.inputHash !== analysisInputHash(data) ||
      typeof data.analysisInputRevision === 'string' && old.inputRevision !== data.analysisInputRevision);
    const changedProfile = options.refreshProfile && old && old.profileHash !== profileHash;
    const completedWithoutCurrentSuggestion = options.refreshProfile && old?.status === 'completed';
    if (oldActive && !changedInput && !changedProfile && (Date.now() - old.requestedAt < TASK_MAX_AGE_MS || hasActiveAnalysisLease(data))) return { status: 'queued' as const, taskId: ref.task.id, enqueued: false };
    if (old && !changedInput && !changedProfile && !completedWithoutCurrentSuggestion && (!retryFailed || Date.now() - old.requestedAt < 60_000)) return { status: old.status as 'paused' | 'failed' | 'completed', taskId: ref.task.id };
    const previousJob = job.data();
    const active = previousJob?.version === 1 && previousJob.processed < previousJob.total;
    const batchId = active ? previousJob.batchId : randomUUID();
    const counts = active ? { total: previousJob.total, processed: previousJob.processed, succeeded: previousJob.succeeded, failed: previousJob.failed } :
      { total: 0, processed: 0, succeeded: 0, failed: 0 };
    const now = Date.now();
    tx.set(ref.task, { ...address, generation: randomUUID(), batchId, status: 'queued', attempts: 0,
      requestedAt: now, nextAttemptAt: now, inputHash: analysisInputHash(data), profileHash,
      inputRevision: typeof data.analysisInputRevision === 'string' ? data.analysisInputRevision : null, lastErrorCode: null });
    tx.set(ref.job, { version: 1, userId: address.userId, accountId: address.accountId, batchId,
      ...counts, total: counts.total + (active && oldActive && old.batchId === batchId ? 0 : 1), status: 'running', phase: 'queued',
      startedAt: active ? previousJob.startedAt : new Date(now), completedAt: null, lastUpdate: new Date(now) });
    tx.update(ref.transaction, { ...(options.refreshProfile ? { ...staleAnalysisUpdate(data), analysisRefreshReason: 'profile_changed' } : {}),
      analysisJobId: ref.task.id, analysis_status: 'pending', analysisStatus: 'pending', analysisErrorCode: null });
    return { status: 'queued' as const, taskId: ref.task.id, enqueued: true };
  });
}

/** Plaid's financial corrections invalidate suggestions, never the user's tax decision. */
export async function updateImportedTransactionForAnalysis(address: AnalysisTaskAddress, fields: {
  date: string; amount: number; merchant_name: string; category: string; description: string;
  iso_currency_code: string | null; unofficial_currency_code: string | null; pending: boolean;
}) {
  if (!Object.values(address).every(validAnalysisId)) throw new Error('Invalid transaction address');
  const ref = refs(address).transaction;
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || !owned(snap.data()!, address.userId)) return { updated: false };
    const data = snap.data()!;
    // Keep the user's reviewed bookkeeping category; bank refreshes supply a separate source category.
    const importedFields = data.review_status === 'confirmed' ? { ...fields, category: data.category, bank_category: fields.category } : fields;
    const changed = analysisInputHash(data) !== analysisInputHash({ ...data, ...importedFields });
    const invalidated = changed ? { ...staleAnalysisUpdate(data), analysisInputRevision: randomUUID() } : {};
    tx.update(ref, { ...importedFields, ...invalidated, updated_at: new Date() });
    return { updated: true, invalidated: changed };
  });
}

export async function enqueueAccountAnalysis(userId: string, accountId: string) {
  if (!validAnalysisId(userId) || !validAnalysisId(accountId)) return { status: 'invalid' as const, queued: 0 };
  const account = await adminDb.doc(`user_profiles/${userId}/accounts/${accountId}`).get();
  if (!account.exists || !owned(account.data()!, userId)) return { status: 'missing' as const, queued: 0 };
  // This is a user-requested catch-up. Each task is independently durable and deduplicated.
  const rows = await account.ref.collection('transactions').get();
  let queued = 0;
  for (const row of rows.docs) {
    const result = await enqueueBankTransactionAnalysis({ userId, accountId, transactionId: row.id }, true);
    if (result.status === 'queued') queued++;
  }
  return { status: 'queued' as const, queued, jobId: `${userId}_${accountId}` };
}

function transactionInput(data: Data, id: string, account: Data): TransactionInput {
  return {
    transaction_kind: data.transaction_kind, type: data.type, tx_id: id, merchant: data.merchant_name || data.name || '', amount_usd: data.amount, date_iso: data.date,
    datetime_iso: data.datetime, merchant_name: data.merchant_name, amount: data.amount, category: data.category,
    date: data.date, datetime: data.datetime, account_id: data.account_id, description: data.description,
    note: data.notes || data.note || data.description, notes: data.notes, business_purpose: data.business_purpose,
    business_use_percentage: data.business_use_percentage,
    attendees: data.attendees, travel_destination: data.travel_destination, equipment_details: data.equipment_details,
    client_project: data.client_project, documentation_status: data.documentation_status,
    meeting_notes: data.meeting_notes, mileage_details: data.mileage_details, location: data.location,
    city: data.location?.city || data.city, state: data.location?.state || data.state,
    mcc: data.merchant_category_code || data.mcc, payment_channel: data.payment_channel,
    authorized_date: data.authorized_date, iso_currency_code: data.iso_currency_code,
    unofficial_currency_code: data.unofficial_currency_code, personal_finance_category: data.personal_finance_category,
    counterparties: data.counterparties, merchant_entity_id: data.merchant_entity_id,
    account_usage_type: ['business', 'personal', 'mixed'].includes(account.usageType) ? account.usageType : 'unknown',
  };
}

/** Returns retry only for an active lease/backoff or bounded transient provider failure. */
export async function processAnalysisTask(taskId: string, generation: string): Promise<{ status: string; retry: boolean; code?: string }> {
  if (!/^[a-f0-9]{64}$/.test(taskId) || !validAnalysisId(generation)) return { status: 'invalid', retry: false };
  const taskRef = adminDb.doc(`analysis_tasks/${taskId}`);
  const first = await taskRef.get();
  const initial = first.data();
  if (!initial || initial.generation !== generation) return { status: 'obsolete', retry: false };
  const address = { userId: initial.userId, accountId: initial.accountId, transactionId: initial.transactionId };
  if (!Object.values(address).every(validAnalysisId) || analysisTaskId(address) !== taskId) return { status: 'invalid', retry: false };
  const ref = refs(address);

  const claim = await adminDb.runTransaction(async tx => {
    const [task, record, profile, account, job] = await Promise.all([tx.get(taskRef), tx.get(ref.transaction), tx.get(ref.profile), tx.get(ref.account), tx.get(ref.job)]);
    const work = task.data();
    if (!work || work.generation !== generation || ['completed', 'failed', 'paused', 'skipped'].includes(work.status)) return { status: 'finished' as const };
    const data = record.data();
    const profileHash = profile.exists && data ? analysisProfileHash(profile.data()!, data.date) : null;
    const now = Date.now();
    function finish(status: string, code: string) {
      tx.update(taskRef, { status, lastErrorCode: code, finishedAt: now });
      const progress = job.data();
      if (progress && progress.batchId === work!.batchId) {
        const processed = progress.processed + 1;
        const failed = progress.failed + (status === 'completed' ? 0 : 1);
        tx.update(ref.job, { processed, failed, succeeded: progress.succeeded + (status === 'completed' ? 1 : 0),
          status: processed >= progress.total ? (failed ? 'failed' : 'done') : 'running', phase: status, lastErrorCode: code, lastUpdate: new Date(now) });
      }
      if (record.exists && !hasActiveAnalysisLease(data!, now) && !hasStructuredAnalysis(data!, profileHash)) {
        tx.update(ref.transaction, { ...staleAnalysisUpdate(data!), analysis_status: 'failed', analysisStatus: 'failed', analysisErrorCode: code });
      }
      return { status: 'finished' as const, code };
    }
    if (!data || !account.exists || !eligibleBankTransaction(data, account.data()!, address)) return finish('skipped', 'TRANSACTION_UNAVAILABLE');
    if (hasStructuredAnalysis(data, profileHash)) return finish('completed', 'ALREADY_ANALYZED');
    if (hasActiveAnalysisLease(data, now) || work.nextAttemptAt > now) return { status: 'busy' as const };
    if (work.attempts >= MAX_ATTEMPTS || now - work.requestedAt > TASK_MAX_AGE_MS) return finish('failed', 'AI_RETRY_LIMIT');
    if (!getAIProviderStatus().configured) return finish('paused', 'AI_UNAVAILABLE');
    if (!profile.exists) return finish('paused', 'PROFILE_REQUIRED');
    const context = convertToEnhancedContext(profile.data()!, data.date);
    if (findMissingUserFields(context).length > 0) return finish('paused', 'PROFILE_REQUIRED');
    if (!Number.isFinite(data.amount) || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
      !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date ||
      typeof (data.merchant_name || data.name) !== 'string' || !(data.merchant_name || data.name).trim()) return finish('paused', 'TRANSACTION_REVIEW_REQUIRED');
    if (data.iso_currency_code !== 'USD' || data.unofficial_currency_code) return finish('paused', 'CURRENCY_REVIEW_REQUIRED');
    const lease = createAnalysisLease(data, now);
    tx.update(taskRef, { status: 'running', attempts: work.attempts + 1, leaseToken: lease.token, startedAt: now, profileHash });
    tx.update(ref.transaction, { ...staleAnalysisUpdate(data), ...analysisLeaseUpdate(lease) });
    return { status: 'claimed' as const, lease, context, profileHash: profileHash!,
      input: transactionInput(data, address.transactionId, account.data()!), attempts: work.attempts + 1 };
  });
  if (claim.status !== 'claimed') return { status: claim.status, retry: claim.status === 'busy' };

  let result: Awaited<ReturnType<typeof analyzeTransactionWithRetry>>;
  try {
    // Confirmed history and saved methods are hints; a failed load leaves profile-only context.
    const taxpayer = await loadTaxpayerContext(address.userId, claim.context, claim.input.merchant, claim.input.date_iso ?? null).catch(() => undefined);
    result = await analyzeTransactionWithRetry(claim.input, taxpayer ? { ...claim.context, taxpayer_context: taxpayer } : claim.context);
  }
  catch { result = { success: false, error: 'AI analysis could not complete.', code: 'AI_FAILED', retryable: true }; }

  return adminDb.runTransaction(async tx => {
    const [task, record, job, profile] = await Promise.all([tx.get(taskRef), tx.get(ref.transaction), tx.get(ref.job), tx.get(ref.profile)]);
    const work = task.data();
    if (!work || work.generation !== generation || work.leaseToken !== claim.lease.token) return { status: 'obsolete', retry: false };
    const data = record.data();
    const current = !!data && isAnalysisLeaseCurrent(data, claim.lease) && profile.exists &&
      analysisProfileHash(profile.data()!, data.date) === claim.profileHash;
    const code = !current ? 'AI_INPUT_CHANGED' : result.success ? null : result.code || 'AI_FAILED';
    const retry = current && !result.success && result.retryable === true && claim.attempts < MAX_ATTEMPTS;
    const status = retry ? 'retry_wait' : !current ? 'failed' : result.success ? 'completed' : result.code === 'AI_UNAVAILABLE' ? 'paused' : 'failed';
    const now = Date.now();
    tx.update(taskRef, { status, lastErrorCode: code, nextAttemptAt: retry ? now + Math.min(60_000 * (2 ** (claim.attempts - 1)), 300_000) : null,
      leaseToken: null, finishedAt: retry ? null : now });
    if (current && result.success) tx.update(ref.transaction, analysisSuggestionUpdate(result.result, now, data, claim.profileHash, claim.context));
    else if (data?.analysisLeaseToken === claim.lease.token) tx.update(ref.transaction, {
      analysisLeaseToken: null, analysisLeaseExpiresAt: null, analysis_status: retry ? 'pending' : 'failed',
      analysisStatus: retry ? 'pending' : 'failed', analysisErrorCode: code,
    });
    const progress = job.data();
    if (!retry && progress && progress.batchId === work.batchId) {
      const processed = progress.processed + 1;
      const succeeded = progress.succeeded + (status === 'completed' ? 1 : 0);
      const failed = progress.failed + (status === 'completed' ? 0 : 1);
      tx.update(ref.job, { processed, succeeded, failed, status: processed >= progress.total ? (failed ? 'failed' : 'done') : 'running',
        phase: status, lastErrorCode: code, completedAt: processed >= progress.total ? new Date(now) : null, lastUpdate: new Date(now) });
    }
    return { status, retry, ...(code ? { code } : {}) };
  });
}
