export type HomeOfficeAnswer = 'yes' | 'no';
export type HomeOfficeMethod = 'simplified' | 'actual';
/** §280A(c)(1)(A)–(C): the three qualifying uses Publication 587 asks about. */
export type HomeOfficeQualifyingUse = 'principal_place_of_business' | 'meet_clients' | 'separate_structure' | 'none';
/** §280A(c)(2) storage and §280A(c)(4) daycare relax the exclusive-use test; both need extra facts. */
export type HomeOfficeExclusiveUseException = 'none' | 'daycare' | 'inventory_storage';
export type HomeOfficeHousingType = 'rented' | 'owned';

export const HOME_OFFICE_ANSWERS: readonly HomeOfficeAnswer[] = ['yes', 'no'];
export const HOME_OFFICE_METHODS: readonly HomeOfficeMethod[] = ['simplified', 'actual'];
export const HOME_OFFICE_QUALIFYING_USES: readonly HomeOfficeQualifyingUse[] = ['principal_place_of_business', 'meet_clients', 'separate_structure', 'none'];
export const HOME_OFFICE_EXCLUSIVE_USE_EXCEPTIONS: readonly HomeOfficeExclusiveUseException[] = ['none', 'daycare', 'inventory_storage'];
export const HOME_OFFICE_HOUSING_TYPES: readonly HomeOfficeHousingType[] = ['rented', 'owned'];

/**
 * Facts Publication 587 and Rev. Proc. 2013-13 require before any home-office amount.
 * `null`/`undefined` means the taxpayer has not answered; it is never treated as "no".
 */
export interface HomeOfficeFacts {
  method?: HomeOfficeMethod | null;
  regularUse?: HomeOfficeAnswer | null;
  exclusiveUse?: HomeOfficeAnswer | null;
  exclusiveUseException?: HomeOfficeExclusiveUseException | null;
  qualifyingUse?: HomeOfficeQualifyingUse | null;
  housingType?: HomeOfficeHousingType | null;
  /** Months with at least 15 days of qualified use (Rev. Proc. 2013-13 §4.04); 0–12. */
  monthsUsed?: number | null;
}

export interface HomeOfficeSettings extends HomeOfficeFacts {
  totalHomeSqFt: number;
  officeSqFt: number;
  rentOrMortgageInterest: number;
  utilities: number;
  insurance: number;
  repairsMaintenance: number;
  propertyTax: number;
  other: number;
}

/** Rev. Proc. 2013-13 §4.01–4.02: $5 per square foot, at most 300 square feet ($1,500). */
export const SIMPLIFIED_RATE_PER_SQFT = 5;
export const SIMPLIFIED_MAX_SQFT = 300;

export interface SimplifiedHomeOfficeCalculation {
  method: 'simplified';
  taxYear: number;
  eligible: boolean;
  ineligibleReason: string | null;
  officeSqFt: number;
  totalHomeSqFt: number;
  allowableSqFt: number;
  monthsUsed: number;
  /** Rev. Proc. 2013-13 §4.04 part-year proration: allowable square feet × months ÷ 12. */
  averageMonthlyAllowableSqFt: number;
  ratePerSqFt: number;
  tentativeDeduction: number;
  /** Schedule C line 29 tentative profit (gross income from the business use minus other business expenses). */
  grossIncomeLimit: number;
  allowableDeduction: number;
  /** Rev. Proc. 2013-13 §4.08(2): the excess is lost; no carryover under the simplified method. */
  disallowedNoCarryover: number;
  housingType: HomeOfficeHousingType | null;
  notes: string[];
}

/** Facts are missing or describe a case the settings cannot calculate; mirrors the other *_REVIEW_REQUIRED errors. */
export class HomeOfficeReviewRequiredError extends Error {
  readonly code = 'HOME_OFFICE_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`Home office deduction needs review: ${detail}`);
    this.name = 'HomeOfficeReviewRequiredError';
  }
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

/**
 * Why the actual-expense method stays review-blocked in the shared snapshot: Form 8829
 * needs the line 8 income ordering, the mortgage-interest/real-estate-tax split between
 * Schedule A and the business share, 39-year depreciation of an owned home, casualty
 * losses and prior-year operating/depreciation carryovers (Form 8829 Part IV). Settings
 * collect none of those, so only the explicit rented-home operating-expense context
 * accepted by calc8829() is calculated; everything else returns this review response.
 */
