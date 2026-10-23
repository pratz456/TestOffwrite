"use client";

import React from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EXPORT_BLOCKED_BODY, EXPORT_BLOCKED_SAFE, EXPORT_BLOCKED_TITLE, RECONCILE_BUTTON, RETRY_EXPORT,
} from "@/lib/tax-rules/income-reconciliation-copy";

export interface ExportConflictRecord {
  label?: string;
  amount?: number;
  message?: string;
  sources?: Array<{ label?: string; amount?: number }>;
}

const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Guided path for a Schedule C export that returned INCOME_RECONCILIATION_REQUIRED. No file is offered here. */
export function IncomeReconciliationExportCard({
  conflicts, onReconcile, onRetry,
}: {
  conflicts: ExportConflictRecord[];
  onReconcile: () => void;
  onRetry: () => void;
}) {
  return (
    <section aria-label={EXPORT_BLOCKED_TITLE} className="rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{EXPORT_BLOCKED_TITLE}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{EXPORT_BLOCKED_BODY}</p>
          <ul aria-label="Records that need a reconciliation decision" className="mt-3 space-y-2 text-xs text-foreground">
            {conflicts.map((conflict, index) => (
              <li key={index}>
                <p>{conflict.message}</p>
                {Array.isArray(conflict.sources) && conflict.sources.length > 0 && (
                  <p className="mt-0.5 text-muted-foreground">
                    {conflict.sources.map(source => `${source.label ?? "Record"} ${typeof source.amount === "number" ? money(source.amount) : ""}`).join("; ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" className="mt-3 min-h-11" onClick={onReconcile}>{RECONCILE_BUTTON}</Button>
          <p className="mt-2 text-xs text-muted-foreground">{EXPORT_BLOCKED_SAFE}</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={onRetry}>{RETRY_EXPORT}</Button>
        </div>
      </div>
    </section>
  );
}

/** Turn the API reviewPath into the in-app screen token the filing hub already navigates with. */
export function reconciliationScreenTarget(reviewPath: string, fallbackYear: string): string {
  try {
    const url = new URL(reviewPath, "http://localhost");
    const screen = url.searchParams.get("screen") || "income-tracking";
    const params = new URLSearchParams();
    const tab = url.searchParams.get("tab");
    const year = url.searchParams.get("year") || fallbackYear;
    if (tab) params.set("tab", tab);
    if (year) params.set("year", year);
    const query = params.toString();
    return query ? `${screen}?${query}` : screen;
  } catch {
    return `income-tracking?tab=reconcile&year=${fallbackYear}`;
  }
}
