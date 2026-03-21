/**
 * Schedule SE Auto-Calculate
 * GET ?year=2025 — reads gross receipts + confirmed expenses + W-2 + deductions
 * Returns full income picture for quarterly estimates and SE calculation.
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

  const [txResult, profileResult, grossSnap, income1099Snap, w2Snap, deductionsSnap] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
  ]);

  const transactions = (txResult.data || []) as any[];
  const profile = profileResult.data as any;

  const grossReceiptsTotal =
    grossSnap.docs.reduce((s: number, d: any) => s + (d.data().amount || 0), 0) +
    income1099Snap.docs.reduce((s: number, d: any) => s + (d.data().amount || 0), 0);

  const w2Total = w2Snap.docs.reduce((s: number, d: any) => s + (d.data().box1Wages || 0), 0);
  const w2Withheld = w2Snap.docs.reduce((s: number, d: any) => s + (d.data().box2FederalWithheld || 0), 0);
  const w2Count = w2Snap.docs.length;

  const deductionsData = deductionsSnap.empty ? null : deductionsSnap.docs[0].data();
  const healthInsurancePremiums = deductionsData?.healthInsurancePremiums || 0;
  const totalRetirement = (deductionsData?.sepIraContribution || 0) +
    (deductionsData?.solo401kEmployeeContribution || 0) +
    (deductionsData?.solo401kEmployerContribution || 0);
  const hsaContribution = deductionsData?.hsaContribution || 0;
  const priorYearTotalTax = deductionsData?.priorYearTotalTax || 0;
  const studentLoanInterest = deductionsData?.studentLoanInterest || 0;

  const { totalDeductible } = aggregateScheduleC(transactions, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
  const netProfit = Math.max(0, grossReceiptsTotal - totalDeductible);
  const calc = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear: year }, profile?.filing_status || 'single');

  // Above-the-line deductions that reduce AGI
  const aboveTheLineDeductions = calc.halfSEDeduction + healthInsurancePremiums + totalRetirement + hsaContribution + studentLoanInterest;

  return NextResponse.json({
    taxYear: year,
    // Self-employment
    grossReceipts: grossReceiptsTotal,
    totalExpenses: totalDeductible,
    netProfit,
    calculation: calc,
    // W-2
    w2Wages: w2Total,
    w2Withheld,
    w2Count,
    // Deductions
    healthInsurancePremiums,
    totalRetirement,
    hsaContribution,
    priorYearTotalTax,
    studentLoanInterest,
    aboveTheLineDeductions,
    // Total picture
    totalIncome: grossReceiptsTotal + w2Total,
    estimatedAGI: Math.max(0, grossReceiptsTotal + w2Total - aboveTheLineDeductions),
    dataSource: 'auto',
  });
}
