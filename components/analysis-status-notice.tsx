'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { parseAnalysisQueue } from '@/lib/ai/client-job-progress';
import { analysisBacklogMessage, analysisOutcomeMessage, analysisOutcomeTitle, type AnalysisOutcomeView } from '@/lib/ai/analysis-state';

export interface AnalysisRetryResult { ok: boolean; queued: number; message: string }

/**
 * One POST /api/plaid/auto-analyze per account. The server re-queues only records
 * without a saved suggestion, so a retry never replaces existing suggestions.
 */
export async function requestAnalysisRetry(accountIds: string[]): Promise<AnalysisRetryResult> {
  let queued = 0;
  for (const accountId of accountIds) {
    try {
      const response = await makeAuthenticatedRequest('/api/plaid/auto-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const partial = queued > 0 ? `${queued} transaction${queued === 1 ? '' : 's'} queued again before this stopped. ` : '';
        return { ok: false, queued, message: response.status === 429 ? `${partial}Analysis was retried recently. Wait a few minutes before retrying again.`
          : response.status === 401 ? 'Your session expired. Sign in again to retry analysis.'
          : body?.code === 'AI_UNAVAILABLE' ? 'AI analysis is temporarily unavailable. Your records are saved; you can review transactions manually.'
          : 'Analysis could not be retried. Your records are unchanged; try again later or review manually.' };
      }
      const result = parseAnalysisQueue(body);
      if (!result) return { ok: false, queued, message: 'The retry response could not be verified. Refresh and check the analysis status.' };
      queued += result.queued;
    } catch {
      return { ok: false, queued, message: 'Analysis could not be retried. Check your connection and try again.' };
    }
  }
  return { ok: true, queued, message: queued > 0
    ? `${queued} transaction${queued === 1 ? '' : 's'} queued again. Suggestions appear as each one finishes; nothing is confirmed without your review.`
    : 'Nothing new was queued: recent attempts are still in progress or these records already have suggestions. Check again in a minute.' };
}

interface AnalysisStatusNoticeProps {
  /** Records queued or running; shown with the first-import note. */
  waiting?: number;
  /** The outcome to explain; omitted while nothing is paused, failed or skipped. */
  outcome?: AnalysisOutcomeView | null;
  /** Records sharing this outcome. */
  count?: number;
  /** Accounts the retry re-queues; the retry button is hidden when empty or when the outcome has no retry. */
  accountIds?: string[];
  /** Opens the record for manual review when the record itself is the blocker. */
  onReview?: () => void;
  disabled?: boolean;
  /** Borderless, for embedding in an existing card. */
  compact?: boolean;
  className?: string;
}

const actionClass = 'inline-flex min-h-11 max-w-full items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-medium disabled:opacity-50';

/**
 * Explains why AI analysis has not produced a suggestion and offers the one way
 * forward: wait (with a count), fix the profile, retry the durable queue, or
 * review the record manually. Renders nothing when there is nothing to explain.
 */
export function AnalysisStatusNotice({ waiting = 0, outcome = null, count = 1, accountIds = [], onReview, disabled = false, compact = false, className = '' }: AnalysisStatusNoticeProps) {
  const [retry, setRetry] = useState<{ state: 'idle' | 'queuing' | 'done'; result: AnalysisRetryResult | null }>({ state: 'idle', result: null });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setRetry({ state: 'idle', result: null }); }, [outcome?.code]);

  if (waiting <= 0 && !outcome) return null;
  const retryable = !!outcome?.retry && accountIds.length > 0;

  const requestRetry = async () => {
    if (retry.state !== 'idle' || !retryable) return;
    setRetry({ state: 'queuing', result: null });
    const result = await requestAnalysisRetry(accountIds);
    if (!mounted.current) return;
    setRetry({ state: result.ok ? 'done' : 'idle', result });
  };

  return (
    <section role="status" aria-label="AI analysis status"
      className={`min-w-0 space-y-2 text-sm ${compact ? '' : 'rounded-xl border border-border bg-card p-3'} ${className}`.trim()}>
      {waiting > 0 && (
        <p className="flex items-start gap-2 text-xs leading-4 text-muted-foreground">
          <Loader2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <span className="min-w-0 break-words">{analysisBacklogMessage(waiting)}</span>
        </p>
      )}
      {outcome && (
        <div className="min-w-0 space-y-1.5">
          <p className="flex items-start gap-2 font-medium leading-5">
            <AlertCircle aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${outcome.kind === 'failed' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`} />
            <span className="min-w-0 break-words">{analysisOutcomeTitle(outcome, count)}</span>
          </p>
          <p className="break-words text-xs leading-4 text-muted-foreground">{analysisOutcomeMessage(outcome, count)}</p>
          {retry.result && (
            <p role={retry.result.ok ? 'status' : 'alert'} className={`flex items-start gap-2 rounded-lg p-2 text-xs leading-4 ${retry.result.ok ? 'bg-primary/5' : 'bg-amber-500/10'}`}>
              {retry.result.ok && <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
              <span className="min-w-0 break-words">{retry.result.message}</span>
            </p>
          )}
          {(outcome.link || retryable || (outcome.manualReview && onReview)) && (
            <div className="flex flex-wrap gap-2">
              {outcome.link && <Link href={outcome.link.href} className={actionClass}>{outcome.link.label}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>}
              {retryable && (
                <button type="button" onClick={requestRetry} disabled={disabled || retry.state !== 'idle'} className={actionClass}>
                  {retry.state === 'queuing' ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4 shrink-0" />}
                  {retry.state === 'queuing' ? 'Retrying…' : retry.state === 'done' ? 'Retry requested' : 'Retry analysis'}
                </button>
              )}
              {outcome.manualReview && onReview && (
                <button type="button" onClick={onReview} disabled={disabled} className={actionClass}>{count > 1 ? 'Review records' : 'Review record'}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" /></button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
