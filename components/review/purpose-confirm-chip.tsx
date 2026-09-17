'use client';

import React, { useEffect, useState } from 'react';
import { Check, Edit3, Loader2, Sparkles, X } from 'lucide-react';

interface PurposeConfirmChipProps {
  /** The AI's proposed business purpose; `null` when the user has to write one. */
  proposal: string | null;
  /** Optional question from the analysis shown as the heading. */
  question?: string | null;
  busy?: boolean;
  disabled?: boolean;
  /** Called with the purpose the user confirmed; the caller records the deduction. */
  onConfirm: (purpose: string) => void | Promise<void>;
  onReject: () => void | Promise<void>;
  /** Button text; a group card says how many charges it covers. */
  confirmLabel?: string;
  /** Sentence under the actions describing what the tap saves. */
  note?: string;
  /** Prefix for element ids when several chips share a page. */
  id?: string;
}

/**
 * One tap confirms the proposed purpose and records the deduction through the caller.
 * Nothing is pre-selected: the tap itself is the user's decision.
 */
export function PurposeConfirmChip({ proposal, question, busy = false, disabled = false, onConfirm, onReject, confirmLabel = 'Confirm purpose',
  note = 'Confirming saves this purpose and records the deduction. Nothing is saved until you tap.', id = 'purpose-proposal' }: PurposeConfirmChipProps) {
  const [editing, setEditing] = useState(proposal === null);
  const [draft, setDraft] = useState(proposal ?? '');
  useEffect(() => { setEditing(proposal === null); setDraft(proposal ?? ''); }, [proposal]);
  const blocked = busy || disabled;
  const trimmed = draft.trim();

  return (
    <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-labelledby={`${id}-heading`}>
      <p id={`${id}-heading`} className="flex items-start gap-1.5 text-xs font-medium text-primary">
        <Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{question?.trim() || 'Proposed business purpose'}</span>
      </p>
      {editing ? (
        <div className="space-y-2">
          <label htmlFor={`${id}-edit`} className="sr-only">Business purpose</label>
          <textarea id={`${id}-edit`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} rows={2} disabled={blocked}
            placeholder="Why was this needed for your business?" className="min-h-16 w-full rounded-lg border border-border bg-background p-3 text-base sm:text-sm" />
          <div className="grid grid-cols-2 gap-2">
            {proposal !== null && <button type="button" disabled={blocked} onClick={() => { setDraft(proposal); setEditing(false); }}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-medium"><X aria-hidden="true" className="h-4 w-4" />Cancel</button>}
            <button type="button" disabled={blocked || !trimmed} onClick={() => onConfirm(trimmed)}
              className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 ${proposal === null ? 'col-span-2' : ''}`}>
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}{busy ? 'Saving…' : confirmLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={blocked} onClick={() => onConfirm(proposal!)} aria-label={`${confirmLabel}: ${proposal}`}
            className="inline-flex min-h-11 max-w-full items-start gap-2 rounded-full border border-primary bg-primary px-4 py-2 text-left text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0"><span className="block text-xs font-normal opacity-90">{confirmLabel}</span><span className="block break-words">{proposal}</span></span>
          </button>
          <button type="button" disabled={blocked} onClick={() => setEditing(true)} aria-label={question ? 'Something else' : 'Edit purpose'}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background px-4 text-sm font-medium"><Edit3 aria-hidden="true" className="h-4 w-4" />{question ? 'Something else' : 'Edit'}</button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-4 text-muted-foreground">{note}</p>
        <button type="button" disabled={blocked} onClick={() => onReject()} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">Not business</button>
      </div>
    </section>
  );
}
