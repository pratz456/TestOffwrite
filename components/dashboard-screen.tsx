/**
 * WriteOff Dashboard with Premium Fintech Design
 *
 * Features:
 * - Plaid integration for automatic bank transaction import
 * - OpenAI GPT-4 analysis for tax deductibility classification
 * - Real-time confidence scoring for AI decisions
 * - Manual transaction entry and editing
 * - Comprehensive expense tracking and categorization
 *
 * Design:
 * - Premium fintech aesthetic (Stripe/Brex vibes)
 * - Deep navy primary, emerald accent, muted grays
 * - 8px border radius, flat surfaces, subtle shadows
 * - Professional typography and spacing
 */

import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCategory, consolidateCategory } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KPICard } from '@/components/ui/kpi';
import { useRouter } from 'next/navigation';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useTransactions, useUserStats } from '@/lib/firebase/hooks';
import { calculateEffectiveTaxRate } from '@/lib/tax-rules/federal-brackets';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { auth } from '@/lib/firebase/client';
import {
  TrendingUp,
  DollarSign,
  Receipt,
  RefreshCw,
  Camera,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  ChevronRight,
  Sparkles,
  CheckCircle,
  Clock,
  Plane,
  Utensils,
  Building,
  Monitor,
  Home,
  Zap,
  ClipboardList
} from '@/lib/icons';
import { Lightbulb, Calculator } from 'lucide-react';

interface DashboardScreenProps {
  profile: any;
  transactions: any[];
  onNavigate: (screen: string) => void;
  onTransactionClick: (transaction: any) => void;
  analyzingTransactions?: boolean;
  onSignOut?: () => void;
}


// Helper function to get category icon
const getCategoryIcon = (category: string) => {
  const categoryIcons: { [key: string]: any } = {
    'TRAVEL_FLIGHTS': Plane,
    'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': Plane,
    'MEALS': Utensils,
    'FOOD_AND_DRINK_COFFEE': Utensils,
    'FOOD_AND_DRINK_FAST_FOOD': Utensils,
    'PROFESSIONAL_SERVICES': Building,
    'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING': Building,
    'SOFTWARE': Monitor,
    'OFFICE_EXPENSE': Monitor,
    'HOME_OFFICE': Home,
    'UTILITIES': Zap,
    'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': Building
  };

  return categoryIcons[category] || Building;
};

