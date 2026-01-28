export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    // Prefer checking `analysis_jobs` collection (where auto-analyze writes job docs).
    // This ensures the client sees the real job progress created by `/api/plaid/auto-analyze`.
    try {
      const jobsQuery = adminDb.collection('analysis_jobs').where('userId', '==', user.uid);
      // If an accountId is provided, narrow to that job to avoid ambiguity
      const jobsSnapshot = await jobsQuery.get();
      if (!jobsSnapshot.empty) {
        const activeJobs = jobsSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((job: any) => job.status === 'running' || job.status === 'pending')
          .filter((job: any) => (accountId ? job.accountId === accountId : true))
          .sort((a: any, b: any) => (b.startedAt?.seconds || 0) - (a.startedAt?.seconds || 0));

        if (activeJobs.length > 0) {
          const activeJob: any = activeJobs[0];
          console.log(`📊 [Analysis Status] Found active job (analysis_jobs): ${activeJob.id}`);
          return NextResponse.json({
            success: true,
            data: {
              overallStatus: 'analyzing',
              progress: {
                current: activeJob.processed || 0,
                total: activeJob.total || 0,
                percentage: activeJob.total > 0 ? Math.round(((activeJob.processed || 0) / activeJob.total) * 100) : 0
              },
              breakdown: {
                pending: (activeJob.total || 0) - (activeJob.processed || 0),
                running: 1,
                completed: activeJob.processed || 0,
                failed: activeJob.failed || 0
              },
              jobId: activeJob.id,
              summary: {
                totalTransactions: activeJob.total || 0,
                analyzedTransactions: activeJob.processed || 0,
                remainingTransactions: (activeJob.total || 0) - (activeJob.processed || 0),
                successRate: activeJob.total > 0 ? Math.round(((activeJob.processed || 0) / activeJob.total) * 100) : 0
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('⚠️ [Analysis Status] Failed to query analysis_jobs collection, falling back to analysis_status. Error:', e);
    }

    // If no active jobs, check transaction status directly
    const { data: allTransactions, error } = await getTransactionsServer(user.uid);

    if (error) {
      console.error('Error fetching transactions for analysis status:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    let transactions = allTransactions || [];
    console.log(`📊 [Analysis Status] Found ${transactions.length} total transactions for user ${user.uid}`);

    // Filter by account if specified
    if (accountId) {
      const beforeFilter = transactions.length;
      transactions = transactions.filter(t => t.account_id === accountId || t.accountId === accountId);
      console.log(`📊 [Analysis Status] Filtered to ${transactions.length} transactions for account ${accountId} (was ${beforeFilter})`);
    }

    // Calculate analysis status
    const pending = transactions.filter(t => 
      t.analysisStatus === 'pending' || 
      t.analysisStatus === undefined || 
      t.analysisStatus === null ||
      (t.analyzed === false && t.analysisStatus !== 'completed' && t.analysisStatus !== 'failed')
    ).length;
    
    const running = transactions.filter(t => t.analysisStatus === 'running').length;
    const completed = transactions.filter(t => 
      t.analysisStatus === 'completed' || 
      (t.analyzed === true && t.analysisStatus !== 'failed')
    ).length;
    const failed = transactions.filter(t => t.analysisStatus === 'failed').length;

    const total = pending + running + completed + failed;
    const current = completed + failed;

    // Debug logging
    console.log(`📊 [Analysis Status] Account ${accountId}: ${total} total, ${pending} pending, ${running} running, ${completed} completed, ${failed} failed`);
    if (transactions.length > 0) {
      console.log(`🔍 [Analysis Status] Sample transactions:`, transactions.slice(0, 3).map(t => ({
        trans_id: t.trans_id,
        merchant_name: t.merchant_name,
        analysisStatus: t.analysisStatus,
        analyzed: t.analyzed
      })));
    }

    // Find currently analyzing transaction
    const currentlyAnalyzing = transactions.find(t => t.analysisStatus === 'running');

    // Calculate progress percentage
    const progressPercentage = total > 0 ? Math.round((current / total) * 100) : 0;

    // Determine overall status
    let overallStatus = 'idle';
    if (total === 0) {
      overallStatus = 'no_transactions';
    } else if (pending > 0 || running > 0) {
      overallStatus = 'analyzing';
    } else if (completed > 0) {
      overallStatus = 'completed';
    }

    return NextResponse.json({
      success: true,
      data: {
        overallStatus,
        progress: {
          current,
          total,
          percentage: progressPercentage
        },
        breakdown: {
          pending,
          running,
          completed,
          failed
        },
        currentlyAnalyzing: currentlyAnalyzing ? {
          id: currentlyAnalyzing.id,
          merchant_name: currentlyAnalyzing.merchant_name || (currentlyAnalyzing as any).name || 'Unknown',
          amount: currentlyAnalyzing.amount,
          category: currentlyAnalyzing.category
        } : null,
        summary: {
          totalTransactions: total,
          analyzedTransactions: current,
          remainingTransactions: pending + running,
          successRate: total > 0 ? Math.round((completed / total) * 100) : 0
        }
      }
    });

  } catch (error) {
    console.error('Error in analysis status API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
