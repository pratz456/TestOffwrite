/**
 * Client-safe reading of the durable analysis pipeline's outcome codes.
 *
 * The worker (lib/ai/analysis-jobs.ts) stamps `analysisStatus` / `analysis_status`
 * and `analysisErrorCode` on each transaction and `lastErrorCode` on the
 * per-account job. This module turns those codes into plain copy and the one
 * action that moves a record forward. It performs no I/O, so every surface
 * (review card, transaction detail, dashboard, connect flow) shows the same words.
 */
import type { Transaction } from '@/lib/firebase/transactions';

/** Settings tab where the profession and state fields live. */
export const PROFILE_SETTINGS_HREF = '/protected/settings?tab=profile';

export const ANALYSIS_ERROR_CODES = ['AI_UNAVAILABLE', 'PROFILE_REQUIRED', 'TRANSACTION_REVIEW_REQUIRED', 'CURRENCY_REVIEW_REQUIRED',
  'AI_RETRY_LIMIT', 'AI_INPUT_CHANGED', 'AI_FAILED', 'TRANSACTION_UNAVAILABLE', 'ALREADY_ANALYZED'] as const;
export type AnalysisErrorCode = typeof ANALYSIS_ERROR_CODES[number];

export interface AnalysisOutcomeView {
  /** The stored code, including unknown ones, so support can match a report to a record. */
  code: string;
  /** paused: blocked on something outside the pipeline; failed: the pipeline gave up; skipped: not eligible. */
  kind: 'paused' | 'failed' | 'skipped';
  title: string;
  /** Copy for one record; `plural` is used when a surface groups several records under this code. */
  message: string;
  plural: string;
  /** The durable catch-up (POST /api/plaid/auto-analyze) can move this record forward. */
  retry: boolean;
  /** Where the user fixes the cause when it is not the record itself. */
  link: { href: string; label: string } | null;
  /** The record itself needs a manual look; analysis will not run until it changes. */
  manualReview: boolean;
}

type OutcomeCopy = Omit<AnalysisOutcomeView, 'code' | 'plural'> & { plural?: string };

const FAILED: OutcomeCopy = {
  kind: 'failed', title: 'Analysis could not complete', retry: true, link: null, manualReview: false,
  message: 'The AI service did not return a usable result. Your records are unchanged; retry analysis or review manually.',
};

const OUTCOMES: Record<Exclude<AnalysisErrorCode, 'ALREADY_ANALYZED'>, OutcomeCopy> = {
  AI_UNAVAILABLE: {
    kind: 'paused', title: 'AI analysis is temporarily unavailable', retry: false, link: null, manualReview: false,
    message: 'Your records are saved; you can review transactions manually.',
  },
  PROFILE_REQUIRED: {
    kind: 'paused', title: 'Analysis paused until your profile is complete', retry: true, manualReview: false,
    message: 'Add your profession and state to your profile to enable analysis, then retry.',
    link: { href: PROFILE_SETTINGS_HREF, label: 'Add profession and state' },
  },
  TRANSACTION_REVIEW_REQUIRED: {
    kind: 'paused', title: 'Analysis paused for this record', retry: false, link: null, manualReview: true,
    message: 'This record needs a valid date, amount and merchant before AI can analyze it. Review it manually.',
    plural: 'These records need a valid date, amount and merchant before AI can analyze them. Review them manually.',
  },
  CURRENCY_REVIEW_REQUIRED: {
    kind: 'paused', title: 'Analysis paused for this record', retry: false, link: null, manualReview: true,
    message: 'This record is not in U.S. dollars, so AI analysis does not run on it. Review it manually.',
    plural: 'These records are not in U.S. dollars, so AI analysis does not run on them. Review them manually.',
  },
  AI_RETRY_LIMIT: { ...FAILED, message: 'Analysis stopped after several attempts. Your records are unchanged; retry analysis or review manually.' },
  AI_INPUT_CHANGED: { ...FAILED, message: 'The transaction changed while it was being analyzed. Retry to analyze the current record.',
    plural: 'These transactions changed while they were being analyzed. Retry to analyze the current records.' },
  AI_FAILED: FAILED,
  TRANSACTION_UNAVAILABLE: {
    kind: 'skipped', title: 'Not eligible for AI analysis', retry: false, link: null, manualReview: false,
    message: 'This record is pending, removed or a duplicate of one already reviewed, so it is not analyzed.',
    plural: 'These records are pending, removed or duplicates of ones already reviewed, so they are not analyzed.',
  },
};

/** Codes stamped by the on-demand route (app/api/ai/analyze-transaction) when a single run is released. */
const ON_DEMAND_OUTCOMES: Record<string, OutcomeCopy> = {
  AI_PROFILE_REQUIRED: OUTCOMES.PROFILE_REQUIRED,
  AI_RECORD_CHANGED: OUTCOMES.AI_INPUT_CHANGED,
  AI_INPUT_REVIEW: { ...OUTCOMES.TRANSACTION_REVIEW_REQUIRED, plural: undefined,
    message: 'Confirm a valid date, amount and U.S. dollar currency on this record before AI can analyze it. Review it manually.' },
  AI_PENDING_TRANSACTION: { ...OUTCOMES.TRANSACTION_UNAVAILABLE, plural: undefined, message: 'This bank transaction is still pending. Analysis runs once it posts.' },
  AI_RATE_LIMITED: { ...FAILED, message: 'The AI service was busy. Retry analysis in a few minutes or review manually.' },
};

