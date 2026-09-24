'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { formatEstimatedTaxEffect, type TransactionExplanation } from '@/lib/ai/explanation';

/**
 * Renders the server-composed explanation saved as `ai_explanation`.
 * Pass the result of `normalizeExplanation(record.ai_explanation)`; null renders nothing.
 */
export function ExplanationCard({ explanation, onAnswer, compact = false, className = '' }: {
  explanation: TransactionExplanation | null | undefined;
  onAnswer?: () => void;
  compact?: boolean;
  className?: string;
}) {
  if (!explanation) return null;
  const effect = explanation.estimatedTaxEffect;
  const why = <p className="leading-relaxed text-foreground/90">{explanation.why}</p>;
  const savedFacts = <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your saved facts used</h4>
      {explanation.yourFacts.length
        ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{explanation.yourFacts.map(fact => <li key={fact}>{fact}</li>)}</ul>
        : <p className="mt-1 text-muted-foreground">Only the bank record was used. Add a purpose or business-use percentage for a more specific review.</p>}
    </div>;
  const placement = explanation.scheduleCLine && <p><span className="font-medium">Where it goes:</span> {explanation.scheduleCLine}</p>;
  const estimate = effect && <div className="rounded-lg bg-primary/5 p-3">
      <p><span className="text-lg font-semibold">{formatEstimatedTaxEffect(effect)}</span> <span className="text-muted-foreground">{effect.label}</span></p>
      {compact && <p className="mt-1 text-xs text-muted-foreground">Basic estimate; excludes QBI, credits and state tax.</p>}
      {!compact && <p className="mt-1 text-xs text-muted-foreground">{effect.basis}</p>}
    </div>;
  const supportingRecords = explanation.strengthen.length > 0 && <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Records that strengthen this</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground/90">{explanation.strengthen.map(item => <li key={item}>{item}</li>)}</ul>
    </div>;
  const nextQuestion = explanation.nextQuestion && <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
      <p className="min-w-0"><span className="font-medium">Next question:</span> {explanation.nextQuestion}</p>
      {onAnswer && <button type="button" onClick={onAnswer} className="flex min-h-11 shrink-0 items-center gap-1 font-medium underline underline-offset-2">Answer<ArrowRight aria-hidden="true" className="h-3 w-3" /></button>}
    </div>;
  return <section className={`${compact ? 'space-y-2 p-3' : 'space-y-3 p-4'} rounded-xl border border-border bg-card text-sm ${className}`} aria-label="Why this transaction was analyzed this way">
    <h3 className="text-base font-semibold leading-snug">{explanation.headline}</h3>
    {compact ? <>
      {nextQuestion}
      {placement}
      {estimate}
      <details className="border-t border-border">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Why and supporting records</summary>
        <div className="space-y-3 pb-1">
          {why}
          {savedFacts}
          {effect && <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimate basis</h4>
            <p className="mt-1 text-xs text-muted-foreground">{effect.basis}</p>
          </div>}
          {supportingRecords}
        </div>
      </details>
    </> : <>
      {why}
      {savedFacts}
      {placement}
      {estimate}
      {supportingRecords}
      {nextQuestion}
    </>}
  </section>;
}
