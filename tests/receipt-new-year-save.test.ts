import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));

const firestore = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  setDoc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'synthetic-new-year' })),
  getDoc: firestore.getDoc,
  getDocs: vi.fn(),
  setDoc: firestore.setDoc,
  updateDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: () => 'synthetic-server-timestamp',
  collectionGroup: vi.fn(),
}));
vi.mock('@/lib/firebase/client', () => ({ db: { kind: 'synthetic' } }));

import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import { createTransaction } from '@/lib/firebase/transactions';

const SCAN = `SYNTHETIC OFFICE STORE\n01/01/2026\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`;

beforeEach(() => {
  firestore.stored = null;
  firestore.setDoc.mockReset().mockImplementation(async (_ref, data) => {
    firestore.stored = data;
  });
  firestore.getDoc.mockReset().mockImplementation(async () => ({
    id: 'synthetic-new-year',
    exists: () => firestore.stored !== null,
    data: () => firestore.stored,
  }));
  worker.recognize.mockResolvedValue({ data: { text: SCAN, confidence: 95 } });
});

afterEach(async () => {
  await receiptProcessor.terminate();
  vi.clearAllMocks();
});

describe('a Tokyo New Year scan keeps the printed day', () => {
  it('saves scan text 01/01/2026 as 2026-01-01 through extractDate, normalizeDateToISO, and createTransaction', async () => {
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.success).toBe(true);
    const receipt = scanned.data!;

    const saved = await createTransaction('synthetic-owner', 'manual', {
      merchant_name: receipt.merchant,
      amount: receipt.amount,
      date: receipt.date,
      receipt_url: '/api/receipts/synthetic-new-year',
      receipt_filename: 'receipt.png',
      trans_id: 'synthetic-new-year',
    });

    expect(saved.error).toBeNull();
    expect(saved.data?.amount).toBe(25);
    expect(saved.data?.date).toBe('2026-01-01');
    expect(firestore.stored?.date).toBe('2026-01-01');
    expect(receipt.date).toBe('2026-01-01');
  });
});
