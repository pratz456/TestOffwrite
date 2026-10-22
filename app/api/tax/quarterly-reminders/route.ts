/**
 * Calendar/payment records plus the shared annual estimate, extended with the
 * regular-method planner when every reviewed fact exists. Planner figures are
 * planning estimates and illustrations, never a balance-due or penalty verdict.
 *
 * Sources: IRS Pub 505 (https://www.irs.gov/publications/p505), Form 2210
 * instructions (https://www.irs.gov/instructions/i2210), IRS quarterly interest
 * rates (https://www.irs.gov/payments/quarterly-interest-rates).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { GET as computeAnnualTax } from '@/app/api/tax/compute-1040/route';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getRecordedQuarterlyPayments, totalRecordedPayments, type RecordedQuarterlyPayment } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import {
  BEFORE_WITHHOLDING_LABEL_PENDING_APPROVAL, buildPriorYearOnlyQuarterlyPlan, buildQuarterlyPlan, isIsoDate,
  PRIOR_YEAR_ONLY_LABEL_PENDING_APPROVAL, QUARTERLY_PLANNER_READY_MESSAGE, readSavedPriorYearFacts, resolveQuarterlyPlannerFacts,
  ZERO_PRIOR_TAX_LABEL_PENDING_APPROVAL,
  type QuarterlyPlan, type QuarterlyPlannerResponse, type RecordedEstimatedPayment,
} from '@/lib/tax-provider/quarterly-planner';
import { QUARTERLY_REVIEW_MESSAGE, QuarterlyReviewRequiredError } from '@/lib/tax-provider/regular-estimated-payments';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { resolveRequestedTaxYear } from '@/lib/tax-rules/requested-tax-year';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { readW2FederalWithholding } from '@/lib/tax-rules/w2-income';

const REVIEW_QUARTER = { recommended: null, status: 'review_required' } as const;

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Reuse the exact authenticated annual API contract, including unsupported
    // years, income reconciliation and organizer review requirements.
    const annualResponse = await computeAnnualTax(request);
    if (!annualResponse.ok) {
      const priorYearOnly = await priorYearOnlyWhenDependentReview(request, user.uid, annualResponse);
      return priorYearOnly ?? annualResponse;
    }
    const annual = await annualResponse.json();
    const taxYear: number = annual.taxYear;
    const owned = (collection: string) => adminDb.collection(collection).where('userId', '==', user.uid).where('taxYear', '==', taxYear).limit(1).get();
    const [payments, organizerSnap, deductionsSnap, profileResult] = await Promise.all([
      getRecordedQuarterlyPayments(user.uid, taxYear), owned('tax_organizers'), owned('tax_deductions'), getUserProfileServer(user.uid),
    ]);
    if (profileResult.error) return NextResponse.json({ error: 'Could not load your annual estimate and recorded payments. Please retry.' }, { status: 503 });
    const recordedEstimatedPayments = totalRecordedPayments(payments);
    const totalFederalWithheld = annual.payments.totalFederalWithheld ?? annual.payments.w2FederalWithheld;
    const asOfParam = request.nextUrl.searchParams.get('asOf');
    const asOf = isIsoDate(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);

    const resolution = resolveQuarterlyPlannerFacts({
      taxYear,
      annual: {
        filingStatus: annual.filingStatus, totalTax: annual.form1040.totalTax, refundableCredits: annual.form1040.totalRefundableCredits ?? 0,
        totalFederalWithheld, totalIncome: annual.form1040.totalIncome,
      },
      profile: (profileResult.data ?? null) as Record<string, unknown> | null,
      organizer: organizerSnap.empty ? null : organizerSnap.docs[0].data(),
      deductions: deductionsSnap.empty ? null : deductionsSnap.docs[0].data(),
    });
    let planner: QuarterlyPlannerResponse;
    if (resolution.status === 'ready') {
      const recorded: RecordedEstimatedPayment[] = payments
        .filter(payment => payment.paidAmount > 0)
        .map(payment => {
          const paidDate = payment.record?.paidDate;
          return { amount: payment.paidAmount, paidDate: isIsoDate(paidDate) ? paidDate : null, recordedQuarter: payment.quarter };
        });
      try {
        planner = buildQuarterlyPlan({
          ...resolution.facts, payments: recorded, asOf,
          assumptions: recorded.length ? ['Each quarter\'s recorded total is treated as paid on the most recent payment date saved for that quarter.'] : [],
        });
      } catch (plannerError) {
        if (!(plannerError instanceof QuarterlyReviewRequiredError)) throw plannerError;
        planner = { status: 'review_required', missingFacts: [], notes: [plannerError.message] };
      }
    } else {
      planner = resolution;
    }

    const amountPaid = (quarter: number) => payments.find(payment => payment.quarter === quarter)?.paidAmount ?? 0;
    const quarters = planner.status === 'ready'
      ? planner.installments.map(installment => ({
        quarter: installment.quarter, label: `Q${installment.quarter}`, dueDate: installment.dueDate, amountPaid: amountPaid(installment.quarter),
        recommended: installment.plannedEstimatedPayment, status: installment.status,
        requiredInstallment: installment.requiredInstallment, withholdingCredited: installment.withholdingCredited,
        paymentsMatchedTotal: installment.paymentsMatchedTotal, underpayment: installment.underpayment, overpaymentCarriedOut: installment.overpaymentCarriedOut,
      }))
      : ([1, 2, 3, 4] as const).map(quarter => ({
        quarter, label: `Q${quarter}`, dueDate: getEstimatedTaxDeadline(taxYear, quarter).toISOString().slice(0, 10), amountPaid: amountPaid(quarter), ...REVIEW_QUARTER,
      }));
    const ready = planner.status === 'ready' ? planner : null;
    return NextResponse.json({
      taxYear, filingStatus: annual.filingStatus,
      estimateBasis: 'saved_annual_records',
      grossReceipts: annual.income.grossReceipts, w2Wages: annual.w2.wages,
      netProfit: annual.income.scheduleCNetProfit, seCalc: annual.seCalc,
      agi: annual.form1040.agi, taxableIncome: annual.form1040.taxableIncome,
      incomeTax: annual.form1040.incomeTax, totalEstimatedTax: annual.form1040.totalTax,
      calculationWarnings: annual.form1040.calculationWarnings,
      totalPaid: recordedEstimatedPayments + totalFederalWithheld,
      recordedEstimatedPayments,
      w2Withheld: annual.payments.w2FederalWithheld,
      socialSecurityWithheld: annual.payments.socialSecurityFederalWithheld ?? 0,
      totalFederalWithheld,
      asOf,
      paymentReview: ready
        ? { code: 'QUARTERLY_PLANNER_READY', message: QUARTERLY_PLANNER_READY_MESSAGE }
        : { code: 'QUARTERLY_REVIEW_REQUIRED', message: QUARTERLY_REVIEW_MESSAGE, missingFacts: planner.status === 'review_required' ? planner.missingFacts : [], notes: planner.status === 'review_required' ? planner.notes : [] },
      planner,
      // Legacy summary fields: regular-method planning figures when ready, otherwise null.
      perQuarterRecommended: ready?.nextDue?.installmentOnly ?? null,
      remainingTarget: ready ? ready.totals.remainingEstimatedPayments : null,
      safeHarborTotal: ready ? ready.requiredAnnualPayment.requiredAnnualPayment : null,
      safeHarborPerQuarter: ready ? Math.round(ready.requiredAnnualPayment.requiredAnnualPayment * 25) / 100 : null,
      safeHarborBasis: ready ? ready.requiredAnnualPayment.basis : null,
      usingPriorYearSafeHarbor: ready ? ready.requiredAnnualPayment.basis !== 'current_year_90' : false,
      // Timing sufficiency and penalties are never asserted; see planner.underpaymentInterestIllustration.
      onTrack: null, estimatedPenaltyRisk: null, quarters,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load your annual estimate and recorded payments. Please retry.' }, { status: 503 });
  }
}

function requestedSupportedTaxYear(request: NextRequest): number | null {
  const year = resolveRequestedTaxYear(request.nextUrl.searchParams.get('year'));
  try {
    getFederalTaxRules(year);
    return year;
  } catch {
    return null;
  }
}

function recordedPayments(payments: RecordedQuarterlyPayment[]): RecordedEstimatedPayment[] {
  return payments
    .filter(payment => payment.paidAmount > 0)
    .map(payment => {
      const paidDate = payment.record?.paidDate;
      return { amount: payment.paidAmount, paidDate: isIsoDate(paidDate) ? paidDate : null, recordedQuarter: payment.quarter };
    });
}

function priorYearOnlyBody(input: {
  taxYear: number;
  planner: QuarterlyPlan;
  payments: RecordedQuarterlyPayment[];
  withholding: number;
  withholdingApplied: boolean;
  annualStatusMessage: string;
}) {
  const { planner, payments, withholding, withholdingApplied, annualStatusMessage, taxYear } = input;
  const amountPaid = (quarter: number) => payments.find(payment => payment.quarter === quarter)?.paidAmount ?? 0;
  const recordedEstimatedPayments = totalRecordedPayments(payments);
  const quarters = planner.installments.map(installment => ({
    quarter: installment.quarter, label: `Q${installment.quarter}`, dueDate: installment.dueDate, amountPaid: amountPaid(installment.quarter),
    recommended: installment.plannedEstimatedPayment, status: installment.status,
    requiredInstallment: installment.requiredInstallment, withholdingCredited: installment.withholdingCredited,
    paymentsMatchedTotal: installment.paymentsMatchedTotal, underpayment: installment.underpayment, overpaymentCarriedOut: installment.overpaymentCarriedOut,
  }));
  return {
    taxYear, filingStatus: planner.filingStatus, asOf: planner.asOf,
    priorYearOnly: true,
    // Line 24 total tax does not subtract refundable credits, so this base can be higher than the 1040-ES prior-year figure.
    priorYearBaseMayOverstate: true,
    withholdingApplied,
    annualStatus: 'review_required' as const,
    annualStatusMessage,
    recordedEstimatedPayments,
    ...(withholdingApplied ? { w2Withheld: withholding, totalFederalWithheld: withholding, totalPaid: recordedEstimatedPayments + withholding } : {}),
    calculationWarnings: [] as string[],
    paymentReview: {
      code: 'PRIOR_YEAR_ONLY',
      message: withholdingApplied ? PRIOR_YEAR_ONLY_LABEL_PENDING_APPROVAL : BEFORE_WITHHOLDING_LABEL_PENDING_APPROVAL,
    },
    planner,
    perQuarterRecommended: planner.nextDue?.installmentOnly ?? null,
    remainingTarget: planner.totals.remainingEstimatedPayments,
    safeHarborTotal: planner.requiredAnnualPayment.requiredAnnualPayment,
    safeHarborPerQuarter: Math.round(planner.requiredAnnualPayment.requiredAnnualPayment * 25) / 100,
    safeHarborBasis: planner.requiredAnnualPayment.basis,
    usingPriorYearSafeHarbor: true,
    onTrack: null, estimatedPenaltyRisk: null, quarters,
  };
}

/**
 * DEPENDENT_CREDIT_REVIEW_REQUIRED is the only annual 422 that can fall back to a
 * prior-year plan. Every other status and code returns null so the caller sends
 * the annual response unchanged.
 */
