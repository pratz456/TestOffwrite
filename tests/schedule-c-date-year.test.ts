import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP, UNREADABLE_DATE_REVIEW } from '@/lib/schedule-c/aggregate';
import { resolveOtherExpensesYear } from '@/lib/schedule-c/other-expenses-line';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';

const DISPLAY_BLOCK = 'Review missing or invalid transaction dates before showing confirmed deduction totals.';

function meal(date: unknown) {
  return {
    id: 'meal-20-01',
    amount: 20.01,
    date,
    category: 'FOOD_AND_DRINK_RESTAURANT',
    merchant_name: 'Meal',
    is_deductible: true as const,
    review_status: 'confirmed' as const,
    pending: false,
    iso_currency_code: 'USD',
  };
}

describe('schedule C date year', () => {
  it('counts ISO, Date, and Timestamp meals in 2026 and flags unreadable dates in the aggregate, CSV, PDF, and display', async () => {
    const cases = [
      { label: 'iso', date: '2026-01-15', year: 2026 as number | null },
      { label: 'date', date: new Date('2026-01-15T12:00:00.000Z'), year: 2026 as number | null },
      { label: 'timestamp', date: { toDate: () => new Date('2026-01-15T12:00:00.000Z') }, year: 2026 as number | null },
      { label: 'us', date: '01/15/2026', year: null },
      { label: 'impossible', date: '2025-02-30', year: null },
    ];

    for (const item of cases) {
      const record = meal(item.date);
      expect(resolveOtherExpensesYear(record), item.label).toBe(item.year);
      const aggregate = aggregateScheduleC([record], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
      const csv = generateScheduleCCSV(aggregate.lineItemsArray, 2026, aggregate.unreadableDates);
      const spy = vi.spyOn(PDFPage.prototype, 'drawText');
      await generateScheduleCPlanningPDF({
        taxYear: 2026,
        grossReceipts: 0,
        lineItems: aggregate.lineItemsArray,
        includeAppendix: true,
        unreadableDates: aggregate.unreadableDates,
      });
      const pdf = spy.mock.calls.map(call => String(call[0])).join(' ').replace(/\s+/g, ' ');
      spy.mockRestore();
      const display = summarizeConfirmedDeductions([record], 2026);

      if (item.year === 2026) {
        expect(aggregate.lineItems['24b']?.lineCode, item.label).toBe('24b');
        expect(aggregate.lineItems['24b']?.total, item.label).toBe(20.01);
        expect(aggregate.lineItems['24b']?.deductible, item.label).toBe(10.01);
        expect(aggregate.totalDeductible, item.label).toBe(10.01);
        expect(aggregate.unreadableDates, item.label).toEqual([]);
        expect(csv, item.label).toContain('24b');
        expect(csv, item.label).toContain('20.01');
        expect(csv, item.label).toContain('10.01');
        expect(csv, item.label).not.toContain(UNREADABLE_DATE_REVIEW);
        expect(pdf, item.label).toContain('24b');
        expect(pdf, item.label).toContain('$20.01');
        expect(pdf, item.label).toContain('$10.01');
        expect(pdf, item.label).not.toContain(UNREADABLE_DATE_REVIEW);
        expect(display.reviewMessage, item.label).toBeNull();
        expect(display.totalDeductible, item.label).toBe(10.01);
        expect(display.totalRecordedAmount, item.label).toBe(20.01);
      } else {
        expect(aggregate.totalDeductible, item.label).toBe(0);
        expect(aggregate.totalExpenses, item.label).toBe(0);
        expect(aggregate.lineItems['24b'], item.label).toBeUndefined();
        expect(aggregate.unreadableDates, item.label).toEqual([record]);
        expect(csv, item.label).toContain(UNREADABLE_DATE_REVIEW);
        expect(csv, item.label).not.toContain('24b');
        expect(csv, item.label).not.toContain('10.01');
        expect(pdf, item.label).toContain(UNREADABLE_DATE_REVIEW);
        expect(pdf, item.label).not.toContain('24b');
        expect(pdf, item.label).not.toContain('$10.01');
        expect(display.totalDeductible, item.label).toBeNull();
        expect(display.totalRecordedAmount, item.label).toBeNull();
        expect(display.reviewMessage, item.label).toBe(DISPLAY_BLOCK);
        expect(display.contributions.size, item.label).toBe(0);
      }
    }
  });
});
