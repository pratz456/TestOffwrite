import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpensesDetailScreen } from '@/components/expenses-detail-screen';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { assembleAuditSupportPacket } from '@/lib/reports/audit-support-packet';
import { assertFilingExportAllowed, FilingExportBlockedError } from '@/lib/reports/transaction-export';
import { sumExpensesForQuarter } from '@/lib/tax-provider/quarterly-estimates';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

afterEach(async () => { await receiptProcessor.terminate(); vi.clearAllMocks(); });

function market(lines: string[]) {
  return ['SYNTHETIC MARKET LLC', '100 MAIN STREET', '2026-09-02', ...lines].join('\n');
}

const usReceipt = (totalLine: string) => market([
  'COFFEE 4.00',
  'BAGEL 8.00',
  'SUBTOTAL 20.00',
  'DISCOUNT 7.50',
  'TAX 1.25',
  'TIP 5.00',
  totalLine,
]);

const euReceipt = (totalLine: string) => market([
  'ESPRESSO 4,00',
  'CROISSANT 8,00',
  'SUBTOTAL 20,00',
  'TAX 1,25',
  'TIP 3,00',
  totalLine,
]);

async function read(text: string) {
  worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
  const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
  expect(result.success).toBe(true);
  return result.data!;
}

describe('receipt totals from US and EU layouts', () => {
  it.each([
    ['TOTAL DUE 12.50', usReceipt('TOTAL DUE 12.50'), 12.5],
    ['AMOUNT DUE $12.50', usReceipt('AMOUNT DUE $12.50'), 12.5],
    ['BALANCE DUE 12.50', usReceipt('BALANCE DUE 12.50'), 12.5],
    ['GRAND TOTAL 1,234.56', usReceipt('GRAND TOTAL 1,234.56'), 1234.56],
    ['TOTAL 1,250.00', usReceipt('TOTAL 1,250.00'), 1250],
    ['TOTAL 12.50 USD', usReceipt('TOTAL 12.50 USD'), 12.5],
    ['TOTAL 1.234,56', euReceipt('TOTAL 1.234,56'), 1234.56],
  ])('reads %s', async (_label, text, amount) => {
    const data = await read(text);
    expect(data.amount).toBeCloseTo(amount, 2);
    expect(data.amountNeedsReview).toBe(false);
    expect(data.date).toBe('2026-09-02');
  });

  it('uses a US thousands comma when another amount shows dot cents', async () => {
    const data = await read(usReceipt('TOTAL 1,234'));
    expect(data.amount).toBe(1234);
    expect(data.amountNeedsReview).toBe(false);
  });

  it('uses an EU thousands dot when another amount shows a comma decimal', async () => {
    const data = await read(euReceipt('TOTAL 1.234'));
    expect(data.amount).toBe(1234);
    expect(data.amountNeedsReview).toBe(false);
  });

  it('lets the grand total win over an earlier total line', async () => {
    const data = await read(market(['TOTAL 10.00', 'GRAND TOTAL 12.50']));
    expect(data.amount).toBe(12.5);
    expect(data.amountNeedsReview).toBe(false);
  });

  it('reads a bare amount line when no total is printed', async () => {
    const data = await read(market(['PENCILS 6.25', 'AMOUNT 18.75']));
    expect(data.amount).toBe(18.75);
    expect(data.amountNeedsReview).toBe(false);
  });

  it.each([
    ['TOTAL 1,234', market(['WIDGET 2', 'GADGET 3', 'TOTAL 1,234'])],
    ['TOTAL', market(['COFFEE 4.00', 'TOTAL'])],
    ['TOTAL 12,5', market(['TOTAL 12,5'])],
    ['items only', market(['COFFEE 4.50', 'MUFFIN 3.25'])],
    // Currency symbols before the number are a separate change. They stay unread.
    ['Total €25.00', market(['Total €25.00'])],
    ['Total ₹25.00', market(['Total ₹25.00'])],
  ])('leaves %s blank for review', async (_label, text) => {
    const data = await read(text);
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.amount).not.toBe(0);
  });

  it.each([
    ['before the total', ['BALANCE DUE 0.00', 'TOTAL 12.50']],
    ['after the total', ['TOTAL 12.50', 'BALANCE DUE 0.00']],
  ])('keeps a positive total when a zero balance due is %s', async (_label, lines) => {
    const data = await read(market(['COFFEE 4.00', 'BAGEL 8.00', 'SUBTOTAL 20.00', 'DISCOUNT 7.50', 'TAX 1.25', 'TIP 5.00', ...lines]));
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
    expect(data.amount).not.toBe(0);
  });

  it.each([
    'TAX TOTAL 1.25',
    'TIP TOTAL 5.00',
    'TOTAL TAX 1.25',
    'TOTAL TIP 5.00',
    'TOTAL SAVINGS 3.00',
    'TOTAL DISCOUNT 7.50',
    'TOTAL TENDERED 20.00',
    'TOTAL ITEMS 3',
    'TOTAL NUMBER OF ITEMS SOLD 3',
    'AMOUNT TAX 9.00',
    'TIP AMOUNT 5.00',
  ])('does not let %s replace TOTAL 12.50 from either side', async noise => {
    for (const lines of [
      ['COFFEE 4.00', 'BAGEL 8.00', 'SUBTOTAL 20.00', noise, 'TOTAL 12.50'],
      ['COFFEE 4.00', 'BAGEL 8.00', 'SUBTOTAL 20.00', 'TOTAL 12.50', noise],
    ]) {
      const data = await read(market(lines));
      expect(data.amount).toBeCloseTo(12.5, 2);
      expect(data.amountNeedsReview).toBe(false);
    }
  });

  it('does not let a higher ranked tax label replace the total from either side', async () => {
    for (const lines of [
      ['GRAND TOTAL TAX 99.00', 'TOTAL 12.50'],
      ['TOTAL 12.50', 'GRAND TOTAL TAX 99.00'],
    ]) {
      const data = await read(market(lines));
      expect(data.amount).toBeCloseTo(12.5, 2);
      expect(data.amount).not.toBe(99);
    }
  });

  it('does not turn a negative total into a positive expense from another dollar amount', async () => {
    const data = await read(market(['$20.00', 'TOTAL -12.50']));
    expect(data.amount).toBeNull();
    expect(data.signedAmountReview).toBe(-12.5);
    expect(data.amount).not.toBe(20);
    expect(data.amount).not.toBe(12.5);
  });

  it('keeps a total when a tax note follows the amount', async () => {
    const data = await read(market(['TOTAL 12.50 TAX INCLUDED']));
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
  });

  it.each([
    ['TOTAL -12.50', market(['TOTAL -12.50'])],
    ['TOTAL (12.50)', market(['TOTAL (12.50)'])],
    ['TOTAL $-12.50', market(['TOTAL $-12.50'])],
  ])('keeps the minus on %s for refund review', async (_label, text) => {
    const data = await read(text);
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.signedAmountReview).toBe(-12.5);
    expect(data.amount).not.toBe(12.5);
  });

  it.each([
    ['$12.50', market(['$12.50'])],
    ['largest dollar amount', market(['$4.00', '$8.00', '$12.50'])],
    ['12.50 USD', market(['12.50 USD'])],
  ])('reads unlabeled US amount %s', async (_label, text) => {
    const data = await read(text);
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
  });

  it('ignores a dollar amount printed only on a tax or subtotal line', async () => {
    const data = await read(market(['SUBTOTAL $20.00', 'TAX TOTAL $8.00', '$4.00', '$12.50']));
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
  });

  it.each([
    ['dollar sign', market(['FEE $1', 'TOTAL 1,234']), 1234],
    ['USD', market(['PAID USD', 'TOTAL 1,234']), 1234],
    ['state and ZIP', market(['CA 94105', 'AMOUNT 2,000']), 2000],
    ['comma address', market(['WILMINGTON, DE 19801', 'TOTAL 1,234']), 1234],
    ['full state name', market(['INDIANA 46204', 'TOTAL 12,500']), 12500],
  ])('reads a thousands comma when the receipt shows a US signal (%s)', async (_label, text, amount) => {
    const data = await read(text);
    expect(data.amount).toBe(amount);
    expect(data.amountNeedsReview).toBe(false);
  });

  it('leaves a German TOTAL 1,234 dated 05/03/2026 blank when there is no dollar or USD', async () => {
    const data = await read(['SYNTHETIC MARKET', 'BERLIN', '05/03/2026', 'TOTAL 1,234'].join('\n'));
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.amount).not.toBe(0);
    expect(data.amount).not.toBe(1234);
    expect(data.amount).not.toBe(1);
  });

  it.each([
    'SOLD IN 12345',
    'MADE IN 94105',
    'DE 10115',
    'ME 04101',
    'PA 19103',
    'in 94105',
    '09/02/2026',
  ])('does not treat %s as a US signal for TOTAL 1,234', async (line) => {
    const data = await read(market([line, 'WIDGET 4', 'TOTAL 1,234']));
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.amount).not.toBe(1234);
  });

  it('leaves a thousands comma blank when another amount uses comma cents', async () => {
    const data = await read(market(['CA 94105', 'TAX 1,25', 'TOTAL 1,234']));
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.amount).not.toBe(1234);
    expect(data.amount).not.toBe(1);
  });

  it('leaves a Quebec TOTAL 12,50 $ blank when the receipt shows QC H2X 1Y4', async () => {
    const data = await read(market(['QC H2X 1Y4', 'TOTAL 12,50 $']));
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.amount).not.toBe(12.5);
    expect(data.amount).not.toBe(1250);
    expect(data.amount).not.toBe(12);
    expect(data.amount).not.toBe(0);
    expect(data.suggestedAmount).toBe(12.5);
  });

  it('leaves TOTAL 1,234 blank when a Canadian signal is present', async () => {
    const data = await read(market(['QC H2X 1Y4', 'ITEM $4.00', 'TOTAL 1,234']));
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.amount).not.toBe(1234);
    expect(data.amount).not.toBe(1.234);
    expect(data.amount).not.toBe(4);
  });

  it('still reads TOTAL $1,234 when a dollar sign and a state plus ZIP are present', async () => {
    const data = await read(market(['WILMINGTON, DE 19801', 'TOTAL $1,234']));
    expect(data.amount).toBe(1234);
    expect(data.amountNeedsReview).toBe(false);
  });

  it('reads TOTAL $1,234 when CA is only the US state on a California receipt', async () => {
    const data = await read(market(['San Jose, CA 95112', 'TAX CA $0.33', 'TOTAL $1,234']));
    expect(data.amount).toBe(1234);
    expect(data.amountNeedsReview).toBe(false);
    expect(data.amount).not.toBe(0.33);
  });

  it('reads TOTAL DUE 12.50', async () => {
    const data = await read(market(['TOTAL DUE 12.50']));
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
    expect(data.amount).not.toBe(0);
  });

  it('reads TOTAL DUE ALL 12.50', async () => {
    const data = await read(market(['TOTAL DUE ALL 12.50']));
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
    expect(data.amount).not.toBe(0);
    expect(data.amount).not.toBe(12);
  });

  it.each([
    ['a bare dollar', market(['FEE $1', 'TOTAL 12,50'])],
    ['USD', market(['PAID USD', 'TOTAL 12,50'])],
    ['a state and ZIP', market(['WILMINGTON, DE 19801', 'TOTAL 12,50'])],
    ['California CA beside a dollar', market(['San Jose, CA 95112', 'TAX CA $0.33', 'TOTAL 12,50'])],
  ])('saves TOTAL 12,50 when the receipt has %s', async (_label, text) => {
    const data = await read(text);
    expect(data.amount).toBeCloseTo(12.5, 2);
    expect(data.amountNeedsReview).toBe(false);
    expect(data.suggestedAmount).toBeUndefined();
    expect(data.amount).not.toBe(0);
    expect(data.amount).not.toBe(12);
  });

  it.each([
    ['TOTAL 12,50', euReceipt('TOTAL 12,50'), 12.5],
    ['Total 25,00 €', euReceipt('Total 25,00 €'), 25],
    ['TOTAL EUR 12,50', euReceipt('TOTAL EUR 12,50'), 12.5],
    ['TOTAL 12,50 alone', market(['TOTAL 12,50']), 12.5],
  ])('suggests %s when the receipt has no US signal', async (_label, text, suggestion) => {
    const data = await read(text);
    expect(data.amount).toBeNull();
    expect(data.amountNeedsReview).toBe(true);
    expect(data.suggestedAmount).toBe(suggestion);
    expect(data.amount).not.toBe(suggestion);
    expect(data.amount).not.toBe(0);
    expect(data.amount).not.toBe(12);
  });

  it('keeps a suggested comma total out of totals, on the held out line, and blocks filing', async () => {
    const data = await read(market(['TOTAL 12,50']));
    expect(data.amount).toBeNull();
    expect(data.suggestedAmount).toBe(12.5);
    const blank = {
      id: 'comma', trans_id: 'comma', account_id: 'a1', merchant_name: 'Comma Market', description: 'Comma Market',
      amount: data.amount, suggestedAmount: data.suggestedAmount, category: 'TRANSPORTATION_FUEL', date: '2026-09-02',
      type: 'expense' as const, pending: false, is_deductible: true, iso_currency_code: 'USD', receipt_url: '/api/receipts/synthetic',
    };
    const paid = { ...blank, id: 'paid', trans_id: 'paid', amount: 10, suggestedAmount: undefined, description: 'Known Market', merchant_name: 'Known Market', receipt_url: undefined };
    const schedule = aggregateScheduleC(
      [
        { amount: 10, date: '2024-01-01', category: 'TRANSPORTATION_FUEL', is_deductible: true },
        { amount: data.amount as unknown as number, date: '2024-01-02', category: 'TRANSPORTATION_FUEL', is_deductible: true },
      ],
      '2024',
      CATEGORY_MAP,
      { mode: 'confirmed-only' },
    );
    expect(schedule.totalExpenses).toBe(10);
    expect(schedule.counts.deductible).toBe(1);
    for (const timezone of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      const quarter = sumExpensesForQuarter([paid, blank] as never, 2026, 3, timezone);
      expect(quarter.confirmed_deductible_expenses).toBe(10);
      expect(quarter.held_out_expenses).toBe(1);
    }
    expect(() => assertFilingExportAllowed([blank], 2026)).toThrow(FilingExportBlockedError);
    expect(() => assertFilingExportAllowed([blank], 2026)).toThrow('PLACEHOLDER');
    expect(() => assembleAuditSupportPacket('owner', 2026, { transactions: [blank], trips: [], receipts: [] }, new Date('2026-09-17T12:00:00Z'))).toThrow('PLACEHOLDER');
    const html = renderToStaticMarkup(React.createElement(ExpensesDetailScreen, {
      user: { id: 'owner' },
      onBack: () => undefined,
      transactions: [
        { ...blank, category: 'office', date: '2026-06-15', amount: data.amount as unknown as number },
        { ...paid, category: 'office', date: '2026-06-16', amount: 10 },
      ],
    }));
    expect(html).toContain('Amount needed');
    expect(html).toContain('value="12.50"');
    expect(html).toContain('data-held-out-expenses');
    expect(html).toContain('PLACEHOLDER');
    expect(html).toContain('$10.00');
    expect(html).not.toContain('22.5');
    expect(html).not.toContain('$0.00');
  });
});
