'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Layers, Loader2, X } from 'lucide-react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import type { BulkConfirmRequest } from '@/lib/transactions/review-proposals';

export interface BulkConfirmOutcome { updated: number; skipped: number; truncated: boolean; transactionIds: string[] }

interface BulkConfirmOfferProps {
  offer: BulkConfirmRequest;
  disabled?: boolean;
  /** Called once the server has stamped the rows; the caller updates its local copies. */
  onApplied: (outcome: BulkConfirmOutcome, offer: BulkConfirmRequest) => void;
  onDismiss: () => void;
}

/** One request to POST /api/transactions/bulk-confirm; the server stamps every row itself. */
export async function requestBulkConfirm(offer: BulkConfirmRequest): Promise<{ ok: true; outcome: BulkConfirmOutcome } | { ok: false; message: string }> {
  try {
    const response = await makeAuthenticatedRequest('/api/transactions/bulk-confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantKey: offer.merchantKey, decision: offer.decision,
        ...(offer.decision === 'business' && offer.businessPurpose ? { businessPurpose: offer.businessPurpose } : {}),
        ...(offer.decision === 'business' && offer.category ? { category: offer.category } : {}),
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      return { ok: false, message: response.status === 429 ? 'Too many bulk updates in a short time. Try again in a few minutes.'
        : response.status === 401 ? 'Your session expired. Sign in again to apply this decision.'
        : typeof result?.error === 'string' ? result.error : 'The decision was not applied to the other charges. Please try again.' };
    }
    return { ok: true, outcome: {
      updated: Number(result.updated) || 0, skipped: Number(result.skipped) || 0, truncated: result.truncated === true,
      transactionIds: Array.isArray(result.transactionIds) ? result.transactionIds.filter((id: unknown): id is string => typeof id === 'string') : [],
    } };
  } catch {
    return { ok: false, message: 'The decision was not applied. Check your connection and try again.' };
  }
}

export function bulkOutcomeMessage(offer: BulkConfirmRequest, outcome: BulkConfirmOutcome): string {
  const charges = `${outcome.updated} charge${outcome.updated === 1 ? '' : 's'} from ${offer.merchant}`;
  const head = outcome.updated === 0 ? `No other charges from ${offer.merchant} were changed`
    : offer.decision === 'business' ? `Recorded ${charges} as business deductions` : `Marked ${charges} as not business`;
  const skipped = outcome.skipped ? `; ${outcome.skipped} still need${outcome.skipped === 1 ? 's' : ''} your individual review` : '';
  const more = outcome.truncated ? '. More charges remain; apply again to continue' : '';
  return `${head}${skipped}${more}.`;
}

/**
 * "Apply to N similar charges" after a single decision. Nothing happens until the
 * user taps Apply; the result count comes from the server response.
 */
export function BulkConfirmOffer({ offer, disabled = false, onApplied, onDismiss }: BulkConfirmOfferProps) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkConfirmOutcome | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setState('idle'); setError(null); setOutcome(null); }, [offer]);

  const apply = async () => {
    if (state !== 'idle') return;
    setState('saving'); setError(null);
    const result = await requestBulkConfirm(offer);
    if (!mounted.current) return;
    if (!result.ok) { setState('idle'); setError(result.message); return; }
    setOutcome(result.outcome); setState('done');
    onApplied(result.outcome, offer);
  };

  const label = `Apply to ${offer.count} similar charge${offer.count === 1 ? '' : 's'} from ${offer.merchant}`;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3" aria-label="Apply to similar charges">
      {state === 'done' && outcome ? (
        <div className="flex items-start justify-between gap-2">
          <p role="status" className="flex items-start gap-2 text-sm leading-5"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{bulkOutcomeMessage(offer, outcome)}</p>
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      ) : (
        <>
          <p className="flex items-start gap-2 text-sm font-medium leading-5"><Layers aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{label}?</p>
          <p className="text-xs leading-4 text-muted-foreground">{offer.decision === 'business'
            ? `Saves ${offer.businessPurpose ? 'the same purpose' : 'the decision'} and records each as a business deduction. Charges the analysis read as transfers, refunds or income are left for your review.`
            : 'Marks each as not business. No deductions are recorded.'}</p>
          {error && <p role="alert" className="rounded-lg bg-amber-500/10 p-2 text-xs leading-4">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={disabled || state === 'saving'} onClick={onDismiss}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium disabled:opacity-50">Not now</button>
            <button type="button" disabled={disabled || state === 'saving'} onClick={apply} aria-label={label}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {state === 'saving' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
              {state === 'saving' ? 'Applying…' : `Apply to ${offer.count}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
