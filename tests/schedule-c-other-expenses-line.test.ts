import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import {
  readStoredAiScheduleCLines, SCHEDULE_C_OTHER_EXPENSES_LINE,
} from '@/lib/schedule-c/other-expenses-line';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { normalizeExplanation, scheduleCLineFor } from '@/lib/ai/explanation';
import { reviewHydrationFields } from '@/lib/transactions/ai-review-contract';
import { suggestionScheduleCLine } from '@/lib/transactions/review-proposals';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { assembleAuditSupportPacket, auditSupportPacketCSV } from '@/lib/reports/audit-support-packet';

const OTHER_EXPENSE_AMOUNT = 80.25;
const FUEL_AMOUNT = 10;
const MEAL_AMOUNT = 10.01;
const MEAL_DEDUCTIBLE = 5.01;

function confirmed(year: number, category: string, amount: number, merchant: string) {
  return {
    amount,
    date: `${year}-06-01`,
    category,
    is_deductible: true as const,
    merchant_name: merchant,
    id: `${merchant}-${year}`,
    description: 'Confirmed business record',
  };
}

function aggregated(year: number) {
  return aggregateScheduleC([
    confirmed(year, 'SERVICE_EDUCATION', OTHER_EXPENSE_AMOUNT, 'OTHER-EXPENSE-MERCHANT'),
    confirmed(year, 'TRANSPORTATION_FUEL', FUEL_AMOUNT, 'FUEL-MERCHANT'),
    confirmed(year, 'FOOD_AND_DRINK_RESTAURANT', MEAL_AMOUNT, 'MEAL-MERCHANT'),
  ], String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
}

describe('Schedule C other expenses line 27b', () => {
  it('keeps one published line constant and does not label other expenses as 27a', () => {
    expect(SCHEDULE_C_OTHER_EXPENSES_LINE).toBe('27b');
    const published = readFileSync('lib/schedule-c/other-expenses-line.ts', 'utf8');
    expect(published).toContain("export const SCHEDULE_C_OTHER_EXPENSES_LINE = '27b'");
    expect(published.match(/'27a'/g)).toEqual(["'27a'"]);
    const sources = [
      'lib/schedule-c/aggregate.ts',
      'lib/schedule-c/export-lines.ts',
      'lib/ai/merchant-intelligence.ts',
      'lib/ai/transaction-tax-policy.ts',
      'lib/ai/profession-priors.ts',
      'lib/tax-assistant/knowledge.ts',
      'lib/ai/explanation.ts',
      'lib/transactions/ai-review-contract.ts',
      'lib/transactions/review-proposals.ts',
      'components/schedule-c-export-screen.tsx',
      'lib/reports/schedule-c-csv.ts',
      'lib/reports/schedule-c-pdf.ts',
      'lib/reports/audit-support-packet.ts',
      'content/blog/1099-forms-explained.mdx',
      'content/blog/complete-guide-schedule-c-freelancers.mdx',
      'content/blog/education-professional-development-deduction.mdx',
      'content/blog/etsy-seller-tax-guide.mdx',
      'content/blog/how-to-track-business-expenses.mdx',
    ];
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?<![\d])27a\b/);
    }
  });

  it.each([2023, 2024, 2025, 2026])('aggregate, CSV and export line show 27b for %s without changing other lines or amounts', year => {
    const result = aggregated(year);
    const other = result.lineItemsArray.find(line => line.lineName === 'Other expenses');
    const fuel = result.lineItemsArray.find(line => line.lineCode === '9');
    const meals = result.lineItemsArray.find(line => line.lineCode === '24b');
    expect(other).toMatchObject({ lineCode: '27b', deductible: OTHER_EXPENSE_AMOUNT, total: OTHER_EXPENSE_AMOUNT, transactionCount: 1 });
    expect(fuel).toMatchObject({ lineCode: '9', lineName: 'Car and truck expenses', deductible: FUEL_AMOUNT, total: FUEL_AMOUNT });
    expect(meals).toMatchObject({ lineCode: '24b', lineName: 'Meals', deductible: MEAL_DEDUCTIBLE, total: MEAL_AMOUNT });
    expect(result.totalDeductible).toBeCloseTo(OTHER_EXPENSE_AMOUNT + FUEL_AMOUNT + MEAL_DEDUCTIBLE, 2);
    const csv = generateScheduleCCSV(result.lineItemsArray, year);
    expect(csv).toContain(`OTHER-EXPENSE-MERCHANT,SERVICE_EDUCATION,27b,${OTHER_EXPENSE_AMOUNT},`);
    expect(csv).toContain(`FUEL-MERCHANT,TRANSPORTATION_FUEL,9,${FUEL_AMOUNT},`);
    expect(csv).toContain(`MEAL-MERCHANT,FOOD_AND_DRINK_RESTAURANT,24b,${MEAL_AMOUNT},`);
    expect(csv).not.toMatch(/(?<![\d])27a\b/);
    expect(scheduleCExportLine('27a', year)).toBe('27b');
    expect(scheduleCExportLine('27b', year)).toBe('27b');
    expect(scheduleCExportLine('24b', year)).toBe('24b');
    expect(scheduleCExportLine('9', year)).toBe('9');
  });

  it.each([2023, 2024, 2026])('PDF shows 27b for other expenses in %s and the same dollar amounts', async year => {
    const result = aggregated(year);
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const bytes = await generateScheduleCPlanningPDF({
      taxYear: year,
      grossReceipts: 1000,
      lineItems: result.lineItemsArray,
      includeAppendix: true,
    });
    const text = spy.mock.calls.map(call => String(call[0])).join('\n');
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(text).toContain('27b');
    expect(text).toContain('24b');
    expect(text).toContain('$80.25');
    expect(text).toContain('$10.00');
    expect(text).toContain('$5.01');
    expect(text).not.toMatch(/(?<![\d])27a\b/);
    spy.mockRestore();
  });

  it('audit support packet uses 27b for an other-expense category and keeps the amount', () => {
    const packet = assembleAuditSupportPacket('owner', 2024, {
      transactions: [{
        userId: 'owner', trans_id: 'edu', id: 'edu', exportReference: 'transaction-edu',
        date: '2024-06-01', amount: OTHER_EXPENSE_AMOUNT, iso_currency_code: 'USD',
        merchant_name: 'OTHER-EXPENSE-MERCHANT', category: 'SERVICE_EDUCATION',
        is_deductible: true, review_status: 'confirmed', review_source: 'user_corrected',
        reviewed_at: '2024-06-02T00:00:00.000Z', user_classification_reason: 'Course for the current business.',
      }],
      trips: [], receipts: [],
    }, new Date('2026-01-01T00:00:00.000Z'));
    expect(packet.deductions).toHaveLength(1);
    expect(packet.deductions[0]).toMatchObject({ scheduleCLine: '27b', amount: OTHER_EXPENSE_AMOUNT, category: 'SERVICE_EDUCATION' });
    const csv = auditSupportPacketCSV(packet);
    expect(csv).toContain('27b');
    expect(csv).toContain('80.25');
    expect(csv).not.toMatch(/(?<![\d])27a\b/);
  });

  it('reads a stored ai_* line code 27a as 27b and leaves the saved record unchanged', () => {
    const stored = {
      ai_schedule_c_line: '27a',
      ai_suggestion: { id: 'saved-suggestion', scheduleCLine: '27a', schedule_c_line: '27a', reasoning: 'Saved analysis' },
      ai: { schedule_c_line: '27a', status: 'ok' },
      ai_explanation: {
        headline: 'Likely deductible: Other expenses',
        why: 'The saved analysis placed this cost with other expenses.',
        yourFacts: ['Design business'],
        scheduleCLine: 'Schedule C line 27a (Other expenses)',
        estimatedTaxEffect: null,
        strengthen: ['Keep the receipt'],
        nextQuestion: null,
      },
      amount: OTHER_EXPENSE_AMOUNT,
    };
    const read = readStoredAiScheduleCLines(stored);
    expect(read.ai_schedule_c_line).toBe('27b');
    expect(read.ai_suggestion).toMatchObject({ scheduleCLine: '27b', schedule_c_line: '27b' });
    expect(read.ai).toMatchObject({ schedule_c_line: '27b', status: 'ok' });
    expect(read.ai_explanation.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(stored.ai_schedule_c_line).toBe('27a');
    expect(stored.ai_suggestion.scheduleCLine).toBe('27a');
    expect(stored.ai_suggestion.schedule_c_line).toBe('27a');
    expect(stored.ai.schedule_c_line).toBe('27a');
    expect(stored.ai_explanation.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    expect(stored.amount).toBe(OTHER_EXPENSE_AMOUNT);

    const hydrated = reviewHydrationFields(stored);
    expect(hydrated.ai_schedule_c_line).toBe('27b');
    expect(hydrated.ai_suggestion.scheduleCLine).toBe('27b');
    expect(hydrated.ai.schedule_c_line).toBe('27b');
    expect(hydrated.ai_explanation.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(stored.ai_schedule_c_line).toBe('27a');
    expect(suggestionScheduleCLine({ ai_suggestion: stored.ai_suggestion })).toBe('27b');
    expect(normalizeExplanation(stored.ai_explanation)?.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(scheduleCLineFor({ schedule_c_line: '27a', category: 'other', transaction_kind: 'expense', status: 'ok' } as never)).toBe('Schedule C line 27b (Other expenses)');
    expect(stored.ai_explanation.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');

    const unchanged = { ai_schedule_c_line: '24b', ai: { schedule_c_line: '18' }, amount: FUEL_AMOUNT };
    expect(readStoredAiScheduleCLines(unchanged)).toBe(unchanged);
    expect(unchanged.ai_schedule_c_line).toBe('24b');
    expect(scheduleCLineFor({ schedule_c_line: '18', category: 'software_subscriptions', transaction_kind: 'expense', status: 'ok' } as never)).toBe('Schedule C line 18 (Office expense)');
  });

  it('revert proof: labeling other expenses as 27a again fails the export and stored-read checks', () => {
    const result = aggregated(2024);
    const other = result.lineItems['27b'];
    expect(other.lineCode).toBe('27b');
    expect(other.deductible).toBe(OTHER_EXPENSE_AMOUNT);
    expect(result.lineItems['27a']).toBeUndefined();
    expect(generateScheduleCCSV(result.lineItemsArray, 2024)).toContain(',27b,80.25,');
    expect(readStoredAiScheduleCLines({ ai_schedule_c_line: '27a' }).ai_schedule_c_line).toBe('27b');
    expect(CATEGORY_MAP.SERVICE_EDUCATION).toMatchObject({ line: '27b', code: '27b', name: 'Other expenses' });
    expect(CATEGORY_MAP.TRANSPORTATION_FUEL).toMatchObject({ line: '9', code: '9' });
    expect(CATEGORY_MAP.FOOD_AND_DRINK_RESTAURANT).toMatchObject({ line: '24b', code: '24b' });
    const unmapped = aggregateScheduleC([
      confirmed(2024, 'UNMAPPED_CATEGORY', 3.25, 'UNMAPPED-MERCHANT'),
    ], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(unmapped.lineItemsArray).toEqual([expect.objectContaining({ lineCode: '27b', lineName: 'Other expenses', deductible: 3.25, total: 3.25 })]);
    expect(unmapped.totalDeductible).toBe(3.25);
  });
});
