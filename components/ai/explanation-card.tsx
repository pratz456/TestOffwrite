'use client';

import React from 'react';
import type { AiExplanation } from '@/lib/transactions/review-proposals';

const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [];
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Minimal plain-language rendering of a saved `ai_explanation`; the explanation writer owns the fuller version. */
export function ExplanationCard({ explanation }: { explanation: AiExplanation }) {
  const headline = text(explanation.headline);
  const why = text(explanation.why);
  const facts = list(explanation.yourFacts);
  const line = text(explanation.scheduleCLine);
  const effect = text(explanation.estimatedTaxEffect);
  const strengthen = list(explanation.strengthen);
  const next = text(explanation.nextQuestion);
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm" aria-label="AI explanation">
      {headline && <p className="font-semibold leading-snug">{headline}</p>}
      {why && <p className="leading-5 text-foreground/90">{why}</p>}
      {facts.length > 0 && <div><p className="text-xs font-medium text-muted-foreground">Your facts</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul></div>}
      {(line || effect) && <p className="text-xs text-muted-foreground">{line ? `Schedule C: ${line}` : ''}{line && effect ? ' · ' : ''}{effect ?? ''}</p>}
      {strengthen.length > 0 && <div><p className="text-xs font-medium text-muted-foreground">Records that strengthen this</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{strengthen.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {next && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">{next}</p>}
    </section>
  );
}
