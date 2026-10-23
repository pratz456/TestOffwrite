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

  it('reads a Date or timestamp in the upload zone and leaves written dates unchanged', () => {
    const losAngeles = new Date('2027-01-01T07:30:00Z');
    expect(normalizeDateToISO(losAngeles, 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(losAngeles.getTime(), 'America/Los_Angeles')).toBe('2026-12-31');
    const tokyo = new Date('2026-12-31T15:30:00Z');
    expect(normalizeDateToISO(tokyo, 'Asia/Tokyo')).toBe('2027-01-01');
    expect(normalizeDateToISO(tokyo.getTime(), 'Asia/Tokyo')).toBe('2027-01-01');
    expect(normalizeDateToISO('01/01/2027', 'America/Los_Angeles')).toBe('2027-01-01');
    expect(normalizeDateToISO('01/01/2027')).toBe('2027-01-01');
  });

  it('keeps a no-zone day when Pago Pago and St. Thomas agree', () => {
    const shared = new Date('2027-01-01T18:00:00Z');
    expect(normalizeDateToISO(shared)).toBe('2027-01-01');
    expect(normalizeDateToISO(shared.getTime())).toBe('2027-01-01');
    expect(normalizeDateToISO(shared, 'Not/AZone')).toBe('2027-01-01');
    expect(normalizeDateToISO(shared.getTime(), '')).toBe('2027-01-01');
  });

  it('returns null for a no-zone instant when Pago Pago and St. Thomas disagree', () => {
    const split = new Date('2027-01-01T05:00:00Z');
    expect(normalizeDateToISO(split)).toBeNull();
    expect(normalizeDateToISO(split.getTime())).toBeNull();
    expect(normalizeDateToISO(split, 'Not/AZone')).toBeNull();
    expect(normalizeDateToISO(split, 'UTC')).toBe('2027-01-01');
  });

  it('uses the supplied zone when that zone and the process zone fall on different days', () => {
    const instant = new Date('2027-01-01T07:30:00Z');
    expect(normalizeDateToISO(instant, 'UTC')).toBe('2027-01-01');
    expect(normalizeDateToISO(instant, 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(instant.getTime(), 'UTC')).toBe('2027-01-01');
    expect(normalizeDateToISO(instant.getTime(), 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(instant.getTime(), 'UTC')).not.toBe(normalizeDateToISO(instant.getTime(), 'America/Los_Angeles'));
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC') {
      expect(normalizeDateToISO(instant, Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('2027-01-01');
      expect(normalizeDateToISO(instant, 'America/Los_Angeles')).toBe('2026-12-31');
    }
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