export default function DashboardScreen({
  profile,
  transactions: propTransactions,
  onNavigate,
  onTransactionClick,
  analyzingTransactions = false,
  onSignOut
}: DashboardScreenProps) {
  const router = useRouter();

  // Get current user for realtime hooks
  const currentUser = auth.currentUser;
  const userId = currentUser?.uid;

  // Use realtime hooks if user is authenticated, otherwise fall back to props
  const { transactions: realtimeTransactions, isLoading: transactionsLoading } = useTransactions(userId || '');
  const { stats: realtimeStats, isLoading: statsLoading } = useUserStats(userId || '');
  const { toasts, removeToast } = useToasts();

  // Use realtime data if available, otherwise fall back to props
  const transactions = realtimeTransactions.length > 0 ? realtimeTransactions : propTransactions;
  const stats = realtimeStats;
  const [taxSavingsData, setTaxSavingsData] = useState<any>(null);
  const [isLoadingTaxSavings, setIsLoadingTaxSavings] = useState(false);
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);

  // Fetch tax savings data
  useEffect(() => {
    const fetchTaxSavings = async () => {
      if (!profile?.id) return;

      try {
        setIsLoadingTaxSavings(true);
        console.log('🔄 [Dashboard] Fetching tax savings data...');
        const response = await makeAuthenticatedRequest('/api/tax-savings');
        if (response.ok) {
          const data = await response.json();
          console.log('✅ [Dashboard] Tax savings API response:', data);
          setTaxSavingsData(data.data);
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error('❌ [Dashboard] Failed to fetch tax savings data:', errorData.error || response.statusText);
        }
      } catch (error) {
        console.error('❌ [Dashboard] Error fetching tax savings:', error);
      } finally {
        setIsLoadingTaxSavings(false);
      }
    };

    fetchTaxSavings();
  }, [profile?.id]);

  if (!transactions) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse">
          <div className="w-8 h-8 bg-primary rounded-full"></div>
        </div>
      </div>
    );
  }

  // Calculate KPIs from transaction data (for fallback only)
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  // Calculate projected annual savings (fallback)
  const monthsElapsed = currentMonth + 1;
  const fallbackProjectedAnnualSavings = monthsElapsed > 0 ? (0 / monthsElapsed) * 12 : 0;

  // Use API data as primary source, fallback to local calculations only if API fails
  const taxSavings = taxSavingsData?.taxSavings?.yearToDate ?? 0;
  const projectedAnnualSavingsFinal = taxSavingsData?.taxSavings?.projectedAnnual ?? fallbackProjectedAnnualSavings;


  // Use realtime stats if available, otherwise calculate from transactions
  const needsReviewCount = stats?.needsReviewTransactions ?? transactions.filter(t =>
    t.is_deductible === null
  ).length;

  const needsAnalysisCount = transactions.filter(t =>
    t.deduction_score === undefined || t.deduction_score === null
  ).length;


  const deductibleTransactions = transactions.filter(t => t.is_deductible === true);
  const totalDeductions = stats?.totalDeductibleAmount ?? deductibleTransactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

  // Category breakdown using consolidated categories
  const categoryBreakdown: Record<string, number> = {};
  for (const transaction of transactions) {
    if (transaction && transaction.is_deductible === true && transaction.category && transaction.amount) {
      const deductibleAmount = Math.abs(transaction.amount);
      const { consolidatedName } = consolidateCategory(transaction.category);
      if (categoryBreakdown[consolidatedName]) {
        categoryBreakdown[consolidatedName] += deductibleAmount;
      } else {
        categoryBreakdown[consolidatedName] = deductibleAmount;
      }
    }
  }

  const categoryEntries = Object.entries(categoryBreakdown);
  categoryEntries.sort((a, b) => b[1] - a[1]);
  const topCategories = categoryEntries.slice(0, 3);

  return (
    <>
      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />

      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="bg-background">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">Dashboard</h1>
                <p className="text-sm md:text-base text-muted-foreground">Welcome back, {profile?.name?.split(' ')[0] || 'there'}</p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (isRefreshingBalances) return;
                    try {
                      setIsRefreshingBalances(true);
                      console.log('🔄 [Dashboard] Refreshing balances...');
                      const response = await makeAuthenticatedRequest('/api/plaid/refresh-balances', {
                        method: 'POST',
                      });
                      if (response.ok) {
                        const data = await response.json();
                        console.log('✅ [Dashboard] Balances refreshed:', data);
                        // Reload page to show updated data
                        setTimeout(() => {
                          window.location.reload();
                        }, 500);
                      } else {
                        const errorData = await response.json().catch(() => ({}));
                        console.error('❌ [Dashboard] Failed to refresh balances:', errorData);
                        alert('Failed to refresh balances. Please try again.');
                      }
                    } catch (error) {
                      console.error('❌ [Dashboard] Error refreshing balances:', error);
                      alert('Error refreshing balances. Please try again.');
                    } finally {
                      setIsRefreshingBalances(false);
                    }
                  }}
                  disabled={isRefreshingBalances}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshingBalances ? 'animate-spin' : ''}`} />
                  {isRefreshingBalances ? 'Refreshing...' : 'Refresh Balances'}
                </Button>
                {/* <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => onNavigate('settings')}
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Button> */}
                {/* <Button
                  onClick={onSignOut}
                  variant="outline"
                  size="sm"
                  className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </Button> */}
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          {/* Top Row - KPI Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
        {/* YTD Tax Savings - 8 cols */}
        <div className="lg:col-span-8">
          <Card className="h-full">
            <CardContent className="p-4 md:p-5">
              <div className="flex flex-col sm:flex-row items-start justify-between h-full gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="success" className="text-xs">
                      YTD +${taxSavings.toFixed(0)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTaxSavingsData(null);
                        const fetchTaxSavings = async () => {
                          try {
                            setIsLoadingTaxSavings(true);
                            const response = await makeAuthenticatedRequest('/api/tax-savings');
                            if (response.ok) {
                              const data = await response.json();
                              setTaxSavingsData(data.data);
                            }
                          } catch (error) {
                            console.error('Error refreshing tax savings:', error);
                          } finally {
                            setIsLoadingTaxSavings(false);
                          }
                        };
                        fetchTaxSavings();
                      }}
                      className="h-6 w-6 p-0 hover:bg-primary/10"
                      disabled={isLoadingTaxSavings}
                    >
                      <RefreshCw className={`h-3 w-3 ${isLoadingTaxSavings ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  <div className="text-2xl sm:text-3xl md:text-4xl font-semibold text-foreground mb-2">
                    {isLoadingTaxSavings ? (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span>Calculating...</span>
                      </div>
                    ) : (
                      `$${taxSavings.toFixed(0)}`
                    )}
                  </div>
                  <p className="text-muted-foreground mb-1">
                    Confirmed savings to date
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Projected: <span className="font-medium text-foreground">${projectedAnnualSavingsFinal.toFixed(0)}</span> annually
                  </p>
                </div>
                <div className="flex-shrink-0 ml-0 sm:ml-4 mt-3 sm:mt-0">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-accent/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-accent" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Total Deductions - 4 cols */}
        <div className="lg:col-span-4">
          <KPICard
            title="Total Deductions"
            value={`$${totalDeductions.toFixed(2)}`}
            subtitle={`${deductibleTransactions.length} deductible transactions`}
            icon={
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
            }
          />
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
        {/* Main Content - 8 cols */}
        <div className="lg:col-span-8 space-y-3">
          {/* Top Deductible Categories */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-medium">Top Deductible Categories</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('categories')}
                  className="text-primary hover:text-primary hover:bg-primary/5"
                >
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {topCategories.length > 0 ? (
                <div className="space-y-4">
                  {topCategories.map(([category, amount]) => {
                    const percentage = totalDeductions > 0 ? (amount / totalDeductions) * 100 : 0;
                    const IconComponent = getCategoryIcon(category);

                    return (
                      <div
                        key={category}
                        className="space-y-2 cursor-pointer hover:bg-muted/50 p-2 rounded-lg transition-colors"
                        onClick={() => {
                          // Navigate to categories page for detailed view
                          onNavigate('categories');
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                              <IconComponent className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div>
                              <span className="font-medium text-foreground text-sm">{consolidateCategory(category).displayName}</span>
                              <div className="text-xs text-muted-foreground">{percentage.toFixed(1)}% of deductions</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-semibold text-foreground text-sm">${amount.toFixed(0)}</span>
                            <span className="text-xs text-muted-foreground ml-2">(${(amount * (calculateEffectiveTaxRate(profile) / 100)).toFixed(0)} saved)</span>
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1">
                          <div
                            className="bg-accent h-1 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(percentage, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                  <p className="text-sm">
                    {transactions.length > 0
                      ? `Found ${transactions.length} transactions. Run AI analysis to categorize them.`
                      : 'Start tracking expenses to see category breakdown'
                    }
                  </p>
                  {transactions.length > 0 && needsAnalysisCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {needsAnalysisCount} transactions need AI analysis
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>


          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-medium">Recent Activity</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('transactions')}
                  className="text-primary hover:text-primary hover:bg-primary/5"
                >
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {transactions.length > 0 ? (
                  transactions.slice(0, 5).map((transaction) => {
                    const isIncome = transaction.amount < 0;
                    const amount = Math.abs(transaction.amount);

                    return (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between py-2 px-3 hover:bg-muted rounded-lg cursor-pointer group transition-colors"
                        onClick={() => onTransactionClick({ ...transaction, _source: 'dashboard' })}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-2 h-2 rounded-full ${
                            transaction.is_deductible === true ? 'bg-accent' :
                            transaction.is_deductible === null ? 'bg-orange-500' :
                            'bg-muted-foreground'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground group-hover:text-primary transition-colors text-sm truncate">
                              {transaction.merchant_name || transaction.description || 'Unknown Merchant'}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                              <span>{isIncome ? 'Income' : consolidateCategory(transaction.category).displayName}</span>
                              <span>•</span>
                              <span>{new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span>•</span>
                              <Badge
                                variant={
                                  transaction.is_deductible === true ? "success" :
                                  transaction.is_deductible === null ? "outline" :
                                  "secondary"
                                }
                                className="text-xs"
                              >
                                {transaction.is_deductible === true ? 'Deductible' :
                                 transaction.is_deductible === null ? 'Pending' :
                                 'Personal'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2 sm:ml-3">
                          <div className={`font-semibold text-sm ${isIncome ? 'text-accent' : 'text-foreground'} whitespace-nowrap`}>
                            {isIncome ? '+' : ''}${amount.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                      <FileText className="h-6 w-6" />
                    </div>
                    <p className="text-sm">No transactions yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Connect your bank account to get started</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - 4 cols */}
        <div className="lg:col-span-4 space-y-3">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(needsAnalysisCount > 0 || needsReviewCount > 0) && (
                  <button
                    onClick={() => onNavigate('review-transactions')}
                    className={`w-full p-3 rounded-lg text-left transition-colors group min-h-[44px] ${
                      needsAnalysisCount > 0
                        ? 'bg-primary/5 hover:bg-primary/10 border border-primary/20'
                        : 'bg-accent/5 hover:bg-accent/10 border border-accent/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        needsAnalysisCount > 0 ? 'bg-primary/10' : 'bg-accent/10'
                      }`}>
                        <ClipboardList className={`h-4 w-4 ${
                          needsAnalysisCount > 0 ? 'text-primary' : 'text-accent'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground text-sm">Review Transactions</div>
                        <div className="text-xs text-muted-foreground">{needsReviewCount} pending</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                  </button>
                )}

                <button
                  onClick={() => onNavigate('transactions')}
                  className="w-full p-3 bg-muted hover:bg-muted/80 border border-border rounded-lg text-left transition-colors group min-h-[44px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-muted-foreground/10 rounded-lg flex items-center justify-center">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">Transactions</div>
                      <div className="text-xs text-muted-foreground">View All</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => onNavigate('schedule-c-export')}
                  className="w-full p-3 bg-muted hover:bg-muted/80 border border-border rounded-lg text-left transition-colors group min-h-[44px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-muted-foreground/10 rounded-lg flex items-center justify-center">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">Export</div>
                      <div className="text-xs text-muted-foreground">Schedule C</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => onNavigate('ai-insights')}
                  className="w-full p-3 bg-accent/10 hover:bg-accent/20 border border-accent/20 rounded-lg text-left transition-colors group min-h-[44px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-accent/20 rounded-lg flex items-center justify-center">
                      <Lightbulb className="h-4 w-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">AI Tax Insights</div>
                      <div className="text-xs text-muted-foreground">Personalized advice</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => onNavigate('quarterly-taxes')}
                  className="w-full p-3 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-left transition-colors group min-h-[44px]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center">
                      <Calculator className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">Quarterly Taxes</div>
                      <div className="text-xs text-muted-foreground">Estimate & pay</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </button>

              </div>
            </CardContent>
          </Card>

        </div>
      </div>

        </div>
    </div>
    </>
  );
}