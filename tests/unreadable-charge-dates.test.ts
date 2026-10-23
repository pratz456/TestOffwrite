import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import * as transactionExport from '@/lib/reports/transaction-export';
import { accountResultSchema } from '@/lib/tax-assistant/account-contract';
import { transactionAccountResult } from '@/lib/tax-assistant/account-tools';
import * as assistantContext from '@/lib/tax-assistant/context';

const { convertTransactionsToCSV, selectExportYear } = transactionExport;
const { assistantProfileFacts, composeForYou, mentionedMerchantFacts } = assistantContext;

function exportNeedsMoreInformationCount(rows: readonly Record<string, unknown>[]) {
  expect(typeof transactionExport.needsMoreInformationCount).toBe('function');
  return transactionExport.needsMoreInformationCount(rows);
}

function needsMoreInformationCount(rows: readonly { date?: unknown; datetime?: unknown; userId?: unknown; user_id?: unknown }[], uid?: string) {
  expect(typeof assistantContext.needsMoreInformationCount).toBe('function');
  return assistantContext.needsMoreInformationCount(rows, uid);
}

const formats = [
  ['a slash date that can be read two ways', '01/05/2025'],
  ['a single digit slash date that can be read two ways', '1/5/2025'],
  ['an epoch number', Date.UTC(2025, 0, 5)],
  ['an impossible date', '2025-02-30'],
  ['an impossible day with a time', '2025-02-30 10:00:00'],
  ['an impossible written day', 'Feb 30, 2025'],
  ['an impossible year first slash day', '2025/02/30'],
  ['an impossible year first slash month', '2025/13/01'],
  ['an impossible year first leap day', '2025/02/29'],
  ['an impossible written leap day', 'Feb 29, 2025'],
  ['an impossible leap day', '2025-02-29'],
  ['an impossible numeric slash day', '02/30/2025'],
  ['an impossible numeric slash month', '13/13/2025'],
  ['a missing date', undefined],
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
  it.each(formats)('counts %s in Needs more information and in no total', (_label, date) => {
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
