import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer, updateTransactionServerWithUserId } from '@/lib/firebase/transactions-server';

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🔧 [Fix Analysis] Starting analysis fix for user: ${user.uid}`);

    // Get all transactions for the user
    const { data: allTransactions, error: transactionsError } = await getTransactionsServer(user.uid);
    
    if (transactionsError) {
      console.error('❌ Error fetching transactions:', transactionsError);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    // Filter for transactions that need review (is_deductible = null)
    const needsReviewTransactions = allTransactions.filter(t => t.is_deductible === null);
    
    console.log(`📊 [Fix Analysis] Found ${needsReviewTransactions.length} transactions needing review`);

    let fixedCount = 0;
    let needsReanalysisCount = 0;
    const results = [];

    for (const transaction of needsReviewTransactions) {
      console.log(`🔍 [Fix Analysis] Checking transaction: ${transaction.merchant_name} (${transaction.trans_id})`);
      
      // Check if transaction has analysis data but it's not displaying properly
      const hasAnalysisData = transaction.deduction_score !== undefined && transaction.deduction_score !== null;
      const hasReason = transaction.deductible_reason && transaction.deductible_reason.trim() !== '';
      
      console.log(`   - Has deduction_score: ${hasAnalysisData} (${transaction.deduction_score})`);
      console.log(`   - Has deductible_reason: ${hasReason}`);
      
      if (hasAnalysisData && !hasReason) {
        console.log(`   ⚠️  Transaction has analysis score but no reason - needs re-analysis`);
        needsReanalysisCount++;
        
        // Clear the analysis data so it gets re-analyzed
        try {
          const { error: updateError } = await updateTransactionServerWithUserId(user.uid, transaction.trans_id, {
            deduction_score: undefined,
            deductible_reason: undefined,
            analysisStatus: 'pending' // Mark for re-analysis
          });
          
          if (updateError) {
            console.error(`   ❌ Failed to update transaction ${transaction.trans_id}:`, updateError);
            results.push({
              transaction_id: transaction.trans_id,
              merchant_name: transaction.merchant_name,
              status: 'error',
              error: updateError
            });
          } else {
            console.log(`   ✅ Cleared analysis data for re-analysis`);
            fixedCount++;
            results.push({
              transaction_id: transaction.trans_id,
              merchant_name: transaction.merchant_name,
              status: 'fixed',
              action: 'cleared_for_reanalysis'
            });
          }
        } catch (error) {
          console.error(`   ❌ Exception updating transaction ${transaction.trans_id}:`, error);
          results.push({
            transaction_id: transaction.trans_id,
            merchant_name: transaction.merchant_name,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } else if (hasAnalysisData && hasReason) {
        console.log(`   ✅ Transaction already has proper analysis data`);
        results.push({
          transaction_id: transaction.trans_id,
          merchant_name: transaction.merchant_name,
          status: 'ok',
          action: 'already_has_analysis'
        });
      } else {
        console.log(`   ℹ️  Transaction has no analysis data - will be analyzed normally`);
        results.push({
          transaction_id: transaction.trans_id,
          merchant_name: transaction.merchant_name,
          status: 'pending',
          action: 'needs_initial_analysis'
        });
      }
    }

    console.log(`📊 [Fix Analysis] Fix Summary:`);
    console.log(`   - Total transactions checked: ${needsReviewTransactions.length}`);
    console.log(`   - Transactions fixed: ${fixedCount}`);
    console.log(`   - Transactions needing re-analysis: ${needsReanalysisCount}`);

    return NextResponse.json({
      success: true,
      summary: {
        total_checked: needsReviewTransactions.length,
        fixed: fixedCount,
        needs_reanalysis: needsReanalysisCount,
        already_ok: results.filter(r => r.status === 'ok').length,
        pending_initial: results.filter(r => r.status === 'pending').length,
        errors: results.filter(r => r.status === 'error').length
      },
      results: results,
      message: fixedCount > 0 
        ? `Successfully fixed ${fixedCount} transactions. They will be re-analyzed and should display their analysis properly.`
        : 'No transactions needed fixing. All analysis data is properly stored.'
    });

  } catch (error) {
    console.error('❌ [Fix Analysis] Error fixing transaction analysis:', error);
    return NextResponse.json(
      { error: 'Internal server error during analysis fix' },
      { status: 500 }
    );
  }
}
