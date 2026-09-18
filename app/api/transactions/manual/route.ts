/**
 * Manual Transaction API - create income or expense entries without Plaid.
 * Stores under user_profiles/{uid}/accounts/manual/transactions/{id}
 * POST - create a manual transaction
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

const MANUAL_ACCOUNT_ID = 'manual';
const manualInput = z.object({
  merchant_name: z.string().trim().min(1).max(500),
  amount: z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().finite().positive()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value),
  iso_currency_code: z.literal('USD').optional(),
  category: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4000).optional(),
  type: z.enum(['income', 'expense']).default('expense'),
  is_deductible: z.boolean().nullable().optional(),
  business_purpose: z.string().trim().max(2000).optional(),
});

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = manualInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Provide a merchant, positive finite amount, valid date (YYYY-MM-DD), and valid transaction fields.' }, { status: 400 });
  const { merchant_name, amount, date, category, notes, type, is_deductible, business_purpose, iso_currency_code } = parsed.data;

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
    ...(iso_currency_code ? { iso_currency_code } : {}),
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

  // The durable Firestore worker analyzes saved expenses after creation.

  return NextResponse.json({ success: true, trans_id: transId, id: transId }, { status: 201 });
}
