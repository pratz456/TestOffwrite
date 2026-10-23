import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import * as taxDate from '@/lib/schedule-c/taxDate';
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
  { input: ' 2025/01/05 ', day: '2025-01-05' },
  { input: '2025/01/01', day: '2025-01-01' },
  { input: '2025/12/31', day: '2025-12-31' },
  { input: '2026/01/01', day: '2026-01-01' },
  { input: '12/31/2025', day: '2025-12-31' },
  { input: '12/31/2024', day: '2024-12-31' },
  { input: '31/12/2025', day: '2025-12-31' },
  { input: '31/12/2024', day: '2024-12-31' },
  { input: '01/01/2026', day: '2026-01-01' },
  { input: '01/01/2025', day: '2025-01-01' },
  { input: '05/05/2025', day: '2025-05-05' },
  { input: '02/02/2025', day: '2025-02-02' },
  { input: '12/12/2025', day: '2025-12-12' },
  { input: '01/13/2025', day: '2025-01-13' },
  { input: '13/01/2025', day: '2025-01-13' },
  { input: '06/15/2025', day: '2025-06-15' },
  { input: '15/06/2025', day: '2025-06-15' },
  { input: '02/29/2024', day: '2024-02-29' },
  { input: '29/02/2024', day: '2024-02-29' },
  { input: '1/31/2025', day: '2025-01-31' },
  { input: '31/1/2025', day: '2025-01-31' },
  { input: '2025-1-5', day: '2025-01-05' },
  { input: '1/1/2025', day: '2025-01-01' },
  { input: '1/1/2026', day: '2026-01-01' },
  { input: '9/15/2025', day: '2025-09-15' },
  { input: '15/9/2025', day: '2025-09-15' },
  { input: '2/29/2024', day: '2024-02-29' },
  { input: '29/2/2024', day: '2024-02-29' },
  { input: ' 2026/01/01 ', day: '2026-01-01' },
  { input: '1 Jan 2026', day: '2026-01-01' },
  { input: 'Jan 1 2026', day: '2026-01-01' },
  { input: 'Jan 1 2025', day: '2025-01-01' },
  { input: 'Thursday Jan 01 2026', day: '2026-01-01' },
  { input: 'Dec 31, 2025 11:30 PM', day: '2025-12-31' },
  { input: 'Jan 1, 2026 12:30 AM', day: '2026-01-01' },
  { input: 'Jan 1, 2026 12:00 AM', day: '2026-01-01' },
  { input: 'Dec 31, 2025 11:59 PM', day: '2025-12-31' },
  { input: 'Jan 1, 2025 12:30 AM', day: '2025-01-01' },
  { input: 'January 1, 2026', day: '2026-01-01' },
  { input: 'December 31 2024 23:30', day: '2024-12-31' },
  { input: 'January 1 2025 00:30', day: '2025-01-01' },
];

const dropped: Array<{ label: string; input: unknown }> = [
  { label: 'two way slash 01/05/2025', input: '01/05/2025' },
  { label: 'two way slash 1/5/2025', input: '1/5/2025' },
  { label: 'two way slash 12/1/2025', input: '12/1/2025' },
  { label: 'two way slash 1/12/2025', input: '1/12/2025' },
  { label: 'two way slash 11/3/2026', input: '11/3/2026' },
  { label: 'two way slash 1/05/2025', input: '1/05/2025' },
  { label: 'two way slash 05/1/2025', input: '05/1/2025' },
  { label: 'two way slash 01/02/2026', input: '01/02/2026' },
  { label: 'two way slash 11/12/2025', input: '11/12/2025' },
  { label: 'two way slash 12/11/2025', input: '12/11/2025' },
  { label: 'impossible numeric slash day', input: '02/30/2025' },
  { label: 'impossible numeric slash 02/29/2025', input: '02/29/2025' },
  { label: 'impossible numeric slash month', input: '13/13/2025' },
  { label: 'epoch number', input: Date.UTC(2025, 0, 5) },
  { label: 'impossible day', input: '2025-02-30' },
  { label: 'impossible day with a time', input: '2025-02-30 10:00:00' },
  { label: 'impossible written day', input: 'Feb 30, 2025' },
  { label: 'impossible year first slash day', input: '2025/02/30' },
  { label: 'impossible year first slash month', input: '2025/13/01' },
  { label: 'impossible year first leap day', input: '2025/02/29' },
  { label: 'impossible written leap day', input: 'Feb 29, 2025' },
  { label: 'impossible leap day', input: '2025-02-29' },
  { label: 'impossible numeric slash 2/29/2025', input: '2/29/2025' },
  { label: 'impossible unpadded iso day', input: '2025-2-30' },
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

/** On this head, chargeDay and chargeYear match safeYMD and safeTaxYear. Base does not export those two. */
function expectReadersAgree(input: unknown, day: string | null, year: number | null) {
  expect(safeYMD(input)).toBe(day);
  expect(safeTaxYear(input)).toBe(year);
  if (typeof taxDate.chargeDay !== 'function' || typeof taxDate.chargeYear !== 'function') {
    expect(taxDate.chargeDay).toBeUndefined();
    expect(taxDate.chargeYear).toBeUndefined();
    return;
  }
  expect(taxDate.chargeDay({ date: input })).toBe(day);
  expect(taxDate.chargeYear({ date: input })).toBe(year);
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
    expectReadersAgree(input, day, year);
    const baseYear = baseSafeTaxYear(input);
    if (baseYear !== null && baseYear !== year) {
      expect(day.endsWith('-01-01') || day.endsWith('-12-31'), `${input} base year ${baseYear}`).toBe(true);
    }
    if (baseYear !== null && baseYear === year) expect(safeTaxYear(input)).toBe(baseYear);
    countedIn(input, year);
  });
});

describe('numeric slash dates on the year boundary', () => {
  it.each([
    ['12/31/2025', '2025-12-31', 2025],
    ['01/01/2026', '2026-01-01', 2026],
    ['31/12/2025', '2025-12-31', 2025],
    ['1/31/2025', '2025-01-31', 2025],
    ['31/1/2025', '2025-01-31', 2025],
    ['1/1/2026', '2026-01-01', 2026],
    ['2025-1-5', '2025-01-05', 2025],
  ])('%s counts in %i', (input, day, year) => {
    expectReadersAgree(input, day, year);
    countedIn(input, year);
  });

  it.each(['01/02/2026', '01/05/2025', '1/5/2025', '12/1/2025', '1/12/2025', '11/3/2026', '2025/13/01'])('%s goes to Needs more information', (input) => {
    expectReadersAgree(input, null, null);
    for (const year of ['2024', '2025', '2026']) {
      const totals = aggregateScheduleC([row(input)], year, CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(totals.totalDeductible).toBe(0);
      expect(totals.needsMoreInformation).toBe(1);
    }
  });

  it('an epoch number stays in Needs more information', () => {
    const input = Date.UTC(2025, 0, 5);
    expectReadersAgree(input, null, null);
    for (const year of ['2024', '2025', '2026']) {
      const totals = aggregateScheduleC([row(input)], year, CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(totals.totalDeductible).toBe(0);
      expect(totals.needsMoreInformation).toBe(1);
    }
  });
});

describe('ruled drop outs stay in Needs more information', () => {
  it.each(dropped)('$label stays out of totals', ({ input }) => {
    expectReadersAgree(input, null, null);
    const totals = aggregateScheduleC([row(input)], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(0);
    expect(totals.needsMoreInformation).toBe(1);
  });
});
