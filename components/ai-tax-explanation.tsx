'use client';

import React from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/ui/dialog';
import type { AiReviewSuggestion } from '@/lib/transactions/ai-review-contract';
import { reviewCategory } from '@/lib/transactions/ai-review-contract';

/** The server supplies curated sources. Reject unsafe links even on legacy/malformed records. */
export function trustedTaxSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['irs.gov', 'www.irs.gov', 'uscode.house.gov', 'www.govinfo.gov', 'govinfo.gov'].includes(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
}

/** A focused reading surface keeps detailed evidence out of the review queue. */
export function AiTaxAnalysisDialog({ suggestion, children, triggerLabel = 'Full analysis & sources' }: { suggestion: AiReviewSuggestion; children?: React.ReactNode; triggerLabel?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild><button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex items-center gap-2"><BookOpen aria-hidden="true" className="h-4 w-4" />{triggerLabel}</span><ArrowRight aria-hidden="true" className="h-4 w-4" /></button></DialogTrigger>
      <DialogContent className="app-workspace max-h-[85dvh] overflow-y-auto overscroll-contain rounded-2xl p-4 pt-5 sm:max-w-xl [&>button]:top-2 [&>button]:right-2 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center">
        <div className="pr-10"><DialogTitle>AI analysis</DialogTitle><DialogDescription className="mt-1 text-xs">Reasoning, missing facts and official tax sources.</DialogDescription></div>
        <AiTaxExplanation suggestion={suggestion} />
        {children && <div className="border-t border-border pt-3">{children}</div>}
      </DialogContent>
    </Dialog>
  );
}

export function AiTaxExplanation({ suggestion, compact = false, onAddContext }: { suggestion: AiReviewSuggestion; compact?: boolean; onAddContext?: () => void }) {
  const flowLabels: Record<string, string> = { income: 'Business income', transfer: 'Transfer / card payment', personal: 'Personal purchase', refund: 'Expense refund' };
  const category = flowLabels[suggestion.transactionKind] || reviewCategory(suggestion.category)?.label;
  const questions = [...new Set(suggestion.questions.filter(question => question.trim()))];
  const documents = [...new Set(suggestion.documentationRequired.filter(document => document.trim()))];
  const sources = suggestion.sources.filter(source => trustedTaxSourceUrl(source.url));
  const needsFacts = suggestion.status !== 'ok' || suggestion.isDeductible === null;
  if (compact) return <section className="space-y-2" aria-label="AI category and tax explanation">
    <div>
      <p className="text-xs text-muted-foreground">Suggested category{suggestion.taxYear ? ` · ${suggestion.taxYear}` : ''}</p>
      <p className="mt-0.5 text-lg font-semibold leading-snug">{category || 'More context needed'}</p>
    </div>
    <p className="line-clamp-2 text-sm leading-5 text-foreground/85">{suggestion.reasoning || 'Add the business purpose and rerun analysis for an explanation.'}</p>
    {needsFacts && <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 text-xs text-amber-900 dark:text-amber-200">
      <span className="py-2">Tax details needed · deduction unresolved</span>
      {onAddContext && <button type="button" onClick={onAddContext} className="flex min-h-11 shrink-0 items-center gap-1 font-medium underline underline-offset-2">Add details<ArrowRight aria-hidden="true" className="h-3 w-3" /></button>}
    </div>}
    <AiTaxAnalysisDialog suggestion={suggestion} />
  </section>;
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
    {suggestion.isDeductible === true && typeof suggestion.deductiblePercent === 'number' && <p className="text-sm text-muted-foreground">Suggested deductible portion: {suggestion.deductiblePercent}%. Business use and category limits still apply.</p>}
    {questions.length > 0 && <div>
      <h4 className="font-semibold">What to clarify</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{questions.map(question => <li key={question}>{question}</li>)}</ul>
      <p className="mt-2 text-sm text-muted-foreground">Add answers in the transaction’s Details tab, then update AI review.</p>
    </div>}
    {documents.length > 0 && <div>
      <h4 className="font-semibold">Records to keep</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{documents.map(document => <li key={document}>{document}</li>)}</ul>
    </div>}
    <div>
      <h4 className="font-semibold">Tax sources</h4>
      {sources.length ? <ul className="mt-2 space-y-2 text-sm">{sources.map(source => <li key={source.id}>
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">{source.title}</a>
        <p className="text-xs text-muted-foreground">{source.edition} · Source checked {source.reviewed_at}</p>
      </li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">No verified source is attached. Run analysis again for source-backed guidance.</p>}
    </div>
    <p className="text-xs text-muted-foreground">Confirming a category organizes your records. Deduction eligibility, business use and applicable limits require their own review.</p>
  </section>;
}
