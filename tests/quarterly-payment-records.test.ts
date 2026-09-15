import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getEstimatedTaxDeadline } from '../lib/tax-provider/payment-deadlines';

const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), reads: [] as string[], writes: [] as string[], uid: 'owner-a' as string | null, transactions: 0 }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null, error: state.uid ? null : 'Unauthorized' }) }));
vi.mock('@/lib/firebase/admin', () => {
  const snapshot = (path: string) => ({ exists: state.docs.has(path), data: () => state.docs.get(path) });
  const ref = (path: string): Record<string, unknown> => ({
    path,
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (id: string) => ref(`${path}/${id}`),
    get: async () => { state.reads.push(path); return snapshot(path); },
  });
  let queue = Promise.resolve();
  return {
    adminDb: {
      collection: (name: string) => ref(name),
      runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => {
        state.transactions++;
        const result = queue.then(() => callback({
          get: async (document: { path: string }) => snapshot(document.path),
          set: (document: { path: string }, value: Record<string, unknown>) => { state.writes.push(document.path); state.docs.set(document.path, { ...state.docs.get(document.path), ...value }); },
        }));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
    },
    FieldValue: { serverTimestamp: () => 'synthetic-time' },
  };
});
import { GET, POST, PUT } from '../app/api/tax/quarterly-payments/route';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '../lib/firebase/quarterly-payments-server';

const key = 'user_profiles/owner-a/quarterly_payments/Q1_2026';
function request(method: string, body?: unknown, year = '2026') {
  return new NextRequest(`http://localhost/api/tax/quarterly-payments?year=${year}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => { state.docs.clear(); state.reads.length = 0; state.writes.length = 0; state.uid = 'owner-a'; state.transactions = 0; vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('recorded quarterly payments', () => {
  it('reads only the authenticated owner/year path and the actual paidAmount field', async () => {
    state.docs.set(key, { paidAmount: 750.25, amount: 999999 });
    state.docs.set('user_profiles/owner-b/quarterly_payments/Q1_2026', { paidAmount: 900000 });
    state.docs.set('user_profiles/owner-a/quarterly_payments/Q1_2025', { paidAmount: 800000 });
    const payments = await getRecordedQuarterlyPayments('owner-a', 2026);
    expect(totalRecordedPayments(payments)).toBe(750.25);
    expect(state.reads).toEqual([1, 2, 3, 4].map(q => `user_profiles/owner-a/quarterly_payments/Q${q}_2026`));
    expect(state.writes).toEqual([]);
  });

  it('returns unsaved default records on GET without creating paid or overdue zero-dollar obligations', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.payments).toHaveLength(4);
    expect(data.payments.every((p: { paidAmount: number; status: string }) => p.paidAmount === 0 && p.status === 'unpaid')).toBe(true);
    expect(state.docs.size).toBe(0);
    expect(state.writes).toEqual([]);
  });

  it('records concurrent payments atomically and keeps estimate updates from overwriting their total', async () => {
    state.docs.set(key, { paidAmount: 10.01, estimatedAmount: 500 });
    const [first, second] = await Promise.all([
      POST(request('POST', { quarter: 1, year: 2026, paidAmount: 100.02, paidDate: '2026-04-15' })),
      POST(request('POST', { quarter: 1, year: 2026, paidAmount: 200.03, paidDate: '2026-04-15' })),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.docs.get(key)?.paidAmount).toBe(310.06);
    const updated = await PUT(request('PUT', { quarter: 1, year: 2026, estimatedAmount: 300 }));
    expect(updated.status).toBe(200);
    expect(state.docs.get(key)?.paidAmount).toBe(310.06);
    expect(state.docs.get(key)?.estimatedAmount).toBe(300);
    expect(state.transactions).toBe(3);
  });

  it.each([
    { quarter: 0, year: 2026, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 1.5, year: 2026, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 5, year: 2026, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 1, year: 2026.5, paidAmount: 100, paidDate: '2026-04-15' },
    { quarter: 1, year: 2026, paidAmount: -1, paidDate: '2026-04-15' },
    { quarter: 1, year: 2026, paidAmount: 100, paidDate: '2026-02-30' },
  ])('rejects invalid payment data before a write %j', async body => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it('rejects unauthenticated read and write requests', async () => {
    state.uid = null;
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await POST(request('POST', {}))).status).toBe(401);
    expect((await PUT(request('PUT', {}))).status).toBe(401);
    expect(state.reads).toEqual([]);
    expect(state.writes).toEqual([]);
  });
});

describe('standard individual estimated-tax deadlines', () => {
  // IRS Form1040-ES: weekend/DC holiday rule; special disaster postponements are outside this helper.
  it.each([[2024, 1, '2024-04-15'], [2025, 2, '2025-06-16'], [2026, 2, '2026-06-15'], [2026, 4, '2027-01-15'], [2023, 4, '2024-01-16'], [2022, 1, '2022-04-18']])('rolls %i Q%i to %s', (year, quarter, expected) => {
    expect(getEstimatedTaxDeadline(Number(year), Number(quarter)).toISOString().slice(0, 10)).toBe(expected);
  });
});
