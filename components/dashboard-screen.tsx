/**
 * WriteOff Dashboard - Premium Fintech Corporate
 *
 * All data fetching and computation stays in this parent component.
 * Presentation is delegated to components/dashboard/*.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useTransactions, useUserStats } from '@/lib/firebase/hooks';
import { calculateEffectiveTaxRate } from '@/lib/tax-rules/federal-brackets';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { auth } from '@/lib/firebase/client';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { consolidateCategory } from '@/lib/utils';
import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { toast } from 'sonner';

import {
  DashboardHeader,
  KpiGrid,
  AnalyticsPanel,
  OptimizationCard,
  TopCategoriesCard,
  RecentActivityCard,
  AiAdvisoryCard,
  QuickActionsBar,
  ActionItemsBanner,
} from '@/components/dashboard/index';

interface DashboardScreenProps {
  profile: any;
  transactions: any[];
  onNavigate: (screen: string) => void;
  onTransactionClick: (transaction: any) => void;
  analyzingTransactions?: boolean;
  onSignOut?: () => void;
}

export default function DashboardScreen({
  profile,
  transactions: propTransactions,
  onNavigate,
  onTransactionClick,
  analyzingTransactions = false,
  onSignOut,
}: DashboardScreenProps) {
  const router = useRouter();

  // --- Auth & realtime hooks (unchanged) ---
  const currentUser = auth.currentUser;
  const userId = currentUser?.uid;
  const { transactions: realtimeTransactions, isLoading: transactionsLoading } = useTransactions(userId || '');
  const { stats: realtimeStats, isLoading: statsLoading } = useUserStats(userId || '');
  const { toasts, removeToast } = useToasts();

  const transactions = realtimeTransactions.length > 0 ? realtimeTransactions : propTransactions;
  const stats = realtimeStats;

  // --- Tax savings state (unchanged) ---
  const [taxSavingsData, setTaxSavingsData] = useState<any>(null);
  const [isLoadingTaxSavings, setIsLoadingTaxSavings] = useState(false);
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);

  useEffect(() => {
    const fetchSyncAndAnalysis = async () => {
      if (!userId) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const [itemsRes, analysisRes] = await Promise.all([
          fetch('/api/plaid/items', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/transactions/analysis-status', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (itemsRes.ok) {
          const items = await itemsRes.json();
          const ls = items.last_sync;
          if (typeof ls === 'number') setLastSync(ls);
          else if (ls?.seconds) setLastSync(ls.seconds * 1000);
        }
        if (analysisRes.ok) {
          const analysis = await analysisRes.json();
          setAnalysisInProgress(analysis?.data?.overallStatus === 'analyzing');
        }
      } catch (_) {}
    };
    fetchSyncAndAnalysis();
  }, [userId]);

  useEffect(() => {
    const fetchTaxSavings = async () => {
      if (!profile?.id) return;
      try {
        setIsLoadingTaxSavings(true);
        const response = await makeAuthenticatedRequest('/api/tax-savings');
        if (response.ok) {
          const data = await response.json();
          setTaxSavingsData(data.data);
        }
      } catch (error) {
        console.error('Error fetching tax savings:', error);
      } finally {
        setIsLoadingTaxSavings(false);
      }
    };
    fetchTaxSavings();
  }, [profile?.id]);

  // --- Early return for no data ---
  if (!transactions) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center px-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // --- Derived data (unchanged business logic) ---
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  const monthsElapsed = currentMonth + 1;
  const fallbackProjectedAnnual = monthsElapsed > 0 ? (0 / monthsElapsed) * 12 : 0;

  const taxSavings = taxSavingsData?.taxSavings?.yearToDate ?? 0;
  const projectedAnnual = taxSavingsData?.taxSavings?.projectedAnnual ?? fallbackProjectedAnnual;
  const estimatedTaxRate = calculateEffectiveTaxRate(profile);

  const needsReviewCount =
    stats?.needsReviewTransactions ??
    transactions.filter((t) => transactionNeedsTaxReview(t)).length;
  const needsAnalysisCount = transactions.filter(t => t.deduction_score === undefined || t.deduction_score === null).length;

  const deductibleTransactions = transactions.filter(t => t.is_deductible === true);
  const totalDeductions = stats?.totalDeductibleAmount ?? deductibleTransactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

  // Plaid convention: positive = expense/debit, negative = income/credit
  const grossIncome = transactions.reduce((sum, t) => {
    if (t.amount < 0) return sum + Math.abs(t.amount);
    return sum;
  }, 0);

  const totalExpenses = transactions.reduce((sum, t) => {
    if (t.amount > 0) return sum + t.amount;
    return sum;
  }, 0);

  const scheduleCProfit = grossIncome - totalExpenses;

  // Compute actual SE tax + income tax for accurate combined rate
  const seBase = scheduleCProfit * 0.9235;
  const seTax = Math.max(0, seBase * 0.153);
  const halfSE = seTax / 2;
  const standardDeduction = profile?.filing_status === 'married_filing_jointly' ? 31500
    : profile?.filing_status === 'head_of_household' ? 23625 : 15750;
  const agi = Math.max(0, scheduleCProfit - halfSE);
  const taxableIncome = Math.max(0, agi - standardDeduction);
  const incomeTax = taxableIncome * (estimatedTaxRate / 100);
  const totalTax = seTax + incomeTax;
  const combinedTaxRate = scheduleCProfit > 0 ? (totalTax / scheduleCProfit) * 100 : 0;
  const quarterlyTaxes = Math.max(0, totalTax / 4);

  // Category breakdown (unchanged)
  const categoryBreakdown: Record<string, number> = {};
  for (const transaction of transactions) {
    if (transaction?.is_deductible === true && transaction.category && transaction.amount) {
      const deductibleAmount = Math.abs(transaction.amount);
      const { consolidatedName } = consolidateCategory(transaction.category);
      categoryBreakdown[consolidatedName] = (categoryBreakdown[consolidatedName] || 0) + deductibleAmount;
    }
  }
  const categoryEntries = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);

  // --- Refresh handler (unchanged) ---
  const handleRefresh = async () => {
    if (isRefreshingBalances) return;
    try {
      setIsRefreshingBalances(true);
      const response = await makeAuthenticatedRequest('/api/plaid/refresh-balances', { method: 'POST' });
      if (response.ok) {
        setTimeout(() => window.location.reload(), 500);
      } else {
        toast.error('Failed to refresh balances. Please try again.');
      }
    } catch {
      toast.error('Error refreshing balances. Please try again.');
    } finally {
      setIsRefreshingBalances(false);
    }
  };

  // --- Render ---
  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />

      <div className="min-h-screen bg-background safe-area-inset-bottom overflow-x-hidden">
        {/* Header */}
        <DashboardHeader
          userName={profile?.name?.split(' ')[0] || 'there'}
          isRefreshing={isRefreshingBalances}
          onRefresh={handleRefresh}
          lastSync={lastSync}
          analysisInProgress={analysisInProgress}
        />

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4">
          {/* Row 1: KPI Cards */}
          <KpiGrid
            scheduleCProfit={scheduleCProfit}
            grossIncome={grossIncome}
            totalExpenses={totalExpenses}
            totalDeductions={totalDeductions}
            deductibleCount={deductibleTransactions.length}
            estimatedTaxRate={estimatedTaxRate}
            quarterlyTaxes={quarterlyTaxes}
          />

          {/* Row 2: Action Items + Premium - side-by-side square cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <ActionItemsBanner
              profile={profile}
              transactions={transactions}
              onNavigate={onNavigate}
            />
            <HistoricalAccessUpgradeCard variant="square" />
          </div>

          {/* Row 3: Quick Actions */}
          <QuickActionsBar
            onNavigate={onNavigate}
            needsReviewCount={needsReviewCount}
            needsAnalysisCount={needsAnalysisCount}
          />

          {/* Row 4: Analytics + Optimization */}
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
            <div className="lg:col-span-7 relative">
              <div className="absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,hsl(var(--primary)/0.05),transparent)] pointer-events-none" aria-hidden />
              <AnalyticsPanel transactions={transactions} />
            </div>
            <div className="lg:col-span-3 relative">
              <div className="absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,hsl(var(--chart-4)/0.06),transparent)] pointer-events-none" aria-hidden />
              <OptimizationCard
                needsReviewCount={needsReviewCount}
                needsAnalysisCount={needsAnalysisCount}
                totalTransactions={transactions.length}
                deductibleCount={deductibleTransactions.length}
                onNavigate={onNavigate}
              />
            </div>
          </div>

          {/* Row 5: Categories + Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopCategoriesCard
              categories={categoryEntries}
              totalDeductions={totalDeductions}
              onViewAll={() => onNavigate('categories')}
              profile={profile}
            />
            <RecentActivityCard
              transactions={transactions}
              onTransactionClick={onTransactionClick}
              onViewAll={() => onNavigate('transactions')}
            />
          </div>

          {/* Row 6: AI Advisory */}
          <AiAdvisoryCard
            needsReviewCount={needsReviewCount}
            needsAnalysisCount={needsAnalysisCount}
            taxSavings={taxSavings}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </>
  );
}
