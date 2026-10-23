import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import { convertTransactionsToCSV, needsMoreInformationCount as exportNeedsMoreInformationCount, selectExportYear } from '@/lib/reports/transaction-export';
import { accountResultSchema } from '@/lib/tax-assistant/account-contract';
import { transactionAccountResult } from '@/lib/tax-assistant/account-tools';
import { assistantProfileFacts, composeForYou, mentionedMerchantFacts, needsMoreInformationCount } from '@/lib/tax-assistant/context';

const formats = [
  ['slash date', '01/05/2025'],
  ['epoch number', Date.UTC(2025, 0, 5)],
  ['impossible date', '2025-02-30'],
  ['impossible day with a time', '2025-02-30 10:00:00'],
  ['impossible written day', 'Feb 30, 2025'],
  ['missing date', undefined],
] as const;

function charge(id: string, amount: number, date: unknown) {
  const row: Record<string, unknown> = {
    id, trans_id: id, userId: 'owner', merchant_name: 'Staples', amount,
    category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD',
    is_deductible: true, review_status: 'confirmed', pending: false,
    created_at: '2026-01-01T03:00:00.000Z',
  };
  if (date !== undefined) row.date = date;
  return row;
}

describe('unreadable charge dates stay in Needs more information and out of totals', () => {
  it.each(formats)('counts a %s in Needs more information and in no total', (_label, date) => {
    const dated = charge('dated', 40, '2025-06-01');
    const unreadable = charge('unreadable', 100, date);
    const rows = [dated, unreadable];

    for (const year of ['2025', '2026']) {
      const totals = aggregateScheduleC(rows as never, year, CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(totals.needsMoreInformation).toBe(1);
      expect(totals.undated.map(row => row.id)).toEqual(['unreadable']);
      expect(totals.totalDeductible).toBe(year === '2025' ? 40 : 0);
      expect(totals.totalExpenses).toBe(year === '2025' ? 40 : 0);
      expect(totals.counts).toEqual({ deductible: year === '2025' ? 1 : 0, year: year === '2025' ? 1 : 0 });
      expect(totals.lineItemsArray.flatMap(item => item.transactions).map(row => row.id)).not.toContain('unreadable');
    }

    expect(exportNeedsMoreInformationCount(rows)).toBe(1);
    for (const year of [2025, 2026]) {
      let failure: unknown;
      try { selectExportYear(rows, year); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED', needsMoreInformation: 1 });
    }
    expect(selectExportYear([dated], 2025).reduce((sum, row) => sum + Number(row.amount), 0)).toBe(40);
    expect(selectExportYear([dated], 2026)).toEqual([]);
    const exported = convertTransactionsToCSV([unreadable]);
    expect(exported.split('\r\n')[1].split(',')[2]).toBe('');
    expect(exported).toContain('Needs more information');
    expect(convertTransactionsToCSV([dated])).toContain('2025-06-01');
    expect(convertTransactionsToCSV([dated])).not.toContain('Needs more information');

    const dashboard = summarizeDashboardRecords(rows);
    expect(dashboard.needsMoreInformationCount).toBe(1);
    expect(dashboard.deductibleCount).toBe(1);
    expect(dashboard.pendingCount).toBe(0);
    expect(dashboard.needsReviewCount).toBe(0);
    expect(dashboard.categoryMagnitude).toBe(40);
    expect(dashboard.categoryEntries.some(([, amount]) => amount === 100)).toBe(false);

    expect(needsMoreInformationCount(rows, 'owner')).toBe(1);
    expect(mentionedMerchantFacts({ message: 'How much did Staples cost', rows, taxYear: 2025, uid: 'owner' })).toMatchObject({ count: 1, totalCents: 4000 });
    expect(mentionedMerchantFacts({ message: 'How much did Staples cost', rows, taxYear: 2026, uid: 'owner' })).toBeNull();
    const paragraph = composeForYou({ profile: assistantProfileFacts(null), merchant: null, undatedCount: needsMoreInformationCount(rows, 'owner') }, 'software-subscriptions')?.paragraph ?? '';
    expect(paragraph).toContain('Needs more information: 1 saved charge');
    expect(paragraph).not.toMatch(/\bin 2025\b/);
    expect(paragraph).not.toMatch(/\bin 2026\b/);
    expect(paragraph).not.toContain('100');

    for (const taxYear of [2025, 2026]) {
      const account = transactionAccountResult({ intent: 'review_transactions', rows, uid: 'owner', taxYear, now: new Date('2026-10-23T12:00:00Z') });
      expect(accountResultSchema.parse(account.account).metrics).toContainEqual({ label: 'Needs more information', value: '1' });
      expect(account.account.scope).toContain(`Checked ${taxYear === 2025 ? 1 : 0} records dated ${taxYear}`);
      expect(account.account.items.map(item => item.detail).join(' ')).not.toContain('100');
    }
  });
});
