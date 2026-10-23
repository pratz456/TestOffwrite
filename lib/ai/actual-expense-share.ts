/** Shown when the car's method for the year is actual expenses and no business-use share is recorded yet. */
export const ACTUAL_EXPENSE_BUSINESS_SHARE = {
  question: 'What percentage of this car\'s use was for business?',
  reason: 'This car uses actual expenses, so fuel, repairs and insurance count only at the business-use share. Record that percentage before this charge can count.',
} as const;

/** Saved category for an actual-expense car cost that has a recorded business-use share. Schedule C line 9. */
export const VEHICLE_ACTUAL_EXPENSE_CATEGORY = 'VEHICLE_ACTUAL_EXPENSE';

export function finiteUsePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
