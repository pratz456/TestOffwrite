import React from 'react';
import { HELD_OUT_REVIEW_ARIA_LABEL, HELD_OUT_REVIEW_LINK_TEXT, type HeldOutDuplicates } from '@/lib/transactions/held-out-duplicates';

/** Two visible lines for totals that omit flagged possible duplicates. Hidden when nothing was held out. */
export function HeldOutDuplicatesNotice({ summary }: { summary?: HeldOutDuplicates | null }) {
  if (!summary || summary.count <= 0) return null;
  return (
    <div data-testid="held-out-duplicates" className="rounded-lg border border-border bg-muted p-3 text-sm">
      {summary.income.count > 0 && <p>{summary.incomeMessage}</p>}
      {summary.expenses.count > 0 && <p>{summary.expenseMessage}</p>}
      <p>
        <a className="underline" href={summary.reviewHref} aria-label={HELD_OUT_REVIEW_ARIA_LABEL}>{HELD_OUT_REVIEW_LINK_TEXT}</a>
      </p>
    </div>
  );
}