export const ACTUAL_METHOD_REVIEW_REASON = 'The actual-expense method (Form 8829) needs the qualified business income ordering, mortgage interest and real estate tax allocation, depreciation of an owned home, casualty losses and prior-year carryovers. Settings do not collect these facts, so only a separately reviewed rented-home operating-expense worksheet is calculated. Choose the simplified method or complete Form 8829 with your preparer.';

const isAnswer = (value: unknown): value is HomeOfficeAnswer => value === 'yes' || value === 'no';

/**
 * Publication 587 "Qualifying for a Deduction" facts still missing or outside the supported
 * subset. An empty list means the simplified method can be calculated. Unanswered facts
 * are listed separately from a "no" answer, which is an eligibility result, not a gap.
 */
export function homeOfficeReviewReasons(facts: Partial<HomeOfficeSettings> | null | undefined): string[] {
  const reasons: string[] = [];
  const method = facts?.method ?? null;
  if (method === null) reasons.push('Choose the simplified method (Rev. Proc. 2013-13) or the actual-expense method.');
  if (method === 'actual') reasons.push(ACTUAL_METHOD_REVIEW_REASON);
  if (!isAnswer(facts?.regularUse)) reasons.push('Answer whether you use the area for business on a regular basis.');
  if (!isAnswer(facts?.exclusiveUse)) reasons.push('Answer whether the area is used exclusively for business (no personal use).');
  if (facts?.exclusiveUse === 'no') {
    const exception = facts.exclusiveUseException ?? null;
    if (exception === null) reasons.push('The area is not used exclusively for business: say whether the licensed daycare or inventory/product-sample storage exception applies, or select "no exception".');
    else if (exception !== 'none') reasons.push('The daycare and inventory/product-sample storage exceptions need hours-of-use or sole-fixed-location facts (Publication 587, §280A(c)(2) and (c)(4)) that Settings do not collect; review with your preparer.');
  }
  if (!facts?.qualifyingUse) reasons.push('Answer whether the area is your principal place of business (including administrative or management work with no other fixed location), a place you meet clients or customers, or a separate structure.');
  const months = facts?.monthsUsed;
  if (months === null || months === undefined) reasons.push('Enter how many months in the year the area was used for business (count a month with at least 15 days of use).');
  else if (!Number.isInteger(months) || months < 0 || months > 12) reasons.push('Months used must be a whole number from 0 to 12.');
  const officeSqFt = facts?.officeSqFt;
  if (!nonnegativeAmount(officeSqFt) || officeSqFt <= 0) reasons.push('Enter the square footage of the area used for business.');
  const totalHomeSqFt = facts?.totalHomeSqFt;
  if (!nonnegativeAmount(totalHomeSqFt) || totalHomeSqFt <= 0) reasons.push('Enter the total square footage of your home; Schedule C line 30 reports both areas under the simplified method.');
  else if (nonnegativeAmount(officeSqFt) && officeSqFt > totalHomeSqFt) reasons.push('Office square footage cannot exceed the total home square footage.');
  return reasons;
}

/**
 * Rev. Proc. 2013-13 simplified method: $5 × allowable square feet (at most 300),
 * averaged over the months of qualified use (§4.04), limited to the gross income from
 * the qualified business use minus other business deductions (§4.08(1); Schedule C
 * instructions, Simplified Method Worksheet line 1 = line 29 tentative profit). The
 * disallowed excess is not carried over (§4.08(2)); depreciation for the year is deemed
 * zero (§4.06). Sources: https://www.irs.gov/pub/irs-drop/rp-13-13.pdf,
 * https://www.irs.gov/publications/p587, https://www.irs.gov/instructions/i1040sc.
 * Eligibility comes from the taxpayer's saved answers; a "no" answer yields $0, while an
 * unanswered fact throws HomeOfficeReviewRequiredError instead of assuming either way.
 */
