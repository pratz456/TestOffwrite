'use client';

import React from 'react';
import { ClipboardList, FileText, Lightbulb, Calculator, ChevronRight } from 'lucide-react';

interface QuickActionsBarProps {
  onNavigate: (screen: string) => void;
  needsReviewCount: number;
  needsAnalysisCount: number;
}

interface ActionItem {
  label: string;
  screen: string;
  icon: React.ElementType;
  show: boolean;
  accent?: boolean;
}

export function QuickActionsBar({ onNavigate, needsReviewCount, needsAnalysisCount }: QuickActionsBarProps) {
  const actions: ActionItem[] = [
    {
      label: `Review (${needsReviewCount})`,
      screen: 'review-transactions',
      icon: ClipboardList,
      show: needsReviewCount > 0 || needsAnalysisCount > 0,
      accent: true,
    },
    { label: 'Transactions', screen: 'transactions', icon: FileText, show: true },
    { label: 'Export', screen: 'schedule-c-export', icon: FileText, show: true },
    { label: 'AI Insights', screen: 'ai-insights', icon: Lightbulb, show: true },
    { label: 'Quarterly Taxes', screen: 'quarterly-taxes', icon: Calculator, show: true },
  ];

  const visible = actions.filter(a => a.show);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {visible.map(action => {
        const Icon = action.icon;
        return (
          <button
            key={action.screen}
            type="button"
            onClick={() => onNavigate(action.screen)}
            className={`flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              action.accent
                ? 'bg-primary/5 hover:bg-primary/10 border border-primary/20 text-primary'
                : 'bg-muted hover:bg-muted/70 border border-border text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
