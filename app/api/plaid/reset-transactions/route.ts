import { NextResponse } from 'next/server';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { syncUserTransactions } from '@/lib/plaid/sync-helper';
/** Compatibility test endpoint: reimport idempotently; never delete tax records. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_TRANSACTION_RESET !== 'true') return NextResponse.json({ error: 'Transaction reset is disabled' }, { status: 403 });
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const denied = await requireFeatureAccess(uid, 'extended_history');
  if (denied) return denied;
  const result = await syncUserTransactions(uid);
  return NextResponse.json({ ...result, transactions_deleted: 0, transactions_saved: result.transactionsSaved }, { status: result.success ? 200 : 503 });
}
