'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import type { Transaction } from '@/lib/firebase/transactions';
import { formatTransactionDate } from '@/lib/transactions/calendar-date';
import { formatMoney, groupDecision, suggestedExpenseCategory, type BulkConfirmRequest, type MerchantGroup } from '@/lib/transactions/review-proposals';
import { PurposeConfirmChip } from './purpose-confirm-chip';
import { bulkOutcomeMessage, requestBulkConfirm, type BulkConfirmOutcome } from './bulk-confirm-offer';

export interface GroupDecisionResult { request: BulkConfirmRequest; outcome: BulkConfirmOutcome }

interface MerchantGroupCardProps {
  group: MerchantGroup;
  index: number;
  disabled?: boolean;
  onApplied: (result: GroupDecisionResult, group: MerchantGroup) => void;
  onOpen?: (transaction: Transaction) => void;
}

/** One merchant's unreviewed charges with a group-level decision through the bulk route. */
export function MerchantGroupCard({ group, index, disabled = false, onApplied, onOpen }: MerchantGroupCardProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const decide = async (decision: 'business' | 'personal', purpose: string | null) => {
    if (saving) return;
    const request = groupDecision(group, decision, purpose);
    setSaving(true); setError(null);
    const result = await requestBulkConfirm(request);
    if (!mounted.current) return;
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    onApplied({ request, outcome: result.outcome }, group);
  };

  const charges = `${group.count} charge${group.count === 1 ? '' : 's'}`;
  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold leading-snug">{group.merchant}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{charges} · {group.categoryLabel ?? (group.transactions.some(transaction => suggestedExpenseCategory(transaction)) ? 'Suggested categories differ' : 'No category suggested yet')}</p>
        </div>
        <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(group.total)}</p>
      </div>
      <PurposeConfirmChip id={`merchant-group-${index}`} proposal={group.proposedPurpose} busy={saving} disabled={disabled}
        confirmLabel={`Confirm ${charges}`} note={`Confirming saves this purpose and records a deduction for each of the ${charges}. Nothing is saved until you tap.`}
        onConfirm={purpose => decide('business', purpose)} onReject={() => decide('personal', null)} />
      {group.needsIndividualReview > 0 && <p className="text-xs leading-4 text-muted-foreground">{group.needsIndividualReview} of these {group.needsIndividualReview === 1 ? 'looks like' : 'look like'} a transfer, refund or a category with its own tax method; a group confirmation leaves {group.needsIndividualReview === 1 ? 'it' : 'them'} for individual review.</p>}
      {error && <p role="alert" className="rounded-lg bg-amber-500/10 p-2 text-xs leading-4">{error}</p>}
      <details className="group/charges">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">Show charges<ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open/charges:rotate-180" /></summary>
        <ul className="divide-y divide-border">
          {group.transactions.map(transaction => (
            <li key={transaction.trans_id || transaction.id}>
              <button type="button" disabled={!onOpen} onClick={() => onOpen?.(transaction)} className="flex min-h-11 w-full items-center justify-between gap-3 py-1.5 text-left text-sm">
                <span className="text-muted-foreground">{formatTransactionDate(transaction.date, 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span className="flex items-center gap-1 tabular-nums">{formatMoney(transaction.amount)}{onOpen && <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

interface MerchantGroupListProps {
  groups: MerchantGroup[];
  /** Decisions already applied this session, shown with the server's counts. */
  results: GroupDecisionResult[];
  disabled?: boolean;
  onApplied: (result: GroupDecisionResult, group: MerchantGroup) => void;
  onDismissResult: (merchantKey: string) => void;
  onOpen?: (transaction: Transaction) => void;
}

/** Merchant-grouped triage: most frequent merchant first, one stacked card per merchant. */
export function MerchantGroupList({ groups, results, disabled = false, onApplied, onDismissResult, onOpen }: MerchantGroupListProps) {
  return (
    <div className="space-y-3">
      {results.length > 0 && <ul className="space-y-2" aria-label="Applied group decisions">
        {results.map(result => (
          <li key={result.request.merchantKey} className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-3">
            <p role="status" className="flex items-start gap-2 text-sm leading-5"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{bulkOutcomeMessage(result.request, result.outcome)}</p>
            <button type="button" onClick={() => onDismissResult(result.request.merchantKey)} aria-label="Dismiss" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"><X aria-hidden="true" className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>}
      {groups.length === 0
        ? <p className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">No unreviewed charges are waiting. New transactions appear here grouped by merchant.</p>
        : <ul className="space-y-3" aria-label="Unreviewed charges by merchant">
          {groups.map((group, index) => <MerchantGroupCard key={group.merchantKey} group={group} index={index} disabled={disabled} onApplied={onApplied} onOpen={onOpen} />)}
        </ul>}
    </div>
  );
}
