/**
 * Manual Transaction API - create income or expense entries without Plaid.
 * Stores under user_profiles/{uid}/accounts/manual/transactions/{id}
 * POST - create a manual transaction
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { analyzeTransactionWithRetry, convertToEnhancedContext } from '@/lib/ai/analyzeTransaction';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';

const MANUAL_ACCOUNT_ID = 'manual';

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { merchant_name, amount, date, category, notes, type, is_deductible, business_purpose } = body;

  if (!merchant_name?.trim()) return NextResponse.json({ error: 'Merchant / payer name required' }, { status: 400 });
  if (amount === undefined || isNaN(Number(amount))) return NextResponse.json({ error: 'Amount required' }, { status: 400 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 });

  const numAmount = Math.abs(Number(amount));
  const txType: 'income' | 'expense' = type === 'income' ? 'income' : 'expense';
  const storedAmount = txType === 'income' ? -numAmount : numAmount;

  const accountRef = adminDb.collection('user_profiles').doc(user.uid).collection('accounts').doc(MANUAL_ACCOUNT_ID);
  const accountDoc = await accountRef.get();
  if (!accountDoc.exists) {
    await accountRef.set({ userId: user.uid, name: 'Manual Entries', type: 'manual', usageType: 'business', createdAt: new Date() });
  }

  const transId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const txData: Record<string, any> = {
    trans_id: transId,
    userId: user.uid,
    account_id: MANUAL_ACCOUNT_ID,
    merchant_name: merchant_name.trim(),
    amount: storedAmount,
    date,
    category: category || (txType === 'income' ? 'income' : 'other'),
    notes: notes?.trim() || '',
    business_purpose: business_purpose?.trim() || '',
    type: txType,
    is_deductible: is_deductible !== undefined ? is_deductible : null,
    analyzed: false,
    analysis_status: 'pending',
    analysisStatus: 'pending',
    source: 'manual',
    created_at: new Date(),
    updated_at: new Date(),
  };

  await accountRef.collection('transactions').doc(transId).set(txData);

  if (txType === 'expense') {
    void (async () => {
      try {
        const { data: profile } = await getUserProfileServer(user.uid);
        if (!profile) return;
        const userContext = convertToEnhancedContext(profile, date);
        const result = await analyzeTransactionWithRetry({
          tx_id: transId, merchant: merchant_name.trim(), amount_usd: numAmount,
          date_iso: date, note: notes || business_purpose || '', category, account_usage_type: 'business',
        }, userContext);
        if (result.success) {
          await accountRef.collection('transactions').doc(transId).set({
            ai_category: result.result.category, ai_audit_risk: result.result.audit_risk,
            ai_confidence: result.result.confidence, ai_customized_reason: result.result.customized_reason,
            ai_irs_refs: result.result.irs_refs, analyzed: true,
            analysis_status: 'completed', analysisStatus: 'completed',
          }, { merge: true });
        }
      } catch { /* non-fatal */ }
    })();
  }

  return NextResponse.json({ success: true, trans_id: transId, id: transId }, { status: 201 });
}
