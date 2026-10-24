import { afterEach, describe, expect, it, vi } from 'vitest';
import { receiptCommitForm } from '@/lib/receipts/receipt-review';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

afterEach(async () => { await receiptProcessor.terminate(); vi.clearAllMocks(); });

function recognize(date: string, currency = 'USD') {
  worker.recognize.mockResolvedValue({ data: {
    text: `SYNTHETIC OFFICE STORE\n${date}\nOffice supplies 25.00 ${currency}\nTOTAL 25.00 ${currency}\nTEST RECEIPT - NO PURCHASE`,
    confidence: 95,
  } });
}

describe('recognized receipt date can be confirmed without manual reformatting', () => {
  it.each(['09/02/2026', '2026-09-02'])('converts %s to the reviewed receipt API date', async date => {
    recognize(date);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date: '2026-09-02' });
    expect(result.data?.dateOrderAssumed).toBe(date === '09/02/2026' ? 'month_day' : undefined);
    const data = result.data!;
    const form = receiptCommitForm(new File(['synthetic input'], 'receipt.png', { type: 'image/png' }), {
      merchant: data.merchant, amount: String(data.amount), date: data.date, category: data.category || 'other',
      ...(data.dateOrderAssumed ? { dateOrderAssumed: data.dateOrderAssumed } : {}),
    }, 'expense');
    expect(JSON.parse(String(form.get('receiptData')))).toMatchObject({ amount: 25, date: '2026-09-02' });
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
