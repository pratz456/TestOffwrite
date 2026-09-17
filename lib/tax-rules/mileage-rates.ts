/**
 * IRS optional business standard mileage rates by effective period.
 * Rates for periods not yet announced return null so callers show a pending
 * state instead of applying a stale or guessed rate.
 */
export interface BusinessMileageRatePeriod {
  from: string;
  to: string;
  ratePerMile: number;
  source: string;
}

export const BUSINESS_STANDARD_MILEAGE_RATES: readonly BusinessMileageRatePeriod[] = [
  { from: '2024-01-01', to: '2024-12-31', ratePerMile: 0.67, source: 'https://www.irs.gov/pub/irs-drop/n-24-08.pdf' },
  { from: '2025-01-01', to: '2025-12-31', ratePerMile: 0.70, source: 'https://www.irs.gov/pub/irs-drop/n-25-05.pdf' },
  { from: '2026-01-01', to: '2026-06-30', ratePerMile: 0.725, source: 'https://www.irs.gov/pub/irs-drop/n-26-10.pdf' },
  // Announcement 2026-11 raised the rate for miles driven on or after July 1, 2026.
  { from: '2026-07-01', to: '2026-12-31', ratePerMile: 0.76, source: 'https://www.irs.gov/irb/2026-29_irb' },
];

function calendarDay(value: string | Date | undefined | null): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Rate for the trip date, or null when the IRS has not published one for that period. */
export function businessMileageRateForDate(date: string | Date | undefined | null): BusinessMileageRatePeriod | null {
  const day = calendarDay(date);
  if (!day) return null;
  return BUSINESS_STANDARD_MILEAGE_RATES.find(period => day >= period.from && day <= period.to) ?? null;
}

export interface MileageDeductionSummary {
  deduction: number;
  ratedMiles: number;
  unratedMiles: number;
  unratedTrips: number;
  ratesApplied: number[];
}

/** Standard-mileage deduction using each trip's own dated rate; unrated trips are reported, not guessed. */
export function summarizeBusinessMileage(trips: ReadonlyArray<{ date: string; miles: number }>): MileageDeductionSummary {
  const summary: MileageDeductionSummary = { deduction: 0, ratedMiles: 0, unratedMiles: 0, unratedTrips: 0, ratesApplied: [] };
  for (const trip of trips) {
    const miles = Number.isFinite(trip.miles) && trip.miles > 0 ? trip.miles : 0;
    const period = businessMileageRateForDate(trip.date);
    if (!period) {
      summary.unratedMiles += miles;
      summary.unratedTrips += 1;
      continue;
    }
    summary.ratedMiles += miles;
    summary.deduction += miles * period.ratePerMile;
    if (!summary.ratesApplied.includes(period.ratePerMile)) summary.ratesApplied.push(period.ratePerMile);
  }
  summary.deduction = Math.round(summary.deduction * 100) / 100;
  return summary;
}
