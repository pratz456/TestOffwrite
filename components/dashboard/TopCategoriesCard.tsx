'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, BarChart3, Plane, Utensils, Building, Monitor, Home, Zap } from 'lucide-react';
import { consolidateCategory } from '@/lib/utils';

interface TopCategoriesCardProps {
  categories: [string, number][];
  totalMagnitude: number;
  reviewMessage?: string | null;
  onViewAll: () => void;
}

const categoryIcons: Record<string, any> = {
  'TRAVEL_FLIGHTS': Plane,
  'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': Plane,
  'MEALS': Utensils,
  'FOOD_AND_DRINK_COFFEE': Utensils,
  'FOOD_AND_DRINK_FAST_FOOD': Utensils,
  'PROFESSIONAL_SERVICES': Building,
  'SOFTWARE': Monitor,
  'OFFICE_EXPENSE': Monitor,
  'HOME_OFFICE': Home,
  'UTILITIES': Zap,
};

function getCategoryIcon(category: string) {
  return categoryIcons[category] || Building;
}

export function TopCategoriesCard({ categories, totalMagnitude, onViewAll, reviewMessage }: TopCategoriesCardProps) {
  const topFive = categories.slice(0, 5);

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-border/70 bg-card shadow-none hover:shadow-none motion-safe:hover:translate-y-0">
      <CardHeader className="px-4 py-3 md:px-5 md:py-3 lg:px-5 lg:py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold">Expense categories</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Marked deductible · All dates · USD</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="h-11 shrink-0 px-2 text-xs font-medium text-primary hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View all
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="border-t border-border/60 px-4 pb-3 pt-1 md:px-5 md:pb-3 md:pt-1 lg:px-5 lg:pb-3 lg:pt-1">
        {reviewMessage ? <p className="py-5 text-sm text-muted-foreground" role="status">{reviewMessage}</p> : topFive.length > 0 ? (
          <div className="divide-y divide-border/40">
            {topFive.map(([category, amount]) => {
              const pct = totalMagnitude > 0 ? (Math.abs(amount) / totalMagnitude) * 100 : 0;
              const Icon = getCategoryIcon(category);
              const { displayName } = consolidateCategory(category);
              return (
                <div
                  key={category}
                  role="button"
                  tabIndex={0}
                  className="-mx-2 cursor-pointer rounded-lg px-2 py-3 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={onViewAll}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewAll(); } }}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate text-xs font-medium text-foreground">{displayName}</span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                      {amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70 transition-all duration-500"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 py-7 text-muted-foreground">
            <BarChart3 className="h-5 w-5 shrink-0 opacity-50" aria-hidden="true" />
            <div><p className="text-sm font-medium text-foreground">No categories yet</p><p className="mt-1 text-xs">Categorize transactions to see your breakdown.</p></div>
          </div>
        )}
        <p className="mt-2 border-t border-border/50 pt-3 text-[10px] leading-relaxed text-muted-foreground">Posted USD records marked deductible. Refunds reduce totals; tax limits are not applied.</p>
      </CardContent>
    </Card>
  );
}
