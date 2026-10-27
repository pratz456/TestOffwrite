import { Timestamp } from 'firebase/firestore';
import { safeYMD } from '../lib/schedule-c/taxDate';
import { formatTransactionDate } from '../lib/transactions/calendar-date';

export type CalendarInputKind = 'Date' | 'Timestamp' | '{seconds, nanoseconds}';

/** A Date, a Firestore Timestamp, or a plain {seconds, nanoseconds} object for one local midnight. */
export function calendarInputValue(kind: CalendarInputKind, localMidnight: Date): unknown {
  if (kind === 'Date') return localMidnight;
  const stamp = Timestamp.fromDate(localMidnight);
  if (kind === 'Timestamp') return stamp;
  return { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds };
}

export function readCalendarInput(kind: CalendarInputKind, localMidnight: Date): { formatted: string; ymd: string | null } {
  const value = calendarInputValue(kind, localMidnight);
  return { formatted: formatTransactionDate(value), ymd: safeYMD(value) };
}
