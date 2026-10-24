"use client";

import React, { useState } from 'react';
import { AMOUNT_ENTRY_COPY, AMOUNT_NEEDED_LABEL } from '@/lib/transactions/amount-display';

/** Receipt image beside an editable amount. A blank amount is never shown as $0.00. */
export function BlankAmountEntry({
  receiptUrl,
  signedAmountReview,
  onSave,
}: {
  receiptUrl?: string;
  signedAmountReview?: number;
  onSave?: (amount: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const amount = Number(draft);
  const ready = draft.trim() !== '' && Number.isFinite(amount) && amount > 0;
  return (
    <form
      className="flex items-center gap-3"
      onSubmit={event => {
        event.preventDefault();
        if (ready && onSave) onSave(amount);
      }}
    >
      {receiptUrl ? <img src={receiptUrl} alt={AMOUNT_ENTRY_COPY} className="h-12 w-12 rounded object-cover" /> : null}
      <div className="text-right">
        <p className="font-bold text-foreground">{AMOUNT_NEEDED_LABEL}</p>
        {typeof signedAmountReview === 'number' && signedAmountReview < 0 ? <p className="text-xs text-muted-foreground">{AMOUNT_ENTRY_COPY} {signedAmountReview}</p> : null}
        <label className="mt-1 block text-xs text-muted-foreground">
          {AMOUNT_ENTRY_COPY}
          <input
            aria-label={AMOUNT_ENTRY_COPY}
            inputMode="decimal"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            className="mt-1 min-h-11 w-28 rounded-lg border border-border bg-background px-2 text-right text-sm text-foreground"
          />
        </label>
      </div>
    </form>
  );
}
