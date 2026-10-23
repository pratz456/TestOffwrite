import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { OTHER_EXPENSES_27B_FIRST_YEAR, otherExpensesLine, readStoredAiScheduleCLines } from '@/lib/schedule-c/other-expenses-line';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { assembleAuditSupportPacket, auditSupportPacketCSV } from '@/lib/reports/audit-support-packet';

const OTHER_EXPENSE_AMOUNT = 80.25;
const FUEL_AMOUNT = 10;
const MEAL_AMOUNT = 10.01;
const MEAL_DEDUCTIBLE = 5.01;
const TOTAL = OTHER_EXPENSE_AMOUNT + FUEL_AMOUNT + MEAL_DEDUCTIBLE;

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

function stored(year: number, code: '27a' | '27b') {
  return {
    date: `${year}-06-01`,
    amount: OTHER_EXPENSE_AMOUNT,
    ai_schedule_c_line: code,
    ai_suggestion: { id: 'saved-suggestion', scheduleCLine: code, schedule_c_line: code, reasoning: 'Saved analysis' },
    ai: { schedule_c_line: code, status: 'ok' },
    ai_explanation: {
      headline: 'Likely deductible: Other expenses',
      why: 'The saved analysis placed this cost with other expenses.',
      yourFacts: ['Design business'],
      scheduleCLine: `Schedule C line ${code} (Other expenses)`,
      estimatedTaxEffect: null,
      strengthen: ['Keep the receipt'],
      nextQuestion: null,
    },
  };
}

