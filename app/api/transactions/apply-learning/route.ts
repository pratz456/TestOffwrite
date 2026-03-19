import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

/**
 * POST /api/transactions/apply-learning
 * Previously applied learning hints to pending transactions. Disabled so tax treatment
 * is only set when the user reviews/classifies each transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      applied: 0,
      skipped: 0,
      message: 'Automatic learning application is disabled.',
    });
  } catch (err) {
    console.error('[apply-learning]', err);
    return NextResponse.json(
      { error: 'Internal server error', applied: 0, skipped: 0 },
      { status: 500 }
    );
  }
}
