import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  uid: 'deduction-owner' as string | null,
  docs: [] as { id: string; data: Record<string, unknown> }[],
  adds: [] as Record<string, unknown>[],
  sets: [] as { id: string; data: Record<string, unknown> }[],
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null, error: state.uid ? null : 'Unauthorized' }) }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where() { return this; }, limit() { return this; },
      get: async () => ({ empty: !state.docs.length, docs: state.docs.map(doc => ({ id: doc.id, data: () => doc.data })) }),
      add: async (data: Record<string, unknown>) => { state.adds.push(data); return { id: 'created-id' }; },
      doc: (id: string) => ({ set: async (data: Record<string, unknown>) => { state.sets.push({ id, data }); } }),
    }),
  },
}));
import { GET, POST } from '../app/api/tax/deductions/route';

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/tax/deductions', { method: 'POST', body: JSON.stringify(body) }));
const get = (year = 2026) => GET(new NextRequest(`http://localhost/api/tax/deductions?year=${year}`));
beforeEach(() => { state.uid = 'deduction-owner'; state.docs = []; state.adds = []; state.sets = []; });

describe('deductions API stores the prior-year planner facts', () => {
  it('saves prior-year total tax and AGI as numbers on a new record', async () => {
    const response = await post({ taxYear: 2026, priorYearTotalTax: '8000', priorYearAGI: 150000.01, hsaContribution: 500 });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, id: 'created-id' });
    expect(state.adds[0]).toMatchObject({ userId: 'deduction-owner', taxYear: 2026, priorYearTotalTax: 8000, priorYearAGI: 150000.01, hsaContribution: 500 });
  });
  it('stores 0 (not entered) when prior-year AGI is omitted and merges updates into the existing record', async () => {
    state.docs = [{ id: 'existing-id', data: { userId: 'deduction-owner', taxYear: 2026, priorYearTotalTax: 8000, priorYearAGI: 100000 } }];
    const response = await post({ taxYear: 2026, priorYearTotalTax: 9000 });
    expect(response.status).toBe(200); expect(state.adds).toHaveLength(0);
    expect(state.sets[0]).toMatchObject({ id: 'existing-id', data: { priorYearTotalTax: 9000, priorYearAGI: 0 } });
  });
  it.each([
    [{ priorYearAGI: -5 }, 'Prior-year adjusted gross income'],
    [{ priorYearAGI: 'unknown' }, 'Prior-year adjusted gross income'],
    [{ priorYearTotalTax: -1 }, 'Prior-year total tax'],
  ])('rejects %j instead of storing an invalid prior-year fact', async (body, label) => {
    const response = await post({ taxYear: 2026, ...body });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain(label); expect(state.adds).toHaveLength(0); expect(state.sets).toHaveLength(0);
  });
  it('returns the saved prior-year facts for the owner and year', async () => {
    state.docs = [{ id: 'existing-id', data: { userId: 'deduction-owner', taxYear: 2026, priorYearTotalTax: 8000, priorYearAGI: 150000.01 } }];
    const body = await (await get()).json();
    expect(body.deductions).toMatchObject({ id: 'existing-id', priorYearTotalTax: 8000, priorYearAGI: 150000.01 });
  });
  it('requires authentication', async () => {
    state.uid = null;
    expect((await post({ taxYear: 2026, priorYearAGI: 1 })).status).toBe(401); expect((await get()).status).toBe(401); expect(state.adds).toHaveLength(0);
  });
});
