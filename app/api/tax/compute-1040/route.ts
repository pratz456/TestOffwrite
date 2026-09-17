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
import { SocialSecurityReviewRequiredError } from '@/lib/tax-rules/social-security';
import { PersonalDeductionReviewRequiredError } from '@/lib/tax-rules/personal-deductions';
import { DependentCreditReviewRequiredError } from '@/lib/tax-rules/credit-scope';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { getAssetsSettings } from '@/lib/firebase/settings-server';
import { describeUnsupportedTaxYear, getFederalTaxRules, SUPPORTED_TAX_YEARS, TAX_YEAR_2027_STATUS } from '@/lib/tax-rules/federal-year-rules';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam === null ? new Date().getFullYear() : /^\d{4}$/.test(yearParam) ? Number(yearParam) : NaN;
  try { getFederalTaxRules(year); } catch {
    return NextResponse.json({
      error: Number.isFinite(year) ? describeUnsupportedTaxYear(year) : `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}`,
      code: 'TAX_YEAR_UNAVAILABLE',
      supportedYears: SUPPORTED_TAX_YEARS,
      ...(year === TAX_YEAR_2027_STATUS.taxYear ? { yearStatus: TAX_YEAR_2027_STATUS } : {}),
    }, { status: 400 });
  }

  try {

  // Fetch all data sources in parallel
  const [
    transactions,
    profileResult,
    grossSnap,
    income1099Snap,
    w2Snap,
    deductionsSnap,
    quarterlySnap,
    organizerSnap,
    assetsResult,
  ] = await Promise.all([
    readTaxExportTransactions(user.uid, year),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    getRecordedQuarterlyPayments(user.uid, year),
    adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    getAssetsSettings(user.uid),
  ]);

  if (profileResult.error || assetsResult.error) {
    return NextResponse.json({ error: 'Could not load the information needed for this calculation. Please retry.' }, { status: 503 });
  }
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

  // Informational state planning estimate from the department-of-revenue registry. It is
  // reported beside the federal figures and is never added to totalTax. W-2 state
  // withholding is shown for reference only; the W-2 state is not reconciled here.
  const stateWithheld = snapshot.w2.stateWithheld;
  const stateTax = snapshot.stateTax
    ? {
      ...snapshot.stateTax,
      stateWithheld,
      ...(snapshot.stateTax.supported && !snapshot.stateTax.noIncomeTax
        ? { stateBalanceDue: Math.max(0, Math.round((snapshot.stateTax.estimate - stateWithheld) * 100) / 100) }
        : {}),
    }
    : null;

  return NextResponse.json({
    taxYear: year,
    filingStatus,
    income: snapshot.income,
    w2: snapshot.w2,
    deductions: snapshot.deductions,
    payments: snapshot.payments,
    incomeReconciliation: snapshot.reconciliation,
    socialSecurityWorksheet: snapshot.socialSecurityWorksheet,
    personalDeductions: snapshot.personalDeductions,
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
    stateTax,
    businessTaxNotices: snapshot.businessTaxNotices,
    dataSource: 'auto',
  }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ExportReviewRequiredError || error instanceof IncomeReconciliationRequiredError || error instanceof FilingStatusReviewRequiredError || error instanceof SocialSecurityReviewRequiredError || error instanceof PersonalDeductionReviewRequiredError || error instanceof DependentCreditReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'DEPRECIATION_REVIEW_REQUIRED') {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Asset depreciation needs review', code: error.code }, { status: 422 });
    }
    return NextResponse.json({ error: 'Could not complete the tax calculation. Please retry.' }, { status: 503 });
  }
}
