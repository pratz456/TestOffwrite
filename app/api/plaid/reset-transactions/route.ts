import { NextResponse } from 'next/server';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { syncUserTransactions } from '@/lib/plaid/sync-helper';
import { BANK_CONSENT_REQUIRED_BODY, isBankConsentRequired, requireBankDataConsent } from '@/lib/onboarding/bank-consent';
/** Compatibility test endpoint: reimport idempotently; never delete tax records. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_TRANSACTION_RESET !== 'true') return NextResponse.json({ error: 'Transaction reset is disabled' }, { status: 403 });
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const denied = await requireFeatureAccess(uid, 'extended_history');
  if (denied) return denied;
  try { await requireBankDataConsent(uid); }
  catch (error) {
    if (isBankConsentRequired(error)) return NextResponse.json({ ...BANK_CONSENT_REQUIRED_BODY, success: false, transactions_deleted: 0, transactions_saved: 0 }, { status: 403 });
    return NextResponse.json({ error: 'Unable to reset transactions', transactions_deleted: 0 }, { status: 503 });
  }
  const result = await syncUserTransactions(uid);
  return NextResponse.json({ ...result, transactions_deleted: 0, transactions_saved: result.transactionsSaved }, { status: result.success ? 200 : 503 });
}
