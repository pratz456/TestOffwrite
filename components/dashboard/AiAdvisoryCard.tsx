'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Lightbulb, ChevronRight } from 'lucide-react';

interface AiAdvisoryCardProps {
  needsReviewCount: number;
  needsAnalysisCount: number;
  taxSavings: number;
  onNavigate: (screen: string) => void;
}

export function AiAdvisoryCard({ needsReviewCount, needsAnalysisCount, taxSavings, onNavigate }: AiAdvisoryCardProps) {
  // Build contextual summary
  let summary = '';
  let cta = { label: 'View AI Insights', screen: 'ai-insights' };

  if (needsAnalysisCount > 0) {
    summary = `You have ${needsAnalysisCount} transactions that haven't been analyzed yet. Running AI analysis could uncover additional deductions.`;
    cta = { label: 'Review now', screen: 'review-transactions' };
  } else if (needsReviewCount > 0) {
    summary = `${needsReviewCount} transactions are pending your review. Confirming them ensures your deduction total is accurate.`;
    cta = { label: 'Review transactions', screen: 'review-transactions' };
  } else if (taxSavings > 0) {
    summary = `You've saved $${taxSavings.toLocaleString('en-US', { minimumFractionDigits: 0 })} in taxes so far this year. Check AI Insights for additional optimization ideas.`;
  } else {
    summary = 'Connect your bank account and categorize expenses to get personalized tax-saving recommendations.';
  }

  return (
    <div
      className="rounded-xl border border-[hsl(var(--chart-4)/0.25)] bg-[hsl(var(--chart-4)/0.08)] backdrop-blur-sm p-4 sm:p-5 flex items-start gap-3.5
        shadow-[0_0_0_1px_hsl(var(--chart-4)/0.06),0_4px_24px_-4px_hsl(var(--chart-4)/0.12)]"
    >
      <div className="w-9 h-9 rounded-lg bg-[hsl(var(--chart-4)/0.2)] flex items-center justify-center shrink-0 mt-0.5">
        <Lightbulb className="h-4 w-4 text-[hsl(var(--chart-4))]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[hsl(var(--chart-4)/0.95)] uppercase tracking-wide mb-1.5">
          Advisory
        </p>
        <p className="text-sm font-medium text-foreground leading-relaxed mb-2">
          {summary}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate(cta.screen)}
          className="min-h-[44px] sm:min-h-0 -ml-3 h-11 sm:h-8 px-3 text-xs font-medium text-[hsl(var(--chart-4))] hover:bg-[hsl(var(--chart-4)/0.12)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {cta.label}
          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </Button>
      </div>
    </div>
  );
}
