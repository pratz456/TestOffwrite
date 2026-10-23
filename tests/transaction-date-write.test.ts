import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'synthetic-doc' })),
  getDoc: firestore.getDoc,
  getDocs: vi.fn(),
  setDoc: firestore.setDoc,
  updateDoc: firestore.updateDoc,
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: () => 'synthetic-server-timestamp',
  collectionGroup: vi.fn(),
}));
vi.mock('@/lib/firebase/client', () => ({ db: { kind: 'synthetic' } }));

import { createTransaction, updateTransaction } from '@/lib/firebase/transactions';

beforeEach(() => {
  firestore.stored = null;
  firestore.setDoc.mockReset().mockImplementation(async (_ref, data) => {
    firestore.stored = data;
  });
  firestore.getDoc.mockReset().mockImplementation(async () => ({
    id: 'synthetic-doc',
    exists: () => firestore.stored !== null,
    data: () => firestore.stored,
  }));
  firestore.updateDoc.mockReset();
});

describe('client transaction create stores a calendar day', () => {
  it.each([
    ['1/31/2025', '2025-01-31'],
    ['12/1/2025', '2025-12-01'],
    ['2025-1-5', '2025-01-05'],
    ['Jan 1, 2026', '2026-01-01'],
    ['2026-01-01', '2026-01-01'],
  ])('writes %s as %s', async (printed, stored) => {
    const result = await createTransaction('synthetic-owner', 'manual', {
      merchant_name: 'Synthetic Cafe',
      amount: 18.5,
      date: printed,
      trans_id: 'synthetic-tx',
    });
    expect(result.error).toBeNull();
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(firestore.stored?.date).toBe(stored);
    expect(result.data?.date).toBe(stored);
  });

  it.each(['1/5/2025', '01/05/2025', '02/30/2025', '2025/13/01'])('does not write an unreadable date %s', async (printed) => {
    const result = await createTransaction('synthetic-owner', 'manual', {
      merchant_name: 'Synthetic Cafe',
      amount: 18.5,
      date: printed,
      trans_id: 'synthetic-tx',
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe('client transaction update does not write a date', () => {
  it('drops a date before the client write', async () => {
    firestore.getDoc.mockResolvedValue({
      id: 'synthetic-doc',
      exists: () => true,
      data: () => ({ trans_id: 'synthetic-tx', date: '2026-01-01' }),
      ref: { path: 'synthetic' },
    });
    const queryModule = await import('firebase/firestore');
    vi.mocked(queryModule.getDocs).mockResolvedValue({
      empty: false,
      docs: [{ ref: { path: 'synthetic' } }],
    } as never);

    const result = await updateTransaction('synthetic-tx', {
      notes: 'kept',
      date: '1/31/2025',
    } as never);

    expect(result.error).toBeNull();
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    const written = firestore.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(written.notes).toBe('kept');
    expect(written.date).toBeUndefined();
  });
});
