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
 * Supported subset: a qualified Schedule C rental home, actual operating expenses,
 * and no mortgage/property-tax, casualty-loss, or depreciation ordering to resolve.
 * Line 8 is qualified-home business income AFTER unrelated business expenses;
 * it is not gross receipts or the taxpayer's total household income.
 */
export interface RentalHomeOfficeContext {
  method: 'actual';
  housingType: 'rented';
  qualifiedScheduleCBusinessUse: boolean;
  expensesLimitedToBusinessUsePeriod: boolean;
  form8829Line8Income: number;
  directOperatingExpenses: number;
  priorOperatingExpenseCarryover: number;
  casualtyLosses: number;
  depreciationAndCasualtyCarryover: number;
}

export class HomeOfficeCalculationError extends Error {
  readonly code: 'HOME_OFFICE_DETAILS_REQUIRED' | 'INVALID_HOME_OFFICE_INPUT';
  constructor(message: string, code: HomeOfficeCalculationError['code'] = 'HOME_OFFICE_DETAILS_REQUIRED') {
    super(message);
    this.name = 'HomeOfficeCalculationError';
    this.code = code;
  }
}

const EXPENSE_FIELDS = ['rentOrMortgageInterest', 'utilities', 'insurance', 'repairsMaintenance', 'propertyTax', 'other'] as const;
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const nonnegativeAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function validateHomeOfficeSettings(settings: Partial<HomeOfficeSettings>): string[] {
  const errors: string[] = [];
  if (!nonnegativeAmount(settings.totalHomeSqFt) || settings.totalHomeSqFt <= 0) {
    errors.push('Total home square footage must be a finite number greater than zero.');
  }
  if (!nonnegativeAmount(settings.officeSqFt) || settings.officeSqFt <= 0) {
    errors.push('Office square footage must be a finite number greater than zero.');
  }
  if (typeof settings.officeSqFt === 'number' && typeof settings.totalHomeSqFt === 'number' && settings.officeSqFt >= settings.totalHomeSqFt) {
    errors.push('Office square footage must be less than total home square footage.');
  }
  for (const field of EXPENSE_FIELDS) {
    if (!nonnegativeAmount(settings[field])) errors.push(`${field} must be a finite amount of zero or more.`);
  }
  return errors;
}

/** Allocation is a worksheet amount, not a deductible amount or eligibility decision. */
export function allocateHomeOfficeExpenses(settings: HomeOfficeSettings): Pick<Form8829Calculation, 'businessUsePercentage' | 'allocatedExpenses' | 'totalAllocatedExpenses'> {
  const errors = validateHomeOfficeSettings(settings);
  if (errors.length) throw new HomeOfficeCalculationError(errors.join(' '), 'INVALID_HOME_OFFICE_INPUT');
  const fraction = settings.officeSqFt / settings.totalHomeSqFt;
  const allocatedExpenses = {
    rentOrMortgageInterest: cents(settings.rentOrMortgageInterest * fraction),
    utilities: cents(settings.utilities * fraction),
    insurance: cents(settings.insurance * fraction),
    repairsMaintenance: cents(settings.repairsMaintenance * fraction),
    propertyTax: cents(settings.propertyTax * fraction),
    other: cents(settings.other * fraction),
  };
  const totalAllocatedExpenses = cents(Object.values(allocatedExpenses).reduce((sum, amount) => sum + amount, 0));
  if (!Number.isFinite(totalAllocatedExpenses)) throw new HomeOfficeCalculationError('Home office expense totals are too large.', 'INVALID_HOME_OFFICE_INPUT');
  return { businessUsePercentage: cents(fraction * 100), allocatedExpenses, totalAllocatedExpenses };
}

/**
 * Sources reviewed 2026-09-15:
 * https://www.irs.gov/instructions/i8829 (Part II lines 8, 19, 25 and Part IV)
 * https://www.irs.gov/publications/p587 (actual expenses and deduction limit)
 * https://www.irs.gov/faqs/small-business-self-employed-other-business/income-expenses/income-expenses-4
 * The $5/300-square-foot simplified method is NOT a cap on actual expenses.
 * Owner homes require the full mortgage/tax/depreciation ordering and are outside
 * this subset. Missing facts must never become a fabricated deduction or carryover.
 */
export function calc8829(settings: HomeOfficeSettings, context?: RentalHomeOfficeContext): Form8829Calculation {
  const allocation = allocateHomeOfficeExpenses(settings);
  if (!context) {
    throw new HomeOfficeCalculationError('A final home-office deduction requires confirmed eligibility, rental or ownership details, business-income limits and prior carryovers. The current settings do not collect these details, so Form 8829 export is unavailable.');
  }
  if (context.method !== 'actual' || context.housingType !== 'rented' || settings.propertyTax !== 0 ||
      context.casualtyLosses !== 0 || context.depreciationAndCasualtyCarryover !== 0) {
    throw new HomeOfficeCalculationError('This calculation supports actual operating expenses for a rented home only. Mortgage interest, real estate taxes, casualty losses, depreciation carryovers and the simplified method require a separate reviewed calculation.');
  }
  if (context.qualifiedScheduleCBusinessUse !== true || context.expensesLimitedToBusinessUsePeriod !== true) {
    throw new HomeOfficeCalculationError('Confirm qualifying Schedule C business use and include only expenses for the eligible business-use period before calculating a deduction.');
  }
  if (typeof context.form8829Line8Income !== 'number' || !Number.isFinite(context.form8829Line8Income) ||
      !nonnegativeAmount(context.directOperatingExpenses) || !nonnegativeAmount(context.priorOperatingExpenseCarryover)) {
    throw new HomeOfficeCalculationError('Enter a finite Form 8829 line 8 income amount and nonnegative direct expenses and operating-expense carryover.', 'INVALID_HOME_OFFICE_INPUT');
  }
  const totalOperatingExpenses = cents(allocation.totalAllocatedExpenses + context.directOperatingExpenses + context.priorOperatingExpenseCarryover);
  if (!Number.isFinite(totalOperatingExpenses)) throw new HomeOfficeCalculationError('Home office expense totals are too large.', 'INVALID_HOME_OFFICE_INPUT');
  const allowed = cents(Math.min(totalOperatingExpenses, Math.max(0, context.form8829Line8Income)));
  return {
    ...allocation,
    directOfficeExpenses: cents(context.directOperatingExpenses),
    totalAllowableDeduction: allowed,
    carryoverToNextYear: cents(totalOperatingExpenses - allowed),
  };
}
