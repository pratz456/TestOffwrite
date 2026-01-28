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
import { HistoricalAccessNotification } from '@/components/historical-access-notification';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
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

      <div className="min-h-screen bg-background safe-area-inset-bottom">
        {/* Header */}
        <div className="bg-background sticky top-0 z-10 border-b border-border/50 backdrop-blur-sm bg-background/95">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 sm:py-4">
            {/* Historical Access Notification */}
            <HistoricalAccessNotification />
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
              <div>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground">Dashboard</h1>
                <p className="text-sm text-muted-foreground">Welcome back, {profile?.name?.split(' ')[0] || 'there'}</p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
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
                  className="gap-2 flex-1 sm:flex-none h-10 sm:h-9 text-sm no-tap-highlight"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshingBalances ? 'animate-spin' : ''}`} />
                  <span className="hidden xs:inline">{isRefreshingBalances ? 'Refreshing...' : 'Refresh'}</span>
                  <span className="xs:hidden">{isRefreshingBalances ? '...' : 'Refresh'}</span>
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

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 sm:py-4">
          {/* Historical Access Upgrade Card */}
          <div className="mb-3 sm:mb-4">
            <HistoricalAccessUpgradeCard />
          </div>

          {/* Top Row - KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 mb-3 sm:mb-4">
        {/* YTD Tax Savings - 8 cols on lg, full width on mobile */}
        <div className="sm:col-span-2 lg:col-span-8">
          <Card className="h-full">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between h-full gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 sm:mb-3">
                    <Badge variant="success" className="text-xs shrink-0">
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
                      className="h-7 w-7 sm:h-6 sm:w-6 p-0 hover:bg-primary/10 no-tap-highlight"
                      disabled={isLoadingTaxSavings}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 sm:h-3 sm:w-3 ${isLoadingTaxSavings ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  <div className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-foreground mb-1 sm:mb-2">
                    {isLoadingTaxSavings ? (
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-lg sm:text-xl">Calculating...</span>
                      </div>
                    ) : (
                      `$${taxSavings.toFixed(0)}`
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-0.5 sm:mb-1">
                    Confirmed savings to date
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Projected: <span className="font-medium text-foreground">${projectedAnnualSavingsFinal.toFixed(0)}</span> annually
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-accent/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-5 w-5 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-accent" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Total Deductions - 4 cols on lg */}
        <div className="sm:col-span-2 lg:col-span-4">
          <KPICard
            title="Total Deductions"
            value={`$${totalDeductions.toFixed(2)}`}
            subtitle={`${deductibleTransactions.length} deductible transactions`}
            icon={
              <div className="w-11 h-11 sm:w-12 sm:h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
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
            <CardHeader className="pb-2 sm:pb-3 px-4 sm:px-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base sm:text-lg font-medium">Top Categories</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('categories')}
                  className="text-primary hover:text-primary hover:bg-primary/5 h-9 sm:h-8 px-2 sm:px-3 text-sm no-tap-highlight"
                >
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              {topCategories.length > 0 ? (
                <div className="space-y-2 sm:space-y-4">
                  {topCategories.map(([category, amount]) => {
                    const percentage = totalDeductions > 0 ? (amount / totalDeductions) * 100 : 0;
                    const IconComponent = getCategoryIcon(category);

                    return (
                      <div
                        key={category}
                        className="space-y-2 cursor-pointer hover:bg-muted/50 active:bg-muted/70 p-3 sm:p-2 rounded-lg transition-colors no-tap-highlight"
                        onClick={() => {
                          // Navigate to categories page for detailed view
                          onNavigate('categories');
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-9 h-9 sm:w-8 sm:h-8 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                              <IconComponent className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground text-sm block truncate">{consolidateCategory(category).displayName}</span>
                              <div className="text-xs text-muted-foreground">{percentage.toFixed(1)}%</div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="font-semibold text-foreground text-sm block">${amount.toFixed(0)}</span>
                            <span className="text-xs text-muted-foreground hidden sm:inline">(${(amount * (calculateEffectiveTaxRate(profile) / 100)).toFixed(0)} saved)</span>
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5 sm:h-1">
                          <div
                            className="bg-accent h-1.5 sm:h-1 rounded-full transition-all duration-500"
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
            <CardHeader className="pb-2 sm:pb-3 px-4 sm:px-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base sm:text-lg font-medium">Recent Activity</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('transactions')}
                  className="text-primary hover:text-primary hover:bg-primary/5 h-9 sm:h-8 px-2 sm:px-3 text-sm no-tap-highlight"
                >
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-2 sm:px-6">
              <div className="space-y-1 sm:space-y-2">
                {transactions.length > 0 ? (
                  transactions.slice(0, 5).map((transaction) => {
                    const isIncome = transaction.amount < 0;
                    const amount = Math.abs(transaction.amount);

                    return (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between py-3 sm:py-2 px-3 hover:bg-muted active:bg-muted/70 rounded-lg cursor-pointer group transition-colors min-h-[56px] sm:min-h-0 no-tap-highlight"
                        onClick={() => onTransactionClick({ ...transaction, _source: 'dashboard' })}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-2.5 h-2.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${
                            transaction.is_deductible === true ? 'bg-accent' :
                            transaction.is_deductible === null ? 'bg-orange-500' :
                            'bg-muted-foreground'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground group-hover:text-primary transition-colors text-sm truncate">
                              {transaction.merchant_name || transaction.description || 'Unknown Merchant'}
                            </div>
                            <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-muted-foreground">
                              <span className="truncate max-w-[100px] sm:max-w-none">{isIncome ? 'Income' : consolidateCategory(transaction.category).displayName}</span>
                              <span className="hidden sm:inline">•</span>
                              <span className="hidden sm:inline">{new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <Badge
                                variant={
                                  transaction.is_deductible === true ? "success" :
                                  transaction.is_deductible === null ? "outline" :
                                  "secondary"
                                }
                                className="text-xs ml-1 sm:ml-0"
                              >
                                {transaction.is_deductible === true ? 'Ded.' :
                                 transaction.is_deductible === null ? 'Pending' :
                                 'Personal'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <div className={`font-semibold text-sm ${isIncome ? 'text-accent' : 'text-foreground'} whitespace-nowrap`}>
                            {isIncome ? '+' : ''}${amount.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground sm:hidden">
                            {new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

        {/* Sidebar - 4 cols on desktop, full width on mobile */}
        <div className="lg:col-span-4 space-y-3">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-2 px-4 sm:px-6">
              <CardTitle className="text-base sm:text-lg font-medium">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              {/* Mobile: 2x2 grid, Desktop: list */}
              <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-3">
                {(needsAnalysisCount > 0 || needsReviewCount > 0) && (
                  <button
                    onClick={() => onNavigate('review-transactions')}
                    className={`col-span-2 sm:col-span-1 w-full p-3 sm:p-3 rounded-lg text-left transition-colors group min-h-[60px] sm:min-h-[44px] no-tap-highlight ${
                      needsAnalysisCount > 0
                        ? 'bg-primary/5 hover:bg-primary/10 active:bg-primary/15 border border-primary/20'
                        : 'bg-accent/5 hover:bg-accent/10 active:bg-accent/15 border border-accent/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        needsAnalysisCount > 0 ? 'bg-primary/10' : 'bg-accent/10'
                      }`}>
                        <ClipboardList className={`h-4 w-4 ${
                          needsAnalysisCount > 0 ? 'text-primary' : 'text-accent'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground text-sm">Review</div>
                        <div className="text-xs text-muted-foreground">{needsReviewCount} pending</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block" />
                    </div>
                  </button>
                )}

                <button
                  onClick={() => onNavigate('transactions')}
                  className="w-full p-3 bg-muted hover:bg-muted/80 active:bg-muted/60 border border-border rounded-lg text-left transition-colors group min-h-[60px] sm:min-h-[44px] no-tap-highlight"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 sm:w-8 sm:h-8 bg-muted-foreground/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">Transactions</div>
                      <div className="text-xs text-muted-foreground hidden sm:block">View All</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block" />
                  </div>
                </button>

                <button
                  onClick={() => onNavigate('schedule-c-export')}
                  className="w-full p-3 bg-muted hover:bg-muted/80 active:bg-muted/60 border border-border rounded-lg text-left transition-colors group min-h-[60px] sm:min-h-[44px] no-tap-highlight"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 sm:w-8 sm:h-8 bg-muted-foreground/10 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">Export</div>
                      <div className="text-xs text-muted-foreground hidden sm:block">Schedule C</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block" />
                  </div>
                </button>

                <button
                  onClick={() => onNavigate('ai-insights')}
                  className="w-full p-3 bg-accent/10 hover:bg-accent/20 active:bg-accent/30 border border-accent/20 rounded-lg text-left transition-colors group min-h-[60px] sm:min-h-[44px] no-tap-highlight"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 sm:w-8 sm:h-8 bg-accent/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Lightbulb className="h-4 w-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">AI Insights</div>
                      <div className="text-xs text-muted-foreground hidden sm:block">Personalized advice</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block" />
                  </div>
                </button>

                <button
                  onClick={() => onNavigate('quarterly-taxes')}
                  className="w-full p-3 bg-primary/10 hover:bg-primary/20 active:bg-primary/30 border border-primary/20 rounded-lg text-left transition-colors group min-h-[60px] sm:min-h-[44px] no-tap-highlight"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 sm:w-8 sm:h-8 bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Calculator className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">Quarterly</div>
                      <div className="text-xs text-muted-foreground hidden sm:block">Estimate & pay</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block" />
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