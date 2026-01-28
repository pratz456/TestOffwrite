"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Search, ChevronDown, ChevronUp, Building, Settings, Info, Home } from 'lucide-react';
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



const getCategoryIcon = (category: string) => {
  const categoryLower = category.toLowerCase();
  if (categoryLower.includes('office') || categoryLower.includes('equipment')) {
    return <Building className="w-5 h-5 text-blue-600" />;
  } else if (categoryLower.includes('software') || categoryLower.includes('tools')) {
    return <Settings className="w-5 h-5 text-purple-600" />;
  } else if (categoryLower.includes('transportation') || categoryLower.includes('travel')) {
    return <Info className="w-5 h-5 text-green-600" />;
  } else if (categoryLower.includes('meals') || categoryLower.includes('entertainment') || categoryLower.includes('food')) {
    return <Home className="w-5 h-5 text-orange-600" />;
  }
  return <Building className="w-5 h-5 text-gray-600" />;
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
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-0.5">Categories</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Your tax deduction breakdown and category analysis</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4">
        {/* Summary Cards - Compact on mobile */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
          <div className="bg-card border border-border rounded-lg p-2.5 sm:p-4 shadow-sm">
            <div className="text-base sm:text-xl md:text-2xl font-bold text-foreground">${totalDeductions.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{activeCategories} active categories</div>
          </div>
          
          <div className="bg-card border border-border rounded-lg p-2.5 sm:p-4 shadow-sm">
            <div className="text-base sm:text-xl md:text-2xl font-bold text-foreground">{deductibleTransactions.length}</div>
            <div className="text-xs text-muted-foreground">Deductible transactions</div>
          </div>
          
          <div className="bg-card border border-border rounded-lg p-2.5 sm:p-4 shadow-sm">
            <div className="text-base sm:text-xl md:text-2xl font-bold text-accent">${totalTaxSavings.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Potential savings</div>
          </div>
          
          <div className="bg-card border border-border rounded-lg p-2.5 sm:p-4 shadow-sm">
            <div className="text-base sm:text-xl md:text-2xl font-bold text-foreground">{transactions.length}</div>
            <div className="text-xs text-muted-foreground">Total transactions</div>
          </div>
        </div>

        {/* Search Bar - Compact */}
        <div className="bg-card border border-border rounded-lg p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <input
              type="text"
              placeholder="Search categories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
        </div>

        {/* Category Table - Desktop */}
        <div className="hidden md:block bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          {/* Table Header */}
          <div className="bg-muted border-b border-border px-6 py-3">
            <div className="grid grid-cols-12 gap-4 text-sm font-semibold text-muted-foreground">
              <div className="col-span-4">CATEGORY</div>
              <div className="col-span-2">TRANSACTIONS</div>
              <div className="col-span-2">TOTAL AMOUNT</div>
              <div className="col-span-2">TAX SAVINGS</div>
              <div className="col-span-2">PERCENTAGE</div>
            </div>
          </div>

          {/* Category Rows */}
          <div className="divide-y divide-border">
            {filteredCategories.map((categoryData) => {
              const isExpanded = expandedCategories.has(categoryData.category);
              
              return (
                <div key={categoryData.category}>
                  <div 
                    className="px-6 py-4 hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => toggleCategory(categoryData.category)}
                  >
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4 flex items-center gap-3">
                        <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                          {getCategoryIcon(categoryData.category)}
                        </div>
                        <div>
                          <div className="font-medium text-foreground text-sm">
                            {categoryData.displayName}
                          </div>
                          {categoryData.originalCategories.length > 1 && (
                            <div className="text-xs text-muted-foreground">
                              {categoryData.originalCategories.length} subcategories
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="col-span-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {categoryData.transactionCount}
                        </span>
                      </div>
                      
                      <div className="col-span-2">
                        <div className="font-semibold text-foreground">
                          ${categoryData.totalAmount.toFixed(2)}
                        </div>
                      </div>
                      
                      <div className="col-span-2">
                        <div className="font-semibold text-accent">
                          ${categoryData.taxSavings.toFixed(2)}
                        </div>
                      </div>
                      
                      <div className="col-span-2 flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div 
                            className="bg-primary h-2 rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(categoryData.percentage, 100)}%` }}
                          ></div>
                        </div>
                        <span className="text-xs text-muted-foreground w-12 text-right">
                          {categoryData.percentage.toFixed(1)}%
                        </span>
                        <button className="ml-2 touch-target">
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
                    <div className="bg-muted/50 border-t border-border">
                      <div className="px-6 py-3">
                        <h4 className="font-semibold text-foreground mb-3 text-sm">Transactions in this category</h4>
                        <div className="space-y-1">
                          {categoryData.transactions.map((transaction) => (
                            <div 
                              key={transaction.id} 
                              className="bg-card rounded-lg p-3 border border-border cursor-pointer hover:border-primary/50 transition-colors"
                              onClick={() => onTransactionClick?.({ ...transaction, _source: 'categories' } as any)}
                            >
                              <div className="grid grid-cols-12 gap-4 items-center">
                                <div className="col-span-4 flex items-center gap-3">
                                  <div className="w-2 h-2 bg-accent rounded-full flex-shrink-0"></div>
                                  <div>
                                    <div className="font-medium text-foreground text-sm">
                                      {transaction.merchant_name || transaction.description || 'Unknown Merchant'}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {new Date(transaction.date).toLocaleDateString('en-US', { 
                                        month: '2-digit', day: '2-digit', year: 'numeric'
                                      })} • {formatCategory(transaction.category)}
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="col-span-2">
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent">
                                    Deductible
                                  </span>
                                </div>
                                
                                <div className="col-span-2">
                                  <div className="font-semibold text-foreground">
                                    ${Math.abs(transaction.amount).toFixed(2)}
                                  </div>
                                </div>
                                
                                <div className="col-span-2">
                                  <div className="font-semibold text-accent">
                                    ${(Math.abs(transaction.amount) * 0.3).toFixed(2)}
                                  </div>
                                </div>
                                
                                <div className="col-span-2">
                                  <div className="text-xs text-muted-foreground">
                                    {((Math.abs(transaction.amount) / categoryData.totalAmount) * 100).toFixed(1)}%
                                  </div>
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

        {/* Category Cards - Mobile (Compact View) */}
        <div className="md:hidden space-y-2">
          {filteredCategories.map((categoryData) => {
            const isExpanded = expandedCategories.has(categoryData.category);
            
            return (
              <div key={categoryData.category} className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-lg shadow-sm overflow-hidden">
                {/* Compact Category Header */}
                <div 
                  className="p-3 hover:bg-gray-50 dark:hover:bg-muted active:bg-gray-100 dark:active:bg-muted/80 cursor-pointer transition-colors no-tap-highlight"
                  onClick={() => toggleCategory(categoryData.category)}
                >
                  {/* Row 1: Icon, Name, Amount, Chevron */}
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-9 h-9 bg-gray-100 dark:bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                      {getCategoryIcon(categoryData.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-foreground text-sm truncate">
                        {categoryData.displayName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-muted-foreground">
                        {categoryData.transactionCount} txns • ${categoryData.taxSavings.toFixed(0)} savings
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 mr-1">
                      <div className="font-bold text-gray-900 dark:text-foreground text-sm">
                        ${categoryData.totalAmount.toFixed(2)}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                  
                  {/* Row 2: Progress bar with percentage */}
                  <div className="flex items-center gap-2 pl-11">
                    <div className="flex-1 bg-gray-200 dark:bg-muted rounded-full h-1.5">
                      <div 
                        className="bg-primary h-1.5 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.min(categoryData.percentage, 100)}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-muted-foreground w-10 text-right">
                      {categoryData.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              
                {/* Expanded Transactions - Mobile (Compact) */}
                {isExpanded && (
                  <div className="bg-gray-50 dark:bg-muted/50 border-t border-gray-200 dark:border-border">
                    <div className="p-2.5 space-y-1.5">
                      {categoryData.transactions.map((transaction) => (
                        <div 
                          key={transaction.id} 
                          className="bg-white dark:bg-card rounded-lg p-2.5 border border-gray-200 dark:border-border cursor-pointer hover:border-blue-300 dark:hover:border-primary/50 active:border-blue-400 transition-colors no-tap-highlight"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTransactionClick?.({ ...transaction, _source: 'categories' } as any);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-foreground text-sm truncate">
                                  {transaction.merchant_name || transaction.description || 'Unknown'}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-muted-foreground">
                                  {new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </div>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="font-semibold text-gray-900 dark:text-foreground text-sm">
                                ${Math.abs(transaction.amount).toFixed(2)}
                              </div>
                              <div className="text-xs text-green-600 dark:text-accent">
                                -${(Math.abs(transaction.amount) * 0.3).toFixed(0)} tax
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
          <div className="bg-card border border-border rounded-lg shadow-sm">
            <div className="text-center py-8 sm:py-12">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                <Search className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground" />
              </div>
              <h3 className="text-base sm:text-lg font-medium text-foreground mb-1 sm:mb-2">No categories found</h3>
              <p className="text-sm text-muted-foreground">Try adjusting your search terms</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
