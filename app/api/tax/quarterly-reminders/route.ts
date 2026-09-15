/**
 * Quarterly Tax Payment Reminders API
 * GET ?year=2025 — returns all 4 quarters with:
 *   - Due dates (April 15, June 16, September 15, January 15)
 *   - Recommended payment amount based on YTD income and safe harbor
 *   - Status: upcoming | due | overdue | paid
 *   - Days until deadline
 *
 * IRS Publication 505 — quarterly payment rules
 * IRS Form 1040-ES — due date schedule
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { reconcileBusinessIncome, IncomeReconciliationRequiredError } from '@/lib/tax-rules/business-income';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { summarizeW2Income } from '@/lib/tax-rules/w2-income';
import { calculateFederalIncomeTax } from '@/lib/tax-rules/federal-brackets';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS, type FederalFilingStatus } from '@/lib/tax-rules/federal-year-rules';
import { getRecordedQuarterlyPayments } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';

interface QuarterDef {
  quarter: 1 | 2 | 3 | 4;
  label: string;
  incomePeriod: string;   // income months covered
  dueDate: string;        // ISO date
}

function getQuarters(year: number): QuarterDef[] {
  return [
    { quarter: 1, label: 'Q1', incomePeriod: 'Jan 1 – Mar 31', dueDate: getEstimatedTaxDeadline(year, 1).toISOString().slice(0, 10) },
    { quarter: 2, label: 'Q2', incomePeriod: 'Apr 1 – May 31', dueDate: getEstimatedTaxDeadline(year, 2).toISOString().slice(0, 10) },
    { quarter: 3, label: 'Q3', incomePeriod: 'Jun 1 – Aug 31', dueDate: getEstimatedTaxDeadline(year, 3).toISOString().slice(0, 10) },
    { quarter: 4, label: 'Q4', incomePeriod: 'Sep 1 – Dec 31', dueDate: getEstimatedTaxDeadline(year, 4).toISOString().slice(0, 10) },
  ];
}

function getQuarterStatus(dueDate: string, paid: boolean): 'paid' | 'overdue' | 'due' | 'upcoming' {
  if (paid) return 'paid';
  const due = new Date(dueDate);
  const today = new Date();
  const daysUntil = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 14) return 'due';
  return 'upcoming';
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam === null ? new Date().getFullYear() : Number(yearParam);
  let rules;
  try { rules = getFederalTaxRules(year); } catch {
    return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 });
  }

  const [txResult, profileResult, grossSnap, income1099Snap, w2Snap, deductionsSnap, paymentsSnap] = await Promise.all([
    getTransactionsServer(user.uid),
    getUserProfileServer(user.uid),
    adminDb.collection('gross_receipts').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('income_1099').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get(),
    adminDb.collection('tax_deductions').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get(),
    getRecordedQuarterlyPayments(user.uid, year),
  ]);

  if (txResult.error || profileResult.error) {
      return NextResponse.json({ error: 'Could not load the information needed for this calculation. Please retry.' }, { status: 503 });
    }
    const transactions = (txResult.data || []) as any[];
  const profile = (profileResult.data || {}) as any;
  const ded = deductionsSnap.empty ? {} : deductionsSnap.docs[0].data();

  // ── Income ──
  let businessIncome;
  try {
    businessIncome = reconcileBusinessIncome(year, transactions,
      grossSnap.docs.map(d => ({ ...d.data(), id: d.id })),
      income1099Snap.docs.map(d => ({ ...d.data(), id: d.id })));
  } catch (error) {
    if (error instanceof IncomeReconciliationRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    throw error;
  }
  const grossReceipts = businessIncome.grossReceipts;
  const w2Income = summarizeW2Income(w2Snap.docs.map(d => d.data()));
  const w2Wages = w2Income.wages;
  const w2Withheld = w2Snap.docs.length ? w2Income.federalWithheld : (profile.w2_federal_withheld || 0);

  const { totalDeductible } = aggregateScheduleC(transactions, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
  const netProfit = grossReceipts - totalDeductible;
  const filingStatus = (profile.filing_status || 'single') as any;
  const w2MedicareWages = w2Income.medicareWagesForSE;
  const seCalc = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear: year }, filingStatus, w2Income.socialSecurityWages, w2MedicareWages);

  // ── Total tax estimate ──
  const aboveLineDeductions =
    seCalc.halfSEDeduction +
    (ded.healthInsurancePremiums || profile.health_insurance_premiums || 0) +
    (ded.sepIraContribution || profile.sep_ira_contribution || 0) +
    (ded.solo401kEmployeeContribution || 0) + (ded.solo401kEmployerContribution || 0) +
    (profile.solo_401k_contribution || 0) +
    (ded.hsaContribution || profile.hsa_contribution || 0);

  const agi = Math.max(0, netProfit + w2Wages - aboveLineDeductions);
  const stdDeduction = rules.standardDeductions[filingStatus as FederalFilingStatus] ?? rules.standardDeductions.single;
  const taxableIncome = Math.max(0, agi - stdDeduction);
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus, year);
  const medicareThreshold = filingStatus === 'married_filing_jointly' ? 250000 : filingStatus === 'married_filing_separately' ? 125000 : 200000;
  const totalEstimatedTax = incomeTax + seCalc.totalSETax + seCalc.additionalMedicareTax + Math.max(0, w2MedicareWages - medicareThreshold) * 0.009;

  // ── Payments made this year ──
  const paymentsByQuarter: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  paymentsSnap.forEach(payment => { paymentsByQuarter[payment.quarter] = payment.paidAmount; });
  const totalPaid = Object.values(paymentsByQuarter).reduce((a, b) => a + b, 0) + w2Withheld;

  // ── Safe harbor ──
  const priorYearTax = ded.priorYearTotalTax || profile.prior_year_tax || 0;
  const safeHarborMultiplier = agi > 150000 ? 1.10 : 1.00;
  const safeHarborTotal = priorYearTax > 0 ? priorYearTax * safeHarborMultiplier : null;
  const targetPayment = safeHarborTotal
    ? Math.min(safeHarborTotal, totalEstimatedTax * 0.90)
    : totalEstimatedTax * 0.90; // 90% of current year (other safe harbor method)

  const remainingTarget = Math.max(0, targetPayment - totalPaid);
  const perQuarterRecommended = Math.ceil(totalEstimatedTax / 4);

  // ── Build quarter objects ──
  const quarters = getQuarters(year);
  const today = new Date();

  const quarterDetails = quarters.map(q => {
    const amountPaid = paymentsByQuarter[q.quarter];
    const paid = amountPaid + w2Withheld / 4 >= targetPayment / 4 && targetPayment > 0;
    const dueDate = new Date(q.dueDate);
    const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const status = getQuarterStatus(q.dueDate, paid);

    // Recommended: equal 1/4 of annual target, minus what's paid
    const recommended = Math.max(0, Math.ceil(targetPayment / 4) - amountPaid - w2Withheld / 4);

    return {
      quarter: q.quarter,
      label: q.label,
      incomePeriod: q.incomePeriod,
      dueDate: q.dueDate,
      dueDateFormatted: dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      daysUntil,
      status,
      amountPaid,
      recommended,
      isCurrentQuarter: daysUntil >= -90 && daysUntil <= 90,
    };
  });

  // Next upcoming quarter
  const nextQuarter = quarterDetails.find(q => q.status === 'due' || q.status === 'upcoming');
  const overdueQuarters = quarterDetails.filter(q => q.status === 'overdue');

  return NextResponse.json({
    taxYear: year,
    filingStatus,
    // Tax calculation
    grossReceipts, w2Wages, netProfit, seCalc,
    agi, taxableIncome, incomeTax,
    totalEstimatedTax: Math.round(totalEstimatedTax),
    // Payments
    totalPaid, w2Withheld,
    perQuarterRecommended,
    remainingTarget: Math.round(remainingTarget),
    // Safe harbor
    priorYearTax,
    safeHarborTotal: safeHarborTotal ? Math.round(safeHarborTotal) : null,
    safeHarborPerQuarter: safeHarborTotal ? Math.round(safeHarborTotal / 4) : null,
    usingPriorYearSafeHarbor: !!safeHarborTotal,
    // Quarters
    quarters: quarterDetails,
    nextQuarter,
    overdueQuarters,
    // Status summary
    onTrack: totalPaid >= targetPayment * 0.75,
    estimatedPenaltyRisk: overdueQuarters.length > 0,
  });
}
