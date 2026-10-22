import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { localCalendarYear } from '../lib/dates/calendar-day';
import { mileageTripsPath } from '../lib/mileage/list-request';

const stored = [
  { id: 'dec', userId: 'owner', date: '2026-12-31', startLocation: 'Home', endLocation: 'Client', miles: 12, businessPurpose: 'Year-end visit', roundTrip: false },
  { id: 'jan', userId: 'owner', date: '2027-01-01', startLocation: 'Home', endLocation: 'Office', miles: 4, businessPurpose: 'New year', roundTrip: false },
];

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
});