describe('Schedule C other expenses line follows the tax year', () => {
  it('keeps the year switch in one function driven by a fixed year, never the clock', () => {
    expect(OTHER_EXPENSES_27B_FIRST_YEAR).toBe(2025);
    expect(otherExpensesLine(OTHER_EXPENSES_27B_FIRST_YEAR - 1)).toBe('27a');
    expect(otherExpensesLine(2023)).toBe('27a');
    expect(otherExpensesLine(2024)).toBe('27a');
    expect(otherExpensesLine(2025)).toBe('27b');
    expect(otherExpensesLine(2026)).toBe('27b');
    expect(otherExpensesLine(OTHER_EXPENSES_27B_FIRST_YEAR)).toBe('27b');
    const source = readFileSync('lib/schedule-c/other-expenses-line.ts', 'utf8');
    expect(source.match(/taxYear >= OTHER_EXPENSES_27B_FIRST_YEAR \? '27b' : '27a'/g)).toEqual(["taxYear >= OTHER_EXPENSES_27B_FIRST_YEAR ? '27b' : '27a'"]);
    expect(source).not.toMatch(/Date\.now|new Date|getFullYear|getUTCFullYear/);
  });

  it('the same record shows 27a in 2024 and 27b in 2025 and 2026, with identical amounts', () => {
    expect(SUPPORTED_TAX_YEARS).toEqual([2024, 2025, 2026]);
    const record = {
      amount: OTHER_EXPENSE_AMOUNT,
      category: 'SERVICE_EDUCATION',
      is_deductible: true as const,
      merchant_name: 'SAME-RECORD',
      id: 'same-record',
      description: 'Confirmed business record',
      ai_schedule_c_line: '27a' as const,
    };
    const expectedLine = { 2024: '27a', 2025: '27b', 2026: '27b' } as const;
    const shown = SUPPORTED_TAX_YEARS.map(year => {
      const dated = { ...record, date: `${year}-06-01` };
      const result = aggregateScheduleC([dated], String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
      const other = result.lineItemsArray.find(item => item.lineName === 'Other expenses');
      const csv = generateScheduleCCSV(result.lineItemsArray, year);
      const read = readStoredAiScheduleCLines(dated);
      return { year, other, total: result.totalDeductible, form7205: result.lineItems[year >= 2025 ? '27a' : '27b'], csv, readLine: read.ai_schedule_c_line, amount: dated.amount };
    });
    expect(shown.map(item => [item.year, item.other?.lineCode, item.other?.deductible, item.other?.total, item.total, item.readLine, item.amount])).toEqual([
      [2024, '27a', OTHER_EXPENSE_AMOUNT, OTHER_EXPENSE_AMOUNT, OTHER_EXPENSE_AMOUNT, '27a', OTHER_EXPENSE_AMOUNT],
      [2025, '27b', OTHER_EXPENSE_AMOUNT, OTHER_EXPENSE_AMOUNT, OTHER_EXPENSE_AMOUNT, '27b', OTHER_EXPENSE_AMOUNT],
      [2026, '27b', OTHER_EXPENSE_AMOUNT, OTHER_EXPENSE_AMOUNT, OTHER_EXPENSE_AMOUNT, '27b', OTHER_EXPENSE_AMOUNT],
    ]);
    for (const item of shown) {
      expect(item.other?.lineCode).toBe(expectedLine[item.year]);
      expect(item.form7205).toBeUndefined();
      expect(item.csv).toContain(`SAME-RECORD,SERVICE_EDUCATION,${expectedLine[item.year]},${OTHER_EXPENSE_AMOUNT},`);
    }
    expect(shown[0].other?.deductible).toBe(shown[1].other?.deductible);
    expect(shown[1].other?.deductible).toBe(shown[2].other?.deductible);
    expect(shown[0].total).toBe(shown[1].total);
    expect(shown[1].total).toBe(shown[2].total);
    expect(record.amount).toBe(OTHER_EXPENSE_AMOUNT);
    expect(record.ai_schedule_c_line).toBe('27a');
  });

  it('2024 shows 27a and 2025 and 2026 show 27b with the same dollar amounts', () => {
    const byYear = [2024, 2025, 2026].map(year => ({ year, result: aggregated(year), line: year >= 2025 ? '27b' : '27a' }));
    for (const { year, result, line } of byYear) {
      const other = result.lineItemsArray.find(item => item.lineName === 'Other expenses');
      const fuel = result.lineItemsArray.find(item => item.lineCode === '9');
      const meals = result.lineItemsArray.find(item => item.lineCode === '24b');
      const form7205 = year >= 2025 ? '27a' : '27b';
      expect(other).toMatchObject({ lineCode: line, deductible: OTHER_EXPENSE_AMOUNT, total: OTHER_EXPENSE_AMOUNT, transactionCount: 1 });
      expect(result.lineItems[form7205]).toBeUndefined();
      expect(fuel).toMatchObject({ lineCode: '9', lineName: 'Car and truck expenses', deductible: FUEL_AMOUNT, total: FUEL_AMOUNT });
      expect(meals).toMatchObject({ lineCode: '24b', lineName: 'Meals', deductible: MEAL_DEDUCTIBLE, total: MEAL_AMOUNT });
      expect(result.totalDeductible).toBeCloseTo(TOTAL, 2);
      const csv = generateScheduleCCSV(result.lineItemsArray, year);
      expect(csv).toContain(`OTHER-EXPENSE-MERCHANT,SERVICE_EDUCATION,${line},${OTHER_EXPENSE_AMOUNT},`);
      expect(csv).toContain(`FUEL-MERCHANT,TRANSPORTATION_FUEL,9,${FUEL_AMOUNT},`);
      expect(csv).toContain(`MEAL-MERCHANT,FOOD_AND_DRINK_RESTAURANT,24b,${MEAL_AMOUNT},`);
      expect(csv).not.toContain(`,${form7205},${OTHER_EXPENSE_AMOUNT},`);
      expect(scheduleCExportLine('27a', year)).toBe(line);
      expect(scheduleCExportLine('27b', year)).toBe(line);
      expect(scheduleCExportLine('24b', year)).toBe('24b');
      expect(scheduleCExportLine('9', year)).toBe('9');
    }
    expect(byYear[0].result.totalDeductible).toBeCloseTo(byYear[1].result.totalDeductible, 2);
    expect(byYear[1].result.totalDeductible).toBeCloseTo(byYear[2].result.totalDeductible, 2);
    expect(byYear[0].result.lineItemsArray.find(item => item.lineName === 'Other expenses')!.deductible).toBe(OTHER_EXPENSE_AMOUNT);
    expect(byYear[1].result.lineItemsArray.find(item => item.lineName === 'Other expenses')!.deductible).toBe(OTHER_EXPENSE_AMOUNT);
    expect(byYear[2].result.lineItemsArray.find(item => item.lineName === 'Other expenses')!.deductible).toBe(OTHER_EXPENSE_AMOUNT);
  });

  it.each([
    [2024, '27a'],
    [2025, '27b'],
    [2026, '27b'],
  ] as const)('PDF for %s shows %s for other expenses and the same dollar amounts', async (year, line) => {
    const result = aggregated(year);
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const bytes = await generateScheduleCPlanningPDF({
      taxYear: year,
      grossReceipts: 1000,
      lineItems: result.lineItemsArray,
      includeAppendix: true,
    });
    const text = spy.mock.calls.map(call => String(call[0])).join('\n');
    const form7205 = year >= 2025 ? '27a' : '27b';
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(text).toContain(line);
    expect(text).toContain('24b');
    expect(text).toContain('$80.25');
    expect(text).toContain('$10.00');
    expect(text).toContain('$5.01');
    expect(text).not.toContain(form7205);
    spy.mockRestore();
  });

  it.each([
    [2024, '27a'],
    [2025, '27b'],
  ] as const)('audit support packet for %s uses %s and keeps the amount', (year, line) => {
    const packet = assembleAuditSupportPacket('owner', year, {
      transactions: [{
        userId: 'owner', trans_id: 'edu', id: 'edu', exportReference: 'transaction-edu',
        date: `${year}-06-01`, amount: OTHER_EXPENSE_AMOUNT, iso_currency_code: 'USD',
        merchant_name: 'OTHER-EXPENSE-MERCHANT', category: 'SERVICE_EDUCATION',
        is_deductible: true, review_status: 'confirmed', review_source: 'user_corrected',
        reviewed_at: `${year}-06-02T00:00:00.000Z`, user_classification_reason: 'Course for the current business.',
      }],
      trips: [], receipts: [],
    }, new Date('2026-01-01T00:00:00.000Z'));
    expect(packet.deductions).toHaveLength(1);
    expect(packet.deductions[0]).toMatchObject({ scheduleCLine: line, amount: OTHER_EXPENSE_AMOUNT, category: 'SERVICE_EDUCATION' });
    const csv = auditSupportPacketCSV(packet);
    expect(csv).toContain(line);
    expect(csv).toContain('80.25');
  });

  it('reads a stored 27a or 27b as other expenses for the record year and leaves the saved record unchanged', () => {
    const early = stored(2024, '27b');
    const earlyRead = readStoredAiScheduleCLines(early);
    expect(earlyRead).not.toBe(early);
    expect(earlyRead.ai_schedule_c_line).toBe('27a');
    expect(earlyRead.ai_suggestion).toMatchObject({ scheduleCLine: '27a', schedule_c_line: '27a' });
    expect(earlyRead.ai).toMatchObject({ schedule_c_line: '27a', status: 'ok' });
    expect(earlyRead.ai_explanation.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    expect(early.ai_schedule_c_line).toBe('27b');
    expect(early.ai_suggestion.scheduleCLine).toBe('27b');
    expect(early.ai.schedule_c_line).toBe('27b');
    expect(early.ai_explanation.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(early.amount).toBe(OTHER_EXPENSE_AMOUNT);

    const later = stored(2025, '27a');
    const laterRead = readStoredAiScheduleCLines(later);
    expect(laterRead.ai_schedule_c_line).toBe('27b');
    expect(laterRead.ai_suggestion).toMatchObject({ scheduleCLine: '27b', schedule_c_line: '27b' });
    expect(laterRead.ai_explanation.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(later.ai_schedule_c_line).toBe('27a');
    expect(later.ai_explanation.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');

    const sameYear = stored(2024, '27a');
    expect(readStoredAiScheduleCLines(sameYear)).toBe(sameYear);
    const laterSame = stored(2026, '27b');
    expect(readStoredAiScheduleCLines(laterSame)).toBe(laterSame);
    const unchanged = { date: '2025-06-01', ai_schedule_c_line: '24b', ai: { schedule_c_line: '18' }, amount: FUEL_AMOUNT };
    expect(readStoredAiScheduleCLines(unchanged)).toBe(unchanged);
  });

  it('2025 other expenses is line 27b, so a year switch stuck on 27a fails this check', () => {
    const result = aggregated(2025);
    const other = result.lineItems['27b'];
    expect(other.lineCode).toBe('27b');
    expect(other.deductible).toBe(OTHER_EXPENSE_AMOUNT);
    expect(result.lineItems['27a']).toBeUndefined();
    expect(generateScheduleCCSV(result.lineItemsArray, 2025)).toContain(',27b,80.25,');
    expect(readStoredAiScheduleCLines({ date: '2025-06-01', ai_schedule_c_line: '27a' }).ai_schedule_c_line).toBe('27b');
    expect(aggregated(2024).lineItems['27a']).toMatchObject({ lineCode: '27a', deductible: OTHER_EXPENSE_AMOUNT });
    expect(aggregated(2024).lineItems['27b']).toBeUndefined();
    expect(CATEGORY_MAP.TRANSPORTATION_FUEL).toMatchObject({ line: '9', code: '9' });
    expect(CATEGORY_MAP.FOOD_AND_DRINK_RESTAURANT).toMatchObject({ line: '24b', code: '24b' });
    const unmapped = aggregateScheduleC([
      confirmed(2025, 'UNMAPPED_CATEGORY', 3.25, 'UNMAPPED-MERCHANT'),
    ], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(unmapped.lineItemsArray).toEqual([expect.objectContaining({ lineCode: '27b', lineName: 'Other expenses', deductible: 3.25, total: 3.25 })]);
    expect(unmapped.totalDeductible).toBe(3.25);
    expect(unmapped.lineItems['27a']).toBeUndefined();
  });
});
