'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronRight, BarChart3, Plane, Utensils, Building, Monitor, Home, Zap } from 'lucide-react';
import { consolidateCategory } from '@/lib/utils';

interface TopCategoriesCardProps {
  categories: [string, number][];
  totalDeductions: number;
  onViewAll: () => void;
  profile: any;
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

export function TopCategoriesCard({ categories, totalDeductions, onViewAll, profile }: TopCategoriesCardProps) {
  const topFive = categories.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Top Categories</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="text-primary hover:text-primary hover:bg-primary/5 min-h-[44px] h-9 sm:h-8 px-2 text-xs no-tap-highlight focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View All
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {topFive.length > 0 ? (
          <div className="space-y-3">
            {topFive.map(([category, amount]) => {
              const pct = totalDeductions > 0 ? (amount / totalDeductions) * 100 : 0;
              const Icon = getCategoryIcon(category);
              const { displayName } = consolidateCategory(category);
              return (
                <div
                  key={category}
                  role="button"
                  tabIndex={0}
                  className="min-h-[44px] cursor-pointer hover:bg-muted/50 rounded-lg p-2.5 -mx-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={onViewAll}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewAll(); } }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 bg-muted rounded-md flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-medium text-foreground truncate">{displayName}</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">
                      ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1 ml-[38px]" style={{ width: 'calc(100% - 38px)' }}>
                    <div
                      className="bg-primary/60 h-1 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No categories yet</p>
            <p className="text-xs mt-1">Categorize transactions to see breakdown</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
