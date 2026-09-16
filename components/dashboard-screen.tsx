/**
 * WriteOff Dashboard - Premium Fintech Corporate
 *
 * All data fetching and computation stays in this parent component.
 * Presentation is delegated to components/dashboard/*.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useTransactions } from '@/lib/firebase/hooks';
import { getUserTaxRateDisplay } from '@/lib/tax-rules/federal-brackets';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { auth } from '@/lib/firebase/client';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { dashboardRecordStatus, summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import { toast } from 'sonner';
import { loadDashboardTaxSnapshot, type DashboardTaxState } from '@/lib/tax/dashboard-snapshot';

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
  const { toasts, removeToast } = useToasts();

  const transactions = realtimeTransactions.length > 0 ? realtimeTransactions : propTransactions;

  // --- Tax savings state (unchanged) ---
  const [taxSavingsData, setTaxSavingsData] = useState<any>(null);
  const [isLoadingTaxSavings, setIsLoadingTaxSavings] = useState(false);
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [bankConnection, setBankConnection] = useState<{ uid: string; connected: boolean } | null>(null);
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
          setBankConnection({ uid: userId, connected: items.hasConnection === true });
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
      setTaxSavingsData(null);
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
  }, [profile?.id, profile?.filing_status]);

  // The current-year tax cards use the same authenticated calculation as Tax Preview.
  // Include source data in the key so even the first render after an edit cannot
  // display a result computed from the previous user's or previous records' data.
  const taxYear = new Date().getFullYear();
  const [taxRetry, setTaxRetry] = useState(0);
  const taxInputKey = JSON.stringify({ userId, taxYear, profile, transactions, taxRetry });
  const [taxResult, setTaxResult] = useState<{ key: string; state: DashboardTaxState } | null>(null);
  const taxState: DashboardTaxState = taxResult?.key === taxInputKey ? taxResult.state : { status: 'loading' };

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setTaxResult({ key: taxInputKey, state: { status: 'loading' } });
    if (!userId) {
      setTaxResult({ key: taxInputKey, state: { status: 'error', message: 'Sign in to load your federal estimate.' } });
      return () => { current = false; controller.abort(); };
    }
    void loadDashboardTaxSnapshot(taxYear, controller.signal).then(state => {
      if (current && auth.currentUser?.uid === userId) setTaxResult({ key: taxInputKey, state });
    });
    return () => { current = false; controller.abort(); };
  }, [taxInputKey, userId, taxYear]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => setTaxRetry(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

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
  const taxRateDisplay = getUserTaxRateDisplay(profile);

  const recordSummary = summarizeDashboardRecords(transactions);
  const needsReviewCount = recordSummary.needsReviewCount;
  const needsAnalysisCount = transactions.filter(t => (t.deduction_score === undefined || t.deduction_score === null) && dashboardRecordStatus(t) === 'review').length;

  // Recalculate tax independently of any optional bank-balance refresh.
  const handleRefresh = async () => {
    if (isRefreshingBalances) return;
    setTaxRetry(value => value + 1);
    if (!bankConnection || bankConnection.uid !== userId || !bankConnection.connected) return;
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
          isRefreshing={isRefreshingBalances || taxState.status === 'loading'}
          onRefresh={handleRefresh}
          lastSync={lastSync}
          analysisInProgress={analysisInProgress}
        />

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4">
          {/* Row 1: KPI Cards */}
          <KpiGrid
            state={taxState}
            taxYear={taxYear}
            onRetry={() => setTaxRetry(value => value + 1)}
            onReview={onNavigate}
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
                totalTransactions={transactions.length}
                deductibleCount={recordSummary.deductibleCount}
                pendingCount={recordSummary.pendingCount}
                onNavigate={onNavigate}
              />
            </div>
          </div>

          {/* Row 5: Categories + Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopCategoriesCard
              categories={recordSummary.categoryEntries}
              totalMagnitude={recordSummary.categoryMagnitude}
              reviewMessage={recordSummary.categoryIssue}
              onViewAll={() => onNavigate('categories')}
            />
            <RecentActivityCard
              transactions={transactions}
              onTransactionClick={onTransactionClick}
              onViewAll={() => onNavigate('transactions')}
            />
          </div>

          {/* Row 6: AI Advisory */}
          {!taxRateDisplay.reviewMessage && <AiAdvisoryCard
            needsReviewCount={needsReviewCount}
            needsAnalysisCount={needsAnalysisCount}
            taxSavings={taxSavings}
            onNavigate={onNavigate}
          />}
        </div>
      </div>
    </>
  );
}
