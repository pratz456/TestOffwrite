import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer, updateTransactionServerWithUserId } from '@/lib/firebase/transactions-server';
import { aiLearningEngine } from '@/lib/ai/learning-engine';

const APPLY_THRESHOLD = 0.7;
const MAX_PENDING_PER_RUN = 100;

/**
 * POST /api/transactions/apply-learning
 * Applies learning patterns to pending transactions: for each pending tx,
 * suggests is_deductible from merchant/category preferences; if confidence >= 0.7, updates the transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.uid;
    const { data: allTransactions, error: fetchError } = await getTransactionsServer(userId);
    if (fetchError || !allTransactions) {
      return NextResponse.json(
        { error: 'Failed to fetch transactions', applied: 0, skipped: 0 },
        { status: 500 }
      );
    }

    const pending = allTransactions.filter(
      (t) => t.is_deductible === null || t.is_deductible === undefined
    );
    const toProcess = pending.slice(0, MAX_PENDING_PER_RUN);

    let applied = 0;
    let skipped = 0;

    for (const tx of toProcess) {
      const suggestion = await aiLearningEngine.suggestClassification(userId, {
        merchant_name: tx.merchant_name,
        category: tx.category,
        mcc: tx.merchant_category_code,
        amount: tx.amount,
      });

      if (suggestion && suggestion.confidence >= APPLY_THRESHOLD) {
        const transId = tx.trans_id || tx.id;
        const { error: updateError } = await updateTransactionServerWithUserId(userId, transId, {
          is_deductible: suggestion.suggestedIsDeductible,
          expense_type: suggestion.suggestedIsDeductible ? 'business' : 'personal',
        });
        if (!updateError) applied++;
        else skipped++;
      } else {
        skipped++;
      }
    }

    return NextResponse.json({ applied, skipped });
  } catch (err) {
    console.error('[apply-learning]', err);
    return NextResponse.json(
      { error: 'Internal server error', applied: 0, skipped: 0 },
      { status: 500 }
    );
  }
}
