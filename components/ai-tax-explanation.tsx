'use client';

import React from 'react';
import type { AiReviewSuggestion } from '@/lib/transactions/ai-review-contract';
import { reviewCategory } from '@/lib/transactions/ai-review-contract';

/** The server supplies curated sources. Reject unsafe links even on legacy/malformed records. */
export function trustedTaxSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['irs.gov', 'www.irs.gov', 'uscode.house.gov'].includes(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
}

export function AiTaxExplanation({ suggestion }: { suggestion: AiReviewSuggestion }) {
  const flowLabels: Record<string, string> = { income: 'Business income', transfer: 'Transfer / card payment', personal: 'Personal purchase', refund: 'Expense refund' };
  const category = flowLabels[suggestion.transactionKind] || reviewCategory(suggestion.category)?.label;
  const questions = [...new Set(suggestion.questions.filter(question => question.trim()))];
  const documents = [...new Set(suggestion.documentationRequired.filter(document => document.trim()))];
  const sources = suggestion.sources.filter(source => trustedTaxSourceUrl(source.url));
  const needsFacts = suggestion.status !== 'ok' || suggestion.isDeductible === null;
  return <section className="space-y-4" aria-label="AI category and tax explanation">
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested category</p>
      <p className="mt-1 text-lg font-semibold">{category || (suggestion.transactionKind === 'unknown' ? 'More context needed' : suggestion.transactionKind.replace(/_/g, ' '))}</p>
      <p className="mt-1 text-sm text-muted-foreground">{suggestion.taxYear ? `${suggestion.taxYear} · ` : ''}U.S. federal tax guidance</p>
    </div>
    <div>
      <h4 className="font-semibold">{category ? 'Why this category fits' : 'What the AI found'}</h4>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{suggestion.reasoning || 'Add the business purpose and rerun analysis for an explanation.'}</p>
    </div>
    {needsFacts && <p className="rounded-lg bg-amber-500/10 p-3 text-sm">The category can help organize this record. Tax treatment still needs review; no deduction has been approved by this analysis.</p>}
    {questions.length > 0 && <div>
      <h4 className="font-semibold">What to clarify</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{questions.map(question => <li key={question}>{question}</li>)}</ul>
      <p className="mt-2 text-sm text-muted-foreground">Add your answers to the transaction context below, then run analysis again.</p>
    </div>}
    {documents.length > 0 && <div>
      <h4 className="font-semibold">Records to keep</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{documents.map(document => <li key={document}>{document}</li>)}</ul>
    </div>}
    <div>
      <h4 className="font-semibold">Tax sources</h4>
      {sources.length ? <ul className="mt-2 space-y-2 text-sm">{sources.map(source => <li key={source.id}>
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2">{source.title}</a>
        <p className="text-xs text-muted-foreground">{source.edition} · Source checked {source.reviewed_at}</p>
      </li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">No verified source is attached. Run analysis again for source-backed guidance.</p>}
    </div>
    <p className="text-xs text-muted-foreground">Confirming a category organizes your records. Deduction eligibility, business use and applicable limits require their own review.</p>
  </section>;
}