async function priorYearOnlyWhenDependentReview(request: NextRequest, uid: string, annualResponse: Response): Promise<NextResponse | null> {
  if (annualResponse.status !== 422) return null;
  let body: { code?: unknown; error?: unknown };
  try {
    body = await annualResponse.clone().json();
  } catch {
    return null;
  }
  if (body?.code !== 'DEPENDENT_CREDIT_REVIEW_REQUIRED') return null;
  const annualStatusMessage = typeof body.error === 'string' ? body.error : '';
  const taxYear = requestedSupportedTaxYear(request);
  if (taxYear === null) return null;

  let payments: RecordedQuarterlyPayment[];
  let organizerSnap: FirebaseFirestore.QuerySnapshot;
  let deductionsSnap: FirebaseFirestore.QuerySnapshot;
  let profileResult: Awaited<ReturnType<typeof getUserProfileServer>>;
  try {
    [payments, organizerSnap, deductionsSnap, profileResult] = await Promise.all([
      getRecordedQuarterlyPayments(uid, taxYear),
      adminDb.collection('tax_organizers').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get(),
      adminDb.collection('tax_deductions').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get(),
      getUserProfileServer(uid),
    ]);
  } catch {
    return null;
  }
  if (profileResult.error) return null;
  const profile = (profileResult.data ?? null) as Record<string, unknown> | null;
  const saved = readSavedPriorYearFacts({
    taxYear,
    organizer: organizerSnap.empty ? null : organizerSnap.docs[0].data(),
    deductions: deductionsSnap.empty ? null : deductionsSnap.docs[0].data(),
    profile,
  });
  const priorYear = saved.priorYear;
  // The 12-month answer has to be an explicit yes. A missing answer leaves priorYear null; 'no' is available false. Both keep the annual response and include no amounts.
  if (!priorYear || priorYear.available !== true || priorYear.coveredTwelveMonths !== true
    || typeof priorYear.totalTax !== 'number' || !Number.isFinite(priorYear.totalTax)
    || typeof priorYear.agi !== 'number' || !Number.isFinite(priorYear.agi)) {
    return null;
  }
  // A yes on the 12-month question does not prove a return was filed; only the question's hint text mentions filing.
  // Prior-year tax of 0 therefore stays a review with no amounts until the organizer asks about a filed return directly.
  // The planner's non-fallback $0 required-payment handling is a separate path and is left unchanged.
  if (priorYear.totalTax === 0) {
    return NextResponse.json({
      taxYear,
      priorYearOnly: true,
      zeroPriorTaxReview: true,
      annualStatus: 'review_required' as const,
      annualStatusMessage,
      calculationWarnings: [] as string[],
      paymentReview: { code: 'ZERO_PRIOR_TAX', message: ZERO_PRIOR_TAX_LABEL_PENDING_APPROVAL },
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  let withholdingApplied = false;
  let withholdingAmount = 0;
  try {
    const w2Snap = await adminDb.collection('w2_income').where('userId', '==', uid).where('taxYear', '==', taxYear).get();
    const withholding = readW2FederalWithholding(w2Snap.docs.map(doc => doc.data()), profile);
    if (withholding.status === 'ready') {
      withholdingApplied = true;
      withholdingAmount = withholding.federalWithheld;
    }
  } catch {
    withholdingApplied = false;
  }

  const asOfParam = request.nextUrl.searchParams.get('asOf');
  const asOf = isIsoDate(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);
  const recorded = recordedPayments(payments);
  let planner: QuarterlyPlan;
  try {
    planner = buildPriorYearOnlyQuarterlyPlan({
      taxYear,
      filingStatus: (profile?.filing_status ?? '') as string,
      // Unreadable withholding is omitted from the installments rather than replaced with a guessed figure.
      withholding: withholdingApplied ? withholdingAmount : 0,
      priorYear,
      payments: recorded,
      asOf,
      annualStatusMessage,
      assumptions: recorded.length ? ['Each quarter\'s recorded total is treated as paid on the most recent payment date saved for that quarter.'] : [],
    });
  } catch (plannerError) {
    if (plannerError instanceof QuarterlyReviewRequiredError || plannerError instanceof FilingStatusReviewRequiredError) return null;
    throw plannerError;
  }
  return NextResponse.json(priorYearOnlyBody({
    taxYear, planner, payments, withholding: withholdingAmount, withholdingApplied, annualStatusMessage,
  }), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
