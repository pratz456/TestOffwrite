export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { duplicateResolutionUpdate, type DuplicateResolution } from '@/lib/transactions/duplicate-hold-out';
import { hydrateReviewTransaction } from '@/lib/transactions/review';

function outcomeValue(value: unknown): DuplicateResolution | null {
  return value === 'both_real' || value === 'duplicate' ? value : null;
}

function owned(path: string, uid: string, data: Record<string, unknown>): boolean {
  const parts = path.split('/');
  return parts.length === 6 && parts[0] === 'user_profiles' && parts[1] === uid && parts[2] === 'accounts' && parts[4] === 'transactions'
    && (data.userId == null || data.userId === uid)
    && (data.user_id == null || data.user_id === uid);
}

async function findOwned(uid: string, transactionId: string) {
  for (const field of ['userId', 'user_id'] as const) {
    const snapshot = await adminDb.collectionGroup('transactions').where(field, '==', uid).where('trans_id', '==', transactionId).limit(5).get();
    const match = snapshot.docs.find(doc => owned(doc.ref.path, uid, doc.data()));
    if (match) return match;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const transactionId = typeof body?.transactionId === 'string' ? body.transactionId.trim() : '';
  const outcome = outcomeValue(body?.outcome);
  if (!transactionId || !outcome) {
    return NextResponse.json({ error: 'PLACEHOLDER: Choose both real or duplicate for one saved row.' }, { status: 400 });
  }
  const doc = await findOwned(user.uid, transactionId);
  if (!doc) return NextResponse.json({ error: 'PLACEHOLDER: That saved row could not be found.' }, { status: 404 });
  const current = doc.data();
  if (current.possibleDuplicate !== true) {
    return NextResponse.json({ error: 'PLACEHOLDER: That row is not an unresolved possible duplicate.' }, { status: 409 });
  }
  const patch = { ...duplicateResolutionUpdate(outcome), updated_at: new Date() };
  const batch = adminDb.batch();
  batch.update(doc.ref, patch);
  await batch.commit();
  const saved = { ...current, ...patch };
  return NextResponse.json({
    outcome,
    transaction: hydrateReviewTransaction(saved, doc.id),
  });
}
