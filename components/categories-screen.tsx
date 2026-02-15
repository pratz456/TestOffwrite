"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Search, ChevronDown, ChevronUp, Building, Settings, Info, Home, TrendingUp } from 'lucide-react';
import { formatCategory, consolidateCategory } from '@/lib/utils';

const writeOffLogo = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzMzNjZDQyIvPgo8dGV4dCB4PSIxNiIgeT0iMjIiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxOCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5XPC90ZXh0Pgo8L3N2Zz4K';

interface Transaction {
  id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  description?: string;
  notes?: string;
}

interface CategoriesScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
  transactions: Transaction[];
  onTransactionClick?: (transaction: Transaction) => void;
}



// Premium fintech: semantic icon colors aligned with Transactions category pills
const getCategoryIcon = (category: string) => {
  const c = category.toUpperCase();
  if (c.includes('FOOD') || c.includes('MEALS') || c.includes('ENTERTAINMENT')) {
    return <Home className="w-5 h-5 text-[hsl(var(--success))]" />;
  }
  if (c.includes('PROFESSIONAL') || c.includes('SERVICES')) {
    return <Building className="w-5 h-5 text-cyan-400" />;
  }
  if (c.includes('LOAN') || c.includes('FINANCIAL')) {
    return <Building className="w-5 h-5 text-[hsl(var(--destructive)/0.9)]" />;
  }
  if (c.includes('MERCHANDISE') || c.includes('GENERAL')) {
    return <Building className="w-5 h-5 text-slate-400" />;
  }
  if (c.includes('TRANSFER')) {
    return <Settings className="w-5 h-5 text-[hsl(var(--chart-4))]" />;
  }
  if (c.includes('TRANSPORT') || c.includes('TRAVEL')) {
    return <Info className="w-5 h-5 text-[hsl(var(--chart-4)/0.9)]" />;
  }
  if (c.includes('OFFICE') || c.includes('SOFTWARE') || c.includes('EQUIPMENT')) {
    return <Settings className="w-5 h-5 text-primary" />;
  }
  return <Building className="w-5 h-5 text-muted-foreground" />;
};

// Low-opacity circular background for category icon (matches Dashboard/Transactions palette)
const getCategoryIconBg = (category: string): string => {
  const c = category.toUpperCase();
  if (c.includes('FOOD') || c.includes('MEALS') || c.includes('ENTERTAINMENT')) return 'bg-[hsl(var(--success)/0.15)]';
  if (c.includes('PROFESSIONAL') || c.includes('SERVICES')) return 'bg-cyan-500/15';
  if (c.includes('LOAN') || c.includes('FINANCIAL')) return 'bg-[hsl(var(--destructive)/0.12)]';
  if (c.includes('MERCHANDISE') || c.includes('GENERAL')) return 'bg-slate-500/15';
  if (c.includes('TRANSFER') || c.includes('TRANSPORT') || c.includes('TRAVEL')) return 'bg-[hsl(var(--chart-4)/0.12)]';
  if (c.includes('OFFICE') || c.includes('SOFTWARE') || c.includes('EQUIPMENT')) return 'bg-primary/15';
  return 'bg-muted';
};

