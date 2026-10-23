import { afterEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

const normalizeDateToISO = (value: unknown) =>
  (receiptProcessor as unknown as { normalizeDateToISO(dateLike: unknown): string | null }).normalizeDateToISO(value);

afterEach(async () => { await receiptProcessor.terminate(); vi.clearAllMocks(); });

function recognized(date: string) {
  worker.recognize.mockResolvedValue({ data: {
    text: `SYNTHETIC OFFICE STORE\n${date}\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`,
    confidence: 95,
  } });
}

describe('OCR receipt dates must be real calendar days', () => {
  it.each(['2026-13-01', '2026-02-30', '2025-12-32'])('normalizes %s to null', date => {
    expect(normalizeDateToISO(date)).toBeNull();
  });

  it.each(['2026-02-28', '2024-02-29'])('keeps real calendar day %s', date => {
    expect(normalizeDateToISO(date)).toBe(date);
  });

  it.each(['2026-13-01', '2026-02-30', '2025-12-32'])('leaves OCR date %s blank so it can be entered', async date => {
    recognized(date);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data?.date).toBe('');
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25 });
  });

  it.each(['2026-02-28', '2024-02-29', '2026-09-15'])('keeps recognized date %s unchanged', async date => {
    recognized(date);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date });
  });
});
