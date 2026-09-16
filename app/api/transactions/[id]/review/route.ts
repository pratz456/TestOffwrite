import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { transactionIdInput } from '@/lib/transactions/client-updates';
import { reviewTransaction, transactionReviewInput, TransactionReviewError } from '@/lib/transactions/review';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = transactionReviewInput.safeParse(await request.json().catch(() => null));
  if (!transactionIdInput.safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Provide a valid review action, account and category.' }, { status: 400 });
  }
  try {
    const transaction = await reviewTransaction(user.uid, id, parsed.data);
    return NextResponse.json({ success: true, transaction }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TransactionReviewError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: 'Your review could not be saved. Please try again.' }, { status: 500 });
  }
}
