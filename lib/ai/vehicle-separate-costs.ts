/**
 * Costs a self-employed person still deducts, at the business share, on top of the
 * standard mileage rate (Rev. Proc. 2019-46 sec. 4.03). Parking and tolls are a
 * separate category. These two can still be filed as vehicle_expense.
 */
const VEHICLE = '(?:car|auto|automobile|vehicle|truck|van)';

const CAR_LOAN_INTEREST = new RegExp(
  `\\b(?:interest\\s+on\\s+(?:the\\s+|my\\s+|a\\s+|our\\s+)?${VEHICLE}\\s+loan|${VEHICLE}\\s+loan\\s+interest)\\b`,
  'i',
);

const VEHICLE_PERSONAL_PROPERTY_TAX = new RegExp(
  `\\bpersonal\\s+property\\s+tax\\b(?:\\W+\\w+){0,8}\\W+${VEHICLE}\\b|\\b${VEHICLE}\\b(?:\\W+\\w+){0,8}\\W+personal\\s+property\\s+tax\\b`,
  'i',
);

export type StandardMileageSeparateCost = 'loan_interest' | 'property_tax';

export function standardMileageSeparateCost(text: string): StandardMileageSeparateCost | null {
  if (VEHICLE_PERSONAL_PROPERTY_TAX.test(text)) return 'property_tax';
  if (CAR_LOAN_INTEREST.test(text)) return 'loan_interest';
  return null;
}

/** A hired ride is not a cost of the taxpayer's own car, so the mileage method does not absorb it. Uber Eats is a meal, not a fare. */
export function hiredVehicleFare(merchantText: string): boolean {
  if (/\buber\s*eats\b/i.test(merchantText)) return false;
  return /\b(?:uber|lyft|taxi|taxicab|cab)\b/i.test(merchantText);
}
