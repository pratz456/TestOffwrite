import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { OTHER_EXPENSES_27B_FIRST_YEAR, OTHER_EXPENSES_LINE_TOKEN, otherExpensesLine, publishedOtherExpensesLine, readStoredAiScheduleCLines, resolveOtherExpensesYear, strictOtherExpensesDateYear, withOtherExpensesLine } from '@/lib/schedule-c/other-expenses-line';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { convertTransactionsToCSV, TRANSACTION_CSV_HEADERS } from '@/lib/reports/transaction-export';
import { normalizeExplanation, scheduleCLineFor } from '@/lib/ai/explanation';
import { reviewHydrationFields } from '@/lib/transactions/ai-review-contract';
import { suggestionOtherExpensesNeedsReview, suggestionScheduleCLine } from '@/lib/transactions/review-proposals';
import { safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';
import { groundTransactionAnalysis } from '@/lib/ai/transaction-tax-policy';
import { merchantIntelligence } from '@/lib/ai/merchant-intelligence';
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { assembleAuditSupportPacket, auditSupportPacketCSV, buildEvidenceRecord } from '@/lib/reports/audit-support-packet';

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
    confirmed(year, 'SERVICE_MEMBERSHIPS', OTHER_EXPENSE_AMOUNT, 'OTHER-EXPENSE-MERCHANT'),
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
      category: 'SERVICE_MEMBERSHIPS',
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
      expect(item.csv).toContain(`SAME-RECORD,SERVICE_MEMBERSHIPS,${expectedLine[item.year]},${OTHER_EXPENSE_AMOUNT},`);
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
      expect(csv).toContain(`OTHER-EXPENSE-MERCHANT,SERVICE_MEMBERSHIPS,${line},${OTHER_EXPENSE_AMOUNT},`);
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
        merchant_name: 'OTHER-EXPENSE-MERCHANT', category: 'SERVICE_MEMBERSHIPS',
        is_deductible: true, review_status: 'confirmed', review_source: 'user_corrected',
        reviewed_at: `${year}-06-02T00:00:00.000Z`, user_classification_reason: 'Course for the current business.',
      }],
      trips: [], receipts: [],
    }, new Date('2026-01-01T00:00:00.000Z'));
    expect(packet.deductions).toHaveLength(1);
    expect(packet.deductions[0]).toMatchObject({ scheduleCLine: line, amount: OTHER_EXPENSE_AMOUNT, category: 'SERVICE_MEMBERSHIPS' });
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

    const hydrated = reviewHydrationFields(later);
    expect(hydrated.ai_schedule_c_line).toBe('27b');
    expect(hydrated.ai_suggestion.scheduleCLine).toBe('27b');
    expect(hydrated.ai.schedule_c_line).toBe('27b');
    expect(hydrated.ai_explanation.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(later.ai_schedule_c_line).toBe('27a');

    expect(suggestionScheduleCLine({ date: '2024-06-01', ai_suggestion: early.ai_suggestion })).toBe('27a');
    expect(suggestionScheduleCLine({ date: '2026-06-01', ai_suggestion: later.ai_suggestion })).toBe('27b');
    expect(normalizeExplanation(later.ai_explanation, 2025)?.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
    expect(normalizeExplanation(early.ai_explanation, 2024)?.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    expect(scheduleCLineFor({ schedule_c_line: '27a', category: 'other', transaction_kind: 'expense', status: 'ok' } as never, 2026)).toBe('Schedule C line 27b (Other expenses)');
    expect(scheduleCLineFor({ schedule_c_line: '27b', category: 'other', transaction_kind: 'expense', status: 'ok' } as never, 2024)).toBe('Schedule C line 27a (Other expenses)');
    expect(later.ai_explanation.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');

    const sameYear = stored(2024, '27a');
    expect(readStoredAiScheduleCLines(sameYear)).toBe(sameYear);
    const laterSame = stored(2026, '27b');
    expect(readStoredAiScheduleCLines(laterSame)).toBe(laterSame);
    const unchanged = { date: '2025-06-01', ai_schedule_c_line: '24b', ai: { schedule_c_line: '18' }, amount: FUEL_AMOUNT };
    expect(readStoredAiScheduleCLines(unchanged)).toBe(unchanged);
    expect(scheduleCLineFor({ schedule_c_line: '18', category: 'software_subscriptions', transaction_kind: 'expense', status: 'ok' } as never, 2025)).toBe('Schedule C line 18 (Office expense)');
  });

  const LINE_REVIEW = 'Tax treatment unresolved; exclude from confirmed deduction totals';
  const CSV_REVIEW = TRANSACTION_CSV_HEADERS.indexOf('Data Review');

  function csvColumns(record: Record<string, unknown>): string[] {
    return convertTransactionsToCSV([record]).split('\r\n')[1].split(',');
  }

  function evidenceFor(record: Record<string, unknown>) {
    return buildEvidenceRecord(record, {
      uid: 'owner',
      tripsByDate: new Map(),
      yearTripCount: 0,
      receiptsByTransaction: new Map(),
    });
  }

  it('a missing date does not print a stored 27a and flags the line for review, with the amount unchanged', () => {
    const record = {
      id: 'missing-date',
      amount: OTHER_EXPENSE_AMOUNT,
      category: 'SERVICE_MEMBERSHIPS',
      merchant_name: 'OTHER-EXPENSE-MERCHANT',
      schedule_c_line: '27a',
      ai_suggestion: { schedule_c_line: '27a', scheduleCLine: '27a' },
    };
    const columns = csvColumns(record);
    expect(columns[4]).toBe('80.25');
    expect(columns[13]).toBe('');
    expect(columns[14]).toBe('');
    expect(columns[13]).not.toContain('27a');
    expect(columns[14]).not.toContain('27b');
    expect(columns[CSV_REVIEW]).toContain(LINE_REVIEW);
    expect(suggestionScheduleCLine(record)).toBeNull();
    expect(suggestionOtherExpensesNeedsReview(record)).toBe(true);
    const evidence = evidenceFor(record);
    expect(evidence.scheduleCLine).toBeNull();
    expect(evidence.substantiation.status).toBe('needs_records');
    expect(evidence.amount).toBe(OTHER_EXPENSE_AMOUNT);
    expect(record.schedule_c_line).toBe('27a');
    expect(record.amount).toBe(OTHER_EXPENSE_AMOUNT);
  });

  it('keeps 27a for 2022 and flags review; 2023 is confirmed 27a and 2026 assumes 27b', () => {
    const row = (year: number) => ({
      id: `year-${year}`,
      amount: OTHER_EXPENSE_AMOUNT,
      date: `${year}-06-01`,
      category: 'SERVICE_MEMBERSHIPS',
      merchant_name: 'YEAR-MERCHANT',
      schedule_c_line: '27a',
      is_deductible: true as const,
      business_purpose: 'Course for the current business.',
      ai_suggestion: { schedule_c_line: '27a' },
    });
    const early = csvColumns(row(2022));
    expect(early[4]).toBe('80.25');
    expect(early[13]).toBe('27a');
    expect(early[14]).toBe('27a');
    expect(early[CSV_REVIEW]).toContain(LINE_REVIEW);
    expect(suggestionScheduleCLine(row(2022))).toBe('27a');
    expect(suggestionOtherExpensesNeedsReview(row(2022))).toBe(true);
    const earlyEvidence = evidenceFor(row(2022));
    expect(earlyEvidence.scheduleCLine).toBe('27a');
    expect(earlyEvidence.substantiation.status).toBe('needs_records');
    expect(earlyEvidence.amount).toBe(OTHER_EXPENSE_AMOUNT);

    const confirmed = csvColumns(row(2023));
    expect(confirmed[13]).toBe('27a');
    expect(confirmed[14]).toBe('27a');
    expect(confirmed[CSV_REVIEW]).not.toContain('Tax treatment unresolved');
    expect(suggestionOtherExpensesNeedsReview(row(2023))).toBe(false);
    const confirmedEvidence = evidenceFor(row(2023));
    expect(confirmedEvidence.scheduleCLine).toBe('27a');
    expect(confirmedEvidence.substantiation.status).toBe('complete');

    const assumed = csvColumns(row(2026));
    expect(assumed[13]).toBe('27b');
    expect(assumed[14]).toBe('27b');
    expect(assumed[CSV_REVIEW]).not.toContain('Tax treatment unresolved');
    expect(suggestionScheduleCLine(row(2026))).toBe('27b');
    expect(suggestionOtherExpensesNeedsReview(row(2026))).toBe(false);
  });

  it('keeps Dec 31 and Jan 1 on the date prefix when the offset would shift the UTC year', () => {
    const late = '2024-12-31T23:59:59-10:00';
    const early = '2025-01-01T00:30:00+14:00';
    expect(safeTaxYear(late)).toBe(2024);
    expect(safeTaxYear(early)).toBe(2025);
    const record = (date: string) => ({
      amount: OTHER_EXPENSE_AMOUNT,
      date,
      category: 'SERVICE_MEMBERSHIPS',
      is_deductible: true as const,
      merchant_name: 'BOUNDARY',
      id: date,
    });
    const december = aggregateScheduleC([record(late)], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(december.lineItems['27a']).toMatchObject({ lineCode: '27a', deductible: OTHER_EXPENSE_AMOUNT });
    expect(december.lineItems['27b']).toBeUndefined();
    expect(aggregateScheduleC([record(late)], '2025', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
    const january = aggregateScheduleC([record(early)], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(january.lineItems['27b']).toMatchObject({ lineCode: '27b', deductible: OTHER_EXPENSE_AMOUNT });
    expect(january.lineItems['27a']).toBeUndefined();
    expect(aggregateScheduleC([record(early)], '2024', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
    expect(december.lineItems['27a'].deductible).toBe(january.lineItems['27b'].deductible);
  });

  it('uses the transaction date when tax_year names a different year', () => {
    const record = {
      amount: OTHER_EXPENSE_AMOUNT,
      date: '2025-06-01',
      tax_year: 2024,
      taxYear: 2024,
      category: 'SERVICE_MEMBERSHIPS',
      is_deductible: true as const,
      merchant_name: 'DATE-WINS',
      id: 'date-wins',
    };
    const dated = aggregateScheduleC([record], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(dated.lineItems['27b']).toMatchObject({ lineCode: '27b', deductible: OTHER_EXPENSE_AMOUNT });
    expect(dated.lineItems['27a']).toBeUndefined();
    const labeled = aggregateScheduleC([record], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(labeled.totalDeductible).toBe(0);
    expect(labeled.lineItems['27a']).toBeUndefined();
    expect(labeled.lineItems['27b']).toBeUndefined();
  });

  it('prints the year line in both transaction CSV line columns and keeps the amount', () => {
    const rows = [2024, 2025, 2026].map(year => {
      const columns = csvColumns({
        id: `csv-${year}`,
        amount: OTHER_EXPENSE_AMOUNT,
        date: `${year}-06-01`,
        category: 'SERVICE_MEMBERSHIPS',
        merchant_name: 'CSV-MERCHANT',
        schedule_c_line: '27a',
      });
      return { amount: columns[4], recorded: columns[13], mapped: columns[14] };
    });
    expect(rows.map(row => row.amount)).toEqual(['80.25', '80.25', '80.25']);
    expect(rows.map(row => row.recorded)).toEqual(['27a', '27b', '27b']);
    expect(rows.map(row => row.mapped)).toEqual(['27a', '27b', '27b']);
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

  const education = { category: 'education_training', transaction_kind: 'expense', status: 'ok' } as never;

  it('hides a saved 27a when the explanation has no year', () => {
    expect(scheduleCLineFor({ schedule_c_line: '27a', category: 'other', transaction_kind: 'expense', status: 'ok' } as never, null)).toBeNull();
  });

  it('hides the category other-expenses line when the explanation has no year', () => {
    expect(scheduleCLineFor({ category: 'dues_and_memberships', transaction_kind: 'expense', status: 'ok' } as never, null)).toBeNull();
  });

  it('hides a stored other-expenses label when the saved explanation has no year', () => {
    const payload = {
      headline: 'Likely deductible: Other expenses',
      why: 'The saved analysis placed this cost with other expenses.',
      scheduleCLine: 'Schedule C line 27a (Other expenses)',
    };
    expect(normalizeExplanation(payload, null)?.scheduleCLine).toBeNull();
  });

  it('shows 27b for a 2025 category line, so a year-blind shown line fails this check', () => {
    expect(scheduleCLineFor(education, 2025)).toBe('Schedule C line 27b (Other expenses)');
  });

  it('a record with no date and tax_year 2025 is blank and flagged on every path', () => {
    const record = {
      id: 'tax-year-only',
      amount: OTHER_EXPENSE_AMOUNT,
      category: 'SERVICE_MEMBERSHIPS',
      merchant_name: 'TAX-YEAR-ONLY',
      schedule_c_line: '27a',
      tax_year: 2025,
      taxYear: 2025,
      ai_tax_year: 2025,
      ai_schedule_c_line: '27a',
      ai_suggestion: { schedule_c_line: '27a', scheduleCLine: '27a', taxYear: 2025 },
      ai: { schedule_c_line: '27a', tax_year: 2025 },
      ai_explanation: {
        headline: 'Likely deductible: Other expenses',
        why: 'The saved analysis placed this cost with other expenses.',
        scheduleCLine: 'Schedule C line 27a (Other expenses)',
      },
    };
    expect(resolveOtherExpensesYear(record)).toBeNull();
    expect(publishedOtherExpensesLine('27a', resolveOtherExpensesYear(record))).toEqual({ line: null, needsReview: true });
    expect(resolveOtherExpensesYear({ date: '', datetime: null, date_iso: '2025-03-01' })).toBe(2025);
    expect(resolveOtherExpensesYear({ date: '2024-13-45', datetime: '2025-06-01' })).toBeNull();
    const columns = csvColumns(record);
    expect(columns[4]).toBe('80.25');
    expect(columns[13]).toBe('');
    expect(columns[14]).toBe('');
    expect(columns[CSV_REVIEW]).toContain(LINE_REVIEW);
    expect(suggestionScheduleCLine(record)).toBeNull();
    expect(suggestionOtherExpensesNeedsReview(record)).toBe(true);
    const evidence = evidenceFor(record);
    expect(evidence.scheduleCLine).toBeNull();
    expect(evidence.substantiation.status).toBe('needs_records');
    expect(evidence.amount).toBe(OTHER_EXPENSE_AMOUNT);
    const read = readStoredAiScheduleCLines(record);
    expect(read.ai_schedule_c_line).toBeNull();
    expect(read.ai_suggestion.schedule_c_line).toBeNull();
    expect(read.ai_suggestion.scheduleCLine).toBeNull();
    expect(read.ai.schedule_c_line).toBeNull();
    expect(read.ai_explanation.scheduleCLine).toBeNull();
    expect(record.ai_schedule_c_line).toBe('27a');
    expect(record.schedule_c_line).toBe('27a');
    expect(normalizeExplanation(record.ai_explanation, resolveOtherExpensesYear(record))?.scheduleCLine).toBeNull();
    expect(scheduleCLineFor({ schedule_c_line: '27a', category: 'education_training', transaction_kind: 'expense', status: 'ok' } as never, resolveOtherExpensesYear(record))).toBeNull();
    expect(merchantIntelligence({ merchant: 'PLANET FITNESS', amount_usd: 20, tax_year: 2025 } as Partial<TransactionInput>).scheduleCLine).toBeNull();
    const analysis = {
      status: 'ok', transaction_kind: 'expense', category: 'education_training', is_deductible: true, expense_type: 'business',
      evidence_ids: ['education-reg-1.162-5'], confidence: 0.9, audit_risk: 'low',
      customized_reason: 'The course maintains design skills already used for client work. Keep the receipt.',
      key_analysis_factor: 'Education for the current design business.',
    } as OutputType;
    const analyst = { user_id: 'synthetic', profession: ['Designer'], filing_state: 'CA', business_entity: 'sole_proprietor' } as UserContext;
    const undated = groundTransactionAnalysis(
      analysis,
      { tx_id: 'tax-year-only', merchant: 'Course vendor', amount_usd: OTHER_EXPENSE_AMOUNT, date_iso: '', business_purpose: 'Course that maintains design skills already used for client work.', tax_year: 2025 } as TransactionInput,
      analyst,
      'synthetic-model',
    );
    expect(undated?.schedule_c_line).toBeUndefined();
    expect(undated?.tax_year).toBeNull();
    const invalidDate = { tx_id: 'invalid-first-date', merchant: 'Course vendor', amount_usd: OTHER_EXPENSE_AMOUNT, date: '2024-13-45', date_iso: '2025-06-01', business_purpose: 'Course that maintains design skills already used for client work.', tax_year: 2025 } as TransactionInput;
    const written = groundTransactionAnalysis(analysis, invalidDate, analyst, 'synthetic-model');
    expect(written?.status).toBe('ok');
    expect(written?.tax_year).toBe(2025);
    expect(written?.schedule_c_line).toBeUndefined();
    expect(publishedOtherExpensesLine('27a', resolveOtherExpensesYear(invalidDate))).toEqual({ line: null, needsReview: true });
    const source = readFileSync('lib/schedule-c/other-expenses-line.ts', 'utf8');
    expect(source).not.toContain('otherExpensesTaxYearFallback');
    expect(source).not.toMatch(/\btax_year\b/);
    expect(source).not.toMatch(/\bai_tax_year\b/);
    const start = source.indexOf('export function resolveOtherExpensesYear');
    const resolver = source.slice(start, source.indexOf('\n/**', start));
    expect(resolver).toContain('strictOtherExpensesDateYear');
    expect(resolver).not.toContain('taxYear');
    expect(resolver).not.toContain('tax_year');
  });

  function invalidDateRecord(date: string) {
    return {
      id: `invalid-${date}`,
      amount: OTHER_EXPENSE_AMOUNT,
      date,
      category: 'SERVICE_MEMBERSHIPS',
      merchant_name: 'INVALID-DATE',
      schedule_c_line: '27a',
      is_deductible: true as const,
      ai_suggestion: { schedule_c_line: '27a' },
    };
  }

  function expectBlankFlag(date: string) {
    const record = invalidDateRecord(date);
    expect(resolveOtherExpensesYear(record)).toBeNull();
    const columns = csvColumns(record);
    expect(columns[4]).toBe('80.25');
    expect(columns[13]).toBe('');
    expect(columns[14]).toBe('');
    expect(columns[CSV_REVIEW]).toContain(LINE_REVIEW);
    expect(suggestionScheduleCLine(record)).toBeNull();
    expect(suggestionOtherExpensesNeedsReview(record)).toBe(true);
    const evidence = evidenceFor(record);
    expect(evidence.scheduleCLine).toBeNull();
    expect(evidence.substantiation.status).toBe('needs_records');
    expect(evidence.amount).toBe(OTHER_EXPENSE_AMOUNT);
    expect(record.schedule_c_line).toBe('27a');
  }

  it('keeps safeYMD and leaves an invalid transaction date out of the tax year group', () => {
    expect(safeYMD('2024-13-45')).toBe('2024-13-45');
    expect(safeYMD('2024-06-01')).toBe('2024-06-01');
    expect(safeTaxYear('2024-13-45')).toBe(2024);
    expect(strictOtherExpensesDateYear('2024-13-45')).toBeNull();
    expect(strictOtherExpensesDateYear('2024-06-01')).toBe(2024);
    expect(strictOtherExpensesDateYear('2024-02-29')).toBe(2024);
    expect(strictOtherExpensesDateYear('2023-02-29')).toBeNull();
    const invalid = {
      amount: OTHER_EXPENSE_AMOUNT,
      date: '2024-13-45',
      category: 'SERVICE_MEMBERSHIPS',
      is_deductible: true as const,
      review_status: 'confirmed' as const,
      merchant_name: 'INVALID-GROUP',
      id: 'invalid-group',
    };
    expect(resolveOtherExpensesYear(invalid)).toBeNull();
    const grouped = aggregateScheduleC([invalid], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(grouped.lineItems['27a']).toBeUndefined();
    expect(grouped.lineItems['27b']).toBeUndefined();
    expect(grouped.totalDeductible).toBe(0);
    const valid = aggregateScheduleC([{ ...invalid, date: '2024-06-01', id: 'valid-group' }], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(valid.lineItems['27a']).toMatchObject({ lineCode: '27a', deductible: OTHER_EXPENSE_AMOUNT });
    expect(valid.totalDeductible).toBe(OTHER_EXPENSE_AMOUNT);
    expect(generateScheduleCCSV(grouped.lineItemsArray, 2024)).not.toContain(',27a,80.25,');
    expect(generateScheduleCCSV(valid.lineItemsArray, 2024)).toContain(',27a,80.25,');
    const taxDate = readFileSync('lib/schedule-c/taxDate.ts', 'utf8');
    const aggregate = readFileSync('lib/schedule-c/aggregate.ts', 'utf8');
    expect(taxDate).toContain('return s.slice(0, 10);');
    expect(taxDate).not.toContain('strictOtherExpensesDateYear');
    expect(aggregate).toContain('resolveOtherExpensesYear(t)');
    expect(aggregate).not.toContain('safeTaxYear');
    expectBlankFlag('2024-13-45');
  });

  it('replaces the other expenses placeholder from the date year', () => {
    expect(withOtherExpensesLine(`Schedule C line ${OTHER_EXPENSES_LINE_TOKEN}`, null)).toBe('Schedule C line 27a for 2024 and earlier, or 27b for 2025 and later');
    expect(withOtherExpensesLine(`Schedule C line ${OTHER_EXPENSES_LINE_TOKEN}`, 2023)).toBe('Schedule C line 27a');
    expect(withOtherExpensesLine(`Schedule C line ${OTHER_EXPENSES_LINE_TOKEN}`, 2025)).toBe('Schedule C line 27b');
    expect(withOtherExpensesLine('Schedule C line 18', null)).toBe('Schedule C line 18');
  });

  it('treats an impossible ISO date as no year and flags the line', () => {
    expectBlankFlag('2024-13-45');
  });

  it('treats a non-ISO date as no year and flags the line', () => {
    expectBlankFlag('1/1/2025');
  });

  it('keeps the calendar date in a positive offset where local year parsing shifts', () => {
    const script = `
      import { resolveOtherExpensesYear } from './lib/schedule-c/other-expenses-line.ts';
      const shifted = new Date('2024-12-31T12:00:00.000Z').getFullYear();
      if (shifted === 2024) throw new Error('timezone did not shift the local year: ' + shifted);
      const year = resolveOtherExpensesYear({ date: '2024-12-31' });
      if (year !== 2024) throw new Error('date-only year ' + year);
      const stamped = resolveOtherExpensesYear({ date: '2024-12-31T23:59:59-10:00' });
      if (stamped !== 2024) throw new Error('timestamp year ' + stamped);
      if (resolveOtherExpensesYear({ date: '2024-13-45' }) !== null) throw new Error('invalid ISO date resolved');
      if (resolveOtherExpensesYear({ date: '1/1/2025' }) !== null) throw new Error('non-ISO date resolved');
    `;
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: 'Pacific/Auckland' },
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
