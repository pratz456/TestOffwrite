import { afterEach, describe, expect, it, vi } from 'vitest';
import { receiptCommitForm } from '@/lib/receipts/receipt-review';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

afterEach(async () => { await receiptProcessor.terminate(); vi.clearAllMocks(); });

describe('recognized receipt date can be confirmed without manual reformatting', () => {
  it.each(['Sep 2, 2026', '2026-09-02'])('converts %s to the reviewed receipt API date', async date => {
    worker.recognize.mockResolvedValue({ data: {
      text: `SYNTHETIC OFFICE STORE\n${date}\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`,
      confidence: 95,
    } });
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date: '2026-09-02' });
    const data = result.data!;
    const form = receiptCommitForm(new File(['synthetic input'], 'receipt.png', { type: 'image/png' }), {
      merchant: data.merchant, amount: String(data.amount), date: data.date, category: data.category || 'other',
    }, 'expense');
    expect(JSON.parse(String(form.get('receiptData')))).toMatchObject({ amount: 25, date: '2026-09-02' });
  });

  it.each([
    ['01/01/2026', '2026-01-01'],
    ['12/31/2025', '2025-12-31'],
    ['Jan 1, 2026', '2026-01-01'],
    ['January 1 2026', '2026-01-01'],
    ['1 Jan 2026', '2026-01-01'],
    ['2026-01-01', '2026-01-01'],
    ['2026-01-01T15:30:00+09:00', '2026-01-01'],
    ['2025-1-5', '2025-01-05'],
    ['31/12/2025', '2025-12-31'],
    ['1/31/2025', '2025-01-31'],
    ['12/1/2025', ''],
    ['1/12/2025', ''],
    ['11/3/2026', ''],
    ['01/05/2025', ''],
    ['1/5/2025', ''],
    ['02/30/2025', ''],
    ['31/2/2025', ''],
    ['2/30/2025', ''],
    ['29/2/2025', ''],
    ['13/45/2025', ''],
    ['0/12/2025', ''],
    ['29/2/2024', '2024-02-29'],
    ['2/29/2024', '2024-02-29'],
    ['09/02/2026', ''],
    ['2025-13-01', ''],
    ['2025/13/01', ''],
    ['2025/31/12', ''],
  ])('keeps the printed day for %s', async (printed, stored) => {
    worker.recognize.mockResolvedValue({ data: {
      text: `SYNTHETIC OFFICE STORE\n${printed}\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`,
      confidence: 95,
    } });
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data?.date).toBe(stored);
  });

  it.each(['Jan 1, 2026', '01/01/2026', '1 Jan 2026', '2026-01-01'])('matches a January 1 receipt to the January 1 transaction for %s', async (printed) => {
    const matches = await receiptProcessor.findMatchingTransactions(
      { merchant: 'Synthetic Cafe', amount: 18.5, date: printed, confidence: 0.9, rawText: 'Synthetic Cafe' },
      [
        { trans_id: 'december', merchant_name: 'Synthetic Cafe', amount: 18.5, date: '2025-12-31' },
        { trans_id: 'january', merchant_name: 'Synthetic Cafe', amount: 18.5, date: '2026-01-01' },
      ],
    );
    expect(matches[0]?.trans_id).toBe('january');
    expect(matches[0]?.matchReasons).toContain('date');
    expect(matches.find((match) => match.trans_id === 'december')?.matchReasons ?? []).not.toContain('date');
  });
});
