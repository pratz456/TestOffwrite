/**
 * WriteOff Home — review first, financial summary second.
 *
 * All data fetching and computation stays in this parent component.
 * Presentation is delegated to components/dashboard/*.
 */

import React, { useState, useEffect } from 'react';
import { ArrowRight, CheckCircle, ChevronDown } from 'lucide-react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useTransactions } from '@/lib/firebase/hooks';
import { getUserTaxRateDisplay } from '@/lib/tax-rules/federal-brackets';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { auth } from '@/lib/firebase/client';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { dashboardRecordStatus, summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import { summarizeAnalysisBacklog } from '@/lib/ai/analysis-state';
import { AnalysisStatusNotice } from '@/components/analysis-status-notice';
import { toast } from 'sonner';
import { loadDashboardTaxSnapshot, type DashboardTaxState } from '@/lib/tax/dashboard-snapshot';
import { transactionNeedsCategoryReview } from '@/lib/utils/transaction-tax-review';
import { dashboardNextSteps } from '@/lib/dashboard/next-steps';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';

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
  // --- Auth & realtime hooks (unchanged) ---
  const currentUser = auth.currentUser;
  const userId = currentUser?.uid;
  const { transactions: realtimeTransactions, isLoading: transactionsLoading } = useTransactions(userId || '');
  const { toasts, removeToast } = useToasts();

  const transactions = realtimeTransactions.length > 0 ? realtimeTransactions : propTransactions;

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

  const taxRateDisplay = getUserTaxRateDisplay(profile);

  const recordSummary = summarizeDashboardRecords(transactions);
  const needsReviewCount = recordSummary.needsReviewCount;
  const needsAnalysisCount = transactions.filter(t => (t.deduction_score === undefined || t.deduction_score === null) && dashboardRecordStatus(t) === 'review').length;
  const categoryReviews = transactions.filter(t => t.pending !== true && transactionNeedsCategoryReview(t));
  const categoriesNeedingAnalysis = categoryReviews.filter(t => t.deduction_score === undefined || t.deduction_score === null).length;
  // Queued, paused and failed AI analysis, read from the records already loaded (no extra listener).
  const analysisBacklog = summarizeAnalysisBacklog(transactions);
  const topOutcome = analysisBacklog.outcomes[0] ?? null;
  const isAnalyzing = analysisBacklog.waiting === 0 && (analyzingTransactions || analysisInProgress);

  const nextSteps = dashboardNextSteps(transactions, taxState);
  const confirmedDeductions = summarizeConfirmedDeductions(transactions, taxYear);

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

      <div className="min-h-full bg-background safe-area-inset-bottom">
        {/* Header */}
        <DashboardHeader
          userName={profile?.name?.split(' ')[0] || 'there'}
          isRefreshing={isRefreshingBalances || taxState.status === 'loading'}
          onRefresh={handleRefresh}
          lastSync={lastSync}
          analysisInProgress={isAnalyzing}
        />

        <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-2 pb-4 space-y-2.5 sm:space-y-3">
          <div className="grid items-start gap-2.5 sm:gap-3 lg:grid-cols-2">
            <KpiGrid state={taxState} taxYear={taxYear} confirmedDeductions={confirmedDeductions}
              onRetry={() => setTaxRetry(value => value + 1)} onReview={onNavigate} />
            <section aria-label="Your next steps" className="overflow-hidden rounded-2xl border border-border/70 bg-card">
              <div className="flex min-h-11 items-center justify-between px-4"><h2 className="text-sm font-semibold">Next up</h2>
                <button className="min-h-11 text-xs text-primary" onClick={() => onNavigate('action-items')}>Full checklist</button></div>
              {nextSteps.length ? <ol className="divide-y divide-border/60">{nextSteps.map(step => <li key={step.id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{step.title}</p><p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{step.detail}</p></div>
                <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:bg-primary/5" aria-label={step.action}
                  onClick={() => step.retry ? setTaxRetry(value => value + 1) : step.transaction ? onNavigate(`transaction-detail?transactionId=${encodeURIComponent(step.transaction.trans_id || step.transaction.id)}&from=dashboard&section=details`) : step.screen && onNavigate(step.screen)}>
                  {step.retry ? 'Retry' : step.transaction ? 'Answer' : step.id === 'tax-inputs' ? 'Review' : step.action}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </li>)}</ol> : <p className="flex items-start gap-2 px-4 pb-4 text-sm text-muted-foreground"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{analysisBacklog.waiting > 0 ? 'AI is reviewing your saved transactions. New questions will appear here.' : recordSummary.pendingCount > 0 ? 'Waiting for your bank to post transactions. Reviews will appear here.' : 'No open transaction tasks. Keep your records current as new activity arrives.'}</p>}
            </section>
          </div>
          <AnalysisStatusNotice waiting={analysisBacklog.waiting} outcome={topOutcome?.outcome ?? null} count={topOutcome?.count ?? 0}
            accountIds={topOutcome?.accountIds ?? []} onReview={() => onNavigate('review-transactions')} />
          <QuickActionsBar onNavigate={onNavigate} needsReviewCount={categoryReviews.length} needsAnalysisCount={categoriesNeedingAnalysis} />

          <details className="group rounded-xl border border-border/70 bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
              Activity, insights & tax checklist
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid items-start gap-3 border-t p-3 lg:grid-cols-2 [&_button]:min-h-11 [&_button[aria-label]]:min-w-11">
              <div className="min-w-0 space-y-3">
                <RecentActivityCard transactions={transactions} onTransactionClick={onTransactionClick} onViewAll={() => onNavigate('transactions')} />
                <ActionItemsBanner
                  profile={profile}
                  transactions={transactions}
                  onNavigate={onNavigate}
                />
                <button type="button" onClick={() => onNavigate('action-items')} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 text-sm text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  View full checklist <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                {!taxRateDisplay.reviewMessage && <AiAdvisoryCard
                  needsReviewCount={needsReviewCount}
                  needsAnalysisCount={needsAnalysisCount}
                  confirmedCount={recordSummary.deductibleCount}
                  onNavigate={onNavigate}
                />}
                <OptimizationCard
                  needsReviewCount={needsReviewCount}
                  totalTransactions={transactions.length}
                  deductibleCount={recordSummary.deductibleCount}
                  pendingCount={recordSummary.pendingCount}
                  onNavigate={onNavigate}
                />
              </div>
              <div className="space-y-3 min-w-0">
                <AnalyticsPanel transactions={transactions} />
                <TopCategoriesCard
                  categories={recordSummary.categoryEntries}
                  totalMagnitude={recordSummary.categoryMagnitude}
                  reviewMessage={recordSummary.categoryIssue}
                  onViewAll={() => onNavigate('categories')}
                />
              </div>
            </div>
          </details>

          <div className="[&_button]:min-h-[44px]">
            <HistoricalAccessUpgradeCard variant="slim" />
          </div>
        </div>
      </div>
    </>
  );
}
