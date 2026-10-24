import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { formatExportMoney } from '@/lib/reports/planning-pdf';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import type { LineItemSummary } from '@/lib/schedule-c/aggregate';

describe('planning exports with a blank amount', () => {
  it('prints Amount needed instead of throwing when an export amount is null', () => {
    expect(formatExportMoney(null)).toBe('Amount needed');
    expect(formatExportMoney(undefined)).toBe('Amount needed');
    expect(() => formatExportMoney(Number.NaN)).toThrow('Export amounts must be finite.');
    expect(formatExportMoney(12.5)).toBe('$12.50');
  });

  it('builds a Schedule C planning PDF when an appendix row has no amount', async () => {
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const line = {
      lineCode: '27a', lineName: 'Other expenses', total: 12.5, deductible: 12.5, transactionCount: 1,
      transactions: [{ id: 'blank', merchant_name: 'BLANK MARKET', amount: null, date: '2026-09-02', category: 'other', is_deductible: true, review_status: 'confirmed' }],
    } as unknown as LineItemSummary;
    const bytes = await generateScheduleCPlanningPDF({ taxYear: 2026, grossReceipts: 100, lineItems: [line], includeAppendix: true });
    expect(bytes.byteLength).toBeGreaterThan(100);
    const text = spy.mock.calls.map(call => String(call[0])).join('\n');
    expect(text).toContain('BLANK MARKET');
    expect(text).toContain('Amount needed');
    expect(text).not.toContain('Export amounts must be finite');
  });
});
