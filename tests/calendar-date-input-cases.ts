import { Timestamp } from 'firebase/firestore';
import { safeYMD } from '../lib/schedule-c/taxDate';
import { formatTransactionDate } from '../lib/transactions/calendar-date';

export type CalendarInputKind = 'Date' | 'Timestamp' | '{seconds, nanoseconds}';

/**
 * Known gap. safeYMD sends values that are not strings through new Date(value),
 * then reads UTC getters. formatTransactionDate renders that UTC day, or '-'
 * when the Date is invalid. A Date built at Tokyo local midnight on Jan 1 2027
 * therefore formats as Dec 31. A Firestore Timestamp and a plain
 * {seconds, nanoseconds} object both come back as '-' because new Date(obj) is NaN.
 * This records the current behavior. safeYMD is unchanged.
 */
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