export function calcSimplifiedHomeOffice(settings: HomeOfficeSettings, input: { taxYear: number; grossIncomeLimit: number }): SimplifiedHomeOfficeCalculation {
  if (!Number.isFinite(input.grossIncomeLimit)) throw new HomeOfficeCalculationError('The gross income limit must be a finite amount.', 'INVALID_HOME_OFFICE_INPUT');
  const reasons = homeOfficeReviewReasons({ ...settings, method: 'simplified' });
  if (reasons.length) throw new HomeOfficeReviewRequiredError(reasons.join(' '));
  const monthsUsed = settings.monthsUsed as number;
  const notes: string[] = ['Planning worksheet for Schedule C line 30 under the simplified method (Rev. Proc. 2013-13); not Form 8829. Depreciation for this year is deemed zero and no amount carries over.'];
  let ineligibleReason: string | null = null;
  if (settings.regularUse === 'no') ineligibleReason = 'You answered that the area is not used regularly for business; §280A(c)(1) requires regular use.';
  else if (settings.exclusiveUse === 'no') ineligibleReason = 'You answered that the area is not used exclusively for business and no exception applies; §280A(c)(1) requires exclusive use.';
  else if (settings.qualifyingUse === 'none') ineligibleReason = 'You answered that the area is not your principal place of business, a place you meet clients, or a separate structure (§280A(c)(1)).';
  else if (monthsUsed === 0) ineligibleReason = 'You reported no months of qualified business use this year.';
  const eligible = ineligibleReason === null;
  const allowableSqFt = eligible ? Math.min(settings.officeSqFt, SIMPLIFIED_MAX_SQFT) : 0;
  const averageMonthlyAllowableSqFt = cents(allowableSqFt * monthsUsed / 12);
  const tentativeDeduction = cents(SIMPLIFIED_RATE_PER_SQFT * averageMonthlyAllowableSqFt);
  const grossIncomeLimit = cents(Math.max(0, input.grossIncomeLimit));
  const allowableDeduction = cents(Math.min(tentativeDeduction, grossIncomeLimit));
  if (settings.officeSqFt > SIMPLIFIED_MAX_SQFT && eligible) notes.push(`Only ${SIMPLIFIED_MAX_SQFT} of ${settings.officeSqFt} square feet count under the simplified method.`);
  if (monthsUsed < 12 && eligible) notes.push(`Prorated for ${monthsUsed} of 12 months of qualified use.`);
  if (tentativeDeduction > allowableDeduction) notes.push('Limited to the gross income from the business use of the home after other business expenses; the excess cannot be carried over under the simplified method.');
  if (settings.housingType === 'owned') notes.push('Owned home: claim mortgage interest and real estate taxes in full on Schedule A if you itemize; the simplified method does not allocate them.');
  if (!settings.housingType) notes.push('Answer whether the home is rented or owned; it does not change the simplified amount but affects Schedule A and any later switch to actual expenses.');
  if (ineligibleReason) notes.push(ineligibleReason);
  return {
    method: 'simplified', taxYear: input.taxYear, eligible, ineligibleReason, officeSqFt: settings.officeSqFt, totalHomeSqFt: settings.totalHomeSqFt,
    allowableSqFt, monthsUsed, averageMonthlyAllowableSqFt, ratePerSqFt: SIMPLIFIED_RATE_PER_SQFT, tentativeDeduction, grossIncomeLimit,
    allowableDeduction, disallowedNoCarryover: cents(tentativeDeduction - allowableDeduction), housingType: settings.housingType ?? null, notes,
  };
}

export interface HomeOfficeResolution {
  deduction: number;
  calculation: SimplifiedHomeOfficeCalculation | null;
  warnings: string[];
}

/**
 * Shared-snapshot entry point. Saved settings are authoritative; the legacy profile method
 * only tells us that a deduction was claimed before the facts existed, which is a review
 * case rather than a silent zero. No saved method means no deduction is claimed.
 */
export function resolveHomeOfficeDeduction(
  settings: HomeOfficeSettings | null | undefined,
  input: { taxYear: number; grossIncomeLimit: number; legacyMethod?: unknown },
): HomeOfficeResolution {
  const legacyMethod = HOME_OFFICE_METHODS.includes(input.legacyMethod as HomeOfficeMethod) ? input.legacyMethod as HomeOfficeMethod : null;
  if (!settings) {
    if (legacyMethod) throw new HomeOfficeReviewRequiredError('Your profile selects a home office method but the home office facts are not saved. Complete the Home Office section in Settings (regular and exclusive use, qualifying use, square footage, months used, rented or owned).');
    return { deduction: 0, calculation: null, warnings: [] };
  }
  const method = settings.method ?? legacyMethod;
  if (!method) {
    const warnings = settings.officeSqFt > 0
      ? ['Home office square footage is saved without a deduction method; no home office deduction is included until you choose the simplified method and answer the use questions in Settings.']
      : [];
    return { deduction: 0, calculation: null, warnings };
  }
  if (method === 'actual') throw new HomeOfficeReviewRequiredError(ACTUAL_METHOD_REVIEW_REASON);
  const calculation = calcSimplifiedHomeOffice({ ...settings, method }, input);
  return { deduction: calculation.allowableDeduction, calculation, warnings: calculation.eligible ? [] : [`Home office deduction is $0: ${calculation.ineligibleReason}`] };
}
