export interface HomeOfficeSettings {
  totalHomeSqFt: number;
  officeSqFt: number;
  rentOrMortgageInterest: number;
  utilities: number;
  insurance: number;
  repairsMaintenance: number;
  propertyTax: number;
  other: number;
}

export interface Form8829Calculation {
  businessUsePercentage: number;
  allocatedExpenses: {
    rentOrMortgageInterest: number;
    utilities: number;
    insurance: number;
    repairsMaintenance: number;
    propertyTax: number;
    other: number;
  };
  totalAllocatedExpenses: number;
  directOfficeExpenses: number;
  totalAllowableDeduction: number;
  carryoverToNextYear: number;
}

/**
 * Calculate Form 8829 - Home Office Expenses
 * Based on IRS Form 8829 instructions
 */
export function calc8829(settings: HomeOfficeSettings): Form8829Calculation {
  const { totalHomeSqFt, officeSqFt, rentOrMortgageInterest, utilities, insurance, repairsMaintenance, propertyTax, other } = settings;

  // Calculate business use percentage
  const businessUsePercentage = (officeSqFt / totalHomeSqFt) * 100;

  // Allocate shared expenses based on business use percentage
  const allocationFactor = businessUsePercentage / 100;
  
  const allocatedExpenses = {
    rentOrMortgageInterest: rentOrMortgageInterest * allocationFactor,
    utilities: utilities * allocationFactor,
    insurance: insurance * allocationFactor,
    repairsMaintenance: repairsMaintenance * allocationFactor,
    propertyTax: propertyTax * allocationFactor,
    other: other * allocationFactor,
  };

  // Calculate total allocated expenses
  const totalAllocatedExpenses = Object.values(allocatedExpenses).reduce((sum, expense) => sum + expense, 0);

  // Direct office expenses (100% deductible)
  // For now, we'll assume no direct office expenses are tracked separately
  const directOfficeExpenses = 0;

  // Total allowable deduction
  const totalAllowableDeduction = totalAllocatedExpenses + directOfficeExpenses;

  // Maximum home office deduction is $1,500 (2024 limit)
  const maxDeduction = 1500;
  const actualDeduction = Math.min(totalAllowableDeduction, maxDeduction);
  const carryoverToNextYear = Math.max(0, totalAllowableDeduction - maxDeduction);

  return {
    businessUsePercentage: Math.round(businessUsePercentage * 100) / 100, // Round to 2 decimal places
    allocatedExpenses,
    totalAllocatedExpenses: Math.round(totalAllocatedExpenses * 100) / 100,
    directOfficeExpenses,
    totalAllowableDeduction: Math.round(actualDeduction * 100) / 100,
    carryoverToNextYear: Math.round(carryoverToNextYear * 100) / 100,
  };
}

/**
 * Validate home office settings for completeness
 */
export function validateHomeOfficeSettings(settings: Partial<HomeOfficeSettings>): string[] {
  const errors: string[] = [];

  if (!settings.totalHomeSqFt || settings.totalHomeSqFt <= 0) {
    errors.push('Total home square footage is required and must be greater than 0');
  }

  if (!settings.officeSqFt || settings.officeSqFt <= 0) {
    errors.push('Office square footage is required and must be greater than 0');
  }

  if (settings.totalHomeSqFt && settings.officeSqFt && settings.officeSqFt >= settings.totalHomeSqFt) {
    errors.push('Office square footage must be less than total home square footage');
  }

  if (settings.rentOrMortgageInterest && settings.rentOrMortgageInterest < 0) {
    errors.push('Rent or mortgage interest cannot be negative');
  }

  if (settings.utilities && settings.utilities < 0) {
    errors.push('Utilities cannot be negative');
  }

  if (settings.insurance && settings.insurance < 0) {
    errors.push('Insurance cannot be negative');
  }

  if (settings.repairsMaintenance && settings.repairsMaintenance < 0) {
    errors.push('Repairs and maintenance cannot be negative');
  }

  if (settings.propertyTax && settings.propertyTax < 0) {
    errors.push('Property tax cannot be negative');
  }

  if (settings.other && settings.other < 0) {
    errors.push('Other expenses cannot be negative');
  }

  return errors;
}
