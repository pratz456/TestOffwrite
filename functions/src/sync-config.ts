export interface ScheduledBankConfig {
  project: string | undefined;
  origin: string;
  clientId: string;
  environment: string;
  secret: string;
}

/** Cloud Scheduler function timeout (the platform maximum for 2nd-gen scheduled functions is 540 s). */
export const SYNC_FUNCTION_TIMEOUT_SECONDS = 540;
/** Users synced in parallel; each one is an internal HTTPS call that fans out to Plaid. */
export const SYNC_CONCURRENCY = 5;
/** Internal sync request timeout passed to fetch. */
export const SYNC_FETCH_TIMEOUT_MS = 90_000;
/** Per-user ceiling covering the fetch timeout plus the profile status writes. */
export const PER_USER_TIMEOUT_MS = 100_000;
/** Wall-clock budget; no user starts unless it can finish inside it, so the run ends before the timeout. */
export const RUN_TIME_BUDGET_MS = 480_000;
/** Server-only progress marker document (firestore.rules denies every client). */
export const SYNC_STATE_DOC = 'scheduled_jobs/plaid_transaction_sync';

/** A deployed scheduler must select the same project, provider account, and app. */
export function assertScheduledBankConfig(config: ScheduledBankConfig): void {
  const allowed: Record<string, { origin: string; environment: string }> = {
    'writeoff-production-testing': { origin: 'https://writeoff-production-testing.web.app', environment: 'sandbox' },
    'writeoff-23910': { origin: 'https://writeoffapp.com', environment: 'production' },
  };
  const expected = config.project ? allowed[config.project] : undefined;
  let url: URL;
  try { url = new URL(config.origin); }
  catch { throw new Error('BANK_SYNC_CONFIGURATION_REQUIRED'); }
  if (!expected || url.origin !== expected.origin || url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      config.environment !== expected.environment || !config.clientId.trim() || config.secret.length < 32) {
    throw new Error('BANK_SYNC_CONFIGURATION_REQUIRED');
  }
}

export function currentBankUsers(connections: Array<Record<string, unknown>>, config: ScheduledBankConfig): string[] {
  assertScheduledBankConfig(config);
  return [...new Set(connections.filter(connection => connection.status === 'active' &&
    connection.clientId === config.clientId && connection.environment === config.environment &&
    typeof connection.uid === 'string' && /^[^/\\\u0000-\u001f\u007f]{1,256}$/.test(connection.uid))
    .map(connection => connection.uid as string))];
}
