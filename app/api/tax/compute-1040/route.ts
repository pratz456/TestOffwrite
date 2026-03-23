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
import { calculateStateTax, STATE_TAX_CONFIG } from '@/lib/tax/state-tax-data';
import { getAssetsSettings } from '@/lib/firebase/settings-server';
import { calc4562 } from '@/lib/reports/calc4562';

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
    organizerSnap,
    assetsResult,
  ] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    adminDb.collection('quarterly_payments').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_organizers').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    getAssetsSettings(user.uid),
  ]);

  const transactions = (txResult.data || []) as any[];
  const profile = (profileResult.data || {}) as any;

  // ── Organizer data: additional income not in Plaid/manual ──
  const org = organizerSnap.empty ? {} as Record<string, any> : organizerSnap.docs[0].data();
  const orgInterest = parseFloat(org.amount1099INT || '0') || 0;
  const orgDividends = parseFloat(org.amount1099DIV || '0') || 0;
  const orgCapGains = parseFloat(org.amountCapGains || '0') || 0;
  const orgSocialSecurity = parseFloat(org.amountSocialSecurity || '0') || 0;
  const orgIRADist = parseFloat(org.amountIRADistributions || '0') || 0;
  const orgRentalIncome = parseFloat(org.amountRentalIncome || '0') || 0;
  const orgOtherIncome = parseFloat(org.amountOtherIncome || '0') || 0;
  // Taxable SS: simplified — up to 85% taxable (full calculation needs provisional income)
  const taxableSS = orgSocialSecurity * 0.85;
  const otherIncome = orgInterest + orgDividends + orgCapGains + taxableSS + orgIRADist + orgRentalIncome + orgOtherIncome;

  // ── Income ──
  const grossReceipts =
    grossSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0) +
    income1099Snap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);

  const w2Wages = w2Snap.docs.reduce((s, d) => s + (d.data().box1Wages || d.data().wages || 0), 0);
  const w2FederalWithheld = w2Snap.docs.reduce((s, d) => s + (d.data().box2FederalWithheld || d.data().federalWithheld || 0), 0);
  const w2StateWithheld = w2Snap.docs.reduce((s: number, d: any) => s + (d.data().stateWithheld || 0), 0);

  // ── Schedule C expenses ──
  const { totalDeductible } = aggregateScheduleC(transactions, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
  const scheduleCNetProfit = Math.max(0, grossReceipts - totalDeductible);

  // ── Depreciation (Form 4562) ──
  const assets = (assetsResult.data || []) as any[];
  const depreciationDeduction = assets.length > 0
    ? calc4562(assets, scheduleCNetProfit).totalDepreciation
    : 0;

  // ── Schedule SE ──
  const filingStatus = (profile.filing_status || 'single') as any;
  const seCalc = calcScheduleSE(
      { scheduleCNetProfit, taxYear: year },
      filingStatus,
      // Pass W-2 Box 3 SS wages to reduce SE SS wage base (IRS Schedule SE Line 8a)
      w2Snap.docs.reduce((sum: number, d: any) => sum + (d.data().box3SocialSecurityWages || d.data().box1Wages || 0), 0)
    );

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
  // Parse organizer for credits data
  const numDependents = parseInt(org.dependents || '0', 10) || 0;
  const numEITCChildren = numDependents; // Simplified: all dependents assumed to qualify
  const taxPayerAge = org.dateOfBirth
    ? new Date().getFullYear() - new Date(org.dateOfBirth).getFullYear()
    : undefined;
  const investmentIncome = (orgInterest + orgDividends + Math.max(0, orgCapGains));
  const longTermCapGains = Math.max(0, orgCapGains); // Simplified: treat all cap gains as LT
  const shortTermCapGains = 0; // User would need to specify

  const result = compute1040({
    taxYear: year,
    filingStatus,
    scheduleCNetProfit,
    w2Wages,
    otherIncome,
    numDependents,
    numEITCChildren,
    taxPayerAge,
    investmentIncome,
    longTermCapGains,
    shortTermCapGains,
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
    charitableDonations: (ded.charitableCashDonations || 0) + (ded.charitableNonCashDonations || 0),
    depreciationDeduction,
  }, priorYearTotalTax > 0 ? priorYearTotalTax : undefined);

  // State tax estimate
  const userState = (profile.mailing_address?.state || profile.state || '').toUpperCase().slice(0,2);
  const stateConfig = STATE_TAX_CONFIG[userState];
  const stateTaxResult = userState && stateConfig
    ? calculateStateTax(result.agi, userState, filingStatus as any)
    : null;

  return NextResponse.json({
    taxYear: year,
    filingStatus,
    // Input summary for display
    income: { grossReceipts, w2Wages, scheduleCNetProfit, totalDeductible,
      otherIncome, interest: orgInterest, dividends: orgDividends, capGains: orgCapGains,
      socialSecurity: taxableSS, iraDist: orgIRADist, rental: orgRentalIncome },
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
    depreciation: { totalDepreciation: depreciationDeduction, assetCount: assets.length },
    stateTax: stateTaxResult ? {
      state: userState,
      stateName: stateConfig?.name || userState,
      estimatedTax: Math.round(stateTaxResult.tax),
      effectiveRate: Math.round(stateTaxResult.effectiveRate * 100) / 100,
      type: stateConfig?.type || 'unknown',
      stateWithheld: w2StateWithheld,
      stateBalanceDue: Math.max(0, Math.round(stateTaxResult.tax) - w2StateWithheld),
      note: stateConfig?.type === 'no_tax'
        ? 'Your state has no income tax'
        : 'State estimate only — does not include local taxes or state-specific deductions',
    } : null,
    dataSource: 'auto',
  });
}
