import { afterEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';

const normalizeDateToISO = (value: unknown, userTimeZone?: string) =>
  (receiptProcessor as unknown as { normalizeDateToISO(dateLike: unknown, userTimeZone?: string): string | null }).normalizeDateToISO(value, userTimeZone);

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

  it('reads a Date or timestamp in the supplied zone and returns null without one', () => {
    const losAngeles = new Date('2027-01-01T07:30:00Z');
    expect(normalizeDateToISO(losAngeles, 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(losAngeles.getTime(), 'America/Los_Angeles')).toBe('2026-12-31');
    const tokyo = new Date('2026-12-31T15:30:00Z');
    expect(normalizeDateToISO(tokyo, 'Asia/Tokyo')).toBe('2027-01-01');
    expect(normalizeDateToISO(tokyo.getTime(), 'Asia/Tokyo')).toBe('2027-01-01');
    expect(normalizeDateToISO(losAngeles)).toBeNull();
    expect(normalizeDateToISO(losAngeles.getTime())).toBeNull();
    expect(normalizeDateToISO(tokyo)).toBeNull();
    expect(normalizeDateToISO(tokyo.getTime())).toBeNull();
    expect(normalizeDateToISO('01/01/2027', 'America/Los_Angeles')).toBe('2027-01-01');
  });

  it('uses the supplied zone when UTC and that zone fall on different calendar days', () => {
    const instant = new Date('2027-01-01T07:30:00Z');
    expect(normalizeDateToISO(instant, 'UTC')).toBe('2027-01-01');
    expect(normalizeDateToISO(instant, 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(instant.getTime(), 'UTC')).toBe('2027-01-01');
    expect(normalizeDateToISO(instant.getTime(), 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(instant, 'Not/AZone')).toBeNull();
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
