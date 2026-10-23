import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Reader at 52f5788d. The year comparison uses this copy in the zone the suite is running in. */
function baseSafeYMD(dateLike: unknown): string | null {
  if (dateLike === null || dateLike === undefined) return null;
  if (typeof dateLike !== 'string') {
    const parsed = new Date(dateLike as string | number);
    if (Number.isNaN(parsed.getTime())) return null;
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
  }
  const text = dateLike.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
}

function baseSafeTaxYear(dateLike: unknown): number | null {
  const day = baseSafeYMD(dateLike);
  if (!day) return null;
  const year = Number(day.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

type Sample = { input: string; day: string };

const counted: Sample[] = [
  { input: '2025-01-05', day: '2025-01-05' },
  { input: '2025-12-31', day: '2025-12-31' },
  { input: '2026-01-01', day: '2026-01-01' },
  { input: '2025-01-05T10:00:00Z', day: '2025-01-05' },
  { input: '2025-12-31T15:00:00Z', day: '2025-12-31' },
  { input: '2026-01-01T15:00:00Z', day: '2026-01-01' },
  { input: '2024-12-31T20:00:00-08:00', day: '2024-12-31' },
  { input: '2025-01-05 10:00:00', day: '2025-01-05' },
  { input: '2025-12-31 10:00:00', day: '2025-12-31' },
  { input: '2026-01-01 10:00:00', day: '2026-01-01' },
  { input: '2025-01-05 10:00', day: '2025-01-05' },
  { input: '2025-12-31 10:00', day: '2025-12-31' },
  { input: '2026-01-01 10:00', day: '2026-01-01' },
  { input: '2025-01-01 10:00', day: '2025-01-01' },
  { input: '2025-01-05Z', day: '2025-01-05' },
  { input: '2025-12-31Z', day: '2025-12-31' },
  { input: '2026-01-01Z', day: '2026-01-01' },
  { input: ' 2025-01-05', day: '2025-01-05' },
  { input: '2025-01-05 ', day: '2025-01-05' },
  { input: ' 2025-12-31', day: '2025-12-31' },
  { input: ' 2026-01-01', day: '2026-01-01' },
  { input: ' 2025-01-01', day: '2025-01-01' },
  { input: '2025-12-31 ', day: '2025-12-31' },
  { input: '2026-01-01 ', day: '2026-01-01' },
  { input: 'Jan 5, 2025', day: '2025-01-05' },
  { input: 'January 5, 2025', day: '2025-01-05' },
  { input: 'jan 5 2025', day: '2025-01-05' },
  { input: 'JANUARY 5, 2025', day: '2025-01-05' },
  { input: '5 January 2025', day: '2025-01-05' },
  { input: '1 January 2025', day: '2025-01-01' },
  { input: '31 December 2025', day: '2025-12-31' },
  { input: '1 January 2026', day: '2026-01-01' },
  { input: 'Jan 1, 2025', day: '2025-01-01' },
  { input: 'Dec 31, 2025', day: '2025-12-31' },
  { input: 'Jan 1, 2026', day: '2026-01-01' },
  { input: 'Sun Jan 05 2025', day: '2025-01-05' },
  { input: 'Wed Dec 31 2025', day: '2025-12-31' },
  { input: 'Thu Jan 01 2026', day: '2026-01-01' },
  { input: 'Wed Jan 01 2025', day: '2025-01-01' },
  { input: 'Tue Dec 31 2024', day: '2024-12-31' },
  { input: 'Sept 5, 2025', day: '2025-09-05' },
  { input: 'Sept. 5, 2025', day: '2025-09-05' },
  { input: 'Sep 5, 2025', day: '2025-09-05' },
  { input: 'Sep. 5, 2025', day: '2025-09-05' },
  { input: 'Dec. 31, 2025', day: '2025-12-31' },
  { input: 'Jan. 1, 2026', day: '2026-01-01' },
  { input: 'Jan. 1, 2025', day: '2025-01-01' },
  { input: 'Jan 5, 2025 10:00 AM', day: '2025-01-05' },
  { input: 'Dec 31, 2025 10:00 AM', day: '2025-12-31' },
  { input: 'Jan 1, 2026 10:00 AM', day: '2026-01-01' },
  { input: 'Jan 1, 2025 10:00 AM', day: '2025-01-01' },
  { input: 'Dec 31, 2024 11:30 PM', day: '2024-12-31' },
  { input: 'January 5 2025 10:00', day: '2025-01-05' },
  { input: 'December 31 2025 10:00', day: '2025-12-31' },
  { input: 'January 1 2026 10:00', day: '2026-01-01' },
  { input: '2025/01/05', day: '2025-01-05' },
  { input: '2025/01/01', day: '2025-01-01' },
  { input: '2025/12/31', day: '2025-12-31' },
  { input: '2026/01/01', day: '2026-01-01' },
];

const dropped: Array<{ label: string; input: unknown }> = [
  { label: 'US slash', input: '01/05/2025' },
  { label: 'epoch number', input: Date.UTC(2025, 0, 5) },
  { label: 'impossible day', input: '2025-02-30' },
  { label: 'impossible day with a time', input: '2025-02-30 10:00:00' },
  { label: 'impossible written day', input: 'Feb 30, 2025' },
  { label: 'impossible year first slash day', input: '2025/02/30' },
  { label: 'impossible year first slash month', input: '2025/13/01' },
  { label: 'missing date', input: undefined },
];

function row(date: unknown) {
  const charge: Record<string, unknown> = {
    id: 'boundary', amount: 25, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD',
    is_deductible: true, review_status: 'confirmed',
  };
  if (date !== undefined) charge.date = date;
  return charge;
}

function countedIn(date: unknown, year: number) {
  expect(aggregateScheduleC([row(date)], String(year), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(25);
  for (const other of [2024, 2025, 2026]) {
    if (other === year) continue;
    expect(aggregateScheduleC([row(date)], String(other), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  }
}

describe('written charge days keep the day and the tax year', () => {
  it.each(counted)('$input is $day in that tax year', ({ input, day }) => {
    const year = Number(day.slice(0, 4));
    expect(safeYMD(input)).toBe(day);
    expect(safeTaxYear(input)).toBe(year);
    const baseYear = baseSafeTaxYear(input);
    if (baseYear !== null && baseYear !== year) {
      expect(day.endsWith('-01-01') || day.endsWith('-12-31'), `${input} base year ${baseYear}`).toBe(true);
    }
    if (baseYear !== null && baseYear === year) expect(safeTaxYear(input)).toBe(baseYear);
    countedIn(input, year);
  });
});

describe('ruled drop outs stay in Needs more information', () => {
  it.each(dropped)('$label stays out of totals', ({ input }) => {
    expect(safeYMD(input)).toBeNull();
    expect(safeTaxYear(input)).toBeNull();
    const totals = aggregateScheduleC([row(input)], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(0);
    expect(totals.needsMoreInformation).toBe(1);
  });
});
