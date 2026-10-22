import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { localCalendarDay, localCalendarYear } from '../lib/dates/calendar-day';
import { mileageTripsPath } from '../lib/mileage/list-request';
import { businessMileageRateForDate, summarizeBusinessMileage } from '../lib/tax-rules/mileage-rates';

type StoredTrip = { id: string; userId: string; date: string; startLocation: string; endLocation: string; miles: number; businessPurpose: string; roundTrip: boolean };

const stored: StoredTrip[] = [
  { id: 'dec', userId: 'owner', date: '2026-12-31', startLocation: 'Home', endLocation: 'Client', miles: 12, businessPurpose: 'Year-end visit', roundTrip: false },
  { id: 'jan', userId: 'owner', date: '2027-01-01', startLocation: 'Home', endLocation: 'Office', miles: 4, businessPurpose: 'New year', roundTrip: false },
];

function seed(trips: Array<Pick<StoredTrip, 'id' | 'date' | 'miles'>>) {
  stored.splice(0, stored.length, ...trips.map(trip => ({
    userId: 'owner', startLocation: 'Home', endLocation: 'Client', businessPurpose: 'Client visit', roundTrip: false, ...trip,
  })));
}

const defaultTrips = stored.map(trip => ({ ...trip }));
beforeEach(() => {
  stored.splice(0, stored.length, ...defaultTrips.map(trip => ({ ...trip })));
});

vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => ({
            forEach(callback: (doc: { id: string; data: () => (typeof stored)[number] }) => void) {
              for (const trip of stored) callback({ id: trip.id, data: () => trip });
            },
          }),
        }),
      }),
    }),
  },
}));

import { GET } from '../app/api/mileage/route';

const previousTz = process.env.TZ;
const instant = new Date('2027-01-01T00:30:00.000Z');

afterAll(() => {
  vi.useRealTimers();
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('mileage list year across midnight UTC', () => {
  it('client in America/Los_Angeles at 2026-12-31 16:30 PST requests year=2026 and the UTC server returns 2026 trips', async () => {
    vi.useFakeTimers();
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(instant);
    expect([new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate(), new Date().getHours(), new Date().getMinutes()]).toEqual([2026, 12, 31, 16, 30]);
    const path = mileageTripsPath('owner');
    expect(path).toBe('/api/mileage?userId=owner&year=2026');
    expect(localCalendarYear()).toBe(2026);

    process.env.TZ = 'UTC';
    vi.setSystemTime(instant);
    expect(localCalendarYear()).toBe(2027);

    const response = await GET(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(200);
    expect((await response.json()).map((trip: { date: string }) => trip.date)).toEqual(['2026-12-31']);
  });

  it('rejects a bad year', async () => {
    for (const year of ['2026abc', '26', '1999', '2101', '2026.5', '02026']) {
      expect((await GET(new NextRequest(`http://localhost/api/mileage?userId=owner&year=${encodeURIComponent(year)}`))).status, year).toBe(400);
    }
  });

  it('keeps an omitted year as the server calendar-year fallback', async () => {
    vi.useFakeTimers();
    process.env.TZ = 'UTC';
    vi.setSystemTime(instant);
    const response = await GET(new NextRequest('http://localhost/api/mileage?userId=owner'));
    expect(response.status).toBe(200);
    expect((await response.json()).map((trip: { date: string }) => trip.date)).toEqual(['2027-01-01']);
  });

  it('on 2027-01-02, year=2026 returns the full 2026 list and total, priced by each trip date', async () => {
    const january2 = new Date('2027-01-02T20:00:00.000Z');
    vi.useFakeTimers();
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(january2);
    expect(localCalendarDay()).toBe('2027-01-02');
    expect(localCalendarYear()).toBe(2027);

    process.env.TZ = 'UTC';
    vi.setSystemTime(january2);
    expect(localCalendarDay()).toBe('2027-01-02');
    expect(localCalendarYear()).toBe(2027);

    seed([
      { id: 'early', date: '2026-03-15', miles: 8 },
      { id: 'june', date: '2026-06-30', miles: 10 },
      { id: 'july', date: '2026-07-01', miles: 10 },
      { id: 'late', date: '2026-12-31', miles: 5 },
      { id: 'next', date: '2027-01-02', miles: 40 },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/mileage?userId=owner&year=2026'));
    expect(response.status).toBe(200);
    const trips = await response.json() as Array<{ date: string; miles: number }>;
    expect(trips.map(trip => trip.date)).toEqual(['2026-12-31', '2026-07-01', '2026-06-30', '2026-03-15']);
    expect(trips.map(trip => businessMileageRateForDate(trip.date)?.ratePerMile)).toEqual([0.76, 0.76, 0.725, 0.725]);

    const summary = summarizeBusinessMileage(trips);
    expect(summary).toEqual({ deduction: 24.45, ratedMiles: 33, unratedMiles: 0, unratedTrips: 0, ratesApplied: [0.76, 0.725] });
  });
});
