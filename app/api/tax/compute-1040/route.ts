/**
 * Form 1040 Complete Computation API
 * GET ?year=2025 — returns the full 1040 line-by-line calculation including
 * balance due / refund, effective rate, marginal rate, and safe harbor amounts.
 * Reads ALL data sources: gross receipts, 1099s, W-2s, expenses, deductions,
 * quarterly payments already made.
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
import { compute1040 } from '@/lib/tax-rules/compute-1040';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  // Fetch all data sources in parallel
  const [
    txResult,
    profileResult,
    grossSnap,
    income1099Snap,
    w2Snap,
    deductionsSnap,
    quarterlySnap,
  ] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    adminDb.collection('quarterly_payments').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
  ]);

  const transactions = (txResult.data || []) as any[];
  const profile = (profileResult.data || {}) as any;

  // ── Income ──
  const grossReceipts =
    grossSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0) +
    income1099Snap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);

  const w2Wages = w2Snap.docs.reduce((s, d) => s + (d.data().box1Wages || d.data().wages || 0), 0);
  const w2FederalWithheld = w2Snap.docs.reduce((s, d) => s + (d.data().box2FederalWithheld || d.data().federalWithheld || 0), 0);

  // ── Schedule C expenses ──
  const { totalDeductible } = aggregateScheduleC(transactions, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
  const scheduleCNetProfit = Math.max(0, grossReceipts - totalDeductible);

  // ── Schedule SE ──
  const filingStatus = (profile.filing_status || 'single') as any;
  const seCalc = calcScheduleSE({ scheduleCNetProfit, taxYear: year }, filingStatus);

  // ── Above-the-line deductions ──
  const ded = deductionsSnap.empty ? {} : deductionsSnap.docs[0].data();
  const healthInsurancePremiums = ded.healthInsurancePremiums || profile.health_insurance_premiums || 0;
  const sepIraContribution = ded.sepIraContribution || profile.sep_ira_contribution || 0;
  const solo401kContribution = (ded.solo401kEmployeeContribution || 0) + (ded.solo401kEmployerContribution || 0) + (profile.solo_401k_contribution || 0);
  const simpleIraContribution = ded.simpleIraContribution || 0;
  const hsaContribution = ded.hsaContribution || profile.hsa_contribution || 0;
  const studentLoanInterest = ded.studentLoanInterest || 0;
  const priorYearTotalTax = ded.priorYearTotalTax || profile.prior_year_tax || 0;

  // ── Estimated payments already made ──
  const estimatedPayments = quarterlySnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
  const totalW2Withheld = w2FederalWithheld + (profile.w2_federal_withheld || 0);

  // ── Compute 1040 ──
  const result = compute1040({
    taxYear: year,
    filingStatus,
    scheduleCNetProfit,
    w2Wages,
    w2FederalWithheld: totalW2Withheld,
    estimatedPayments,
    selfEmploymentTax: seCalc.totalSETax,
    halfSEDeduction: seCalc.halfSEDeduction,
    healthInsurancePremiums,
    sepIraContribution,
    solo401kContribution,
    simpleIraContribution,
    hsaContribution,
    studentLoanInterest,
  }, priorYearTotalTax > 0 ? priorYearTotalTax : undefined);

  return NextResponse.json({
    taxYear: year,
    filingStatus,
    // Input summary for display
    income: { grossReceipts, w2Wages, scheduleCNetProfit, totalDeductible },
    w2: { wages: w2Wages, withheld: totalW2Withheld, count: w2Snap.docs.length },
    deductions: { healthInsurancePremiums, sepIraContribution, solo401kContribution, hsaContribution, studentLoanInterest },
    payments: { estimatedPayments, w2FederalWithheld: totalW2Withheld },
    seCalc,
    // Full 1040 computation
    form1040: result,
    // Convenience fields for display
    balanceDue: result.balanceDue,
    refund: result.refund,
    totalTax: result.totalTax,
    agi: result.agi,
    effectiveRate: result.effectiveRate,
    dataSource: 'auto',
  });
}
