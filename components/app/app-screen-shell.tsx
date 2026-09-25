"use client";

import type { ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ScreenWidth = "narrow" | "default" | "wide" | "full";

const widths: Record<ScreenWidth, string> = {
  narrow: "max-w-2xl",
  default: "max-w-4xl",
  wide: "max-w-6xl",
  full: "max-w-7xl",
};

export function AppScreenShell({
  children,
  width = "default",
  className = "",
}: {
  children: ReactNode;
  width?: ScreenWidth;
  className?: string;
}) {
  return (
    <div className="min-h-full bg-background">
      <div className={`mx-auto w-full ${widths[width]} space-y-3 px-3 py-3 sm:px-4 sm:py-4 md:px-6 ${className}`}>
        {children}
      </div>
    </div>
  );
}

export function AppPageHeader({
  title,
  description,
  onBack,
  backLabel = "Back",
  actions,
  meta,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-[var(--shadow-tight)] sm:px-4">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="min-h-11 shrink-0 gap-1.5 px-2" aria-label={backLabel}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{backLabel}</span>
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex min-h-11 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function AppSection({
  children,
  title,
  description,
  actions,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border/70 bg-card shadow-[var(--shadow-tight)] ${className}`}>
      {(title || description || actions) && (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 sm:px-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-foreground sm:text-base">{title}</h2>}
            {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

export function AppMetricStrip({
  metrics,
}: {
  metrics: Array<{ label: string; value: ReactNode; detail?: string; tone?: "default" | "success" | "warning" | "danger" }>;
}) {
  const columns = metrics.length === 1
    ? "grid-cols-1"
    : metrics.length === 2
      ? "grid-cols-2"
      : metrics.length === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-2 sm:grid-cols-4";
  const tones = {
    default: "text-foreground",
    success: "text-[hsl(var(--success))]",
    warning: "text-[hsl(var(--warning))]",
    danger: "text-destructive",
  };
  return (
    <dl className={`grid ${columns} divide-x divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card shadow-[var(--shadow-tight)] sm:divide-y-0`}>
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 px-3 py-2.5 sm:px-4">
          <dt className="text-xs leading-4 text-muted-foreground">{metric.label}</dt>
          <dd className={`mt-0.5 break-words text-lg font-semibold leading-6 tabular-nums ${tones[metric.tone ?? "default"]}`}>{metric.value}</dd>
          {metric.detail && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{metric.detail}</p>}
        </div>
      ))}
    </dl>
  );
}

export function AppLoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-border/70 bg-card text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
      {label}
    </div>
  );
}
