import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { aggregateQuarterlyEstimatesForYear, getLocalTransactionDate } from '@/lib/tax-provider/quarterly-estimates';
import { calculateStateTax, STATE_TAX_CONFIG } from '@/lib/tax/state-tax-data';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import { normalizeFilingStatus, FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';

interface TaxCalculation {
  totalIncome: number;
  businessIncome: number;
  w2Income: number;
  estimatedTax: number;
  selfEmploymentTax: number;
  incomeTax: number;
  safeHarborAmount: number | null;
  quarterlyAmount: number;
  ytdPayments: number;
  remainingPayments: number;
}

interface QuarterlyTaxData {
  quarter: number;
  deadline: Date;
  estimatedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'upcoming' | 'due' | 'overdue' | 'paid';
  daysUntilDeadline: number;

  // Estimate details (computed from posted transactions only).
  gross_income?: number;
  confirmed_deductible_expenses?: number;
  potential_deductions_needing_review?: number;
  net_profit?: number;
  estimated_self_employment_tax?: number;
  estimated_total_tax?: number;
  suggested_quarterly_payment?: number;
  reconciliation?: {
    gross_income_cents_raw: number;
    confirmed_deductible_expenses_cents_raw: number;
    net_profit_cents_raw: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Quarterly Tax] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userProfile, transactions, userTimezone } = await request.json();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile is required' }, { status: 400 });
    }

    const tz = typeof userTimezone === 'string' && userTimezone.trim() ? userTimezone : 'UTC';
    const localNow = getLocalTransactionDate(
      { amount: 0, category: '', date: new Date().toISOString() } as any,
      tz
    );
    const taxYear = localNow?.year ?? new Date().getFullYear();

    console.log('🧮 [Quarterly Tax] Calculating for user:', user.uid, { taxYear, tz });

    const filingStatus = normalizeFilingStatus(userProfile.filing_status);
    const w2Income = userProfile.w2_income || 0;
    const otherIncome = userProfile.other_income || 0;

    const { quarters } = aggregateQuarterlyEstimatesForYear(transactions || [], taxYear, tz, {
      filingStatus,
      w2Income,
      otherIncome,
    });

    const recordedPayments = await getRecordedQuarterlyPayments(user.uid, taxYear);
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const quarterlyData: QuarterlyTaxData[] = quarters.map((q) => {
      const deadline = getEstimatedTaxDeadline(taxYear, q.quarter);
      const estimatedAmount = q.suggested_quarterly_payment;
      const paidAmount = recordedPayments.find(payment => payment.quarter === q.quarter)?.paidAmount ?? 0;
      const remainingAmount = Math.max(0, estimatedAmount - paidAmount);
      const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / msPerDay);

      let status: 'upcoming' | 'due' | 'overdue' | 'paid';
      if (paidAmount >= estimatedAmount && estimatedAmount > 0) status = 'paid';
      else if (daysUntilDeadline < 0) status = 'overdue';
      else if (daysUntilDeadline <= 7) status = 'due';
      else status = 'upcoming';

      return {
        quarter: q.quarter,
        deadline,
        estimatedAmount,
        paidAmount,
        remainingAmount,
        status,
        daysUntilDeadline,
        gross_income: q.gross_income,
        confirmed_deductible_expenses: q.confirmed_deductible_expenses,
        potential_deductions_needing_review: q.potential_deductions_needing_review,
        net_profit: q.net_profit,
        estimated_self_employment_tax: q.estimated_self_employment_tax,
        estimated_total_tax: q.estimated_total_tax,
        suggested_quarterly_payment: q.suggested_quarterly_payment,
        reconciliation: q.reconciliation,
      };
    });

    const cents = (v: number) => Math.round((v ?? 0) * 100);
    const businessIncomeCents = quarters.reduce((s, q) => s + cents(q.net_profit), 0);
    const totalIncomeCents = businessIncomeCents + cents(w2Income) + cents(otherIncome);
    const estimatedTaxCents = quarters.reduce((s, q) => s + cents(q.estimated_total_tax), 0);
    const selfEmploymentTaxCents = quarters.reduce((s, q) => s + cents(q.estimated_self_employment_tax), 0);
    const incomeTaxCents = estimatedTaxCents - selfEmploymentTaxCents;

    const quarterlyAmountCents = Math.round(estimatedTaxCents / 4);

    const businessIncome = businessIncomeCents / 100;
    const totalIncome = totalIncomeCents / 100;
    const estimatedTax = estimatedTaxCents / 100;
    const selfEmploymentTax = selfEmploymentTaxCents / 100;
    const incomeTax = incomeTaxCents / 100;
    const safeHarborAmount = null; // Income divided by four is not an IRS safe-harbor calculation.
    const quarterlyAmount = quarterlyAmountCents / 100;

    const ytdPayments = totalRecordedPayments(recordedPayments);
    const remainingPayments = Math.max(0, estimatedTaxCents - cents(ytdPayments)) / 100;

    const calculation: TaxCalculation = {
      totalIncome,
      businessIncome,
      w2Income,
      estimatedTax,
      selfEmploymentTax,
      incomeTax,
      safeHarborAmount,
      quarterlyAmount,
      ytdPayments,
      remainingPayments,
    };

    // State tax quarterly estimate
    const userState = (userProfile.state || '').toUpperCase().slice(0, 2);
    const stateConfig = STATE_TAX_CONFIG[userState];
    const stateTaxResult = userState && stateConfig && stateConfig.type !== 'no_tax'
      ? calculateStateTax(totalIncome, userState, filingStatus as any)
      : null;
    const stateQuarterlyAmount = stateTaxResult ? Math.round(stateTaxResult.tax / 4) : 0;

    return NextResponse.json({
      success: true,
      calculation,
      quarterlyData,
      stateTax: stateTaxResult ? {
        state: userState,
        stateName: stateConfig?.name || userState,
        estimatedAnnualTax: Math.round(stateTaxResult.tax),
        quarterlyAmount: stateQuarterlyAmount,
        effectiveRate: Math.round(stateTaxResult.effectiveRate * 100) / 100,
      } : null,
    });

  } catch (error) {
    if (error instanceof FilingStatusReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    console.error('❌ [Quarterly Tax] Error:', error);
    return NextResponse.json(
      { error: 'Could not load your quarterly estimate and recorded payments. Please retry.' },
      { status: 500 }
    );
  }
}
