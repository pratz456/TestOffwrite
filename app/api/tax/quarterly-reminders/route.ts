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
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import {
  buildQuarterlyPlan, isIsoDate, QUARTERLY_PLANNER_READY_MESSAGE, resolveQuarterlyPlannerFacts,
  type QuarterlyPlannerResponse, type RecordedEstimatedPayment,
} from '@/lib/tax-provider/quarterly-planner';
import { QUARTERLY_REVIEW_MESSAGE, QuarterlyReviewRequiredError } from '@/lib/tax-provider/regular-estimated-payments';

const REVIEW_QUARTER = { recommended: null, status: 'review_required' } as const;

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Reuse the exact authenticated annual API contract, including unsupported
    // years, income reconciliation and organizer review requirements.
    const annualResponse = await computeAnnualTax(request);
    if (!annualResponse.ok) return annualResponse;
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