/**
 * Copy and action for a stored outcome code. `ALREADY_ANALYZED` and empty codes
 * explain nothing (a suggestion exists or no attempt was recorded). Unknown
 * non-empty codes read as a completed-with-failure outcome with retry.
 */
export function analysisOutcomeView(code: unknown): AnalysisOutcomeView | null {
  if (typeof code !== 'string' || !code.trim() || code === 'ALREADY_ANALYZED') return null;
  const known = (OUTCOMES as Record<string, OutcomeCopy | undefined>)[code] ?? ON_DEMAND_OUTCOMES[code] ?? FAILED;
  return { code, ...known, plural: known.plural ?? known.message };
}

const FAILED_VIEW: AnalysisOutcomeView = { code: 'AI_FAILED', ...FAILED, plural: FAILED.message };

/** The stamped fields only, so screens with their own record shapes (transaction detail) can pass what they hold. */
type AnalysisRecord = Pick<Transaction, 'analysisStatus' | 'analysis_status' | 'analysisErrorCode' | 'analysisJobId'> &
  { ai_suggestion?: { id?: string } | null; pending?: boolean | null };

export type AnalysisRecordState =
  | { state: 'bank_pending' | 'completed' | 'running' | 'queued' | 'none'; outcome: null }
  | { state: 'paused' | 'failed' | 'skipped'; outcome: AnalysisOutcomeView };

/**
 * What the pipeline last did with one record. A live run outranks everything; a
 * saved suggestion outranks a later failed on-demand attempt, which the review
 * flow already shows as the current suggestion.
 */
export function analysisRecordState(record: AnalysisRecord): AnalysisRecordState {
  if (record.pending === true) return { state: 'bank_pending', outcome: null };
  const status = record.analysisStatus ?? record.analysis_status;
  if (status === 'running') return { state: 'running', outcome: null };
  if (record.ai_suggestion?.id) return { state: 'completed', outcome: null };
  if (status === 'failed') {
    // A failed flag without a code predates the durable pipeline; it still needs a retry.
    const outcome = analysisOutcomeView(record.analysisErrorCode) ?? FAILED_VIEW;
    return { state: outcome.kind, outcome };
  }
  if (status === 'pending' && record.analysisJobId) return { state: 'queued', outcome: null };
  return { state: 'none', outcome: null };
}

export interface AnalysisBacklogOutcome { outcome: AnalysisOutcomeView; count: number; accountIds: string[] }

export interface AnalysisBacklog {
  /** Records queued or currently being analyzed. */
  waiting: number;
  /** Paused, failed and skipped records grouped by code, most common first. */
  outcomes: AnalysisBacklogOutcome[];
  /** Accounts holding at least one record the durable catch-up can retry. */
  retryAccountIds: string[];
}

/** Derived from the owner's already-loaded transactions; no extra reads or listeners. */
export function summarizeAnalysisBacklog(records: Array<AnalysisRecord & Pick<Transaction, 'account_id' | 'accountId'>>): AnalysisBacklog {
  let waiting = 0;
  const groups = new Map<string, AnalysisBacklogOutcome>();
  const retryAccounts = new Set<string>();
  for (const record of records) {
    const current = analysisRecordState(record);
    if (current.state === 'queued' || current.state === 'running') { waiting++; continue; }
    if (!current.outcome) continue;
    const accountId = record.account_id || record.accountId || '';
    const group = groups.get(current.outcome.code) ?? { outcome: current.outcome, count: 0, accountIds: [] };
    group.count++;
    if (accountId && !group.accountIds.includes(accountId)) group.accountIds.push(accountId);
    if (accountId && current.outcome.retry) retryAccounts.add(accountId);
    groups.set(current.outcome.code, group);
  }
  return { waiting, outcomes: [...groups.values()].sort((a, b) => b.count - a.count), retryAccountIds: [...retryAccounts] };
}

/** Backlog copy: an honest count and the expectation that a first import is slow. */
export function analysisBacklogMessage(waiting: number): string {
  const records = `${waiting} transaction${waiting === 1 ? '' : 's'} waiting for AI analysis.`;
  return `${records} A first import can take a while; suggestions appear as each one finishes, and you can review any transaction yourself now.`;
}

/** Title for a grouped outcome on an aggregate surface such as the dashboard. */
export function analysisOutcomeTitle(outcome: AnalysisOutcomeView, count: number): string {
  if (count <= 1) return outcome.title;
  const records = `${count} transactions`;
  if (outcome.code === 'AI_UNAVAILABLE') return `${outcome.title} for ${records}`;
  if (outcome.kind === 'paused') return `Analysis paused for ${records}`;
  if (outcome.kind === 'skipped') return `${records} are not eligible for AI analysis`;
  return `Analysis could not complete for ${records}`;
}

export function analysisOutcomeMessage(outcome: AnalysisOutcomeView, count: number): string {
  return count > 1 ? outcome.plural : outcome.message;
}

/** Short header label for a record card, alongside the category the user still has to choose. */
export function analysisOutcomeLabel(outcome: AnalysisOutcomeView): string {
  return outcome.kind === 'paused' ? 'AI analysis paused' : outcome.kind === 'skipped' ? 'Not analyzed by AI' : 'AI analysis could not complete';
}
