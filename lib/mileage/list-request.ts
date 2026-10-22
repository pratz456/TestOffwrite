import { localCalendarYear } from '@/lib/dates/calendar-day';

/** Mileage list URL. The year is the device calendar year, not the server clock. */
export function mileageTripsPath(userId: string, year = localCalendarYear()): string {
  return `/api/mileage?userId=${encodeURIComponent(userId)}&year=${year}`;
}
