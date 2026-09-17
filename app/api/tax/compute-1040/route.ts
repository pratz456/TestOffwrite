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
import { CapitalGainReviewRequiredError } from '@/lib/tax-rules/capital-gains';
import { BusinessLossReviewRequiredError } from '@/lib/tax-rules/business-losses';
import { OBBBADeductionReviewRequiredError } from '@/lib/tax-rules/obbba-deductions';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { calculateStateTax, STATE_TAX_CONFIG } from '@/lib/tax/state-tax-data';
import { getAssetsSettings } from '@/lib/firebase/settings-server';
import { describeUnsupportedTaxYear, getFederalTaxRules, SUPPORTED_TAX_YEARS, TAX_YEAR_2027_STATUS } from '@/lib/tax-rules/federal-year-rules';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';
import { readIncomeReconciliationDecisions } from '@/lib/firebase/income-reconciliations-server';
import { incomeReconciliationReviewBody } from '@/lib/tax-rules/income-reconciliation-response';

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
    reconciliationDecisions,
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
    readIncomeReconciliationDecisions(user.uid, year),
  ]);

  if (profileResult.error || assetsResult.error) {
    return NextResponse.json({ error: 'Could not load the information needed for this calculation. Please retry.' }, { status: 503 });
  }
  const profile = (profileResult.data || {}) as any;

  const snapshot = buildFederalTaxSnapshot({
    taxYear: year, transactions, profile,
    grossReceipts: grossSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    forms1099: income1099Snap.docs.map(d => ({ ...d.data(), id: d.id })),
    reconciliationDecisions,
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
    if (error instanceof IncomeReconciliationRequiredError) return NextResponse.json(incomeReconciliationReviewBody(error, year), { status: 422 });
    if (error instanceof ExportReviewRequiredError || error instanceof IncomeReconciliationRequiredError || error instanceof FilingStatusReviewRequiredError || error instanceof SocialSecurityReviewRequiredError || error instanceof PersonalDeductionReviewRequiredError || error instanceof DependentCreditReviewRequiredError
      || error instanceof CapitalGainReviewRequiredError || error instanceof BusinessLossReviewRequiredError || error instanceof OBBBADeductionReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'DEPRECIATION_REVIEW_REQUIRED') {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Asset depreciation needs review', code: error.code }, { status: 422 });
    }
    return NextResponse.json({ error: 'Could not complete the tax calculation. Please retry.' }, { status: 503 });
  }
}
