"use client";

import dynamic from "next/dynamic";
import { useAuth } from "@/lib/firebase/auth-context";
import { getUserProfile } from "@/lib/firebase/profiles";
import { profileLookupState } from "@/lib/onboarding/profile";
import { notifyProfileUpdated } from "@/lib/onboarding/profile-events";
import { protectedScreen, protectedScreenUrl, previousProtectedScreen, type ProtectedScreen } from "@/lib/navigation/protected-screens";
import { Button } from "@/components/ui/button";
import { ProfileSetupScreen } from "@/components/profile-setup-screen";
import DashboardScreen from "@/components/dashboard-screen";
import { SettingsScreen } from "@/components/settings-screen";
import { AddExpenseScreen } from "@/components/add-expense-screen";
import { ReceiptUploadScreen } from "@/components/receipt-upload-screen";
import { TaxCalendarScreen } from "@/components/tax-calendar-screen";
import { TransactionDetailScreen } from "@/components/transaction-detail-screen";
import { ReviewTransactionsScreen } from "@/components/review-transactions-screen";
import { DeductionsDetailScreen } from "@/components/deductions-detail-screen";
import { ExpensesDetailScreen } from "@/components/expenses-detail-screen";
import { BanksDetailScreen } from "@/components/banks-detail-screen";
import { CategoriesScreen } from "@/components/categories-screen";
import { PlaidLinkScreen } from "@/components/plaid-link-screen";
import { PlaidScreen } from "@/components/plaid-screen";
import { AIInsightsPage } from "@/components/ai-insights-page";
import { TaxEducationModal } from "@/components/tax-education-modal";
import { MobileQuickActions } from "@/components/mobile-quick-actions";
import { ProfitLossReportScreen } from "@/components/profit-loss-report-screen";
import { QuarterlyPaymentTrackingScreen } from "@/components/quarterly-payment-tracking-screen";
import { ActionItemsScreen } from "@/components/action-items-screen";

const ScheduleCExportScreen = dynamic(
  () => import("@/components/schedule-c-export-screen").then((m) => m.ScheduleCExportScreen || m.default),
  { ssr: false }
);
const TaxAssistantScreen = dynamic(
  () => import("@/components/tax-assistant-screen").then((m) => m.TaxAssistantScreen || m.default),
  { ssr: false }
);
const MileageTrackerScreen = dynamic(
  () => import("@/components/mileage-tracker-screen").then((m) => m.MileageTrackerScreen || m.default),
  { ssr: false }
);
const QuarterlyTaxCalculator = dynamic(
  () => import("@/components/quarterly-tax-calculator").then((m) => m.QuarterlyTaxCalculator || m.default),
  { ssr: false }
);
const IncomeTrackingScreen = dynamic(
  () => import("@/components/income-tracking-screen").then((m) => m.IncomeTrackingScreen || m.default),
  { ssr: false }
);
const TaxFormWizardScreen = dynamic(
  () => import("@/components/tax-form-wizard-screen").then((m) => m.TaxFormWizardScreen || m.default),
  { ssr: false }
);
const StateTaxCalculatorScreen = dynamic(
  () => import("@/components/state-tax-calculator-screen").then((m) => m.StateTaxCalculatorScreen || m.default),
  { ssr: false }
);
const AddManualTransactionScreen = dynamic(
  () => import("@/components/add-manual-transaction-screen").then((m) => m.AddManualTransactionScreen || m.default),
  { ssr: false }
);
const TaxFilingHubScreen = dynamic(
  () => import("@/components/tax-filing-hub-screen").then((m) => m.TaxFilingHubScreen || m.default),
  { ssr: false }
);
const TaxPreviewScreen = dynamic(
  () => import("@/components/tax-preview-screen").then((m) => m.TaxPreviewScreen || m.default),
  { ssr: false }
);
const DeductionsEntryScreen = dynamic(
  () => import("@/components/deductions-entry-screen").then((m) => m.DeductionsEntryScreen || m.default),
  { ssr: false }
);
const Form8879Screen = dynamic(
  () => import("@/components/form-8879-screen").then((m) => m.Form8879Screen || m.default),
  { ssr: false }
);
const DocumentImportScreen = dynamic(
  () => import("@/components/document-import-screen").then((m) => m.DocumentImportScreen || m.default),
  { ssr: false }
);
const W2IncomeScreen = dynamic(
  () => import("@/components/w2-income-screen").then((m) => m.W2IncomeScreen || m.default),
  { ssr: false }
);
const TaxOrganizerScreen = dynamic(
  () => import("@/components/tax-organizer-screen").then((m) => m.TaxOrganizerScreen || m.default),
  { ssr: false }
);
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransactions } from "@/lib/firebase/hooks";
import { useTransactionPolling } from "@/lib/hooks/use-transaction-polling";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";
import type { Transaction as FirebaseTransaction } from "@/lib/firebase/transactions";

