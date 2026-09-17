import {
  HOME_OFFICE_ANSWERS, HOME_OFFICE_EXCLUSIVE_USE_EXCEPTIONS, HOME_OFFICE_HOUSING_TYPES, HOME_OFFICE_METHODS, HOME_OFFICE_QUALIFYING_USES,
  type HomeOfficeSettings,
} from '@/lib/reports/calc8829';

const AMOUNT_FIELDS = ['totalHomeSqFt', 'officeSqFt', 'rentOrMortgageInterest', 'utilities', 'insurance', 'repairsMaintenance', 'propertyTax', 'other'] as const;
const FACT_FIELDS = {
  method: HOME_OFFICE_METHODS, regularUse: HOME_OFFICE_ANSWERS, exclusiveUse: HOME_OFFICE_ANSWERS,
  exclusiveUseException: HOME_OFFICE_EXCLUSIVE_USE_EXCEPTIONS, qualifyingUse: HOME_OFFICE_QUALIFYING_USES, housingType: HOME_OFFICE_HOUSING_TYPES,
} as const;
const ALLOWED_KEYS = new Set<string>([...AMOUNT_FIELDS, ...Object.keys(FACT_FIELDS), 'monthsUsed']);

/**
 * Facts may be saved one answer at a time (null = not yet answered), so square footage is
 * optional here; the calculation, not the save, decides whether the facts are complete.
 * Unknown option values are rejected so a stale UI can never store a fact the calculation
 * would later misread.
 */
export function validateHomeOfficePayload(body: unknown): { settings: Partial<HomeOfficeSettings>; errors: string[] } {
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { settings: {}, errors: ['Send the home office settings as an object.'] };
  const input = body as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(input)) if (!ALLOWED_KEYS.has(key)) errors.push(`Unknown field: ${key}.`);
  for (const field of AMOUNT_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`${field} must be a finite number of zero or more.`);
    else settings[field] = value;
  }
  if (typeof settings.totalHomeSqFt === 'number' && typeof settings.officeSqFt === 'number' && settings.totalHomeSqFt > 0 && settings.officeSqFt > settings.totalHomeSqFt) {
    errors.push('Office square footage must not exceed total home square footage.');
  }
  for (const [field, allowed] of Object.entries(FACT_FIELDS)) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null || (typeof value === 'string' && (allowed as readonly string[]).includes(value))) settings[field] = value;
    else errors.push(`${field} must be one of ${allowed.join(', ')} or null when unanswered.`);
  }
  if (input.monthsUsed !== undefined) {
    const months = input.monthsUsed;
    if (months === null || (typeof months === 'number' && Number.isInteger(months) && months >= 0 && months <= 12)) settings.monthsUsed = months;
    else errors.push('monthsUsed must be a whole number from 0 to 12, or null when unanswered.');
  }
  return { settings: settings as Partial<HomeOfficeSettings>, errors };
}
