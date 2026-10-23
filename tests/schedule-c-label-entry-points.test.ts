import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const dues = {
  id: 'dues-179d', trans_id: 'dues-179d', merchant_name: 'AIGA', amount: 120, date: '2026-06-15',
  category: 'SERVICE_PROFESSIONAL_DUES', iso_currency_code: 'USD', is_deductible: true,
  review_status: 'confirmed', schedule_c_line: '27a (179D)',
};

describe('Schedule C callers keep a 179D label', () => {
  it('schedule C csv: a confirmed 179D-labeled dues row contributes 0', () => {
    const totals = aggregateScheduleC([dues], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(totals.lineItems.review).toBeUndefined();
    expect(Object.values(totals.lineItems).some(item => item.lineName === 'Needs more information')).toBe(false);
    const csv = generateScheduleCCSV(totals.lineItemsArray, 2026, totals.needsMoreInformation);
    expect(csv).toContain('2026-06-15,AIGA,SERVICE_PROFESSIONAL_DUES,,120,0,');
    expect(csv).toContain('Needs more information');
    expect(csv).not.toContain(',120,120,');
  });

  it('schedule C pdf: a confirmed 179D-labeled dues row contributes 0', async () => {
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const totals = aggregateScheduleC([dues], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    await generateScheduleCPlanningPDF({ taxYear: 2026, grossReceipts: 0, lineItems: totals.lineItemsArray, needsMoreInformation: totals.needsMoreInformation, includeAppendix: true });
    const drawn = spy.mock.calls.map(call => String(call[0]));
    expect(drawn.filter(value => value === '$120.00')).toHaveLength(1);
    expect(drawn).toContain('$0.00');
  });

  it('federal tax snapshot: a confirmed 179D-labeled dues row contributes 0', () => {
    const result = buildFederalTaxSnapshot({
      taxYear: 2026, profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(),
      transactions: [dues], grossReceipts: [{ amount: 100000 }], forms1099: [], w2Entries: [], deductions: {}, assets: [], estimatedPayments: 0,
    });
    expect(result.income.scheduleCNetProfit).toBe(100000);
    expect(result.scheduleC.profitBeforeAssets).toBe(100000);
  });
});
