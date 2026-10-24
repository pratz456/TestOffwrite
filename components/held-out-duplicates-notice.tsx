import React from 'react';
import type { HeldOutDuplicates } from '@/lib/transactions/held-out-duplicates';

/** One visible line for totals that omit flagged possible duplicates. Hidden when nothing was held out. */
export function HeldOutDuplicatesNotice({ summary }: { summary?: HeldOutDuplicates | null }) {
  if (!summary || summary.count <= 0) return null;
  return (
    <p data-testid="held-out-duplicates" className="rounded-lg border border-border bg-muted p-3 text-sm">
      {summary.message}{' '}
      <a className="underline" href={summary.reviewHref}>Review possible duplicates</a>
    </p>
  );
}
