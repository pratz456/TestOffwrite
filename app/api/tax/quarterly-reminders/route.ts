/** Calendar/payment records plus the shared annual estimate; never a timing verdict. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { GET as computeAnnualTax } from '@/app/api/tax/compute-1040/route';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import { QUARTERLY_REVIEW_MESSAGE } from '@/lib/tax-provider/regular-estimated-payments';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Reuse the exact authenticated annual API contract, including unsupported
    // years, income reconciliation and organizer review requirements.
    const annualResponse = await computeAnnualTax(request);
    if (!annualResponse.ok) return annualResponse;
    const annual = await annualResponse.json();
    const payments = await getRecordedQuarterlyPayments(user.uid, annual.taxYear);
    const recordedEstimatedPayments = totalRecordedPayments(payments);
    const totalFederalWithheld = annual.payments.totalFederalWithheld ?? annual.payments.w2FederalWithheld;
    const quarters = ([1, 2, 3, 4] as const).map(quarter => ({
      quarter, label: `Q${quarter}`,
      dueDate: getEstimatedTaxDeadline(annual.taxYear, quarter).toISOString().slice(0, 10),
      amountPaid: payments.find(payment => payment.quarter === quarter)?.paidAmount ?? 0,
      recommended: null, status: 'review_required',
    }));
    return NextResponse.json({
      taxYear: annual.taxYear, filingStatus: annual.filingStatus,
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
      paymentReview: { code: 'QUARTERLY_REVIEW_REQUIRED', message: QUARTERLY_REVIEW_MESSAGE },
      perQuarterRecommended: null, remainingTarget: null,
      safeHarborTotal: null, safeHarborPerQuarter: null, usingPriorYearSafeHarbor: false,
      onTrack: null, estimatedPenaltyRisk: null, quarters,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load your annual estimate and recorded payments. Please retry.' }, { status: 503 });
  }
}
