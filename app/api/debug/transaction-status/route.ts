export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserSubscriptionStatus, userHasHistoricalAccess } from '@/lib/subscriptions/trial-manager';
import { getTransactionDateRange } from '@/lib/subscriptions/historical-access';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Debug endpoint to check transaction status, subscription, and date ranges
 * Helps diagnose issues with missing transactions
 */
export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.uid;

    // 1. Get subscription status
    const subscriptionStatus = await getUserSubscriptionStatus(userId);
    const hasHistoricalAccess = await userHasHistoricalAccess(userId);
    const dateRange = await getTransactionDateRange(userId);

    // 2. Get user profile data
    const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
    const userData = userDoc.data();

    // 3. Get all transactions
    const { data: allTransactions, error: transactionsError } = await getTransactionsServer(userId);

    // 4. Calculate transaction date range
    let oldestTransaction: Date | null = null;
    let newestTransaction: Date | null = null;
    let transactionCountByMonth: Record<string, number> = {};

    if (allTransactions && allTransactions.length > 0) {
      const dates = allTransactions
        .map(t => t.date ? new Date(t.date) : null)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());

      if (dates.length > 0) {
        oldestTransaction = dates[0];
        newestTransaction = dates[dates.length - 1];

        // Count transactions by month
        allTransactions.forEach(t => {
          if (t.date) {
            const date = new Date(t.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            transactionCountByMonth[monthKey] = (transactionCountByMonth[monthKey] || 0) + 1;
          }
        });
      }
    }

    // 5. Calculate expected date range
    const now = new Date();
    const expectedStartDate = new Date(now);
    expectedStartDate.setDate(expectedStartDate.getDate() - dateRange);

    // 6. Get account information
    const accountsSnapshot = await adminDb
      .collection('user_profiles')
      .doc(userId)
      .collection('accounts')
      .get();

    const accounts = accountsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 7. Count transactions per account
    const transactionsPerAccount: Record<string, number> = {};
    for (const account of accounts) {
      try {
        const txSnapshot = await adminDb
          .collection('user_profiles')
          .doc(userId)
          .collection('accounts')
          .doc(account.id)
          .collection('transactions')
          .get();
        transactionsPerAccount[account.id] = txSnapshot.size;
      } catch (error) {
        transactionsPerAccount[account.id] = 0;
      }
    }

    // 8. Check if transactions are within expected range
    const transactionsInRange = allTransactions?.filter(t => {
      if (!t.date) return false;
      const txDate = new Date(t.date);
      return txDate >= expectedStartDate && txDate <= now;
    }) || [];

    return NextResponse.json({
      success: true,
      debug: {
        userId,
        timestamp: new Date().toISOString(),

        // Subscription & Access
        subscription: {
          status: subscriptionStatus.status,
          isTrialActive: subscriptionStatus.isTrialActive,
          isPaidActive: subscriptionStatus.isPaidActive,
          hasAccess: subscriptionStatus.hasAccess,
          hasHistoricalAccess,
          trialStart: subscriptionStatus.trialStart?.toISOString(),
          trialEnd: subscriptionStatus.trialEnd?.toISOString(),
          subscriptionEnd: subscriptionStatus.subscriptionEnd?.toISOString(),
          userProfileData: {
            subscriptionStatus: userData?.subscriptionStatus,
            hasHistoricalAccess: userData?.hasHistoricalAccess,
            trialStart: userData?.trialStart?.toDate?.()?.toISOString(),
            trialEnd: userData?.trialEnd?.toDate?.()?.toISOString(),
            subscriptionEnd: userData?.subscriptionEnd?.toDate?.()?.toISOString(),
          },
        },

        // Date Range
        dateRange: {
          days: dateRange,
          expectedStartDate: expectedStartDate.toISOString(),
          expectedEndDate: now.toISOString(),
          isHistoricalAccess: dateRange >= 365,
        },

        // Transactions
        transactions: {
          totalCount: allTransactions?.length || 0,
          inRangeCount: transactionsInRange.length,
          oldestTransaction: oldestTransaction?.toISOString() || null,
          newestTransaction: newestTransaction?.toISOString() || null,
          countByMonth: transactionCountByMonth,
          error: transactionsError ? String(transactionsError) : null,
        },

        // Accounts
        accounts: {
          count: accounts.length,
          details: accounts.map(acc => ({
            id: acc.id,
            name: acc.name || acc.official_name || 'Unknown',
            transactionCount: transactionsPerAccount[acc.id] || 0,
          })),
        },

        // Analysis
        analysis: {
          expectedTransactionCount: 'Unknown (depends on bank data)',
          actualTransactionCount: allTransactions?.length || 0,
          dateRangeCoverage: oldestTransaction && newestTransaction
            ? Math.ceil((newestTransaction.getTime() - oldestTransaction.getTime()) / (1000 * 60 * 60 * 24))
            : 0,
          isDateRangeComplete: oldestTransaction
            ? oldestTransaction <= expectedStartDate
            : false,
          recommendations: [
            ...(dateRange < 365 && !hasHistoricalAccess
              ? ['User does not have historical access. Start a free trial to get 365 days of access.']
              : []),
            ...(oldestTransaction && oldestTransaction > expectedStartDate
              ? [`Oldest transaction (${oldestTransaction.toISOString()}) is newer than expected start date (${expectedStartDate.toISOString()}). Consider re-importing transactions.`]
              : []),
            ...(allTransactions && allTransactions.length < 100
              ? ['Transaction count seems low. Consider checking if all accounts are connected and transactions are imported.']
              : []),
          ],
        },
      },
    });
  } catch (error: any) {
    console.error('Error in debug transaction status endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get debug information',
        details: error.stack,
      },
      { status: 500 }
    );
  }
}
