import { describe, expect, it } from 'vitest';
import { convertTransactionsToCSV, csvCell, exportDate, exportYear, selectExportYear, recordedDeductibility, ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { preparerMonthlySummary, generatePreparerReport } from '@/lib/reports/preparer-report';
import { PDFDocument } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
describe('preparer CSV semantics', () => {
  it('preserves negative inflows, zero confidence and explicit non-deductibility', () => {
    const csv = convertTransactionsToCSV([{ id: 'tx', date: '2026-01-01', amount: -100, iso_currency_code: 'USD', is_deductible: false, deduction_score: 0, pending: false, category: ['Transfer', 'Internal'], business_purpose: 'Reconcile transfer', receipt_url: '/api/receipts/one', notes: 'No income assumed' }]);
    expect(csv).toContain(',-100,Inflow,'); expect(csv).toContain('Transfer > Internal,No,No'); expect(csv).toContain(',0,,/api/receipts/one,');
    expect(csv).toContain('Reconcile transfer'); expect(csv).not.toContain('Taxable Income');
  });
  it('escapes commas, double quotes, CR/newlines and prevents spreadsheet formula execution', () => {
    expect(csvCell('a,b"c\rd\ne')).toBe('"a,b""c\rd\ne"');
    for (const value of ['=HYPERLINK("https://bad")', ' +SUM(1)', '\t@A1', '-2+3']) expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell(-12.5)).toBe('-12.5'); expect(csvCell(false)).toBe('false'); expect(csvCell(0)).toBe('0');
  });
  it('never exports an external signed receipt URL or treats expense type as a Schedule C line', () => {
    const csv = convertTransactionsToCSV([{ date: '2026-01-01', amount: 10, expense_type: 'Meals', receipt_url: 'https://storage.test/private?token=secret' }]);
    expect(csv).not.toContain('secret'); expect(csv).not.toContain('Meals'); expect(csv).toContain('Receipt link unavailable'); expect(csv).toContain('Classification unreviewed');
  });
  it('preserves recorded partial-use and zero deduction overrides without claiming they are filing amounts', () => {
    const csv = convertTransactionsToCSV([{ date: '2026-01-01', amount: 200, is_deductible: true, equipment_details: { business_use_percentage: 50 }, deduction_override: 0 }]);
    expect(csv).toContain('equipment_details.business_use_percentage"":50'); expect(csv).toContain('deduction_override"":0');
    expect(csv).toContain('Recorded Business-use Fields (not applied)'); expect(csv).not.toContain('Business-use percentage not recorded');
    expect(convertTransactionsToCSV([{ date: '2026-01-01', amount: 200, is_deductible: true }])).toContain('Business-use percentage not recorded');
  });
  it('keeps calendar dates across timezone offsets and rejects impossible/missing selected-year dates', () => {
    expect(exportDate('2026-12-31T23:59:00-08:00')).toBe('2026-12-31'); expect(exportDate('2026-02-29')).toBeNull(); expect(exportDate(new Date(NaN))).toBeNull();
    expect(selectExportYear([{ date: '2026-12-31T23:59:00-08:00' }, { date: '2027-01-01' }], 2026)).toHaveLength(1);
    expect(() => selectExportYear([{ amount: 10 }], 2026)).toThrow(ExportReviewRequiredError);
  });
  it.each(['2026junk', '26', '2026.5', 2026.5, 1999, 2101, ''])('rejects invalid export year %s', value => expect(() => exportYear(value)).toThrow(RangeError));
  it('exports a truthful header for no records', () => expect(convertTransactionsToCSV([])).toContain('Cash Direction (not tax classification)'));
  it('preserves legacy deductible declarations without overriding an explicit false or trusting malformed flags', () => {
    expect(recordedDeductibility({ deductible: true })).toBe(true);
    expect(recordedDeductibility({ is_deductible: false, deductible: true })).toBe(false);
    expect(recordedDeductibility({ is_deductible: 'false', deductible: true })).toBeNull();
    expect(convertTransactionsToCSV([{ date: '2026-01-01', amount: 10, deductible: true }])).toContain(',Yes,Not recorded,');
    expect(preparerMonthlySummary([{ date: '2026-01-01', amount: 10, deductible: true }], 2026).groups.get('Currency not recorded')![0].markedOutflow).toBe(1000);
  });
});
describe('server-derived monthly PDF summary', () => {
  const records = [
    { id: 'receipt', date: '2026-01-01', amount: 120.25, iso_currency_code: 'USD', is_deductible: true },
    { id: 'deposit', date: '2026-01-31', amount: -5000, iso_currency_code: 'USD', is_deductible: false },
    { id: 'pending', date: '2026-01-31', amount: 900, iso_currency_code: 'USD', is_deductible: true, pending: true },
    { id: 'euro', date: '2026-12-31', amount: 50, iso_currency_code: 'EUR' },
    { id: 'old', date: '2025-01-01', amount: 999999, iso_currency_code: 'USD' },
  ];
  it('separates currencies, excludes pending, selects year, and preserves cash direction without calling it taxable income', () => {
    const summary = preparerMonthlySummary(records, 2026);
    expect(summary).toMatchObject({ count: 4, pending: 1, unreviewed: 1 });
    expect(summary.groups.get('USD')![0]).toEqual({ outflow: 12025, inflow: 500000, markedOutflow: 12025, count: 2 });
    expect(summary.groups.get('EUR')![11]).toEqual({ outflow: 5000, inflow: 0, markedOutflow: 0, count: 1 });
  });
  it('requires review for invalid amounts and repeated provider references instead of producing misleading totals', () => {
    expect(() => preparerMonthlySummary([{ date: '2026-01-01', amount: 'bad' }], 2026)).toThrow(ExportReviewRequiredError);
    const duplicate = { date: '2026-01-01', amount: 10, trans_id: 'same', account_id: 'a' };
    expect(() => preparerMonthlySummary([duplicate, duplicate], 2026)).toThrow(ExportReviewRequiredError);
  });
  it('produces a real, labeled PDF with separate currency pages', async () => {
    const bytes = await generatePreparerReport(records, 2026), pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2); expect(pdf.getTitle()).toBe('WriteOff 2026 - preparer transaction summary');
    if (process.env.WRITEOFF_EXPORT_SAMPLE) await writeFile(process.env.WRITEOFF_EXPORT_SAMPLE, bytes);
  });
});
