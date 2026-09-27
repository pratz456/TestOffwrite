import { describe, expect, it } from 'vitest';
import { BUSINESS_STANDARD_MILEAGE_RATES, businessMileageRateForDate, describeBusinessMileageRatesForYear, summarizeBusinessMileage } from '../lib/tax-rules/mileage-rates';

describe('IRS business standard mileage rates', () => {
  it.each([
    ['2024-06-01', 0.67], ['2025-01-01', 0.70], ['2025-12-31', 0.70],
    ['2026-01-01', 0.725], ['2026-06-30', 0.725], ['2026-07-01', 0.76], ['2026-12-31', 0.76],
  ])('applies the published rate for %s', (date, rate) => {
    expect(businessMileageRateForDate(date)?.ratePerMile).toBe(rate);
  });
  it('returns null instead of guessing for unpublished or invalid periods', () => {
    expect(businessMileageRateForDate('2027-01-15')).toBeNull();
    expect(businessMileageRateForDate('2023-12-31')).toBeNull();
    expect(businessMileageRateForDate('not a date')).toBeNull();
    expect(businessMileageRateForDate(undefined)).toBeNull();
  });
  it('covers every period with a primary IRS source and no overlapping dates', () => {
    for (let index = 0; index < BUSINESS_STANDARD_MILEAGE_RATES.length; index++) {
      const period = BUSINESS_STANDARD_MILEAGE_RATES[index];
      expect(period.source).toMatch(/^https:\/\/www\.irs\.gov\//);
      expect(period.from <= period.to).toBe(true);
      if (index) expect(BUSINESS_STANDARD_MILEAGE_RATES[index - 1].to < period.from).toBe(true);
    }
  });
  it('builds user-facing annual rate copy from the dated registry and fails closed for unpublished years', () => {
    expect(describeBusinessMileageRatesForYear(2025)).toBe('The 2025 business standard mileage rate is 70 cents per mile.');
    expect(describeBusinessMileageRatesForYear(2026)).toContain('January 1 through June 30: 72.5 cents per mile. July 1 through December 31: 76 cents per mile.');
    expect(describeBusinessMileageRatesForYear(2027)).toContain('has not been verified as published');
  });
  it('sums trips at each trip date rate and reports unrated trips separately', () => {
    const summary = summarizeBusinessMileage([
      { date: '2026-03-10', miles: 100 },
      { date: '2026-08-10', miles: 100 },
      { date: '2027-02-01', miles: 40 },
      { date: '2026-01-01', miles: -5 },
    ]);
    expect(summary).toEqual({ deduction: 148.5, ratedMiles: 200, unratedMiles: 40, unratedTrips: 1, ratesApplied: [0.725, 0.76] });
  });
});
