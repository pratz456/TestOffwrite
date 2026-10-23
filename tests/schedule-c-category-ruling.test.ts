import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

import { ANALYSIS_DECISION_RULES } from '@/lib/ai/analysis-decision-rules';
import { composeExplanation, scheduleCLineFor, type ExplainableResult } from '@/lib/ai/explanation';
import { PROFESSION_PRIORS } from '@/lib/ai/profession-priors';
import { CATEGORY_SCHEDULE_C_LINE, TRANSACTION_TAX_EVIDENCE } from '@/lib/ai/transaction-tax-policy';
import { buildEvidenceRecord } from '@/lib/reports/audit-support-packet';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { convertTransactionsToCSV, type ExportRecord } from '@/lib/reports/transaction-export';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';

const NOTE = "The de minimis safe harbor election statement must be attached to that year's return.";
const ADOBE_LINE_18 = 'ordinary software expense (Schedule C line 18)';

function row(fields: ExportRecord): ExportRecord {
  const id = String(fields.id ?? 'row');
  return {
    id, trans_id: id, iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed',
    review_source: 'user_corrected', merchant_name: 'Merchant', ...fields,
  };
}

function totals(records: ExportRecord[], year: string, mode: 'confirmed-only' | 'default' = 'confirmed-only') {
  return aggregateScheduleC(records as never[], year, undefined, { mode });
}

function lineDeductible(records: ExportRecord[], year: string, line: string, mode: 'confirmed-only' | 'default' = 'confirmed-only') {
  return totals(records, year, mode).lineItems[line]?.deductible ?? 0;
}

function reviewCount(records: ExportRecord[], year: string, mode: 'confirmed-only' | 'default' = 'confirmed-only') {
  return totals(records, year, mode).needsMoreInformation?.length ?? 0;
}

function softwareResult(amount: number, date: string, extra: Partial<ExplainableResult> = {}): ExplainableResult {
  return {
    status: 'ok', transaction_kind: 'expense', category: 'software_subscriptions', is_deductible: true, sources: [], ...extra,
  } as ExplainableResult;
}

