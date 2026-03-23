import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { aggregateQuarterlyEstimatesForYear, getLocalTransactionDate } from '@/lib/tax-provider/quarterly-estimates';
import { calculateStateTax, STATE_TAX_CONFIG } from '@/lib/tax/state-tax-data';

interface TaxCalculation {
  totalIncome: number;
  businessIncome: number;
  w2Income: number;
  estimatedTax: number;
  selfEmploymentTax: number;
  incomeTax: number;
  safeHarborAmount: number;
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

    const filingStatus = userProfile.filing_status || 'single';
    const w2Income = userProfile.w2_income || 0;
    const otherIncome = userProfile.other_income || 0;

    const { quarters } = aggregateQuarterlyEstimatesForYear(transactions || [], taxYear, tz, {
      filingStatus,
      w2Income,
      otherIncome,
    });

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const quarterlyData: QuarterlyTaxData[] = quarters.map((q) => {
      // Deadlines are based on tax-year convention (not timezone-sensitive for local quarter grouping).
      // Use UTC noon to reduce chance of date rendering drifting by 1 day.
      let deadline: Date;
      if (q.quarter === 1) deadline = new Date(Date.UTC(taxYear, 3, 15, 12, 0, 0));
      else if (q.quarter === 2) deadline = new Date(Date.UTC(taxYear, 5, 15, 12, 0, 0));
      else if (q.quarter === 3) deadline = new Date(Date.UTC(taxYear, 8, 15, 12, 0, 0));
      else deadline = new Date(Date.UTC(taxYear + 1, 0, 15, 12, 0, 0)); // Q4 -> next year Jan 15

      const estimatedAmount = q.suggested_quarterly_payment;
      const paidAmount = 0; // Payment tracking is handled elsewhere in-app for now.
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

    const safeHarborAmountCents = Math.round(totalIncomeCents / 4); // 25%
    const quarterlyAmountCents = Math.round(estimatedTaxCents / 4);

    const businessIncome = businessIncomeCents / 100;
    const totalIncome = totalIncomeCents / 100;
    const estimatedTax = estimatedTaxCents / 100;
    const selfEmploymentTax = selfEmploymentTaxCents / 100;
    const incomeTax = incomeTaxCents / 100;
    const safeHarborAmount = safeHarborAmountCents / 100;
    const quarterlyAmount = quarterlyAmountCents / 100;

    const ytdPayments = calculateYTDPayments(transactions || [], taxYear, tz);
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
    console.error('❌ [Quarterly Tax] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    );
  }
}

function calculateYTDPayments(transactions: any[], taxYear: number, timezone: string): number {
  const now = new Date();
  const localNow = getLocalTransactionDate(
    { amount: 0, category: '', date: now.toISOString() } as any,
    timezone
  );
  const nowYMD = localNow?.ymd;

  let cents = 0;
  for (const tx of transactions) {
    if (tx?.pending === true) continue; // posted only
    const merchant = tx?.merchant_name;
    if (!merchant || typeof merchant !== 'string' || !merchant.toLowerCase().includes('irs')) continue;
    if (!(tx?.amount > 0)) continue;

    const localDate = getLocalTransactionDate(tx, timezone);
    if (!localDate) continue;
    if (localDate.year !== taxYear) continue;
    if (nowYMD && localDate.ymd > nowYMD) continue; // exclude future

    cents += Math.round((tx.amount ?? 0) * 100);
  }

  return cents / 100;
}
