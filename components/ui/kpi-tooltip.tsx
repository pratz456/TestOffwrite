'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

export interface KpiTooltipContent {
  /** One-line summary of what this number is */
  what: string;
  /** How it's calculated  -  plain English, include IRS source if applicable */
  how: string;
  /** What the user should do with this information */
  action: string;
  /** Optional IRS form/line reference */
  irsRef?: string;
}

interface KpiTooltipProps {
  content: KpiTooltipContent;
}

export function KpiTooltip({ content }: KpiTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="What is this number?"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(v => !v)}
        className="w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 sm:w-72">
          {/* Arrow */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0
            border-l-[6px] border-l-transparent
            border-r-[6px] border-r-transparent
            border-t-[6px] border-t-popover" />

          <div className="rounded-xl border border-border bg-popover shadow-xl p-3.5 space-y-2.5">
            {/* What */}
            <p className="text-xs font-semibold text-foreground leading-snug">{content.what}</p>

            {/* How it's calculated */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">How it's calculated</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{content.how}</p>
            </div>

            {/* IRS ref */}
            {content.irsRef && (
              <p className="text-[10px] text-muted-foreground/70 italic">{content.irsRef}</p>
            )}

            {/* What to do */}
            <div className="rounded-lg bg-primary/8 border border-primary/15 px-2.5 py-2">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-0.5">What to do</p>
              <p className="text-xs text-foreground leading-relaxed">{content.action}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
