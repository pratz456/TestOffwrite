/**
 * Federal tax brackets and calculation utilities
 * Based on 2024 tax year brackets
 */

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface TaxBrackets {
  single: TaxBracket[];
  married_filing_jointly: TaxBracket[];
  married_filing_separately: TaxBracket[];
  head_of_household: TaxBracket[];
}

// 2024 Federal Tax Brackets
export const FEDERAL_TAX_BRACKETS_2024: TaxBrackets = {
  single: [
    { min: 0, max: 11600, rate: 0.10 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: 100525, rate: 0.22 },
    { min: 100525, max: 191950, rate: 0.24 },
    { min: 191950, max: 243725, rate: 0.32 },
    { min: 243725, max: 609350, rate: 0.35 },
    { min: 609350, max: Infinity, rate: 0.37 }
  ],
  married_filing_jointly: [
    { min: 0, max: 23200, rate: 0.10 },
    { min: 23200, max: 94300, rate: 0.12 },
    { min: 94300, max: 201050, rate: 0.22 },
    { min: 201050, max: 383900, rate: 0.24 },
    { min: 383900, max: 487450, rate: 0.32 },
    { min: 487450, max: 731200, rate: 0.35 },
    { min: 731200, max: Infinity, rate: 0.37 }
  ],
  married_filing_separately: [
    { min: 0, max: 11600, rate: 0.10 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: 100525, rate: 0.22 },
    { min: 100525, max: 191950, rate: 0.24 },
    { min: 191950, max: 243725, rate: 0.32 },
    { min: 243725, max: 365600, rate: 0.35 },
    { min: 365600, max: Infinity, rate: 0.37 }
  ],
  head_of_household: [
    { min: 0, max: 16550, rate: 0.10 },
    { min: 16550, max: 63100, rate: 0.12 },
    { min: 63100, max: 100500, rate: 0.22 },
    { min: 100500, max: 191950, rate: 0.24 },
    { min: 191950, max: 243700, rate: 0.32 },
    { min: 243700, max: 609350, rate: 0.35 },
    { min: 609350, max: Infinity, rate: 0.37 }
  ]
};

export interface UserProfile {
  income?: number | string;
  filing_status?: string;
  state?: string;
  tax_bracket?: number;
}

/**
 * Calculate federal income tax based on taxable income and filing status
 * @param taxableIncome Taxable income amount
 * @param filingStatus Filing status (single, married_filing_jointly, etc.)
 * @returns Calculated federal income tax
 */
export function calculateFederalIncomeTax(taxableIncome: number, filingStatus: string = 'single'): number {
  const brackets = FEDERAL_TAX_BRACKETS_2024[filingStatus as keyof TaxBrackets] || FEDERAL_TAX_BRACKETS_2024.single;
  let tax = 0;

  for (const bracket of brackets) {
    if (taxableIncome > bracket.min) {
      const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min;
      tax += taxableInBracket * bracket.rate;
    }
  }

  return Math.round(tax);
}

/**
 * Calculate effective tax rate based on user profile
 * @param userProfile User profile with income and filing status
 * @returns Effective tax rate as percentage (0-100)
 */
export function calculateEffectiveTaxRate(userProfile: UserProfile): number {
  if (!userProfile.income) {
    return 25; // Default fallback rate
  }

  const income = typeof userProfile.income === 'string' 
    ? parseFloat(userProfile.income.replace(/[,$]/g, '')) 
    : userProfile.income;

  if (isNaN(income) || income <= 0) {
    return 25; // Default fallback rate
  }

  // Standard deduction amounts for 2024
  const standardDeductions = {
    single: 14600,
    married_filing_jointly: 29200,
    married_filing_separately: 14600,
    head_of_household: 21900
  };

  const filingStatus = userProfile.filing_status || 'single';
  const standardDeduction = standardDeductions[filingStatus as keyof typeof standardDeductions] || standardDeductions.single;
  
  // Calculate taxable income (income minus standard deduction)
  const taxableIncome = Math.max(0, income - standardDeduction);
  
  // Calculate federal tax
  const federalTax = calculateFederalIncomeTax(taxableIncome, filingStatus);
  
  // Calculate effective rate (tax / total income)
  const effectiveRate = (federalTax / income) * 100;
  
  // Cap at reasonable maximum (40%)
  return Math.min(effectiveRate, 40);
}

/**
 * Get marginal tax rate for additional income
 * @param userProfile User profile with income and filing status
 * @returns Marginal tax rate as percentage (0-100)
 */
export function getMarginalTaxRate(userProfile: UserProfile): number {
  if (!userProfile.income) {
    return 25; // Default fallback rate
  }

  const income = typeof userProfile.income === 'string' 
    ? parseFloat(userProfile.income.replace(/[,$]/g, '')) 
    : userProfile.income;

  if (isNaN(income) || income <= 0) {
    return 25; // Default fallback rate
  }

  const filingStatus = userProfile.filing_status || 'single';
  const brackets = FEDERAL_TAX_BRACKETS_2024[filingStatus as keyof TaxBrackets] || FEDERAL_TAX_BRACKETS_2024.single;
  
  // Find the bracket that the income falls into
  for (const bracket of brackets) {
    if (income >= bracket.min && income < bracket.max) {
      return bracket.rate * 100;
    }
  }
  
  // If income is above the highest bracket
  return brackets[brackets.length - 1].rate * 100;
}
