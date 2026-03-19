import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';

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
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Quarterly Tax] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userProfile, transactions } = await request.json();

    if (!userProfile) {
      return NextResponse.json({ error: 'User profile is required' }, { status: 400 });
    }

    console.log('🧮 [Quarterly Tax] Calculating for user:', user.uid);

    // Calculate taxes
    const calculation = calculateTaxes(userProfile, transactions || []);
    
    // Generate quarterly data
    const quarterlyData = generateQuarterlyData(calculation, user.uid);

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

function calculateYTDPayments(transactions: any[]): number {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  
  return transactions
    .filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= yearStart && 
             tx.merchant_name?.toLowerCase().includes('irs') &&
             tx.amount > 0; // Positive amounts for payments
    })
    .reduce((total, tx) => total + tx.amount, 0);
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
