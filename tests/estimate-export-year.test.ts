import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeDay, chargeYear } from '@/lib/schedule-c/taxDate';
import { getLocalTransactionDate } from '@/lib/tax-provider/quarterly-estimates';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('@/lib/reports/export-records', () => ({
  readOwnedTransactions: async () => state.rows,
}));

import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';

const zones = ['America/Los_Angeles', 'Asia/Tokyo'] as const;

function income(id: string, amount: number, extra: Record<string, unknown>) {
  return { id, trans_id: id, account_id: 'a1', amount, category: 'income', iso_currency_code: 'USD', pending: false, ...extra };
}

describe('readTaxExportTransactions keeps undated income in the year total', () => {
  beforeEach(() => { state.rows = []; });

  it('returns 1500 for 500 dated plus 1000 undated and 500 for the dated row alone', async () => {
    const dated = income('dated', -500, { date: '2025-03-01' });
    const undated = income('open', -1000, { datetime: '2025-06-15T12:00:00Z' });
    const expense = { id: 'exp', trans_id: 'exp', account_id: 'a1', amount: 250, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD', pending: false };
    state.rows = [dated, undated, expense];
    let thrown: unknown;
    let rows: Awaited<ReturnType<typeof readTaxExportTransactions>> = [];
    try {
      rows = await readTaxExportTransactions('owner', 2025);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(rows.map(row => row.id)).toEqual(['dated', 'open']);
    const open = rows.find(row => row.id === 'open');
    expect(open).toMatchObject({ placedWithoutDate: true, date: '' });
    expect(chargeDay(open)).toBeNull();
    expect(chargeYear(open)).toBeNull();
    for (const zone of zones) expect(getLocalTransactionDate(open!, zone)).toBeNull();
    const api = await import('@/lib/tax-provider/quarterly-estimates');
    for (const zone of zones) {
      expect(api.sumIncomeForYear(rows, 2025, zone).grossIncome).toBe(1500);
    }
    state.rows = [dated];
    const only = await readTaxExportTransactions('owner', 2025);
    expect(only.map(row => row.id)).toEqual(['dated']);
    expect(only[0]).not.toHaveProperty('placedWithoutDate');
    for (const zone of zones) {
      expect(api.sumIncomeForYear(only, 2025, zone).grossIncome).toBe(500);
    }
  });
});