describe('Schedule C category ruling', () => {
  it('keeps line 18 for office supplies only', () => {
    expect(Object.entries(CATEGORY_MAP).filter(([, entry]) => entry.line === '18').map(([key]) => key)).toEqual([
      'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
    ]);
    const supplies = row({ id: 'supplies', date: '2026-06-15', amount: 45, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', merchant_name: 'Staples' });
    expect(lineDeductible([supplies], '2026', '18')).toBe(45);
    expect(lineDeductible([supplies], '2026', '22')).toBe(0);
    const csv = convertTransactionsToCSV([supplies]);
    expect(csv).toContain(',18,18,');
    expect(csv).not.toContain(',22,22,');
  });

  it('moves storage to line 20b and other general merchandise to line 22', () => {
    const storage = row({ id: 'storage', date: '2026-06-15', amount: 80, category: 'SERVICE_STORAGE', merchant_name: 'Public Storage' });
    const other = row({ id: 'other', date: '2026-06-15', amount: 30, category: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', merchant_name: 'Target' });
    expect(lineDeductible([storage], '2026', '20b')).toBe(80);
    expect(lineDeductible([storage], '2026', '18')).toBe(0);
    expect(lineDeductible([other], '2026', '22')).toBe(30);
    expect(lineDeductible([other], '2026', '18')).toBe(0);
    expect(convertTransactionsToCSV([storage])).toContain(',20b,20b,');
    expect(convertTransactionsToCSV([other])).toContain(',22,22,');
  });

  it.each([
    ['2016-06-15', '2016', 0, 1],
    ['2024-06-15', '2024', 2500, 0],
    ['2025-06-15', '2025', 2500, 0],
  ])('prints a computer charge of 2500.00 on Part V for %s', (date, year, deductible, review) => {
    const charge = row({ id: 'pc', date, amount: 2500, category: 'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS', merchant_name: 'Best Buy' });
    expect(lineDeductible([charge], year, '27a')).toBe(deductible);
    expect(lineDeductible([charge], year, '18')).toBe(0);
    expect(reviewCount([charge], year)).toBe(review);
    if (deductible > 0) {
      const printed = year === '2024' ? '27a (Other expenses)' : '27b (Other expenses)';
      expect(convertTransactionsToCSV([charge])).toContain(printed);
      expect(totals([charge], year).lineItems['27a']?.transactions?.[0]?.schedule_c_export_note).toBe(NOTE);
    }
  });

  it('sends a computer charge of $2,500.01 to Needs more information', () => {
    const charge = row({ id: 'pc-over', date: '2026-06-15', amount: 2500.01, category: 'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS', merchant_name: 'Apple' });
    expect(lineDeductible([charge], '2026', '27a')).toBe(0);
    expect(lineDeductible([charge], '2026', '18')).toBe(0);
    expect(reviewCount([charge], '2026')).toBe(1);
    expect(totals([charge], '2026').totalDeductible).toBe(0);
    expect(convertTransactionsToCSV([charge])).not.toContain(NOTE);
    const evidence = buildEvidenceRecord(charge, { uid: 'owner', tripsByDate: new Map(), yearTripCount: 0, receiptsByTransaction: new Map() });
    expect(evidence.scheduleCLine).toBeNull();
    expect(evidence.substantiation.advisories).toContain('Needs more information');
  });

  it.each([
    ['2016-06-15', '2016', 0, 1],
    ['2024-06-15', '2024', 40, 0],
    ['2025-06-15', '2025', 40, 0],
  ])('prints a one off software charge of 40.00 on Part V for %s', (date, year, deductible, review) => {
    const charge = row({ id: 'soft', date, amount: 40, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Solo Vendor', description: 'single seat' });
    expect(lineDeductible([charge], year, '27a')).toBe(deductible);
    expect(lineDeductible([charge], year, '18')).toBe(0);
    expect(reviewCount([charge], year)).toBe(review);
  });

  it('treats one off software at $2,500.00 and $2,500.01 on opposite sides of the safe harbor', () => {
    const at = row({ id: 'soft-at', date: '2026-06-15', amount: 2500, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Once Software' });
    const over = row({ id: 'soft-over', date: '2026-06-15', amount: 2500.01, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Big Software' });
    expect(lineDeductible([at], '2026', '27a')).toBe(2500);
    expect(totals([at], '2026').lineItems['27a']?.transactions?.[0]?.schedule_c_export_note).toBe(NOTE);
    expect(lineDeductible([over], '2026', '27a')).toBe(0);
    expect(lineDeductible([over], '2026', '18')).toBe(0);
    expect(reviewCount([over], '2026')).toBe(1);
    const atCard = scheduleCLineFor(softwareResult(2500, '2026-06-15'), '2026-06-15', { amount: 2500, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Once Software' });
    const overCard = scheduleCLineFor(softwareResult(2500.01, '2026-06-15'), '2026-06-15', { amount: 2500.01, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Big Software' });
    expect(atCard).toBe('Schedule C line 27b (Other expenses)');
    expect(overCard).toBeNull();
  });

  it.each([
    ['2016-06-15', '2016', 0, 2],
    ['2024-06-15', '2024', 30, 0],
    ['2025-06-15', '2025', 30, 0],
  ])('prints a recurring subscription on Part V for %s', (date, year, deductible, review) => {
    const first = row({ id: `${year}-a`, date, amount: 15, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Adobe Inc.' });
    const second = row({ id: `${year}-b`, date, amount: 15, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'ADOBE, INC' });
    expect(lineDeductible([first, second], year, '27a')).toBe(deductible);
    expect(lineDeductible([first, second], year, '18')).toBe(0);
    expect(reviewCount([first, second], year)).toBe(review);
    if (deductible > 0) {
      const notes = (totals([first, second], year).lineItems['27a']?.transactions ?? []).map(item => item.schedule_c_export_note ?? null);
      expect(notes).toEqual([null, null]);
    }
  });

  it('keeps a large recurring software charge on Part V and a one off lifetime charge in review', () => {
    const older = row({ id: 'old', date: '2024-03-01', amount: 15, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Adobe Inc.' });
    const newer = row({ id: 'new', date: '2025-06-15', amount: 3000, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'ADOBE, INC' });
    expect(lineDeductible([older, newer], '2025', '27a')).toBe(3000);
    expect(reviewCount([older, newer], '2025')).toBe(0);
    const lifetime = row({ id: 'life', date: '2026-06-15', amount: 99, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Adobe', description: 'Lifetime license' });
    const pair = row({ id: 'pair', date: '2026-07-01', amount: 15, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Adobe' });
    expect(reviewCount([lifetime, pair], '2026')).toBe(1);
    expect(lineDeductible([lifetime, pair], '2026', '27a')).toBe(15);
    const alone = row({ id: 'alone', date: '2026-06-15', amount: 3000, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Unique Tool' });
    expect(lineDeductible([alone], '2026', '27a')).toBe(0);
    expect(reviewCount([alone], '2026')).toBe(1);
    const card = scheduleCLineFor(softwareResult(3000, '2025-06-15'), '2025-06-15', {
      amount: 3000, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'ADOBE, INC', id: 'new',
      peers: [older, newer] as never[],
    });
    expect(card).toBe('Schedule C line 27b (Other expenses)');
  });

  it('withholds undated and impossible subscription dates', () => {
    const undated = row({ id: 'undated', amount: 20, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Adobe' });
    delete undated.date;
    expect(reviewCount([undated], '2026')).toBe(1);
    expect(totals([undated], '2026').totalDeductible).toBe(0);
    const impossible = row({ id: 'bad', date: '2025-02-30', amount: 20, category: 'SERVICE_SUBSCRIPTION', merchant_name: 'Adobe' });
    expect(reviewCount([impossible], '2025')).toBe(1);
    expect(totals([impossible], '2025').totalDeductible).toBe(0);
  });

  it('leaves pharmacy at $0 unless the user marks it business, and then asks for more information', () => {
    const personal = row({ id: 'pharmacy', date: '2026-06-15', amount: 25, category: 'GENERAL_MERCHANDISE_PHARMACY', merchant_name: 'CVS', is_deductible: null, review_status: undefined });
    const personalTotals = totals([personal], '2026', 'default');
    expect(personalTotals.totalDeductible).toBe(0);
    expect(personalTotals.lineItems['18']?.deductible ?? 0).toBe(0);
    const business = row({ id: 'pharmacy-biz', date: '2026-06-15', amount: 25, category: 'GENERAL_MERCHANDISE_PHARMACY', merchant_name: 'Walgreens', is_deductible: true });
    expect(totals([business], '2026').totalDeductible).toBe(0);
    expect(reviewCount([business], '2026')).toBe(1);
    expect(lineDeductible([business], '2026', '18')).toBe(0);
  });

  it('sends home improvement to Needs more information', () => {
    const home = row({ id: 'home', date: '2026-06-15', amount: 400, category: 'GENERAL_MERCHANDISE_HOME_IMPROVEMENT', merchant_name: 'Home Depot' });
    expect(totals([home], '2026').totalDeductible).toBe(0);
    expect(reviewCount([home], '2026')).toBe(1);
    expect(lineDeductible([home], '2026', '18')).toBe(0);
  });

  it('puts the safe harbor note on the Schedule C CSV, the transaction CSV, the PDF and the audit packet', async () => {
    const charge = row({ id: 'pc-note', date: '2026-06-15', amount: 2500, category: 'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS', merchant_name: 'Best Buy' });
    const aggregated = totals([charge], '2026');
    expect(generateScheduleCCSV(aggregated.lineItemsArray, 2026)).toContain(NOTE);
    expect(convertTransactionsToCSV([charge])).toContain(NOTE);
    const evidence = buildEvidenceRecord(charge, { uid: 'owner', tripsByDate: new Map(), yearTripCount: 0, receiptsByTransaction: new Map() });
    expect(evidence.scheduleCLine).toBe('27b (Other expenses)');
    expect(evidence.substantiation.advisories).toContain(NOTE);
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    await generateScheduleCPlanningPDF({ taxYear: 2026, grossReceipts: 0, lineItems: aggregated.lineItemsArray, includeAppendix: true });
    expect(spy.mock.calls.map(call => String(call[0])).join('\n')).toContain('de minimis safe harbor');
    spy.mockRestore();
    const card = composeExplanation({
      result: softwareResult(2500, '2026-06-15'),
      transaction: charge,
      profile: { income: 80000, filing_status: 'single' },
      taxYear: 2026,
    });
    expect(card.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
  });

  it('stops teaching that software is Schedule C line 18', () => {
    expect(ANALYSIS_DECISION_RULES).not.toContain(ADOBE_LINE_18);
    expect(ANALYSIS_DECISION_RULES).toContain('ordinary software expense (Schedule C other expenses)');
    const prompt = readFileSync(new URL('../lib/ai/analyzeTransaction.ts', import.meta.url), 'utf8');
    expect(prompt).not.toContain(ADOBE_LINE_18);
    expect(prompt).toContain('ordinary software expense (Schedule C other expenses)');
    const priors = JSON.stringify(PROFESSION_PRIORS);
    expect(priors).not.toContain('(line 18)');
    expect(priors).toContain('(Schedule C other expenses)');
    expect(CATEGORY_SCHEDULE_C_LINE.software_subscriptions).toBe('27a');
    const rule = (TRANSACTION_TAX_EVIDENCE as Array<{ id: string; rule: string }>).find(item => item.id === 'software-334');
    expect(rule?.rule ?? '').not.toContain('Schedule C line 18');
    expect(rule?.rule ?? '').toContain('de minimis safe harbor election statement');
    const merchants = readFileSync(new URL('../lib/ai/merchant-intelligence.ts', import.meta.url), 'utf8');
    expect(merchants).not.toContain("'software_subscriptions', '18'");
    expect(merchants).not.toContain('Schedule C line 18');
  });
});
