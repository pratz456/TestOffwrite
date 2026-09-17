import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the real hooks with a minimal React stand-in and a captured Firestore listener.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[],
  listeners: [] as Array<(snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void>,
  errors: [] as Array<(error: { code?: string; message: string }) => void>,
  request: vi.fn(),
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = initial;
    return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
  },
  useEffect(effect: () => void | (() => void)) { harness.effects.push(effect); },
}));
vi.mock('firebase/firestore', () => ({
  collectionGroup: (_db: unknown, name: string) => ({ name }), query: (...parts: unknown[]) => ({ parts }), where: (...parts: unknown[]) => ({ where: parts }),
  or: (...parts: unknown[]) => ({ or: parts }), orderBy: (...parts: unknown[]) => ({ orderBy: parts }),
  onSnapshot: (_query: unknown, next: (typeof harness.listeners)[number], error: (typeof harness.errors)[number]) => { harness.listeners.push(next); harness.errors.push(error); return () => {}; },
}));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'owner' } }) }));
vi.mock('@/lib/firebase/client', () => ({ db: {} }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
import { useTransactions, useUserStats } from '@/lib/firebase/hooks';

const doc = (id: string, data: Record<string, unknown>) => ({ id, data: () => ({ userId: 'owner', date: '2026-03-10', amount: 42.5, merchant_name: id, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD', pending: false, ...data }) });
const docs = [
  doc('old-coffee', { trans_id: 'old-plaid-id', is_deductible: true, review_status: 'confirmed' }),
  doc('new-coffee', { trans_id: 'new-plaid-id', is_deductible: null, superseded_by: 'user_profiles/owner/accounts/old/transactions/old-coffee' }),
  doc('new-hardware', { trans_id: 'hardware', is_deductible: null }),
];
function mount<T>(hook: () => T): () => T {
  const render = () => { harness.cursor = 0; return hook(); };
  render();
  harness.effects.splice(0).forEach(effect => effect());
  return render;
}
beforeEach(() => { harness.slots = []; harness.cursor = 0; harness.effects = []; harness.listeners = []; harness.errors = []; vi.clearAllMocks(); });

describe('transaction hooks hide superseded bank re-imports', () => {
  it('drops superseded records from the realtime list while keeping the canonical and distinct ones', () => {
    const read = mount(() => useTransactions('owner'));
    harness.listeners[0]({ docs });
    const { transactions, isLoading } = read();
    expect(isLoading).toBe(false);
    expect(transactions.map(transaction => transaction.trans_id)).toEqual(['old-plaid-id', 'hardware']);
  });

  it('drops superseded records from the API fallback too', async () => {
    harness.request.mockResolvedValue(Response.json({ transactions: docs.map(item => ({ id: item.id, trans_id: item.id, ...item.data() })) }));
    const read = mount(() => useTransactions('owner'));
    harness.errors[0]({ code: 'unavailable', message: 'offline' });
    await vi.waitFor(() => expect(read().isLoading).toBe(false));
    expect(read().transactions.map(transaction => transaction.id)).toEqual(['old-coffee', 'new-hardware']);
    expect(harness.request).toHaveBeenCalledWith('/api/transactions');
  });

  it('never counts a superseded record in the dashboard stats, including as needing review', () => {
    const read = mount(() => useUserStats('owner'));
    harness.listeners[0]({ docs });
    expect(read().stats).toMatchObject({ totalTransactions: 2, deductibleTransactions: 1, needsReviewTransactions: 1, totalDeductibleAmount: 42.5 });
  });
});
