import { NextRequest, NextResponse } from 'next/server';
import { updateTransactionServerWithUserId } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { aiLearningEngine } from '@/lib/ai/learning-engine';
import { adminDb } from '@/lib/firebase/admin';

// Helper function to normalize transaction document
function normalizeDoc(doc: any): any {
  const data = doc.data();
  return {
    id: data.trans_id || doc.id,
    trans_id: data.trans_id || doc.id,
    merchant_name: data.merchant_name || '',
    amount: data.amount || 0,
    category: data.category || '',
    date: data.date || '',
    type: data.amount < 0 ? 'income' : 'expense',
    is_deductible: data.is_deductible,
    deductible_reason: data.deductible_reason || null,
    deduction_score: data.deduction_score || null,
    ai_analysis: data.ai_analysis || null,
    user_classification_reason: data.user_classification_reason || null,
    description: data.description,
    notes: data.notes,
    account_id: data.account_id,
    userId: data.userId || data.user_id,
    analyzed: data.analyzed,
    analysisStatus: data.analysis_status || data.analysisStatus,
    transactionHash: data.transactionHash,
    analysisStartedAt: data.analysisStartedAt,
    analysisCompletedAt: data.analysisCompletedAt,
    created_at: data.created_at,
    updated_at: data.updated_at,
    ai: data.ai || null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [API GET Transaction] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: transactionId } = await params;
    console.log('🔍 [API GET Transaction] Fetching transaction:', transactionId, 'for user:', user.uid);

    // Strategy 1: Try collectionGroup query with userId and trans_id
    try {
      const transactionsQuery = adminDb
        .collectionGroup('transactions')
        .where('userId', '==', user.uid)
        .where('trans_id', '==', transactionId)
        .limit(1);

      const querySnapshot = await transactionsQuery.get();

      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const transaction = normalizeDoc(doc);
        console.log('✅ [API GET Transaction] Found transaction via collectionGroup query');
        return NextResponse.json({ transaction });
      }
    } catch (error) {
      console.warn('⚠️ [API GET Transaction] CollectionGroup query failed:', error);
    }

    // Strategy 2: Try collectionGroup with user_id (snake_case)
    try {
      const transactionsQuery = adminDb
        .collectionGroup('transactions')
        .where('user_id', '==', user.uid)
        .where('trans_id', '==', transactionId)
        .limit(1);

      const querySnapshot = await transactionsQuery.get();

      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const transaction = normalizeDoc(doc);
        console.log('✅ [API GET Transaction] Found transaction via collectionGroup (user_id) query');
        return NextResponse.json({ transaction });
      }
    } catch (error) {
      console.warn('⚠️ [API GET Transaction] CollectionGroup (user_id) query failed:', error);
    }

    // Strategy 3: Fallback - search through user's accounts
    try {
      const accountsSnapshot = await adminDb
        .collection('user_profiles')
        .doc(user.uid)
        .collection('accounts')
        .get();

      for (const accountDoc of accountsSnapshot.docs) {
        const accountId = accountDoc.id;
        const transactionsSnapshot = await adminDb
          .collection('user_profiles')
          .doc(user.uid)
          .collection('accounts')
          .doc(accountId)
          .collection('transactions')
          .get();

        const targetTransaction = transactionsSnapshot.docs.find((doc) => {
          const data = doc.data();
          return data.trans_id === transactionId || doc.id === transactionId;
        });

        if (targetTransaction) {
          const transaction = normalizeDoc(targetTransaction);
          console.log('✅ [API GET Transaction] Found transaction via account search');
          return NextResponse.json({ transaction });
        }
      }
    } catch (error) {
      console.warn('⚠️ [API GET Transaction] Account search failed:', error);
    }

    console.log('❌ [API GET Transaction] Transaction not found:', transactionId);
    return NextResponse.json(
      { error: 'Transaction not found' },
      { status: 404 }
    );

  } catch (error) {
    console.error('❌ [API GET Transaction] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

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
