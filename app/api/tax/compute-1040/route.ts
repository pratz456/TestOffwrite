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
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { IncomeReconciliationRequiredError } from '@/lib/tax-rules/business-income';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { calculateStateTax, STATE_TAX_CONFIG } from '@/lib/tax/state-tax-data';
import { getAssetsSettings } from '@/lib/firebase/settings-server';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam === null ? new Date().getFullYear() : Number(yearParam);
  try { getFederalTaxRules(year); } catch {
    return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 });
  }

  try {

  // Fetch all data sources in parallel
  const [
    txResult,
    profileResult,
    grossSnap,
    income1099Snap,
    w2Snap,
    deductionsSnap,
    quarterlySnap,
    organizerSnap,
    assetsResult,
  ] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    getRecordedQuarterlyPayments(user.uid, year),
    adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    getAssetsSettings(user.uid),
  ]);

  if (txResult.error || profileResult.error || assetsResult.error) {
    return NextResponse.json({ error: 'Could not load the information needed for this calculation. Please retry.' }, { status: 503 });
  }
  const transactions = (txResult.data || []) as any[];
  const profile = (profileResult.data || {}) as any;

  const snapshot = buildFederalTaxSnapshot({
    taxYear: year, transactions, profile,
    grossReceipts: grossSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    forms1099: income1099Snap.docs.map(d => ({ ...d.data(), id: d.id })),
    w2Entries: w2Snap.docs.map(d => d.data()),
    organizer: organizerSnap.empty ? {} : organizerSnap.docs[0].data(),
    deductions: deductionsSnap.empty ? {} : deductionsSnap.docs[0].data(),
    assets: assetsResult.data || [], estimatedPayments: totalRecordedPayments(quarterlySnap),
  });
  const { result, filingStatus } = snapshot;

  // State tax estimate
  const userState = (profile.mailing_address?.state || profile.state || '').toUpperCase().slice(0,2);
  const stateConfig = STATE_TAX_CONFIG[userState];
  const stateTaxResult = userState && stateConfig
    ? calculateStateTax(result.agi, userState, filingStatus as any)
    : null;

  return NextResponse.json({
    taxYear: year,
    filingStatus,
    income: snapshot.income,
    w2: snapshot.w2,
    deductions: snapshot.deductions,
    payments: snapshot.payments,
    incomeReconciliation: snapshot.reconciliation,
    seCalc: snapshot.seCalc,
    // Full 1040 computation
    form1040: result,
    // Convenience fields for display
    balanceDue: result.balanceDue,
    refund: result.refund,
    totalTax: result.totalTax,
    agi: result.agi,
    effectiveRate: result.effectiveRate,
    depreciation: { totalDepreciation: snapshot.depreciationDeduction, assetCount: assetsResult.data?.length || 0 },
    stateTax: stateTaxResult ? {
      state: userState,
      stateName: stateConfig?.name || userState,
      estimatedTax: Math.round(stateTaxResult.tax),
      effectiveRate: Math.round(stateTaxResult.effectiveRate * 100) / 100,
      type: stateConfig?.type || 'unknown',
      stateWithheld: snapshot.w2.stateWithheld,
      stateBalanceDue: Math.max(0, Math.round(stateTaxResult.tax) - snapshot.w2.stateWithheld),
      note: stateConfig?.type === 'no_tax'
        ? 'Your state has no income tax'
        : 'State estimate only — does not include local taxes or state-specific deductions',
    } : null,
    dataSource: 'auto',
  }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof IncomeReconciliationRequiredError || error instanceof FilingStatusReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'DEPRECIATION_REVIEW_REQUIRED') {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Asset depreciation needs review', code: error.code }, { status: 422 });
    }
    return NextResponse.json({ error: 'Could not complete the tax calculation. Please retry.' }, { status: 503 });
  }
}
