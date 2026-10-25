import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { summarizeRecordedCashFlow } from '@/lib/dashboard/cash-flow-summary';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';
import { generateActionItems } from '@/lib/guidance/action-engine';
import { appendTransactionDateNeeded, convertTransactionsToCSV, partitionExportYear, summarizeDateNeeded, summarizeMileageDateNeeded } from '@/lib/reports/transaction-export';
import { preparerMonthlySummary, generatePreparerReport } from '@/lib/reports/preparer-report';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { assembleAuditSupportPacket, auditSupportPacketCSV, generateAuditSupportPDF } from '@/lib/reports/audit-support-packet';
import { aggregateQuarterlyEstimatesForYear } from '@/lib/tax-provider/quarterly-estimates';
import { listIncomeSourceCandidates } from '@/lib/tax-rules/business-income';
import { compareTransactionDates } from '@/lib/transactions/date-order';
import { transactionDateParts } from '@/lib/transactions/calendar-date';
import { displayTransactionDate } from '@/lib/transactions/calendar-date';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
const plFixture = vi.hoisted(() => ({ records: [] as Record<string, unknown>[] }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' } }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports/export-records')>();
  return { ...actual, readOwnedTransactions: async () => plFixture.records };
});
import { NextRequest } from 'next/server';
import { GET as profitLossPdf, POST as profitLossJson } from '@/app/api/reports/profit-loss/route';
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

afterEach(async () => { await receiptProcessor.terminate(); vi.restoreAllMocks(); });

const office = (id: string, amount: number, date: string) => ({
  id, trans_id: id, date, amount, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
  iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', pending: false, merchant_name: id,
});
const undated = (id: string, amount: number, date: unknown = '') => ({
  id, trans_id: id, date, amount, category: 'Needs-more-information', merchant_name: 'Needs more information',
  iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', pending: false,
});
const seed = [
  office('mar', 100, '2026-03-10'),
  office('may', 40, '2026-05-20'),
  office('nov', 25.5, '2026-11-02'),
  undated('blank', 999.99, ''),
];

