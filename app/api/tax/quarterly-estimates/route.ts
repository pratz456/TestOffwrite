import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
<<<<<<< HEAD
import { aggregateQuarterlyEstimatesForYear, getLocalTransactionDate } from '@/lib/tax-provider/quarterly-estimates';
=======
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
>>>>>>> 454713be4d4a0e76f6ed1ab611b3837c8f7065fb

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

    return NextResponse.json({
      success: true,
      calculation,
      quarterlyData
    });

  } catch (error) {
    console.error('❌ [Quarterly Tax] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    );
  }
}

function calculateTaxes(userProfile: any, transactions: any[]): TaxCalculation {
  const businessIncome = userProfile.business_income || 0;
  const w2Income = userProfile.w2_income || 0;
  const otherIncome = userProfile.other_income || 0;
  const totalIncome = businessIncome + w2Income + otherIncome;

  // Calculate self-employment tax (15.3% on business income up to $160,200 in 2024)
  const socialSecurityWageBase = 160200;
  const medicareWageBase = 200000;
  
  const socialSecurityTax = Math.min(businessIncome, socialSecurityWageBase) * 0.124; // 12.4%
  const medicareTax = businessIncome * 0.029; // 2.9%
  const additionalMedicareTax = Math.max(0, businessIncome - medicareWageBase) * 0.009; // 0.9%
  
  const selfEmploymentTax = socialSecurityTax + medicareTax + additionalMedicareTax;

  // Calculate income tax (simplified progressive tax brackets for 2024)
  const incomeTax = calculateIncomeTax(totalIncome, userProfile.filing_status || 'single');

  // Total estimated tax
  const estimatedTax = selfEmploymentTax + incomeTax;

  // IRS safe harbor: 100% of prior year tax (110% if AGI > $150k)
  let safeHarborAmount: number;
  if (userProfile.prior_year_tax != null && userProfile.prior_year_tax > 0) {
    const multiplier = totalIncome > 150000 ? 1.10 : 1.00;
    safeHarborAmount = userProfile.prior_year_tax * multiplier;
  } else {
    safeHarborAmount = totalIncome * getUserTaxRate(userProfile);
  }

  // Quarterly amount
  const quarterlyAmount = Math.min(estimatedTax / 4, safeHarborAmount / 4);

  // Calculate YTD payments from transactions
  const ytdPayments = calculateYTDPayments(transactions);

  // Remaining payments
  const remainingPayments = Math.max(0, estimatedTax - ytdPayments);

  return {
    totalIncome,
    businessIncome,
    w2Income,
    estimatedTax,
    selfEmploymentTax,
    incomeTax,
    safeHarborAmount,
    quarterlyAmount,
    ytdPayments,
    remainingPayments
  };
}

function calculateIncomeTax(income: number, filingStatus: string): number {
  // 2024 tax brackets (simplified)
  const brackets = {
    single: [
      { min: 0, max: 11000, rate: 0.10 },
      { min: 11000, max: 44725, rate: 0.12 },
      { min: 44725, max: 95375, rate: 0.22 },
      { min: 95375, max: 182050, rate: 0.24 },
      { min: 182050, max: 231250, rate: 0.32 },
      { min: 231250, max: 578125, rate: 0.35 },
      { min: 578125, max: Infinity, rate: 0.37 }
    ],
    married_filing_jointly: [
      { min: 0, max: 22000, rate: 0.10 },
      { min: 22000, max: 89450, rate: 0.12 },
      { min: 89450, max: 190750, rate: 0.22 },
      { min: 190750, max: 364200, rate: 0.24 },
      { min: 364200, max: 462500, rate: 0.32 },
      { min: 462500, max: 693750, rate: 0.35 },
      { min: 693750, max: Infinity, rate: 0.37 }
    ]
  };

  const taxBrackets = brackets[filingStatus as keyof typeof brackets] || brackets.single;
  let tax = 0;

  for (const bracket of taxBrackets) {
    if (income > bracket.min) {
      const taxableInBracket = Math.min(income, bracket.max) - bracket.min;
      tax += taxableInBracket * bracket.rate;
    }
  }

  return tax;
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

function generateQuarterlyData(calculation: TaxCalculation, userId: string): QuarterlyTaxData[] {
  const currentYear = new Date().getFullYear();
  const now = new Date();
  
  const quarters = [
    {
      quarter: 1,
      deadline: new Date(currentYear, 3, 15), // April 15
      paidAmount: 0 // Would be calculated from actual payments
    },
    {
      quarter: 2,
      deadline: new Date(currentYear, 5, 15), // June 15
      paidAmount: 0
    },
    {
      quarter: 3,
      deadline: new Date(currentYear, 8, 15), // September 15
      paidAmount: 0
    },
    {
      quarter: 4,
      deadline: new Date(currentYear + 1, 0, 15), // January 15 (next year)
      paidAmount: 0
    }
  ];

  return quarters.map(q => {
    const estimatedAmount = calculation.quarterlyAmount;
    const remainingAmount = Math.max(0, estimatedAmount - q.paidAmount);
    const daysUntilDeadline = Math.ceil((q.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    let status: 'upcoming' | 'due' | 'overdue' | 'paid';
    if (q.paidAmount >= estimatedAmount) {
      status = 'paid';
    } else if (daysUntilDeadline < 0) {
      status = 'overdue';
    } else if (daysUntilDeadline <= 7) {
      status = 'due';
    } else {
      status = 'upcoming';
    }

    return {
      quarter: q.quarter,
      deadline: q.deadline,
      estimatedAmount,
      paidAmount: q.paidAmount,
      remainingAmount,
      status,
      daysUntilDeadline
    };
  });
}
