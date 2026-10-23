const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Formats a planner ISO date as "January 15, 2027". The date itself comes from the deadline table. */
export function formatPlannerDueDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError('Provide the due date as YYYY-MM-DD.');
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new RangeError('Provide the due date as YYYY-MM-DD.');
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}

export function localIsoDate(date = new Date(), timeZone?: string): string {
  if (timeZone) return calendarIsoDate(date, timeZone);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Calendar date in an IANA timezone. YYYY-MM-DD is read from the calendar, not from UTC. */
export function calendarIsoDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError('Provide a calendar date.');
  return `${year}-${month}-${day}`;
}

/** Local calendar date for a YYYY-MM-DD string. Does not use UTC midnight. */
export function parsePlannerIsoDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError('Provide the date as YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new RangeError('Provide the date as YYYY-MM-DD.');
  }
  return date;
}

export function formatPlannerMonthDay(isoDate: string): string {
  return formatPlannerDueDate(isoDate).replace(/, \d{4}$/, '');
}

export function formatPlannerMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