describe('blank and invalid dates stay out of year totals', () => {
  it('keeps Schedule C, quarterly, and dashboard totals on the dated rows', () => {
    expect(aggregateScheduleC(seed as never, '2026', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(165.5);
    expect(aggregateScheduleC(seed as never, '2025', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
    const quarterly = aggregateQuarterlyEstimatesForYear(seed as never, 2026, 'UTC', { filingStatus: 'single' });
    expect(quarterly.yearTotal).toBe(165.5);
    expect(quarterly.quarters.map(quarter => quarter.expenses)).toEqual([100, 40, 0, 25.5]);
    expect(quarterly.dateNeeded).toMatchObject({ count: 1, total: 999.99, label: 'Date needed: 1 row, $999.99' });
    const cash = summarizeRecordedCashFlow(seed, 2026);
    expect(cash.reviewMessage).toContain('missing or invalid dates');
    expect(cash.months).toHaveLength(12);
    expect(cash.months[2].expenses).toBe(100);
    expect(cash.months[4].expenses).toBe(40);
    expect(cash.months[10].expenses).toBe(25.5);
    expect(cash.months.reduce((sum, month) => sum + month.expenses, 0)).toBe(165.5);
    expect(summarizeConfirmedDeductions(seed, 2026).totalDeductible).toBe(165.5);
    expect(summarizeConfirmedDeductions([...seed, office('prior', 80, '2025-01-01')], 2025).totalDeductible).toBe(80);
    expect(JSON.stringify({ cash, quarterly })).not.toMatch(/1970|Invalid Date/);
  });

  it('reports two blank rows as a count and dollar total that match those rows', () => {
    const rows = [...seed, undated('second', 50.25, '2026-02-30')];
    const summary = aggregateQuarterlyEstimatesForYear(rows as never, 2026, 'UTC', { filingStatus: 'single' }).dateNeeded;
    expect(summary.count).toBe(2);
    expect(summary.total).toBe(1050.24);
    expect(summary.label).toBe('Date needed: 2 rows, $1,050.24');
    expect(aggregateScheduleC(rows as never, '2026', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(165.5);
  });
});

describe('selected-year exports keep dated rows and a Date needed section', () => {
  async function expectExcluded(rows: typeof seed, count: number, total: number, label: string) {
    const quarterly = aggregateQuarterlyEstimatesForYear(rows as never, 2026, 'UTC', { filingStatus: 'single' });
    expect(quarterly.yearTotal).toBe(165.5);
    expect(quarterly.dateNeeded).toMatchObject({ count, total, label });
    const { dated, dateNeeded } = partitionExportYear(rows, 2026);
    expect(dateNeeded).toHaveLength(count);
    expect(summarizeDateNeeded(dateNeeded).label).toBe(label);
    const csv = appendTransactionDateNeeded(convertTransactionsToCSV(dated), dated, dateNeeded);
    expect(csv).toContain(label);
    expect(csv).toContain('Year total');
    expect(csv).toContain('165.50');
    const needed = csv.split('\r\n').filter(line => line.endsWith(',Date needed'));
    expect(needed).toHaveLength(count);
    expect(needed.every(line => line.split(',')[2] === '')).toBe(true);
    expect(csv).not.toContain('1970');
    expect(csv).not.toContain('Invalid Date');
    const summary = preparerMonthlySummary(rows, 2026);
    expect(summary.count).toBe(3);
    expect(summary.dateNeeded).toMatchObject({ count, total, label });
    expect(summary.groups.get('USD')![2].outflow).toBe(10000);
    const schedule = aggregateScheduleC(rows as never, '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(schedule.totalDeductible).toBe(165.5);
    const scheduleCsv = generateScheduleCCSV(schedule.lineItemsArray, 2026, summary.dateNeeded, schedule.totalDeductible);
    expect(scheduleCsv).toContain(label);
    expect(scheduleCsv).toContain('165.50');
    expect(scheduleCsv.split('\r\n').filter(line => line.startsWith(',') && line.includes('Date needed'))).toHaveLength(count);
    const packet = assembleAuditSupportPacket('owner', 2026, { transactions: rows, trips: [], receipts: [] });
    expect(packet.summary.recordedAmount).toBe(165.5);
    expect(packet.summary.dateNeeded).toMatchObject({ count, total, label });
    expect(auditSupportPacketCSV(packet)).toContain(label);
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    await generatePreparerReport(rows, 2026);
    await generateScheduleCPlanningPDF({ taxYear: 2026, grossReceipts: 0, lineItems: schedule.lineItemsArray, includeAppendix: false, dateNeeded: summary.dateNeeded });
    await generateAuditSupportPDF(packet);
    plFixture.records = rows;
    const cashFlow = await (await profitLossJson(new NextRequest('https://localhost/api/reports/profit-loss', { method: 'POST', body: JSON.stringify({ year: 2026 }) }))).json();
    expect(cashFlow).toMatchObject({ totalExpenses: 165.5, netProfit: -165.5, dateNeeded: { count, total, label } });
    expect((await profitLossPdf(new NextRequest('https://localhost/api/reports/profit-loss?format=pdf&year=2026'))).status).toBe(200);
    const printed = spy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(printed).toContain(label);
    expect(printed).toContain('Needs more information');
    expect(printed).not.toContain('1970');
    expect(printed).not.toContain('Invalid Date');
    spy.mockRestore();
  }

  it('builds the CSV section with an empty date, the marker, and the excluded total', async () => {
    await expectExcluded(seed, 1, 999.99, 'Date needed: 1 row, $999.99');
    expect(convertTransactionsToCSV([{ date: '', amount: 5 }])).toContain('Missing/invalid date');
  });

  it('reports two blank rows as a count and dollar total on every selected-year surface', async () => {
    const two = [...seed, undated('second', 50.25, '2026-02-30')];
    await expectExcluded(two, 2, 1050.24, 'Date needed: 2 rows, $1,050.24');
    const undefinedDate = [...seed, undated('second', 50.25, undefined)];
    expect(preparerMonthlySummary(undefinedDate, 2026).dateNeeded).toMatchObject({ count: 2, total: 1050.24, label: 'Date needed: 2 rows, $1,050.24' });
    expect(summarizeDateNeeded(partitionExportYear(undefinedDate, 2026).dateNeeded).total).toBe(1050.24);
  });
});

describe('undated mileage stays in the selected year as miles only', () => {
  it('counts one undated trip beside an unchanged dated trip and never assigns a rate or dollars', () => {
    const trips = [
      { date: '2026-03-10', miles: 100, deduction: 72.5, ratePerMile: 0.725 },
      { date: '', miles: 12, deduction: 9.99, ratePerMile: 0.725 },
    ];
    const split = partitionExportYear(trips, 2026);
    expect(split.dated).toEqual([trips[0]]);
    const summary = summarizeMileageDateNeeded(split.dateNeeded);
    expect(summary).toEqual({ count: 1, miles: 12, noMilesCount: 0, label: 'Date needed: 1 trip, 12 miles', trips: [{ date: '', miles: 12 }] });
    expect(JSON.stringify(summary)).not.toMatch(/\$|rate|deduction|72\.5|0\.725|9\.99/);
  });

  it('counts a blank miles trip under no miles and does not treat it as 0 miles or assign a rate', () => {
    const summary = summarizeMileageDateNeeded([{ date: '', miles: '', businessPurpose: 'Site walk', deduction: 4.5, ratePerMile: 0.76 }]);
    expect(summary.noMilesCount).toBe(1);
    expect(summary.miles).toBe(0);
    expect(summary.label).toBe('Date needed: 1 trip, 1 trip has no miles');
    expect(summary.label).not.toContain('0 miles');
    expect(summary.trips[0]).toEqual({ date: '', miles: '', businessPurpose: 'Site walk' });
    expect(JSON.stringify(summary)).not.toMatch(/\$|rate|deduction|0\.76|4\.5/);
  });

  it('shows only the trip count when every undated trip has blank or invalid miles', () => {
    const summary = summarizeMileageDateNeeded([
      { date: '', miles: '', businessPurpose: 'Site walk', deduction: 4.5, ratePerMile: 0.76 },
      { date: '2026-02-30', miles: 'not-a-number', businessPurpose: 'Errand', deduction: 8, ratePerMile: 0.725 },
    ]);
    expect(summary.count).toBe(2);
    expect(summary.noMilesCount).toBe(summary.count);
    expect(summary.label).toBe('Date needed: 2 trips, 2 trips have no miles');
    expect(summary.label).not.toMatch(/\d+(?:\.\d+)? miles?/);
    expect(summary.trips.map(trip => trip.businessPurpose)).toEqual(['Site walk', 'Errand']);
    expect(JSON.stringify(summary)).not.toMatch(/\$|rate|deduction|0\.76|0\.725|4\.5/);
  });
});

describe('blank dates sort last and are not year 0 or a date match', () => {
  it('sorts blank and invalid dates after dated rows ascending and descending', () => {
    const dates = ['2026-11-02', '', '2026-03-10', '2026-02-30'];
    const asc = [...dates].sort((a, b) => compareTransactionDates(a, b, 'asc'));
    const desc = [...dates].sort((a, b) => compareTransactionDates(a, b, 'desc'));
    expect(asc.slice(0, 2)).toEqual(['2026-03-10', '2026-11-02']);
    expect(desc.slice(0, 2)).toEqual(['2026-11-02', '2026-03-10']);
    expect(new Set(asc.slice(2))).toEqual(new Set(['', '2026-02-30']));
    expect(new Set(desc.slice(2))).toEqual(new Set(['', '2026-02-30']));
    expect(displayTransactionDate('')).toBe('Date needed');
    expect(displayTransactionDate('2026-02-30')).toBe('Date needed');
    expect(transactionDateParts('')).toBeNull();
    expect(transactionDateParts(undefined)).toBeNull();
  });

  it('does not treat a blank date as year 0', () => {
    const row = { id: 'blank', trans_id: 'blank', account_id: 'bank', date: '', amount: -999.99, category: 'income', pending: false };
    expect(listIncomeSourceCandidates(0, [row], [], []).candidates).toEqual([]);
    expect(listIncomeSourceCandidates(2026, [row], [], []).candidates).toEqual([]);
    const year = new Date().getFullYear();
    const blanks = Array.from({ length: 60 }, (_, index) => ({ id: String(index), date: '', category: 'other', amount: 1 }));
    expect(generateActionItems(null, blanks).some(item => item.id === 'categorize-transactions')).toBe(false);
    const dated = Array.from({ length: 60 }, (_, index) => ({ id: String(index), date: `${year}-06-01`, category: 'other', amount: 1 }));
    expect(generateActionItems({ bankConnected: true }, dated).some(item => item.id === 'categorize-transactions')).toBe(true);
  });

  it('gives a receipt with no date a zero date score and does not list date as a reason', async () => {
    const transactions = [{ trans_id: 'jan', merchant_name: 'Synthetic Cafe', amount: 18.5, date: '2026-01-01' }];
    const receipt = { merchant: 'Synthetic Cafe', amount: 18.5, confidence: 0.9, rawText: 'Synthetic Cafe' };
    for (const date of ['', undefined] as const) {
      const matches = await receiptProcessor.findMatchingTransactions({ ...receipt, date: date! }, transactions);
      expect(matches[0]?.matchReasons ?? []).not.toContain('date');
    }
    const matched = await receiptProcessor.findMatchingTransactions({ ...receipt, date: '2026-01-01' }, transactions);
    const missed = await receiptProcessor.findMatchingTransactions({ ...receipt, date: '2026-02-02' }, transactions);
    const blank = await receiptProcessor.findMatchingTransactions({ ...receipt, date: '' }, transactions);
    expect(matched[0].matchReasons).toContain('date');
    expect(blank[0].confidence).toBe(missed[0].confidence);
    expect(blank[0].confidence).toBeLessThan(matched[0].confidence);
  });
});
