import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { aggregateScheduleC, CATEGORY_MAP, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { formatExportMoney } from '@/lib/reports/planning-pdf';
import { generateScheduleCPlanningPDF, type ScheduleCExportData } from '@/lib/reports/schedule-c-pdf';
import { SCHEDULE_C_UNREADABLE_DATE_NOTICE, unreadableChargeOutAndIn } from '@/lib/reports/schedule-c-unreadable-notice';
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

function charge(id: string, amount: number, date: unknown, merchant = id, category = 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES'): ScheduleCTransactionLike {
  const row: ScheduleCTransactionLike = {
    id, trans_id: id, merchant_name: merchant, amount,
    category, iso_currency_code: 'USD',
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
  const dated2024Ads = charge('y2024ads', 25, '2024-07-01', 'DATED-2024-ADS', 'SERVICE_ADVERTISING');
  const dated2025 = charge('y2025', 60, '2025-06-01', 'DATED-2025');
  const dated2025Ads = charge('y2025ads', 30, '2025-07-01', 'DATED-2025-ADS', 'SERVICE_ADVERTISING');
  const unreadable = charge('bad', 17.25, 'not-a-date', 'UNREADABLE-ONE');
  const blank = charge('blank', -4, '', 'UNREADABLE-TWO');
  const dated = [dated2024, dated2024Ads, dated2025, dated2025Ads];
  const rows = [...dated, unreadable, blank];

  it('leaves unreadable date amounts out of every Schedule C line total in the PDF and the CSV for any selected year', async () => {
    for (const year of [2024, 2025, 2026]) {
      const withOmitted = yearExport(rows, year);
      const withoutOmitted = yearExport(dated, year);
      expect(withOmitted.aggregate.totalDeductible).toBe(withoutOmitted.aggregate.totalDeductible);
      expect(withOmitted.aggregate.totalExpenses).toBe(withoutOmitted.aggregate.totalExpenses);
      expect(withOmitted.aggregate.lineItemsArray.map(line => [line.lineCode, line.deductible, line.total])).toEqual(
        withoutOmitted.aggregate.lineItemsArray.map(line => [line.lineCode, line.deductible, line.total]),
      );
      expect(withOmitted.aggregate.lineItemsArray.map(line => line.lineName).sort()).toEqual(year === 2026 ? [] : ['Advertising', 'Supplies']);

      const drawn = await drawPdf(withOmitted.data);
      const baseline = await drawPdf(withoutOmitted.data);
      for (const line of withOmitted.aggregate.lineItemsArray) {
        const label = `${line.lineName} - ${line.transactionCount} confirmed records`;
        expect(nextMoney(drawn, label)).toBe(formatExportMoney(line.deductible));
        expect(nextMoney(drawn, label)).toBe(nextMoney(baseline, label));
      }
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).toBe(formatExportMoney(withOmitted.aggregate.totalDeductible));
      expect(nextMoney(drawn, 'Confirmed expense subtotal only')).toBe(nextMoney(baseline, 'Confirmed expense subtotal only'));
      expect(drawn[drawn.findIndex(item => item.text === 'Charges out') + 1]?.text).toBe('$17.25');
      expect(drawn[drawn.findIndex(item => item.text === 'Money in') + 1]?.text).toBe('$4.00');
      expect(joined(drawn)).not.toContain('$21.25');
      expect(joined(drawn)).not.toContain('$13.25');

      const parsed = parseCsv(withOmitted.csv);
      const parsedBaseline = parseCsv(withoutOmitted.csv);
      expect(parsed[0]).toEqual(HEADERS);
      expect(new Set(parsed.map(row => row.length))).toEqual(new Set([HEADERS.length]));
      expect(withOmitted.csv.split('\r\n').slice(0, parsedBaseline.length)).toEqual(withoutOmitted.csv.split('\r\n'));
      const trailing = parsed.slice(parsedBaseline.length);
      expect(trailing.map(row => row[HEADERS.indexOf('Merchant')])).toEqual(['UNREADABLE-ONE', 'UNREADABLE-TWO', 'Charges out', 'Money in']);
      expect(trailing.map(row => row[HEADERS.indexOf('Schedule C planning reference')])).toEqual(['Needs more information', 'Needs more information', '', '']);
      expect(trailing.map(row => row[HEADERS.indexOf('Signed amount')])).toEqual(['17.25', '-4', '$17.25', '$4.00']);
      expect(trailing.map(row => row[0])).toEqual(['', '', '', '']);
      expect(contributionSum(parsed)).toBe(contributionSum(parsedBaseline));
      expect(withOmitted.csv.startsWith('Tax date,')).toBe(true);
      expect(withOmitted.csv.split('\r\n')[0]).not.toContain('assigned to any year');
    }
  });

  it('shows the unreadable count and dollar total in Needs more information and says that year totals may be missing them', async () => {
    // February 31 is not a calendar day, so a written English month still leaves this charge undated.
    const row = charge('jan', 17.25, 'February 31, 2025', 'UNDATED-JAN');
    const notice = SCHEDULE_C_UNREADABLE_DATE_NOTICE(unreadableChargeOutAndIn([row]));
    expect(notice).toBe("These totals leave out 1 charge ($17.25) because its date couldn't be read, so it isn't counted in any year. It's listed under Needs more information below.");
    expect(notice).toContain('leave out');
    expect(notice).toContain("it isn't counted in any year");
    const { data } = yearExport([charge('kept', 40, '2025-03-01', 'DATED-KEEP'), row], 2025);
    const drawn = await drawPdf(data);
    expect(drawn.map(item => item.text).join(' ')).toContain(notice);
    const keepAt = drawn.findIndex(item => item.text === 'DATED-KEEP');
    const sectionAt = drawn.findIndex((item, index) => index > keepAt && item.text === 'Needs more information');
    expect(sectionAt).toBeGreaterThan(keepAt);
    const sectionText = drawn.slice(sectionAt).map(item => item.text).join('\n');
    expect(sectionText.indexOf('UNDATED-JAN')).toBeGreaterThan(0);
    expect(sectionText.indexOf('February 31, 2025')).toBeGreaterThan(0);
    const outAt = drawn.findIndex((item, index) => index > sectionAt && item.text === 'Charges out');
    expect(drawn[outAt + 1].text).toBe('$17.25');
    expect(drawn.some(item => item.text === 'Money in')).toBe(false);
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

  it('gives case A exactly for one charge of $17.25', () => {
    const totals = unreadableChargeOutAndIn([charge('one', 17.25, 'not-a-date', 'ONE-CHARGE')]);
    expect(totals).toEqual({ out: 17.25, in: 0, outCount: 1, inCount: 0 });
    expect(SCHEDULE_C_UNREADABLE_DATE_NOTICE(totals)).toBe("These totals leave out 1 charge ($17.25) because its date couldn't be read, so it isn't counted in any year. It's listed under Needs more information below.");
  });

  it('gives case A plural exactly for three charges totalling $17.25', () => {
    const totals = unreadableChargeOutAndIn([
      charge('a', 10, 'not-a-date'),
      charge('b', 5, 'not-a-date'),
      charge('c', 2.25, 'not-a-date'),
    ]);
    expect(totals).toEqual({ out: 17.25, in: 0, outCount: 3, inCount: 0 });
    expect(SCHEDULE_C_UNREADABLE_DATE_NOTICE(totals)).toBe("These totals leave out 3 charges ($17.25) because their dates couldn't be read, so they aren't counted in any year. They're listed under Needs more information below.");
  });

  it('gives case B exactly for one refund of $4.00', () => {
    const totals = unreadableChargeOutAndIn([charge('refund', -4, 'not-a-date', 'ONE-REFUND')]);
    expect(totals).toEqual({ out: 0, in: 4, outCount: 0, inCount: 1 });
    const notice = SCHEDULE_C_UNREADABLE_DATE_NOTICE(totals);
    expect(notice).toBe("These totals leave out 1 refund or other credit ($4.00) because its date couldn't be read, so it isn't counted in any year. It's listed under Needs more information below.");
    expect(notice).not.toContain('charge');
    expect(notice).not.toContain('$0.00');
  });

  it('gives case C exactly for two charges of $17.25 and one refund of $4.00', async () => {
    const rows = [
      charge('a', 10, 'not-a-date', 'CHARGE-A'),
      charge('b', 7.25, 'not-a-date', 'CHARGE-B'),
      charge('c', -4, 'not-a-date', 'REFUND-C'),
    ];
    const totals = unreadableChargeOutAndIn(rows);
    expect(totals).toEqual({ out: 17.25, in: 4, outCount: 2, inCount: 1 });
    const notice = SCHEDULE_C_UNREADABLE_DATE_NOTICE(totals);
    expect(notice).toBe("These totals leave out 2 charges ($17.25) and 1 refund or other credit ($4.00) because their dates couldn't be read, so they aren't counted in any year. They're listed under Needs more information below.");
    expect(notice).not.toContain('$21.25');
    expect(notice).not.toContain('$13.25');
    const drawn = await drawPdf(yearExport(rows, 2025).data);
    const text = joined(drawn);
    expect(text).not.toContain('$21.25');
    expect(text).not.toContain('$13.25');
    expect(drawn[drawn.findIndex(item => item.text === 'Charges out') + 1].text).toBe('$17.25');
    expect(drawn[drawn.findIndex(item => item.text === 'Money in') + 1].text).toBe('$4.00');
  });

  it('gives no notice and no Needs more information 0 when no charge date is unreadable', async () => {
    expect(SCHEDULE_C_UNREADABLE_DATE_NOTICE({ out: 0, in: 0, outCount: 0, inCount: 0 })).toBe('');
    const aggregate = aggregateScheduleC([charge('only', 40, '2025-03-01', 'DATED-ONLY')], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(aggregate.undated).toEqual([]);
    const drawn = await drawPdf({
      taxYear: 2025, grossReceipts: 1000, lineItems: aggregate.lineItemsArray,
      name: 'Synthetic Taxpayer', includeAppendix: true, needsMoreInformation: [],
    });
    const text = joined(drawn);
    expect(text).not.toContain('Needs more information');
    expect(text).not.toContain("couldn't be read");
    expect(text).not.toContain('Needs more information 0');
    const csv = generateScheduleCCSV(aggregate.lineItemsArray, 2025, []);
    expect(csv).not.toContain('Needs more information');
    expect(csv).not.toContain('Charges out');
    expect(csv).not.toContain('Money in');
  });

  it('prints Charges out only for charges and Money in only for credits in the PDF and the CSV', async () => {
    const refundOnly = yearExport([charge('refund', -4, 'not-a-date', 'ONLY-REFUND')], 2025);
    const refundDrawn = await drawPdf(refundOnly.data);
    expect(refundDrawn.some(item => item.text === 'Charges out')).toBe(false);
    expect(refundDrawn[refundDrawn.findIndex(item => item.text === 'Money in') + 1].text).toBe('$4.00');
    const refundCsv = parseCsv(refundOnly.csv);
    expect(refundCsv.some(row => row.includes('Charges out'))).toBe(false);
    expect(refundCsv.some(row => row.includes('Money in') && row.includes('$4.00'))).toBe(true);

    const chargesOnly = yearExport([charge('charge', 17.25, 'not-a-date', 'ONLY-CHARGE')], 2025);
    const chargeDrawn = await drawPdf(chargesOnly.data);
    expect(chargeDrawn.some(item => item.text === 'Money in')).toBe(false);
    expect(chargeDrawn[chargeDrawn.findIndex(item => item.text === 'Charges out') + 1].text).toBe('$17.25');
    const chargeCsv = parseCsv(chargesOnly.csv);
    expect(chargeCsv.some(row => row.includes('Money in'))).toBe(false);
    expect(chargeCsv.some(row => row.includes('Charges out') && row.includes('$17.25'))).toBe(true);
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
      const detail = parsed.find(row => row[HEADERS.indexOf('Merchant')] === 'ONCE-UNREADABLE');
      expect(detail?.[HEADERS.indexOf('Tax date')]).toBe('');
      expect(detail?.[HEADERS.indexOf('Schedule C planning reference')]).toBe('Needs more information');
      expect(detail?.[HEADERS.indexOf('Confirmed contribution')]).toBe('');
      expect(parsed.filter(row => row[HEADERS.indexOf('Schedule C planning reference')] === 'Needs more information')).toHaveLength(1);
      expect(parsed.at(-1)?.[HEADERS.indexOf('Merchant')]).toBe('Charges out');
      expect(parsed.at(-1)?.[HEADERS.indexOf('Signed amount')]).toBe('$100.00');
      expect(parsed.some(row => row[HEADERS.indexOf('Merchant')] === 'Money in')).toBe(false);
    }
  });
});
