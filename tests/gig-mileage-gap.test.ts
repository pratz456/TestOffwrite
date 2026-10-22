import { describe, expect, it } from 'vitest';
import { businessMileageRateForDate, summarizeBusinessMileage } from '../lib/tax-rules/mileage-rates';
import {
  calculateGigMileageGap,
  mileageRateSegments,
  parseMilesInput,
  type GigMileageGapInput,
} from '../lib/tools/gig-mileage-gap';

function miles(overrides: Partial<GigMileageGapInput> = {}): GigMileageGapInput {
  return {
    startDate: '2026-06-30',
    endDate: '2026-06-30',
    onTripMiles: 100,
    toPickupMiles: 0,
    commuteMiles: 0,
    waitingMiles: 0,
    odometerMiles: 100,
    qualifyingHomeOffice: false,
    ...overrides,
  };
}

describe('gig mileage gap math', () => {
  it('prices June 30, 2026 at 72.5 cents and July 1, 2026 at 76 cents', () => {
    const june = calculateGigMileageGap(miles());
    const july = calculateGigMileageGap(miles({ startDate: '2026-07-01', endDate: '2026-07-01' }));
    expect(businessMileageRateForDate('2026-06-30')?.ratePerMile).toBe(0.725);
    expect(businessMileageRateForDate('2026-07-01')?.ratePerMile).toBe(0.76);
    expect(june.estimatedDeduction).toBe(summarizeBusinessMileage([{ date: '2026-06-30', miles: 100 }]).deduction);
    expect(july.estimatedDeduction).toBe(summarizeBusinessMileage([{ date: '2026-07-01', miles: 100 }]).deduction);
    expect(june.estimatedDeduction).toBe(72.5);
    expect(july.estimatedDeduction).toBe(76);
    expect(june.portions[0].ratePerMile).toBe(0.725);
    expect(july.portions[0].ratePerMile).toBe(0.76);
  });

  it('asks for a split when the range crosses July 1, 2026 and prices only the miles provided', () => {
    const crossed = miles({ endDate: '2026-07-01', onTripMiles: 100, odometerMiles: 100 });
    const withheld = calculateGigMileageGap(crossed);
    expect(withheld.crossesJuly12026).toBe(true);
    expect(withheld.splitStatus).toBe('required');
    expect(withheld.estimatedDeduction).toBeNull();
    expect(withheld.portions.every(portion => portion.deduction === null)).toBe(true);

    const partial = calculateGigMileageGap({
      ...crossed,
      periodMiles: [{ from: '2026-06-30', to: '2026-06-30', onTripMiles: 40, toPickupMiles: 0, commuteMiles: 0 }],
    });
    expect(partial.estimatedDeduction).toBeNull();

    const priced = calculateGigMileageGap({
      ...crossed,
      periodMiles: [
        { from: '2026-06-30', to: '2026-06-30', onTripMiles: 40, toPickupMiles: 0, commuteMiles: 0 },
        { from: '2026-07-01', to: '2026-07-01', onTripMiles: 60, toPickupMiles: 0, commuteMiles: 0 },
      ],
    });
    expect(priced.splitStatus).toBe('complete');
    expect(priced.estimatedDeduction).toBe(summarizeBusinessMileage([
      { date: '2026-06-30', miles: 40 },
      { date: '2026-07-01', miles: 60 },
    ]).deduction);
    expect(priced.estimatedDeduction).toBe(74.6);
    expect(priced.portions.map(portion => portion.deduction)).toEqual([29, 45.6]);

    const mismatch = calculateGigMileageGap({
      ...crossed,
      periodMiles: [
        { from: '2026-06-30', to: '2026-06-30', onTripMiles: 10, toPickupMiles: 0, commuteMiles: 0 },
        { from: '2026-07-01', to: '2026-07-01', onTripMiles: 10, toPickupMiles: 0, commuteMiles: 0 },
      ],
    });
    expect(mismatch.splitStatus).toBe('mismatch');
    expect(mismatch.estimatedDeduction).toBeNull();
  });

  it('shows no dollar amount for 2027 or for the unrated part of a range', () => {
    const pending = calculateGigMileageGap(miles({
      startDate: '2027-01-01',
      endDate: '2027-03-31',
      onTripMiles: 50,
      toPickupMiles: 5,
      commuteMiles: 3,
      waitingMiles: 2,
      odometerMiles: 80,
      qualifyingHomeOffice: true,
    }));
    expect(businessMileageRateForDate('2027-01-15')).toBeNull();
    expect(pending.estimatedDeduction).toBeNull();
    expect(pending.portions).toEqual([
      expect.objectContaining({ ratePerMile: null, deduction: null, pricing: 'rate-pending' }),
    ]);
    expect(pending.reviewMiles).toBe(55);

    const mixed = calculateGigMileageGap(miles({
      startDate: '2026-12-31',
      endDate: '2027-01-02',
      onTripMiles: 50,
      toPickupMiles: 5,
      odometerMiles: 55,
      periodMiles: [
        { from: '2026-12-31', to: '2026-12-31', onTripMiles: 10, toPickupMiles: 0, commuteMiles: 0 },
        { from: '2027-01-01', to: '2027-01-02', onTripMiles: 40, toPickupMiles: 5, commuteMiles: 0 },
      ],
    }));
    expect(mixed.portions[0]).toMatchObject({ pricing: 'priced', deduction: 7.6 });
    expect(mixed.portions[1]).toMatchObject({ pricing: 'rate-pending', deduction: null, ratePerMile: null });
    expect(mixed.estimatedDeduction).toBe(7.6);
  });

  it('keeps commute and online-and-waiting miles out of the review total, and prices commute only with a home office', () => {
    const shared = {
      onTripMiles: 10,
      toPickupMiles: 5,
      commuteMiles: 20,
      waitingMiles: 8,
      odometerMiles: 50,
    };
    const excluded = calculateGigMileageGap(miles(shared));
    const included = calculateGigMileageGap(miles({ ...shared, qualifyingHomeOffice: true }));
    const noWaiting = calculateGigMileageGap(miles({ ...shared, waitingMiles: 0 }));

    expect(excluded.reviewMiles).toBe(15);
    expect(included.reviewMiles).toBe(15);
    expect(excluded.businessMiles).toBe(15);
    expect(included.businessMiles).toBe(35);
    expect(excluded.estimatedDeduction).toBe(summarizeBusinessMileage([
      { date: '2026-06-30', miles: 15 },
    ]).deduction);
    expect(included.estimatedDeduction).toBe(summarizeBusinessMileage([
      { date: '2026-06-30', miles: 35 },
    ]).deduction);
    expect(excluded.estimatedDeduction).not.toBe(included.estimatedDeduction);
    expect(noWaiting.estimatedDeduction).toBe(excluded.estimatedDeduction);
    expect(noWaiting.reviewMiles).toBe(excluded.reviewMiles);
    expect(excluded.waitingMiles).toBe(8);
    expect(excluded.gapMiles).toBe(40);
    expect(excluded.unexplainedMiles).toBe(7);
    expect(included.gapMiles).toBe(excluded.gapMiles);
  });

  it('splits the odometer gap into to-pickup, commute, waiting, and miles not listed', () => {
    const result = calculateGigMileageGap(miles({
      onTripMiles: 60,
      toPickupMiles: 15,
      commuteMiles: 10,
      waitingMiles: 5,
      odometerMiles: 100,
    }));
    expect(result.gapMiles).toBe(40);
    expect(result.unexplainedMiles).toBe(10);
    expect(result.reviewMiles).toBe(75);
    expect(mileageRateSegments('2026-06-30', '2026-07-01')).toEqual([
      { from: '2026-06-30', to: '2026-06-30', ratePerMile: 0.725 },
      { from: '2026-07-01', to: '2026-07-01', ratePerMile: 0.76 },
    ]);
  });

  it('rejects invalid dates, reversed ranges, and miles that are not numbers', () => {
    expect(calculateGigMileageGap(miles({ startDate: '2026-02-31' })).errors).toEqual(['invalid-date']);
    expect(calculateGigMileageGap(miles({ endDate: '2026-06-01' })).errors).toEqual(['end-before-start']);
    expect(calculateGigMileageGap(miles({ waitingMiles: -1 })).errors).toEqual(['invalid-miles']);
    expect(parseMilesInput('100junk')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMilesInput('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMilesInput('1,058.5')).toEqual({ ok: true, miles: 1058.5 });
  });
});
