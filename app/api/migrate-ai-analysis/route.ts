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

    console.log(`🔄 [Migration] Starting AI analysis migration for user: ${user.uid}`);

    // Get all transactions for the user
    const { data: allTransactions, error: transactionsError } = await getTransactionsServer(user.uid);
    
    if (transactionsError) {
      console.error('❌ Error fetching transactions:', transactionsError);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    let migratedCount = 0;
    const results = [];

    for (const transaction of allTransactions) {
      console.log(`🔍 [Migration] Checking transaction: ${transaction.merchant_name} (${transaction.trans_id})`);
      
      // Check if transaction has deductible_reason but no ai_analysis
      const hasDeductibleReason = transaction.deductible_reason && transaction.deductible_reason.trim() !== '';
      const hasAiAnalysis = transaction.ai_analysis && transaction.ai_analysis.trim() !== '';
      
      console.log(`   - Has deductible_reason: ${hasDeductibleReason}`);
      console.log(`   - Has ai_analysis: ${hasAiAnalysis}`);
      
      if (hasDeductibleReason && !hasAiAnalysis) {
        // Check if the deductible_reason looks like AI analysis (not user classification)
        const isUserClassification = transaction.deductible_reason?.includes('Classified as') ||
                                    transaction.deductible_reason?.includes('by user');
        
        if (!isUserClassification) {
          console.log(`   ✅ Migrating AI analysis for ${transaction.merchant_name}`);
          
          try {
            const { error: updateError } = await updateTransactionServerWithUserId(user.uid, transaction.trans_id, {
              ai_analysis: transaction.deductible_reason
            });
            
            if (updateError) {
              console.error(`   ❌ Failed to migrate transaction ${transaction.trans_id}:`, updateError);
              results.push({
                transaction_id: transaction.trans_id,
                merchant_name: transaction.merchant_name,
                status: 'error',
                error: updateError
              });
            } else {
              console.log(`   ✅ Successfully migrated AI analysis for ${transaction.merchant_name}`);
              migratedCount++;
              results.push({
                transaction_id: transaction.trans_id,
                merchant_name: transaction.merchant_name,
                status: 'migrated',
                ai_analysis: transaction.deductible_reason
              });
            }
          } catch (error) {
            console.error(`   ❌ Exception migrating transaction ${transaction.trans_id}:`, error);
            results.push({
              transaction_id: transaction.trans_id,
              merchant_name: transaction.merchant_name,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        } else {
          console.log(`   ⏭️  Skipping user classification: ${transaction.deductible_reason}`);
          results.push({
            transaction_id: transaction.trans_id,
            merchant_name: transaction.merchant_name,
            status: 'skipped',
            reason: 'user_classification'
          });
        }
      } else if (hasAiAnalysis) {
        console.log(`   ✅ Already has AI analysis`);
        results.push({
          transaction_id: transaction.trans_id,
          merchant_name: transaction.merchant_name,
          status: 'already_migrated'
        });
      } else {
        console.log(`   ℹ️  No analysis to migrate`);
        results.push({
          transaction_id: transaction.trans_id,
          merchant_name: transaction.merchant_name,
          status: 'no_analysis'
        });
      }
    }

    console.log(`📊 [Migration] Migration Summary:`);
    console.log(`   - Total transactions checked: ${allTransactions.length}`);
    console.log(`   - Transactions migrated: ${migratedCount}`);

    return NextResponse.json({
      success: true,
      summary: {
        total_checked: allTransactions.length,
        migrated: migratedCount,
        already_migrated: results.filter(r => r.status === 'already_migrated').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        no_analysis: results.filter(r => r.status === 'no_analysis').length,
        errors: results.filter(r => r.status === 'error').length
      },
      results: results,
      message: migratedCount > 0 
        ? `Successfully migrated ${migratedCount} transactions. AI analysis is now preserved separately from user classifications.`
        : 'No transactions needed migration. All AI analysis is already properly stored.'
    });

  } catch (error) {
    console.error('❌ [Migration] Error migrating AI analysis:', error);
    return NextResponse.json(
      { error: 'Internal server error during migration' },
      { status: 500 }
    );
  }
}
