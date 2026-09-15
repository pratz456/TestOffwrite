/**
 * Schedule SE Auto-Calculate
 * GET ?year=2025 — reads gross receipts + confirmed expenses + W-2 + deductions
 * Returns full income picture for quarterly estimates and SE calculation.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { reconcileBusinessIncome, IncomeReconciliationRequiredError } from '@/lib/tax-rules/business-income';
import { normalizeFilingStatus, FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { summarizeW2Income } from '@/lib/tax-rules/w2-income';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam === null ? new Date().getFullYear() : Number(yearParam);
  try { getFederalTaxRules(year); } catch {
    return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 });
  }

  const [txResult, profileResult, grossSnap, income1099Snap, w2Snap, deductionsSnap] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
  ]);

  if (txResult.error || profileResult.error) {
      return NextResponse.json({ error: 'Could not load the information needed for this calculation. Please retry.' }, { status: 503 });
    }
    const transactions = (txResult.data || []) as any[];
  const profile = profileResult.data as any;

  let businessIncome;
  let filingStatus;
  try {
    filingStatus = normalizeFilingStatus(profile?.filing_status);
    businessIncome = reconcileBusinessIncome(year, transactions,
      grossSnap.docs.map(d => ({ ...d.data(), id: d.id })),
      income1099Snap.docs.map(d => ({ ...d.data(), id: d.id })));
  } catch (error) {
    if (error instanceof IncomeReconciliationRequiredError || error instanceof FilingStatusReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    throw error;
  }
  const grossReceiptsTotal = businessIncome.grossReceipts;

  const w2Income = summarizeW2Income(w2Snap.docs.map(d => d.data()));
  const w2Total = w2Income.wages;
  const w2Withheld = w2Income.federalWithheld;
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
  const netProfit = grossReceiptsTotal - totalDeductible;
  const calc = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear: year }, filingStatus, w2Income.socialSecurityWages, w2Income.medicareWagesForSE);

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
    totalIncome: netProfit + w2Total,
    estimatedAGI: netProfit + w2Total - aboveTheLineDeductions,
    dataSource: 'auto',
  });
}
