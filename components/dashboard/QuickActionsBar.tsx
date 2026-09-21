'use client';

import React from 'react';
import { ClipboardList, FileText, Lightbulb, Calculator, Plus, MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface QuickActionsBarProps {
  onNavigate: (screen: string) => void;
  needsReviewCount: number;
  needsAnalysisCount: number;
}

export function QuickActionsBar({ onNavigate, needsReviewCount, needsAnalysisCount }: QuickActionsBarProps) {
  const extraActions = [
    { label: `Review (${needsReviewCount})`, screen: 'review-transactions', icon: ClipboardList, show: needsReviewCount > 0 || needsAnalysisCount > 0 },
    { label: 'Transactions', screen: 'transactions', icon: FileText, show: true },
    { label: 'Export records', screen: 'schedule-c-export', icon: FileText, show: true },
    { label: 'AI insights', screen: 'ai-insights', icon: Lightbulb, show: true },
    { label: 'Quarterly taxes', screen: 'quarterly-taxes', icon: Calculator, show: true },
  ];
  return <div className="grid grid-cols-[1fr_1fr_auto] gap-2" aria-label="Quick actions">
    {[{ label: 'Add Income', screen: 'income-tracking' }, { label: 'Add Expense', screen: 'add-manual-transaction' }].map(action => <button key={action.screen} type="button" onClick={() => onNavigate(action.screen)} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border/70 bg-card px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-3.5 w-3.5 shrink-0" />{action.label}</button>)}
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" aria-label="More actions" className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-card text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl">
        {extraActions.filter(action => action.show).map(action => <DropdownMenuItem key={action.screen} onClick={() => onNavigate(action.screen)} className="min-h-11 gap-2 rounded-lg"><action.icon className="h-4 w-4" />{action.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
