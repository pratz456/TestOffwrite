import { addCalendarDays, parseCalendarDay } from '@/lib/dates/calendar-day';
import { BUSINESS_STANDARD_MILEAGE_RATES, businessMileageRateForDate, summarizeBusinessMileage } from '@/lib/tax-rules/mileage-rates';

/**
 * Gig mileage gap.
 *
 * App-reported miles are the on-trip miles the gig apps counted.
 * Gap = odometer miles − those on-trip miles.
 * The gap is split into to-pickup, home-to-first/last-drop-off-home, online-and-waiting, and whatever is still unlisted.
 *
 * Dollars use businessMileageRateForDate / summarizeBusinessMileage.
 * Priced miles are on-trip and to-pickup, plus home miles only when the driver marks a qualifying home office.
 * Online-and-waiting miles are never priced. A period with no published rate contributes no dollars.
 * A range that touches more than one rate period is priced only from miles the caller assigns to each period.
 */

export interface MileageRateSegment {
  from: string;
  to: string;
  ratePerMile: number | null;
}

export interface GigMileagePeriodInput {
  from: string;
  to: string;
  onTripMiles: number;
  toPickupMiles: number;
  commuteMiles: number;
}

export interface GigMileageGapInput {
  startDate: string;
  endDate: string;
  onTripMiles: number;
  toPickupMiles: number;
  commuteMiles: number;
  waitingMiles: number;
  odometerMiles: number;
  qualifyingHomeOffice: boolean;
  periodMiles?: readonly GigMileagePeriodInput[];
}

export type GigMileageGapError = 'invalid-date' | 'end-before-start' | 'invalid-miles';
export type PeriodSplitStatus = 'not-needed' | 'required' | 'mismatch' | 'complete';
export type PortionPricing = 'priced' | 'rate-pending' | 'unallocated';

export interface GigMileagePortion {
  from: string;
  to: string;
  ratePerMile: number | null;
  businessMiles: number | null;
  deduction: number | null;
  pricing: PortionPricing;
}

export interface GigMileageGapResult {
  valid: boolean;
  errors: GigMileageGapError[];
  gapMiles: number | null;
  onTripMiles: number | null;
  toPickupMiles: number | null;
  commuteMiles: number | null;
  /** On-trip plus to-pickup. Commute and online-and-waiting miles are never included. */
  reviewMiles: number | null;
  unexplainedMiles: number | null;
  segments: MileageRateSegment[];
  crossesJuly12026: boolean;
  splitStatus: PeriodSplitStatus;
  portions: GigMileagePortion[];
  businessMiles: number | null;
  estimatedDeduction: number | null;
  commuteIncluded: boolean;
  waitingMiles: number | null;
}

export type MilesParse = { ok: true; miles: number } | { ok: false; reason: 'empty' | 'invalid' };

const EMPTY_RESULT: GigMileageGapResult = {
  valid: false,
  errors: [],
  gapMiles: null,
  onTripMiles: null,
  toPickupMiles: null,
  commuteMiles: null,
  reviewMiles: null,
  unexplainedMiles: null,
  segments: [],
  crossesJuly12026: false,
  splitStatus: 'not-needed',
  portions: [],
  businessMiles: null,
  estimatedDeduction: null,
  commuteIncluded: false,
  waitingMiles: null,
};

export function parseMilesInput(raw: string): MilesParse {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };
  const trimmed = raw.trim();
  if (!/^(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/.test(trimmed)) return { ok: false, reason: 'invalid' };
  const miles = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(miles) || miles < 0) return { ok: false, reason: 'invalid' };
  return { ok: true, miles };
}

export function roundMiles(miles: number): number {
  return Math.round(miles * 100) / 100;
}

export function formatGigMiles(miles: number): string {
  const negative = miles < 0;
  const rounded = roundMiles(Math.abs(miles));
  const [whole, frac] = rounded.toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${trimmed ? `${withCommas}.${trimmed}` : withCommas}`;
}

export function formatGigDollars(amount: number): string {
  const negative = amount < 0;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const [whole, frac] = rounded.toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${withCommas}.${frac}`;
}

