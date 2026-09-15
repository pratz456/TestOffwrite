import { afterEach, describe, expect, it, vi } from 'vitest';
import { receiptCommitForm } from '@/lib/receipts/receipt-review';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

afterEach(async () => { await receiptProcessor.terminate(); vi.clearAllMocks(); });

describe('recognized receipt date can be confirmed without manual reformatting', () => {
  it.each(['09/02/2026', '2026-09-02'])('converts %s to the reviewed receipt API date', async date => {
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
});
