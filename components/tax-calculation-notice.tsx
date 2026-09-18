"use client";

import React, { useId } from "react";
import { Info } from "lucide-react";

interface TaxCalculationNoticeProps {
  warnings?: unknown;
  taxYear: string | number;
}

/** Keep known calculation limits visible beside the figures, including on mobile. */
export function TaxCalculationNotice({ warnings, taxYear }: TaxCalculationNoticeProps) {
  const headingId = useId();
  const notes = Array.isArray(warnings)
    ? [...new Set(warnings.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
    : [];

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
      <div className="flex items-start gap-2.5">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold">What could change your {taxYear} estimate</h2>
          <p className="mt-1 text-xs leading-relaxed">Use these figures for planning. Review the limits below before filing or making a tax payment.</p>
          {notes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed">
              {notes.map(note => <li key={note} className="break-words">{note}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-relaxed">Your records and eligibility still need review. Some deductions, credits and other taxes may need separate calculations.</p>
          )}
        </div>
      </div>
    </section>
  );
}