export function mileageSegmentKey(segment: { from: string; to: string }): string {
  return `${segment.from}:${segment.to}`;
}

function isMiles(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function rateForDay(ymd: string): number | null {
  return businessMileageRateForDate(ymd)?.ratePerMile ?? null;
}

export function mileageRateSegments(startDate: string, endDate: string): MileageRateSegment[] | null {
  const start = parseCalendarDay(startDate);
  const end = parseCalendarDay(endDate);
  if (!start || !end || start.ymd > end.ymd) return null;

  const overlapping = BUSINESS_STANDARD_MILEAGE_RATES
    .filter(period => period.to >= start.ymd && period.from <= end.ymd)
    .slice()
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const segments: MileageRateSegment[] = [];
  let cursor = start.ymd;

  const push = (from: string, to: string) => {
    if (from > to) return;
    segments.push({ from, to, ratePerMile: rateForDay(from) });
  };

  for (const period of overlapping) {
    const from = period.from > cursor ? period.from : cursor;
    const to = period.to < end.ymd ? period.to : end.ymd;
    if (cursor < from) {
      const gapEnd = addCalendarDays(from, -1);
      if (!gapEnd) return null;
      push(cursor, gapEnd);
    }
    push(from, to);
    const next = addCalendarDays(to, 1);
    if (!next) return null;
    cursor = next;
  }

  if (cursor <= end.ymd) push(cursor, end.ymd);
  return segments;
}

function businessMilesOf(onTrip: number, toPickup: number, commute: number, includeCommute: boolean): number {
  return roundMiles(onTrip + toPickup + (includeCommute ? commute : 0));
}

function invalid(errors: GigMileageGapError[]): GigMileageGapResult {
  return { ...EMPTY_RESULT, errors };
}

export function calculateGigMileageGap(input: GigMileageGapInput): GigMileageGapResult {
  const start = parseCalendarDay(input.startDate);
  const end = parseCalendarDay(input.endDate);
  if (!start || !end) return invalid(['invalid-date']);
  if (start.ymd > end.ymd) return invalid(['end-before-start']);

  const mileValues = [input.onTripMiles, input.toPickupMiles, input.commuteMiles, input.waitingMiles, input.odometerMiles];
  if (!mileValues.every(isMiles)) return invalid(['invalid-miles']);

  const segments = mileageRateSegments(start.ymd, end.ymd);
  if (!segments) return invalid(['invalid-date']);

  const onTrip = roundMiles(input.onTripMiles);
  const toPickup = roundMiles(input.toPickupMiles);
  const commute = roundMiles(input.commuteMiles);
  const waiting = roundMiles(input.waitingMiles);
  const odometer = roundMiles(input.odometerMiles);
  const includeCommute = input.qualifyingHomeOffice;
  const needsSplit = segments.length > 1;
  const crossesJuly12026 = start.ymd <= '2026-06-30' && end.ymd >= '2026-07-01';
  const gapMiles = roundMiles(odometer - onTrip);
  const unexplainedMiles = roundMiles(gapMiles - toPickup - commute - waiting);
  const businessMiles = businessMilesOf(onTrip, toPickup, commute, includeCommute);

  const base = {
    valid: true,
    errors: [] as GigMileageGapError[],
    gapMiles,
    onTripMiles: onTrip,
    toPickupMiles: toPickup,
    commuteMiles: commute,
    reviewMiles: roundMiles(onTrip + toPickup),
    unexplainedMiles,
    segments,
    crossesJuly12026,
    businessMiles,
    commuteIncluded: includeCommute,
    waitingMiles: waiting,
  };

  if (!needsSplit) {
    const segment = segments[0];
    const portion = pricePortion(segment, businessMiles);
    const estimatedDeduction = portion.pricing === 'priced' ? portion.deduction : null;
    return {
      ...base,
      splitStatus: 'not-needed',
      portions: [portion],
      estimatedDeduction,
    };
  }

  const allocation = allocateSplit(segments, input.periodMiles, onTrip, toPickup, commute, includeCommute);
  if (allocation.status !== 'complete') {
    return {
      ...base,
      splitStatus: allocation.status,
      portions: segments.map(segment => ({
        from: segment.from,
        to: segment.to,
        ratePerMile: segment.ratePerMile,
        businessMiles: null,
        deduction: null,
        pricing: 'unallocated' as const,
      })),
      estimatedDeduction: null,
    };
  }

  const portions = segments.map(segment => {
    const row = allocation.rows.find(item => item.from === segment.from && item.to === segment.to)!;
    const miles = businessMilesOf(row.onTripMiles, row.toPickupMiles, row.commuteMiles, includeCommute);
    return pricePortion(segment, miles);
  });

  const ratedTrips = portions.flatMap(portion => {
    if (portion.pricing !== 'priced' || portion.businessMiles === null) return [];
    return [{ date: portion.from, miles: portion.businessMiles }];
  });
  const hasPricedPortion = portions.some(portion => portion.pricing === 'priced');
  const estimatedDeduction = hasPricedPortion ? summarizeBusinessMileage(ratedTrips).deduction : null;

  return {
    ...base,
    splitStatus: 'complete',
    portions,
    estimatedDeduction,
  };
}

function pricePortion(segment: MileageRateSegment, businessMiles: number): GigMileagePortion {
  const period = businessMileageRateForDate(segment.from);
  if (!period) {
    return {
      from: segment.from,
      to: segment.to,
      ratePerMile: null,
      businessMiles,
      deduction: null,
      pricing: 'rate-pending',
    };
  }
  const summary = summarizeBusinessMileage([{ date: segment.from, miles: businessMiles }]);
  return {
    from: segment.from,
    to: segment.to,
    ratePerMile: period.ratePerMile,
    businessMiles,
    deduction: summary.deduction,
    pricing: 'priced',
  };
}

function allocateSplit(
  segments: readonly MileageRateSegment[],
  periodMiles: readonly GigMileagePeriodInput[] | undefined,
  onTrip: number,
  toPickup: number,
  commute: number,
  includeCommute: boolean,
): { status: 'required' | 'mismatch'; rows?: undefined } | { status: 'complete'; rows: GigMileagePeriodInput[] } {
  if (!periodMiles || periodMiles.length === 0) return { status: 'required' };

  const rows: GigMileagePeriodInput[] = [];
  const seen = new Set<string>();
  for (const row of periodMiles) {
    if (!parseCalendarDay(row.from) || !parseCalendarDay(row.to)) return { status: 'required' };
    if (!isMiles(row.onTripMiles) || !isMiles(row.toPickupMiles) || !isMiles(row.commuteMiles)) {
      return { status: 'mismatch' };
    }
    const key = mileageSegmentKey(row);
    if (seen.has(key) || !segments.some(segment => mileageSegmentKey(segment) === key)) return { status: 'mismatch' };
    seen.add(key);
    rows.push({
      from: row.from,
      to: row.to,
      onTripMiles: roundMiles(row.onTripMiles),
      toPickupMiles: roundMiles(row.toPickupMiles),
      commuteMiles: roundMiles(row.commuteMiles),
    });
  }

  if (segments.some(segment => !seen.has(mileageSegmentKey(segment)))) return { status: 'required' };

  const sum = (pick: (row: GigMileagePeriodInput) => number) => roundMiles(rows.reduce((total, row) => total + pick(row), 0));
  const onTripMatches = sum(row => row.onTripMiles) === onTrip;
  const toPickupMatches = sum(row => row.toPickupMiles) === toPickup;
  const commuteMatches = !includeCommute || sum(row => row.commuteMiles) === commute;
  if (!onTripMatches || !toPickupMatches || !commuteMatches) return { status: 'mismatch' };
  return { status: 'complete', rows };
}
