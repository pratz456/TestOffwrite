const STAGING_PROJECT = 'writeoff-production-testing';
const STAGING_ORIGIN = 'https://writeoff-production-testing.web.app';
const PRODUCTION_PROJECT = 'writeoff-23910';
const PRODUCTION_ORIGIN = 'https://writeoffapp.com';
const MAX_EVENT_AGE_MS = 23 * 60 * 60 * 1000;

export function shouldQueueBankWrite(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  if (!after || after.pending === true) return false;
  const suggestion = after.ai_suggestion;
  if (suggestion && typeof suggestion === 'object' && 'id' in suggestion &&
      (after.analyzed === true || after.analysis_status === 'completed' || after.analysisStatus === 'completed')) return false;
  if (typeof after.amount !== 'number' || !Number.isFinite(after.amount)) return false;
  // Catch new posted records and pending->posted transitions, not our own status writes.
  return !before || before.pending === true ||
    (typeof after.analysisInputRevision === 'string' && after.analysisInputRevision !== before.analysisInputRevision);
}

export function shouldProcessTask(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  return !!after && after.status === 'queued' && typeof after.generation === 'string' && after.generation !== before?.generation;
}

export async function callAnalysisWorker(body: Record<string, string>, options: {
  project: string | undefined; origin: string; secret: string; eventTime: string; emulator?: string; fetcher?: typeof fetch;
}) {
  // Exact pairs prevent a worker from sending identifiers or its secret to a
  // different project, preview, redirect, or development server.
  const staging = options.project === STAGING_PROJECT && options.origin === STAGING_ORIGIN;
  const production = options.project === PRODUCTION_PROJECT && options.origin === PRODUCTION_ORIGIN;
  const hosted = options.emulator !== 'true' && (staging || production);
  const local = options.emulator === 'true' && options.project === 'demo-writeoff-security' && options.origin === 'http://127.0.0.1:3000';
  if ((!hosted && !local) || options.secret.trim().length < 32) throw new Error('ANALYSIS_WORKER_CONFIGURATION_REQUIRED');
  const createdAt = Date.parse(options.eventTime);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_EVENT_AGE_MS) return;
  const response = await (options.fetcher ?? fetch)(`${options.origin}/api/internal/analysis-worker`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-analysis-worker-secret': options.secret },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000), redirect: 'error',
  });
  // Permanent/provider-configuration failures are recorded as paused by the API and acknowledged with 200.
  // Non-2xx means no safe completion, a held lease/backoff, or transient failure: Eventarc retries it.
  if (!response.ok) throw new Error('ANALYSIS_WORKER_RETRY_REQUIRED');
}