export const CategoriesScreen: React.FC<CategoriesScreenProps> = ({ 
  user, 
  onBack, 
  transactions,
  onTransactionClick 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showDeductionsTooltip, setShowDeductionsTooltip] = useState(false);
  const [showSavingsTooltip, setShowSavingsTooltip] = useState(false);

  // Filter deductible transactions (include all deductible transactions regardless of amount sign)
  const deductibleTransactions = transactions.filter(t => t.is_deductible === true);


  // Group transactions by consolidated category
  const categoryGroups = deductibleTransactions.reduce((acc, transaction) => {
    const { consolidatedName, displayName } = consolidateCategory(transaction.category);
    
    if (!acc[consolidatedName]) {
      acc[consolidatedName] = {
        displayName,
        transactions: [],
        originalCategories: new Set()
      };
    }
    
    acc[consolidatedName].transactions.push(transaction);
    acc[consolidatedName].originalCategories.add(transaction.category);
    
    return acc;
  }, {} as Record<string, { displayName: string; transactions: Transaction[]; originalCategories: Set<string> }>);

  // Calculate category totals and percentages (use absolute values for consistency with dashboard)
  const totalDeductions = deductibleTransactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
  
  const categoryData = Object.entries(categoryGroups).map(([consolidatedName, groupData]) => {
    const totalAmount = groupData.transactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const percentage = totalDeductions > 0 ? (totalAmount / totalDeductions) * 100 : 0;
    const taxSavings = totalAmount * 0.3; // 30% tax rate
    
    return {
      category: consolidatedName,
      displayName: groupData.displayName,
      transactions: groupData.transactions,
      totalAmount,
      percentage,
      taxSavings,
      transactionCount: groupData.transactions.length,
      originalCategories: Array.from(groupData.originalCategories)
    };
  }).sort((a, b) => b.totalAmount - a.totalAmount);

  // Filter categories based on search
  const filteredCategories = categoryData.filter(cat => 
    cat.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cat.originalCategories.some(orig => formatCategory(orig).toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // Calculate total tax savings directly from total deductions
  const totalTaxSavings = totalDeductions * 0.30;
  const activeCategories = categoryData.length;

  return (
    <div className="bg-background min-h-screen overflow-x-hidden">
      {/* Header */}
      <div className="bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-0.5">Categories</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Your tax deduction breakdown and category analysis</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6">
        {/* Summary Cards — 2px left border glow, semantic accents: Emerald / Blue / Cyan / Steel */}
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
          <div className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-2 border-l-[hsl(var(--success)/0.75)] shadow-[0_0_0_1px_hsl(var(--success)/0.05),0_2px_6px_-2px_hsl(var(--success)/0.08)] min-h-[44px] flex flex-col justify-center">
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">${totalDeductions.toFixed(2)}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/75 mt-1">{activeCategories} active categories</div>
          </div>
          <div className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-2 border-l-primary/65 shadow-[0_0_0_1px_hsl(var(--primary)/0.05),0_2px_6px_-2px_hsl(var(--primary)/0.08)] min-h-[44px] flex flex-col justify-center">
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums whitespace-nowrap">{deductibleTransactions.length}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/75 mt-1">Deductible transactions</div>
          </div>
          <div className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-2 border-l-cyan-500/60 shadow-[0_0_0_1px_rgba(34,211,238,0.06),0_2px_6px_-2px_rgba(34,211,238,0.1)] min-h-[44px] flex flex-col justify-center">
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">${totalTaxSavings.toFixed(2)}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/75 mt-1">Potential savings</div>
          </div>
          <div className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-2 border-l-muted-foreground/45 shadow-[0_2px_6px_-2px_rgba(0,0,0,0.06)] min-h-[44px] flex flex-col justify-center hover:bg-muted/20 transition-all duration-150">
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums whitespace-nowrap">{transactions.length}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/75 mt-1">Total transactions</div>
          </div>
        </div>

        {/* Search Bar — full width, inset shadow, focus glow, 150ms transition */}
        <div className="w-full bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 pointer-events-none" />
            <input
              type="text"
              placeholder="Search categories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-3 min-h-[44px] text-sm bg-background rounded-xl border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-150"
            />
          </div>
        </div>

        {/* Category Table - Desktop: radial glow, row depth, gradient progress, tax savings + arrow */}
        <div className="hidden md:block relative">
          <div className="absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,hsl(var(--primary)/0.04),transparent)] pointer-events-none" aria-hidden />
          <div className="relative bg-card border border-border rounded-xl shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.25)] overflow-hidden">
            <div className="bg-muted/50 border-b border-border px-5 py-4">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                <div className="col-span-4">Category</div>
                <div className="col-span-2">Transactions</div>
                <div className="col-span-2">Total amount</div>
                <div className="col-span-2">Tax savings</div>
                <div className="col-span-2">Percentage</div>
              </div>
            </div>

            <div className="divide-y divide-border">
              {filteredCategories.map((categoryData) => {
                const isExpanded = expandedCategories.has(categoryData.category);
                return (
                  <div key={categoryData.category}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={`px-5 py-5 hover:bg-[hsl(var(--primary)/0.04)] cursor-pointer transition-all duration-150 md:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${isExpanded ? 'bg-[hsl(var(--primary)/0.02)]' : ''}`}
                      onClick={() => toggleCategory(categoryData.category)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCategory(categoryData.category); } }}
                    >
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-4 flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${getCategoryIconBg(categoryData.category)}`}>
                            {getCategoryIcon(categoryData.category)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground text-sm">
                              {categoryData.displayName}
                            </div>
                            {categoryData.originalCategories.length > 1 && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {categoryData.originalCategories.length} subcategories
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.2)] transition-shadow duration-150">
                            {categoryData.transactionCount}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <div className="font-semibold text-foreground tabular-nums">
                            ${categoryData.totalAmount.toFixed(2)}
                          </div>
                        </div>
                        <div className="col-span-2 flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-[hsl(var(--success))] shrink-0 mt-0.5" />
                          <div className="font-semibold text-[hsl(var(--success))] tabular-nums">
                            ${categoryData.taxSavings.toFixed(2)}
                          </div>
                        </div>
                        <div className="col-span-2 flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-2.5 min-w-0 overflow-hidden">
                            <div
                              className="h-2.5 rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-primary to-cyan-500"
                              style={{ width: `${Math.min(categoryData.percentage, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right shrink-0 tabular-nums">
                            {categoryData.percentage.toFixed(1)}%
                          </span>
                          <button
                            type="button"
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center -m-2 rounded-lg hover:bg-muted/80 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                            onClick={(e) => { e.stopPropagation(); toggleCategory(categoryData.category); }}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                
                  {/* Expanded Transactions - Desktop */}
                  {isExpanded && (
                    <div className="bg-muted/40 border-t border-border">
                      <div className="px-5 py-3">
                        <h4 className="font-semibold text-foreground mb-3 text-sm">Transactions in this category</h4>
                        <div className="space-y-2">
                          {categoryData.transactions.map((transaction) => (
                            <div
                              key={transaction.id}
                              role="button"
                              tabIndex={0}
                              className="bg-card rounded-xl p-3 border border-border cursor-pointer hover:border-primary/30 hover:bg-[hsl(var(--primary)/0.03)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => onTransactionClick?.({ ...transaction, _source: 'categories' } as any)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTransactionClick?.({ ...transaction, _source: 'categories' } as any); } }}
                            >
                              <div className="grid grid-cols-12 gap-4 items-center">
                                <div className="col-span-4 flex items-center gap-3">
                                  <div className="w-2 h-2 rounded-full bg-[hsl(var(--success))] flex-shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-foreground text-sm truncate">
                                      {transaction.merchant_name || transaction.description || 'Unknown Merchant'}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {new Date(transaction.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })} • {formatCategory(transaction.category)}
                                    </div>
                                  </div>
                                </div>
                                <div className="col-span-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border border-[hsl(var(--success)/0.3)]">
                                    Deductible
                                  </span>
                                </div>
                                <div className="col-span-2 font-semibold text-destructive/85 tabular-nums">
                                  ${Math.abs(transaction.amount).toFixed(2)}
                                </div>
                                <div className="col-span-2 font-semibold text-[hsl(var(--success))] tabular-nums">
                                  ${(Math.abs(transaction.amount) * 0.3).toFixed(2)}
                                </div>
                                <div className="col-span-2 text-xs text-muted-foreground">
                                  {((Math.abs(transaction.amount) / categoryData.totalAmount) * 100).toFixed(1)}%
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>

        {/* Category Cards - Mobile: Name+Icon, Badge, Amount, Tax Savings, Progress (no horizontal scroll, 44px tap) */}
        <div className="md:hidden space-y-4">
          {filteredCategories.map((categoryData) => {
            const isExpanded = expandedCategories.has(categoryData.category);
            return (
              <div key={categoryData.category} className="bg-card border border-border rounded-xl shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)] overflow-hidden min-w-0">
                <div
                  role="button"
                  tabIndex={0}
                  className="min-h-[44px] p-4 hover:bg-muted/40 active:bg-muted/60 cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => toggleCategory(categoryData.category)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCategory(categoryData.category); } }}
                >
                  {/* Row 1: Category name + icon */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getCategoryIconBg(categoryData.category)}`}>
                      {getCategoryIcon(categoryData.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground text-sm truncate">
                        {categoryData.displayName}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  {/* Row 2: Transactions badge, Total amount, Tax savings */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                      {categoryData.transactionCount} txns
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-muted-foreground">Total</span>
                      <span className="font-semibold text-foreground text-sm tabular-nums whitespace-nowrap">${categoryData.totalAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-[hsl(var(--success))] shrink-0" />
                      <span className="text-xs text-muted-foreground">Tax savings</span>
                      <span className="font-semibold text-[hsl(var(--success))] text-sm tabular-nums whitespace-nowrap">${categoryData.taxSavings.toFixed(2)}</span>
                    </div>
                  </div>
                  {/* Row 3: Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted rounded-full h-2.5 min-w-0 overflow-hidden">
                      <div
                        className="h-2.5 rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-primary to-cyan-500"
                        style={{ width: `${Math.min(categoryData.percentage, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-right shrink-0 tabular-nums">
                      {categoryData.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-muted/40 border-t border-border">
                    <div className="p-3 space-y-2">
                      {categoryData.transactions.map((transaction) => (
                        <div
                          key={transaction.id}
                          role="button"
                          tabIndex={0}
                          className="min-h-[44px] bg-card rounded-xl p-3 border border-border cursor-pointer hover:bg-[hsl(var(--primary)/0.03)] active:bg-muted/50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTransactionClick?.({ ...transaction, _source: 'categories' } as any);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              onTransactionClick?.({ ...transaction, _source: 'categories' } as any);
                            }
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="w-2 h-2 rounded-full bg-[hsl(var(--success))] flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="font-semibold text-foreground text-sm truncate">
                                  {transaction.merchant_name || transaction.description || 'Unknown'}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </div>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="font-semibold text-destructive/85 text-sm tabular-nums">
                                ${Math.abs(transaction.amount).toFixed(2)}
                              </div>
                              <div className="text-xs text-[hsl(var(--success))]">
                                ${(Math.abs(transaction.amount) * 0.3).toFixed(0)} tax saved
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredCategories.length === 0 && (
          <div className="bg-card border border-border rounded-xl shadow-sm">
            <div className="text-center py-8 sm:py-12">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                <Search className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-1 sm:mb-2">No categories found</h3>
              <p className="text-sm text-muted-foreground">Try adjusting your search terms</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
