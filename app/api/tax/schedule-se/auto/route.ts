/**
 * Schedule SE Auto-Calculate
 * GET ?year=2025 - reads gross receipts + confirmed expenses directly, no manual setup needed
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { calcScheduleSE } from '@/lib/reports/calcSE';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  const [txResult, profileResult, grossSnap, income1099Snap] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
  ]);

  const transactions = (txResult.data || []) as any[];
  const profile = profileResult.data as any;

  const totalGrossReceipts =
    grossSnap.docs.reduce((s: number, d: any) => s + (d.data().amount || 0), 0) +
    income1099Snap.docs.reduce((s: number, d: any) => s + (d.data().amount || 0), 0);

  const { totalDeductible } = aggregateScheduleC(transactions, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
  const netProfit = Math.max(0, totalGrossReceipts - totalDeductible);
  const calc = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear: year }, profile?.filing_status || 'single');

  return NextResponse.json({ taxYear: year, grossReceipts: totalGrossReceipts, totalExpenses: totalDeductible, netProfit, calculation: calc, dataSource: 'auto' });
}
