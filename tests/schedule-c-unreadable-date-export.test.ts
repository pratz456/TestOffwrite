import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF, type ScheduleCExportData } from '@/lib/reports/schedule-c-pdf';
import { SCHEDULE_C_UNREADABLE_DATE_NOTICE } from '@/lib/reports/schedule-c-unreadable-notice';
import { generateScheduleCCSV as baseScheduleCCsv } from './fixtures/schedule-c-base-52f5788d/schedule-c-csv';
import { generateScheduleCPlanningPDF as baseScheduleCPdf } from './fixtures/schedule-c-base-52f5788d/schedule-c-pdf';

/**
 * Zero-row baseline is the Schedule C PDF and CSV generators copied from commit
 * 52f5788d (git show 52f5788d:lib/reports/schedule-c-pdf.ts and schedule-c-csv.ts,
 * plus the planning-pdf.ts and transaction-export.ts those files import).
 * The test freezes Date so pdf-lib writes CreationDate and ModDate as D:20260615120000Z.
 */

const FIXED_AT = new Date('2026-06-15T12:00:00.000Z');
const HEADERS = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];

function charge(id: string, amount: number, date: unknown, merchant = id): ScheduleCTransactionLike {
  const row: ScheduleCTransactionLike = {
    id, trans_id: id, merchant_name: merchant, amount,
    category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD',
    is_deductible: true, review_status: 'confirmed', pending: false, description: '',
    date: '',
  };
  if (date !== undefined) row.date = date as string;
  return row;
}

function yearExport(rows: ScheduleCTransactionLike[], year: number) {
  const aggregate = aggregateScheduleC(rows, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
  const data: ScheduleCExportData = {
    taxYear: year, grossReceipts: 1000, lineItems: aggregate.lineItemsArray,
    name: 'Synthetic Taxpayer', includeAppendix: true, needsMoreInformation: aggregate.undated,
  };
  return { aggregate, data, csv: generateScheduleCCSV(aggregate.lineItemsArray, year, aggregate.undated) };
}

type Drawn = { page: PDFPage; text: string };
async function drawPdf(data: ScheduleCExportData): Promise<Drawn[]> {
  const drawn: Drawn[] = [];
  const original = PDFPage.prototype.drawText;
  const spy = vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, text: string, options?: Parameters<PDFPage['drawText']>[1]) {
    drawn.push({ page: this, text });
    return original.call(this, text, options);
  });
  try { await generateScheduleCPlanningPDF(data); }
  finally { spy.mockRestore(); }
  return drawn;
}

function joined(drawn: Drawn[]): string {
  return drawn.map(item => item.text).join('\n');
}

function nextMoney(drawn: Drawn[], label: string): string | undefined {
  const index = drawn.findIndex(item => item.text === label);
  return drawn.slice(index + 1).find(item => /^-?\$/.test(item.text))?.text;
}

