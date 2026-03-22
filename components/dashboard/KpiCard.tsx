'use client';

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiTooltip, type KpiTooltipContent } from '@/components/ui/kpi-tooltip';

export type KpiAccent = 'blue' | 'emerald' | 'amber' | 'emeraldStrong' | 'violet' | 'orange';

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  delta?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  /** Semantic accent: left border + icon tint only (no full-color fills). */
  accent?: KpiAccent;
  /** Hover tooltip explaining what this number means and what to do with it */
  tooltip?: KpiTooltipContent;
}

const accentBorder: Record<KpiAccent, string> = {
  blue: 'border-l-primary/70',
  emerald: 'border-l-[hsl(var(--success)/0.7)]',
  amber: 'border-l-[hsl(var(--warning)/0.7)]',
  emeraldStrong: 'border-l-[hsl(var(--success)/0.85)]',
  violet: 'border-l-violet-500/70',
  orange: 'border-l-orange-500/70',
};

const accentIconWrap: Record<KpiAccent, string> = {
  blue: 'bg-primary/10 [&_svg]:text-primary/90',
  emerald: 'bg-[hsl(var(--success)/0.12)] [&_svg]:text-[hsl(var(--success)/0.9)]',
  amber: 'bg-[hsl(var(--warning)/0.12)] [&_svg]:text-[hsl(var(--warning)/0.9)]',
  emeraldStrong: 'bg-[hsl(var(--success)/0.18)] [&_svg]:text-[hsl(var(--success))]',
  violet: 'bg-violet-500/10 [&_svg]:text-violet-500',
  orange: 'bg-orange-500/10 [&_svg]:text-orange-500',
};

export function KpiCard({ title, value, subtitle, delta, icon, loading, accent, tooltip }: KpiCardProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5 min-h-[88px]">
        <Skeleton className="h-3.5 w-24 mb-3" />
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  const borderClass = accent ? (accentBorder[accent] ?? '') : '';
  const iconWrapClass = accent && icon ? (accentIconWrap[accent] ?? '') : '';

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 sm:p-5 transition-colors duration-150 min-h-[88px]
        ${accent ? `border-l-4 ${borderClass}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {title}
            </p>
            {tooltip && <KpiTooltip content={tooltip} />}
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums tracking-tight break-words">
            {value}
          </p>
          {delta && (
            <p className="text-xs text-muted-foreground mt-1">{delta}</p>
          )}
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${iconWrapClass}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
