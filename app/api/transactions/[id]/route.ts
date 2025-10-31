import { NextRequest, NextResponse } from 'next/server';
import { updateTransactionServerWithUserId } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { aiLearningEngine } from '@/lib/ai/learning-engine';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [API UPDATE→DB] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: transactionId } = await params;
    const updates = await request.json();

    console.log('🔄 [API UPDATE→DB] Updating transaction:', transactionId, updates);

    // Check if this is a correction (user overriding AI analysis)
    const isCorrection = updates.is_deductible !== undefined || 
                        updates.deductible_reason !== undefined ||
                        updates.user_classification_reason !== undefined;

    let originalAnalysis = null;
    if (isCorrection) {
      // Get original transaction data to capture the original AI analysis
      try {
        const { getTransactionServer } = await import('@/lib/firebase/transactions-server');
        const { data: originalTransaction } = await getTransactionServer(user.uid, transactionId);
        if (originalTransaction) {
          originalAnalysis = {
            is_deductible: originalTransaction.is_deductible,
            confidence: originalTransaction.deduction_score,
            reasoning: originalTransaction.deductible_reason || originalTransaction.ai?.reasoning
          };
        }
      } catch (error) {
        console.warn('⚠️ [API UPDATE→DB] Could not get original analysis for learning:', error);
      }
    }

    // Update the transaction using Firebase server function
    const { data, error } = await updateTransactionServerWithUserId(user.uid, transactionId, updates);

    if (error) {
      console.error('❌ [API UPDATE→DB] Update failed:', error);
      return NextResponse.json(
        { error: 'Update failed', details: error.message },
        { status: 500 }
      );
    }

    // Record correction for AI learning if this was a user override
    if (isCorrection && originalAnalysis && data) {
      try {
        await aiLearningEngine.recordCorrection(
          user.uid,
          transactionId,
          data,
          originalAnalysis,
          {
            isDeductible: updates.is_deductible !== undefined ? updates.is_deductible : data.is_deductible,
            reasoning: updates.deductible_reason || updates.user_classification_reason
          }
        );
        console.log('✅ [AI Learning] Recorded correction for learning');
      } catch (error) {
        console.warn('⚠️ [AI Learning] Could not record correction:', error);
      }
    }

    console.log('✅ [API UPDATE→DB] Update successful:', data);

    return NextResponse.json({
      success: true,
      transaction: data
    });

  } catch (error) {
    console.error('❌ [API UPDATE→DB] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    );
  }
}
