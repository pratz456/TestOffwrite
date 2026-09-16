"use client";

import { Check, Info } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const AVAILABLE = [
  "Manual income and expense records, with editable categories and notes.",
  "Receipt uploads with extracted details for you to check before saving.",
  "A records archive on every plan, plus PDF and CSV reports with a trial or Premium plan.",
];

export function ComparisonSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="availability" className="py-12 sm:py-16" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Current Preview</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Know what you can use today</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Start organizing records now, with clear limits on tax planning and filing.</p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="animate-on-scroll rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-foreground">Expense and receipt organization</h3>
            <ul className="mt-5 space-y-4">
              {AVAILABLE.map(item => (
                <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="animate-on-scroll rounded-2xl border border-border bg-muted/30 p-6 sm:p-8">
            <h3 className="flex items-center gap-2 text-xl font-semibold text-foreground"><Info className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />Before you choose a plan</h3>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>AI analysis, bank connections, and in-app tax filing are not available in this preview.</p>
              <p>Federal estimates cover supported situations and may require further review. WriteOff does not prepare a complete federal or state return, certify deductions, or guarantee tax savings.</p>
              <p>Use exported records with a tax preparer. Receipt files remain private in your account and are not bundled in the records archive.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
