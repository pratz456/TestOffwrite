import { describe, expect, it } from 'vitest';
import { safeYMD } from '@/lib/schedule-c/taxDate';

// Run this file in separate processes with TZ=America/Los_Angeles and TZ=Asia/Tokyo.
describe('printed calendar days ignore the process time zone', () => {
  it.each([
    ['01/01/2026', '2026-01-01'],
    ['12/31/2025', '2025-12-31'],
    ['Jan 1, 2026', '2026-01-01'],
    ['January 1 2026', '2026-01-01'],
    ['1 Jan 2026', '2026-01-01'],
    ['2026-01-01', '2026-01-01'],
    ['2026-01-01T00:00:00.000Z', '2026-01-01'],
    ['2026-01-01T00:00:00+14:00', '2026-01-01'],
    ['2025-1-5', '2025-01-05'],
    ['2025-1-5T00:00:00', '2025-01-05'],
    ['31/12/2025', '2025-12-31'],
    ['1/31/2025', '2025-01-31'],
    ['12-31-2025', '2025-12-31'],
    ['2025/1/5', '2025-01-05'],
    ['2025/12/31', '2025-12-31'],
    ['11/11/2025', '2025-11-11'],
    ['2024-02-29', '2024-02-29'],
  ])('reads %s as %s', (printed, stored) => {
    expect(safeYMD(printed)).toBe(stored);
  });

  it.each([
    '01/05/2025',
    '1/5/2025',
    '12/1/2025',
    '1/12/2025',
    '11/3/2026',
    '09/02/2026',
    '12/01/2025',
    '02/30/2025',
    '2025-02-30',
    '2025-13-01',
    '2025/13/01',
    '2025/31/12',
    '2025/02/30',
    '',
    'not-a-date',
  ])('leaves %s unset', (printed) => {
    expect(safeYMD(printed)).toBeNull();
  });

  it('reads a Date or epoch millisecond as the UTC calendar day of that instant', () => {
    const midnight = Date.UTC(2026, 0, 1);
    const justBefore = midnight - 1;
    expect(safeYMD(midnight)).toBe('2026-01-01');
    expect(safeYMD(new Date(midnight))).toBe('2026-01-01');
    expect(safeYMD(justBefore)).toBe('2025-12-31');
    expect(safeYMD(new Date(justBefore))).toBe('2025-12-31');
    expect(safeYMD(new Date(2026, 0, 1))).toBe(new Date(2026, 0, 1).toISOString().slice(0, 10));
  });
});
