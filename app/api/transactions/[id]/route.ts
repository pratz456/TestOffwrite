import { NextRequest, NextResponse } from 'next/server';
import { updateTransactionServerWithUserId } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { aiLearningEngine } from '@/lib/ai/learning-engine';
import { adminDb } from '@/lib/firebase/admin';
import { transactionIdInput, transactionUpdatesInput } from '@/lib/transactions/client-updates';

import { hydrateReviewTransaction } from '@/lib/transactions/review';

function normalizeDoc(doc: any): any {
  return hydrateReviewTransaction(doc.data(), doc.id);
}

function ownedDocument(doc: any, uid: string): boolean {
  const parts = doc.ref?.path?.split('/');
  const data = doc.data();
  return parts?.length === 6 && parts[0] === 'user_profiles' && parts[1] === uid &&
    parts[2] === 'accounts' && parts[4] === 'transactions' &&
    [data.userId, data.user_id].every(value => value == null || value === uid);
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
    if (!transactionIdInput.safeParse(transactionId).success) return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    console.log('🔍 [API GET Transaction] Fetching transaction:', transactionId, 'for user:', user.uid);

    // Strategy 1: Try collectionGroup query with userId and trans_id
    try {
      const transactionsQuery = adminDb
        .collectionGroup('transactions')
        .where('userId', '==', user.uid)
        .where('trans_id', '==', transactionId)
        .limit(1);

      const querySnapshot = await transactionsQuery.get();

      if (!querySnapshot.empty && ownedDocument(querySnapshot.docs[0], user.uid)) {
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

      if (!querySnapshot.empty && ownedDocument(querySnapshot.docs[0], user.uid)) {
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

        if (targetTransaction && ownedDocument(targetTransaction, user.uid)) {
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
      { error: 'Internal server error' },
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
    if (!transactionIdInput.safeParse(transactionId).success) return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    const parsed = transactionUpdatesInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Provide valid editable transaction fields. Ownership, amounts and AI fields cannot be changed here.' }, { status: 400 });
    const updates = parsed.data;

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
        { error: 'Update failed' },
        { status: 500 }
      );
    }

    const updatedTransaction = Array.isArray(data) ? data[0] : data;

    // Record correction for AI learning if this was a user override
    if (isCorrection && originalAnalysis && updatedTransaction && updates.is_deductible !== null) {
      try {
        await aiLearningEngine.recordCorrection(
          user.uid,
          transactionId,
          updatedTransaction,
          originalAnalysis,
          {
            isDeductible: updates.is_deductible !== undefined ? updates.is_deductible : updatedTransaction.is_deductible,
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
      transaction: updatedTransaction
    });

  } catch (error) {
    console.error('❌ [API UPDATE→DB] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
