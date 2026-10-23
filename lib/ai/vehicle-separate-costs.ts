/**
 * Costs a self-employed person still deducts, at the business-use share, on top of
 * either vehicle method (Rev. Proc. 2019-46 sec. 4.03). Parking and tolls are the
 * only add-on that counts in full. Interest and vehicle personal property tax never
 * default to 100%.
 */
import { ACTUAL_EXPENSE_BUSINESS_SHARE } from './actual-expense-share';

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

/**
 * Same question as an actual-expense car cost. The reason is the interest and
 * property-tax rule, which applies under both methods.
 */
export const SEPARATE_VEHICLE_COST_SHARE = {
  question: ACTUAL_EXPENSE_BUSINESS_SHARE.question,
  reason: 'Car loan interest and personal property tax on the car count only at the business-use share. Record that percentage before this charge can count.',
} as const;

/** A hired ride is not a cost of the taxpayer's own car, so the mileage method does not absorb it. Uber Eats is a meal, not a fare. */
export function hiredVehicleFare(merchantText: string): boolean {
  if (/\buber\s*eats\b/i.test(merchantText)) return false;
  return /\b(?:uber|lyft|taxi|taxicab|cab)\b/i.test(merchantText);
}

/** Existing rideshare question. A fare is decided by where the trip went. */
export const HIRED_FARE_PURPOSE = {
  question: 'Where did this ride go? Rides between business locations or to a client are deductible; commuting from home to a regular workplace and personal rides are not.',
  reason: 'A rideshare or taxi fare follows the trip, not the method for your own car. Say where this ride went before it can count.',
} as const;

/** Asked when a business fare is not yet confirmed as overnight travel. Local fares are not given a Schedule C line. */
export const HIRED_FARE_OVERNIGHT = {
  question: 'Was this ride part of an overnight business trip away from home?',
  reason: 'This ride counts as travel only if it was part of an overnight business trip away from home.',
} as const;

/** True only when the saved purpose says the ride was overnight travel away from the tax home. */
export function hiredFareOvernightConfirmed(purpose: string): boolean {
  const overnight = /\bovernight\b/i.test(purpose);
  const awayFromHome = /\baway\s+from\s+(?:my\s+|the\s+|our\s+|their\s+)?(?:tax\s+)?home\b/i.test(purpose);
  const taxHome = /\btax\s+home\b/i.test(purpose);
  return overnight && (awayFromHome || taxHome);
}

export const HIRED_FARE_PERSONAL = {
  reason: 'This trip is personal, so the fare stays out of business deductions.',
} as const;

const FARE_BUSINESS_PURPOSE = /\b(?:clients?|customers?|job\s*sites?|meetings?|business|workplaces?|work\s+sites?|offices?|conferences?|appointments?|studios?|warehouses?|passengers?|airports?)\b/i;
const FARE_PERSONAL_PURPOSE = /\b(?:concerts?|movies?|cinema|gyms?|grocer(?:y|ies)|friends?|famil(?:y|ies)|vacations?|parties|personal|commut\w*|shopping|doctors?|dentists?|schools?)\b|\bhome\s+from\b/i;

/** Business, personal, or not stated. A commute is personal even when the destination is an office. */
export function hiredFarePurpose(purpose: string): 'business' | 'personal' | 'unstated' {
  const business = FARE_BUSINESS_PURPOSE.test(purpose);
  const personal = FARE_PERSONAL_PURPOSE.test(purpose);
  if (personal && /\bcommut/i.test(purpose)) return 'personal';
  if (business && !personal) return 'business';
  if (personal && !business) return 'personal';
  return 'unstated';
}