interface UserProfile {
  email: string;
  name: string;
  profession: string | string[];
  income: string;
  state: string;
  filingStatus: string;
}

// Use Transaction type from firebase library
type Transaction = FirebaseTransaction;

export default function ProtectedPage() {
  const { user, loading } = useAuth();
  const [userProfile, setUserProfile] = useState<any>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [currentScreen, setCurrentScreen] = useState<ProtectedScreen>('dashboard');
  const [navigationStack, setNavigationStack] = useState<string[]>(['dashboard']);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<Transaction | null>(null);
  const [analyzingTransactions, setAnalyzingTransactions] = useState(false);
  const [bankConnected, setBankConnected] = useState(false);
  const [isEducationModalOpen, setIsEducationModalOpen] = useState(false);
  const [isMobileQuickActionsVisible, setIsMobileQuickActionsVisible] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigateScreen = (rawScreen: string) => {
    setCurrentScreen(protectedScreen(rawScreen));
    router.push(protectedScreenUrl(rawScreen));
  };

  // Use real-time transactions hook for instant updates
  const {
    transactions
  } = useTransactions(user?.id || '');

  // No background polling; rely on webhooks + one sync on visit when bank connected
  const {
    isSyncing: isPollingSync,
    lastSyncTime,
    syncNow: manualSync
  } = useTransactionPolling({
    interval: 2 * 60 * 60 * 1000, // 2 hours (fallback only if enabled)
    enabled: false, // Disabled: webhooks drive incremental sync; optional sync on mount below
    timeframe: '6months',
  });

  // One-time incremental sync when user lands on protected app with bank connected
  const hasSyncedOnVisitRef = useRef(false);
  useEffect(() => {
    // A real-data local preview can opt out of importing new bank activity on login.
    if (process.env.NEXT_PUBLIC_AUTO_SYNC_ON_VISIT === 'false') return;
    if (!bankConnected || !user?.id || hasSyncedOnVisitRef.current) return;
    hasSyncedOnVisitRef.current = true;
    makeAuthenticatedRequest('/api/plaid/sync-transactions', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id, incremental: true }),
    }).catch((err) => console.warn('[Protected] Sync on visit failed:', err));
  }, [bankConnected, user?.id]);

  // Force re-renders when transactions are updated
  useEffect(() => {
    // This will trigger a re-render whenever transactions are updated
    console.log('🔄 Transactions updated, forcing re-render');
  }, [transactions]);

  // Transaction state is now managed by useTransactionState hook

  // Check bank connection and fetch transactions
  const checkBankConnectionAndFetchTransactions = async (currentUser: any) => {
    try {
      // Check the server-managed bank connection status
      const { data: profile, error } = await getUserProfile(currentUser.id);

      if (profile?.bankConnected) {
        setBankConnected(true);
        // Only sync transactions if explicitly requested, not on every page load
        // This prevents the massive slowdown on home screen
        console.log('✅ Bank connected - transactions will be synced on demand');

        // Transactions are now automatically managed by useTransactionState
      } else {
        setBankConnected(false);
        // Transactions are now automatically managed by useTransactionState
      }
    } catch (error) {
      console.error('Error checking bank connection:', error);
      setBankConnected(false);
      // Transactions are now automatically managed by useTransactionState
    }
  };

  useEffect(() => {
    if (loading) return;
    let current = true;
    if (!user?.id) {
      setHasProfile(null);
      setUserProfile(null);
      setBankConnected(false);
      setProfileLoadError(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setProfileLoadError(false);
    const checkUserAndProfile = async () => {
      try {
        const { data: profile, error } = await getUserProfile(user.id);
        if (!current) return;
        const state = profileLookupState(profile, error);
        if (state === 'error') {
          setProfileLoadError(true);
          return;
        }
        setHasProfile(state === 'existing');
        setUserProfile(profile);
        setBankConnected(Boolean(profile?.bankConnected));
      } catch {
        if (current) setProfileLoadError(true);
      } finally {
        if (current) setIsLoading(false);
      }
    };
    void checkUserAndProfile();
    return () => { current = false; };
  }, [user?.id, loading, profileRetry]);

  // Refresh transactions when navigating to dashboard
  // Real-time updates are handled automatically by useTransactions hook

  // URL changes drive the displayed screen. Data refreshes never append history,
  // and a late transaction request cannot reopen a screen after the user leaves it.
  useEffect(() => {
    const screen = protectedScreen(searchParams.get('screen'));
    const transactionId = searchParams.get('transactionId');
    setCurrentScreen(screen);
    if (screen !== 'transaction-detail' || !transactionId) return;
    const transaction = transactions.find(t => t.id === transactionId || t.trans_id === transactionId);
    if (transaction) {
      setViewingTransaction(transaction);
      return;
    }
    setViewingTransaction(null);
    const controller = new AbortController();
    const loadTransaction = async () => {
      try {
        const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted && data.transaction) {
          const fetched = data.transaction;
          setViewingTransaction({ ...fetched, trans_id: fetched.trans_id || fetched.id, id: fetched.id || fetched.trans_id });
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error('Could not load transaction', error);
      }
    };
    void loadTransaction();
    return () => controller.abort();
  }, [searchParams, transactions]);

  const handleProfileComplete = async (profile: UserProfile, redirectTo?: string) => {
    console.log('Profile setup completed:', profile);
    setHasProfile(true);

    // Fetch the complete profile from database to ensure we have all fields
    if (user) {
      notifyProfileUpdated(user.id);
      try {
        const { data: userProfile, error: profileError } = await getUserProfile(user.id);

        if (profileError) {
          console.error('Error fetching user profile after completion:', profileError);
        } else {
          console.log('✅ User profile loaded after completion:', userProfile);
          setUserProfile(userProfile);
        }

        // Check bank connection and fetch transactions after profile completion
        await checkBankConnectionAndFetchTransactions(user);

        // Redirect to specified screen if provided
        if (redirectTo) {
          console.log(`🔄 Redirecting to ${redirectTo} after profile completion`);
          navigateScreen(redirectTo);
        }
      } catch (error) {
        console.error('Error in handleProfileComplete:', error);
      }
    }
  };

  // Handle Plaid connection success
  const handlePlaidConnectionSuccess = async () => {
    if (user) {
      try {
        // Refresh the safe server-managed bank connection status
        const { data: userProfile, error: profileError } = await getUserProfile(user.id);

        if (!profileError && userProfile) {
          setUserProfile(userProfile);
          setBankConnected(userProfile.bankConnected === true);
          notifyProfileUpdated(user.id);

          // If this is the first Plaid connection and Plaid guide hasn't been shown,
          // trigger the Plaid guide tutorial
          if (userProfile.bankConnected && !userProfile.onboardingPlaidGuideCompleted) {
            // Small delay to ensure the profile update is processed
            setTimeout(() => {
              const plaidGuideButton = document.getElementById('open-plaid-guide');
              if (plaidGuideButton) {
                plaidGuideButton.click();
              }
            }, 1000);
          }
        }

        // Update bank connection status
        setBankConnected(true);
        // Transactions are now automatically managed by useTransactionState

        // Navigate to review transactions screen to show the newly synced transactions
        navigateScreen('review-transactions');
      } catch (error) {
        console.error('Error handling Plaid connection success:', error);
      }
    }
  };

  const handleBack = async () => {
    // Navigate back to the previous page or dashboard
    try {
      // Try to go back in browser history first
      if (window.history.length > 1) {
        router.back();
      } else {
        // Fallback to dashboard if no history
        router.push('/protected');
      }
    } catch (error) {
      console.error('Error navigating back:', error);
      // Final fallback to dashboard
      router.push('/protected');
    }
  };

  const handleNavigate = (rawScreen: string) => {
    if (rawScreen === 'mobile-actions') {
      setIsMobileQuickActionsVisible(visible => !visible);
      return;
    }
    const screen = protectedScreen(rawScreen);
    if (screen === 'add-expense') setEditingTransaction(null);
    if (screen !== currentScreen) setNavigationStack(previous => [...previous, currentScreen]);
    navigateScreen(rawScreen);
  };

  const handleGoBack = () => {
    const previous = previousProtectedScreen(currentScreen, navigationStack, searchParams.get('from'));
    setNavigationStack(previous.stack);
    navigateScreen(previous.screen);
  };

  // Handle viewing transaction details
  const handleViewTransaction = (transaction: Transaction & { _source?: string }, initialSection?: 'details') => {
    // Use the source information if available, otherwise use current screen
    const sourceScreen = transaction._source || currentScreen;
    console.log('Viewing transaction from source:', sourceScreen);

    // Add source screen to navigation stack before viewing transaction
    setNavigationStack(prev => [...prev, sourceScreen]);
    setViewingTransaction(transaction);
    setCurrentScreen('transaction-detail');

    // Update URL so the transaction detail can be opened directly and back-button works
    try {
      const transactionIdForUrl = (transaction as any).trans_id || transaction.id;
      const url = `/protected?screen=transaction-detail&transactionId=${encodeURIComponent(transactionIdForUrl)}&from=${encodeURIComponent(sourceScreen)}${initialSection === 'details' ? '&section=details' : ''}`;
      router.push(url);
    } catch (e) {
      console.error('Failed to push router state for transaction detail:', e);
    }
  };

  // Handle viewing transaction details from external pages (like /protected/transactions)
  const handleViewTransactionFromExternal = (transaction: Transaction, fromPage: string) => {
    console.log('Viewing transaction from external page:', fromPage);

    // Add the external page to navigation stack
    setNavigationStack(prev => [...prev, fromPage]);
    setViewingTransaction(transaction);
    setCurrentScreen('transaction-detail');

    // Update URL so the transaction detail can be opened directly and back-button works
    try {
      const transactionIdForUrl = (transaction as any).trans_id || transaction.id;
      const url = `/protected?screen=transaction-detail&transactionId=${encodeURIComponent(transactionIdForUrl)}&from=${encodeURIComponent(fromPage)}`;
      router.push(url);
    } catch (e) {
      console.error('Failed to push router state for transaction detail (external):', e);
    }
  };

  // Handle sign out
  const handleSignOut = async () => {
    try {
      const { signOutUser } = await import("@/lib/firebase/auth");
      await signOutUser();
      router.push("/");
    } catch (error) {
      console.error('Error signing out:', error);
      router.push("/");
    }
  };

  // Handle saving transactions - now handled by real-time updates
  const handleSaveTransaction = async (transaction: Transaction) => {
    // Real-time updates are handled automatically by the useTransactions hook
    // Just update the viewing transaction if it's the same one
    setViewingTransaction(prev => prev && prev.id === transaction.id ? transaction : prev);
  };

  // Handle editing a transaction
  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    navigateScreen('add-expense');
  };

  // Handle transaction update (for review screen) - now handled by real-time updates
  const handleTransactionUpdate = (updatedTransaction: Transaction) => {
    console.log('🔄 [UI RERENDER] Parent handleTransactionUpdate called for:', updatedTransaction.trans_id || updatedTransaction.id, 'is_deductible:', updatedTransaction.is_deductible);

    // Real-time updates are handled automatically by the useTransactions hook
    // Just update the viewing transaction if it's the same one
    setViewingTransaction(prev => {
      if (!prev) return null;
      const prevId = prev.trans_id || prev.id;
      const updatedId = updatedTransaction.trans_id || updatedTransaction.id;
      return prevId === updatedId ? { ...prev, ...updatedTransaction } : prev;
    });
  };

  // Handle receipt upload completion
  const handleReceiptUploadComplete = (transactionData: any) => {
    if (!transactionData) return;

    // Commit route returns the real Firestore transaction shape.
    const amount = Number(transactionData.amount ?? 0);
    const normalized: Transaction = {
      id: String(transactionData.id ?? transactionData.trans_id ?? Date.now().toString()),
      trans_id: String(transactionData.trans_id ?? transactionData.id ?? `receipt-${Date.now()}`),
      merchant_name: String(transactionData.merchant_name ?? transactionData.description ?? ''),
      amount,
      category: String(transactionData.category ?? 'other'),
      date: String(transactionData.date ?? ''),
      type: transactionData.type ?? (amount < 0 ? 'income' : 'expense'),
      is_deductible: transactionData.is_deductible ?? transactionData.isDeductible ?? null,
      notes:
        transactionData.notes ??
        `Receipt uploaded: ${transactionData.receipt_filename || transactionData.receipt_url || 'receipt.jpg'}`,
      receipt_url: transactionData.receipt_url,
      receipt_filename: transactionData.receipt_filename
    } as Transaction;

    // Update UI state so any transaction detail view can reflect the newest receipt.
    setViewingTransaction(normalized);
  };

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (user && profileLoadError) {
    return <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">We couldn&apos;t load your profile</h1>
        <p role="alert" className="text-muted-foreground">Check your connection and try again. Your saved details are safe.</p>
        <Button onClick={() => setProfileRetry(value => value + 1)}>Try again</Button>
      </div>
    </div>;
  }

  // Show profile setup screen if user hasn't completed their profile
  if (user && hasProfile === false) {
    return (
      <ProfileSetupScreen
        user={user}
        existingConsents={userProfile?.consents}
        onBack={handleBack}
        onComplete={handleProfileComplete}
      />
    );
  }

  // Show dashboard if user has completed profile setup
  if (user && hasProfile === true) {


    if (currentScreen === 'settings') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <SettingsScreen
          user={safeUser}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
          inAppNavigation={true}
        />
      );
    }

    if (currentScreen === 'add-expense') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <AddExpenseScreen
          user={safeUser}
          onBack={handleGoBack}
          onSave={handleSaveTransaction}
          editingExpense={editingTransaction}
        />
      );
    }

    if (currentScreen === 'receipt-upload') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <ReceiptUploadScreen
          user={safeUser}
          onBack={handleGoBack}
          onUploadComplete={handleReceiptUploadComplete}
        />
      );
    }

    if (currentScreen === 'tax-calendar') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <TaxCalendarScreen
          user={safeUser}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'ai-insights') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <AIInsightsPage
          user={safeUser}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'quarterly-taxes') {
      return (
        <div className="min-h-screen bg-gray-50">
          <div className="max-w-4xl mx-auto p-6">
            <div className="mb-6">
              <button
                onClick={handleGoBack}
                className="flex items-center gap-2 text-teal-600 hover:text-teal-700 mb-4"
              >
                ← Back
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Quarterly Tax Calculator</h1>
            </div>
            <QuarterlyTaxCalculator
              userProfile={userProfile}
              transactions={transactions}
            />
          </div>
        </div>
      );
    }



    if (currentScreen === 'review-transactions') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <ReviewTransactionsScreen
          user={safeUser}
          focusedTransactionId={searchParams.get('transactionId')}
          onBack={handleGoBack}
          transactions={transactions as any}
          onTransactionUpdate={handleTransactionUpdate as any}
          onTransactionClick={(transaction, initialSection) => {
            // Add source to transaction
            const transactionWithSource = {
              ...transaction,
              _source: 'review-transactions'
            };
            handleViewTransaction(transactionWithSource as any, initialSection);
          }}
        />
      );
    }

    if (currentScreen === 'schedule-c-export') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <ScheduleCExportScreen
          user={safeUser}
          onBack={handleGoBack}
          transactions={transactions}
        />
      );
    }

    if (currentScreen === 'deductions-detail') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <DeductionsDetailScreen
          user={safeUser}
          onBack={handleGoBack}
          transactions={transactions}
        />
      );
    }

    if (currentScreen === 'expenses-detail') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <ExpensesDetailScreen
          user={safeUser}
          onBack={handleGoBack}
          transactions={transactions}
        />
      );
    }

    if (currentScreen === 'banks-detail') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <BanksDetailScreen
          user={safeUser}
          onBack={handleGoBack}
          onConnectBank={(itemId) => {
            router.push(`/protected?screen=plaid-link&from=settings${itemId ? `&itemId=${encodeURIComponent(itemId)}` : ''}`);
          }}
        />
      );
    }

    if (currentScreen === 'categories') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <CategoriesScreen
          user={safeUser}
          onBack={handleGoBack}
          transactions={transactions}
          onTransactionClick={(transaction) => {
            // Ensure transaction has trans_id and add source
            const transactionWithSource = {
              ...transaction,
              trans_id: (transaction as any).trans_id || transaction.id,
              _source: 'categories'
            };
            handleViewTransaction(transactionWithSource as any);
          }}
        />
      );
    }

    if (currentScreen === 'plaid-link') {
      const safeUser = { ...user, email: user.email ?? undefined };
      // Check if this is from settings by checking the search params
      const isFromSettings = searchParams?.get('from') === 'settings';
      return (
        <PlaidLinkScreen
          user={safeUser}
          onSuccess={handlePlaidConnectionSuccess}
          onBack={handleGoBack}
          fromSettings={isFromSettings || false}
          updateItemId={searchParams.get('itemId') || undefined}
        />
      );
    }

    if (currentScreen === 'plaid') {
      const safeUser = { ...user, email: user.email ?? undefined };
      return (
        <PlaidScreen
          user={safeUser}
          onBack={handleGoBack}
          onConnect={() => handleNavigate('plaid-link')}
        />
      );
    }

    if (currentScreen === 'transaction-detail' && viewingTransaction) {
      return (
        <TransactionDetailScreen
          transaction={viewingTransaction}
          transactions={transactions as any}
          initialSection={searchParams.get('section') === 'details' ? 'details' : 'summary'}
          onBack={handleGoBack}
          onSave={handleSaveTransaction}
        />
      );
    }

    if (currentScreen === 'mileage-tracker') {
      return (
        <MileageTrackerScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'income-tracking') {
      return (
        <IncomeTrackingScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          initialTab={searchParams.get('tab')}
          initialYear={searchParams.get('year')}
        />
      );
    }

    if (currentScreen === 'tax-form-wizard') {
      return (
        <TaxFormWizardScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          userProfile={userProfile}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'state-tax-calculator') {
      return (
        <StateTaxCalculatorScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          userProfile={userProfile}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'tax-assistant') {
      return (
        <TaxAssistantScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          userProfile={userProfile}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'profit-loss-report' || currentScreen === 'profit-loss-detail') {
      return (
        <ProfitLossReportScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'action-items') {
      return (
        <ActionItemsScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
          profile={userProfile}
          transactions={transactions}
        />
      );
    }

    if (currentScreen === 'quarterly-payments') {
      return (
        <QuarterlyPaymentTrackingScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'add-manual-transaction') {
      return (
        <AddManualTransactionScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onSaved={() => handleNavigate('dashboard')}
        />
      );
    }

    if (currentScreen === 'tax-filing-hub') {
      return (
        <TaxFilingHubScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentScreen === 'w2-income') {
      return (
        <W2IncomeScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
        />
      );
    }

    if (currentScreen === 'tax-organizer') {
      return (
        <TaxOrganizerScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentScreen === 'tax-preview') {
      return (
        <TaxPreviewScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentScreen === 'deductions-entry') {
      return (
        <DeductionsEntryScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentScreen === 'form-8879') {
      return (
        <Form8879Screen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentScreen === 'document-import') {
      return (
        <DocumentImportScreen
          user={{ id: user.id, email: user.email ?? undefined }}
          onBack={handleGoBack}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentScreen === 'reports') {
      // For reports, we'll redirect to the reports page
      router.push('/protected/reports');
      return null;
    }

    return (
      <>
        <DashboardScreen
          profile={userProfile}
          transactions={transactions}
          onNavigate={handleNavigate}
          onTransactionClick={(transaction) => handleViewTransaction(transaction)}
          analyzingTransactions={analyzingTransactions}
          onSignOut={handleSignOut}
        />

        {/* Tax Education Modal */}
        <TaxEducationModal
          isOpen={isEducationModalOpen}
          onClose={() => setIsEducationModalOpen(false)}
          transaction={viewingTransaction ? {
            merchant_name: viewingTransaction.merchant_name,
            amount: viewingTransaction.amount,
            category: viewingTransaction.category,
            is_deductible: viewingTransaction.is_deductible ?? false,
            deductible_reason: viewingTransaction.deductible_reason,
            ai: viewingTransaction.ai ? {
              reasoning: viewingTransaction.ai.reasoning ?? undefined,
              irs: viewingTransaction.ai.irs ? {
                publication: viewingTransaction.ai.irs.publication ?? undefined,
                section: viewingTransaction.ai.irs.section ?? undefined
              } : undefined
            } : undefined
          } : undefined}
          userProfile={userProfile ? {
            profession: Array.isArray(userProfile.profession) ? userProfile.profession[0] || '' : userProfile.profession || '',
            business_entity_type: userProfile.businessEntityType || '',
            state: userProfile.state || ''
          } : undefined}
        />

        {/* Mobile Quick Actions */}
        <MobileQuickActions
          isVisible={isMobileQuickActionsVisible}
          onNavigate={handleNavigate}
          onAddExpense={() => handleNavigate('add-expense')}
          onTakePhoto={() => handleNavigate('receipt-upload')}
        />
      </>
    );
  }

  return null;
}
