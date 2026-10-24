import { afterEach, describe, expect, it, vi } from 'vitest';

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
    ['TOTAL 12,50', euReceipt('TOTAL 12,50'), 12.5],
    ['TOTAL 1.234,56', euReceipt('TOTAL 1.234,56'), 1234.56],
    ['Total 25,00 €', euReceipt('Total 25,00 €'), 25],
    ['TOTAL EUR 12,50', euReceipt('TOTAL EUR 12,50'), 12.5],
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
});
