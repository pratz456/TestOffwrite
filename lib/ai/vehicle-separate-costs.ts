/**
 * Costs a self-employed person still deducts, at the business-use share, on top of
 * either vehicle method (Rev. Proc. 2019-46 sec. 4.03). Parking and tolls are the
 * only add-on that counts in full. Interest and vehicle personal property tax never
 * default to 100%.
 */
import { tripStartsAtHome } from '@/lib/mileage/vehicles';
import { profileHasHomeOffice } from '@/lib/profile/home-office';
import { ACTUAL_EXPENSE_BUSINESS_SHARE } from './actual-expense-share';

export { profileHasHomeOffice } from '@/lib/profile/home-office';

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

/** One question. The answer is the saved purpose, matched to these labels exactly. */
export const HIRED_FARE_USE = {
  question: 'What was this ride for?',
  reason: 'Choose what this ride was for before it can count.',
  overnight: 'Part of an overnight work trip away from home',
  between: 'Between work locations',
  betweenWithHomeOffice: 'Between work locations, or from home to a client if you work from a home office',
  commute: 'Home to my usual workplace',
  personal: 'Personal ride',
  overnightReason: 'This ride was part of an overnight work trip away from home.',
  betweenReason: 'This ride was between work locations.',
  commuteReason: 'A ride from home to your usual workplace is commuting, so the fare stays out of business deductions.',
  homeStartReason: 'This ride started at home and the profile has no home office, so this answer stays open.',
} as const;

/** Recorded category for a local hired fare. It uses the other expenses line. */
export const HIRED_LOCAL_TRANSPORT_CATEGORY = 'HIRED_LOCAL_TRANSPORT';

export function hiredFareBetweenLabel(profile: unknown): string {
  return profileHasHomeOffice(profile) ? HIRED_FARE_USE.betweenWithHomeOffice : HIRED_FARE_USE.between;
}

/** The question, then the four answers. The long between label is used when the profile has a home office. */
export function hiredFareUsePrompt(profile: unknown): string[] {
  return [HIRED_FARE_USE.question, HIRED_FARE_USE.overnight, hiredFareBetweenLabel(profile), HIRED_FARE_USE.commute, HIRED_FARE_USE.personal];
}

export function hiredFarePurposeText(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  return ['business_purpose', 'notes', 'note'].map(key => typeof data[key] === 'string' ? data[key] as string : '').filter(Boolean).join(' ').trim();
}

export function hiredFareChoice(purpose: string): 'overnight' | 'between' | 'commute' | 'personal' | null {
  const text = purpose.trim();
  if (text === HIRED_FARE_USE.overnight) return 'overnight';
  if (text === HIRED_FARE_USE.between || text === HIRED_FARE_USE.betweenWithHomeOffice) return 'between';
  if (text === HIRED_FARE_USE.commute) return 'commute';
  if (text === HIRED_FARE_USE.personal) return 'personal';
  return null;
}

/** The saved purpose wins. Other notes do not change an exact answer. */
export function hiredFareChoiceFromRecord(data: Record<string, unknown> | null | undefined): 'overnight' | 'between' | 'commute' | 'personal' | null {
  if (!data) return null;
  const purpose = typeof data.business_purpose === 'string' ? hiredFareChoice(data.business_purpose) : null;
  return purpose ?? hiredFareChoice(hiredFarePurposeText(data));
}

/**
 * True when mileage_details.start_location is a home start, false when it is some other place,
 * and null when this charge has no trip origin.
 */
export function hiredFareStartedAtHome(data: Record<string, unknown> | null | undefined): boolean | null {
  const details = data?.mileage_details;
  if (!details || typeof details !== 'object') return null;
  const start = (details as { start_location?: unknown }).start_location;
  if (typeof start !== 'string' || !start.trim()) return null;
  return tripStartsAtHome(start);
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