function parseCsv(text: string): string[][] {
  const result = spawnSync('python3', ['-c', 'import csv,json,sys; print(json.dumps(list(csv.reader(sys.stdin))))'], { input: text, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'csv parser failed');
  return JSON.parse(result.stdout) as string[][];
}

function contributionSum(rows: string[][]): number {
  const column = HEADERS.indexOf('Confirmed contribution');
  return rows.slice(1).reduce((sum, row) => sum + (row[column] === '' ? 0 : Number(row[column])), 0);
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Schedule C export lists every unreadable charge date outside the year totals', () => {
  const dated2024 = charge('y2024', 40, '2024-06-01', 'DATED-2024');
  const dated2025 = charge('y2025', 60, '2025-06-01', 'DATED-2025');
  const unreadable = charge('bad', 17.25, 'not-a-date', 'UNREADABLE-ONE');
  const blank = charge('blank', -4, '', 'UNREADABLE-TWO');
  const rows = [dated2024, dated2025, unreadable, blank];

  it('leaves unreadable date amounts out of every Schedule C line total in the PDF and the CSV for any selected year', async () => {
    for (const year of [2024, 2025, 2026]) {
      const withOmitted = yearExport(rows, year);
      const withoutOmitted = yearExport([dated2024, dated2025], year);
      expect(withOmitted.aggregate.totalDeductible).toBe(withoutOmitted.aggregate.totalDeductible);
      expect(withOmitted.aggregate.totalExpenses).toBe(withoutOmitted.aggregate.totalExpenses);
      expect(withOmitted.aggregate.lineItemsArray.map(line => [line.lineCode, line.deductible, line.total])).toEqual(
        withoutOmitted.aggregate.lineItemsArray.map(line => [line.lineCode, line.deductible, line.total]),
      );

      const drawn = await drawPdf(withOmitted.data);
      const baseline = await drawPdf(withoutOmitted.data);
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).toBe(nextMoney(baseline, 'Confirmed expense subtotal only'));
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).not.toBe('$21.25');
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).not.toBe('$57.25');
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).not.toBe('$77.25');
      if (year === 2024) expect(joined(drawn)).toContain('missing');

      const parsed = parseCsv(withOmitted.csv);
      const parsedBaseline = parseCsv(withoutOmitted.csv);
      expect(parsed[0]).toEqual(HEADERS);
      expect(new Set(parsed.map(row => row.length))).toEqual(new Set([HEADERS.length]));
      expect(withOmitted.csv.split('\r\n').slice(0, parsedBaseline.length)).toEqual(withoutOmitted.csv.split('\r\n'));
      const trailing = parsed.slice(parsedBaseline.length);
      expect(trailing.map(row => row[HEADERS.indexOf('Schedule C planning reference')])).toEqual(['Needs more information', 'Needs more information']);
      expect(trailing.map(row => row[0])).toEqual(['', '']);
      expect(contributionSum(parsed)).toBe(contributionSum(parsedBaseline));
      expect(withOmitted.csv.startsWith('Tax date,')).toBe(true);
      expect(withOmitted.csv.split('\r\n')[0]).not.toContain('assigned to any year');
    }
  });

  it('shows the unreadable count and dollar total in Needs more information and says that year totals may be missing them', async () => {
    // February 31 is not a calendar day, so a written English month still leaves this charge undated.
    const row = charge('jan', 17.25, 'February 31, 2025', 'UNDATED-JAN');
    const notice = SCHEDULE_C_UNREADABLE_DATE_NOTICE(1, 17.25);
    expect(notice).toBe("These totals leave out 1 charge ($17.25) because their dates couldn't be read, so they aren't assigned to any year. Fix the dates in WriteOff and export again to include them.");
    expect(notice).toContain('leave out');
    expect(notice).toContain("aren't assigned to any year");
    const { data } = yearExport([charge('kept', 40, '2025-03-01', 'DATED-KEEP'), row], 2025);
    const drawn = await drawPdf(data);
    const text = joined(drawn);
    expect(drawn.map(item => item.text).join(' ')).toContain(notice);
    const sectionAt = text.indexOf('Needs more information');
    expect(sectionAt).toBeGreaterThan(text.indexOf('DATED-KEEP'));
    expect(text.indexOf('UNDATED-JAN')).toBeGreaterThan(sectionAt);
    expect(text.indexOf('February 31, 2025')).toBeGreaterThan(sectionAt);
    expect(text.indexOf('Subtotal')).toBeGreaterThan(sectionAt);
    expect(text).toContain('1 charge');
    expect(text).toContain('$17.25');
    const subtotalAt = drawn.findIndex(item => item.text === 'Confirmed expense subtotal only');
    const creditsAt = drawn.findIndex(item => item.text.startsWith('Credits/refunds'));
    const noticeDraws = drawn.slice(subtotalAt, creditsAt).filter(item => notice.includes(item.text) && item.text.length > 20);
    expect(noticeDraws.length).toBeGreaterThan(0);
    expect(noticeDraws.every(item => item.page === drawn[subtotalAt].page)).toBe(true);
  });

  it('matches the 52f5788d PDF and CSV byte for byte when no charge date is unreadable', async () => {
    const aggregate = aggregateScheduleC([charge('only', 100, '2026-03-01', 'Synthetic supplies')], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(aggregate.undated).toEqual([]);
    const data = {
      taxYear: 2026, grossReceipts: 1000, lineItems: aggregate.lineItemsArray,
      name: 'Synthetic Taxpayer', profession: 'Consultant', includeAppendix: true,
    };
    vi.useFakeTimers({ now: FIXED_AT, toFake: ['Date'] });
    const currentPdf = Buffer.from(await generateScheduleCPlanningPDF(data));
    const baselinePdf = Buffer.from(await baseScheduleCPdf(data));
    expect(currentPdf.equals(baselinePdf)).toBe(true);
    const loaded = await PDFDocument.load(currentPdf);
    expect(loaded.getCreationDate()?.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(loaded.getModificationDate()?.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    const currentCsv = generateScheduleCCSV(aggregate.lineItemsArray, 2026);
    const currentCsvExplicit = generateScheduleCCSV(aggregate.lineItemsArray, 2026, []);
    const baselineCsv = baseScheduleCCsv(aggregate.lineItemsArray, 2026);
    expect(currentCsv).toBe(baselineCsv);
    expect(currentCsvExplicit).toBe(baselineCsv);
    expect(Buffer.from(currentCsv).equals(Buffer.from(baselineCsv))).toBe(true);
  });

  it('lists one unreadable row on both the 2024 and the 2025 export and includes it in neither year total', async () => {
    const omitted = charge('once', 100, '01/05/2025', 'ONCE-UNREADABLE');
    const rows = [charge('y2024', 40, '2024-04-01', 'DATED-2024'), charge('y2025', 60, '2025-04-01', 'DATED-2025'), omitted];
    for (const year of [2024, 2025]) {
      const exported = yearExport(rows, year);
      const drawn = await drawPdf(exported.data);
      const text = joined(drawn);
      expect(text.split('ONCE-UNREADABLE').length - 1).toBe(1);
      expect(text).toContain('01/05/2025');
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).toBe(year === 2024 ? '$40.00' : '$60.00');
      expect(exported.aggregate.lineItemsArray.flatMap(line => line.transactions).map(row => row.id)).not.toContain('once');
      expect(exported.aggregate.undated.map(row => row.id)).toEqual(['once']);
      const parsed = parseCsv(exported.csv);
      expect(parsed[0]).toEqual(HEADERS);
      expect(new Set(parsed.map(row => row.length))).toEqual(new Set([HEADERS.length]));
      const last = parsed[parsed.length - 1];
      expect(last[HEADERS.indexOf('Merchant')]).toBe('ONCE-UNREADABLE');
      expect(last[HEADERS.indexOf('Tax date')]).toBe('');
      expect(last[HEADERS.indexOf('Schedule C planning reference')]).toBe('Needs more information');
      expect(last[HEADERS.indexOf('Confirmed contribution')]).toBe('');
      expect(parsed.slice(1, -1).some(row => row[HEADERS.indexOf('Schedule C planning reference')] === 'Needs more information')).toBe(false);
    }
  });
});
