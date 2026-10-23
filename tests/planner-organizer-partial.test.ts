import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  if (name !== 'tax_organizers') throw new Error(`unexpected collection ${name}`);
  const filters: [string, unknown][] = [];
  const doc = (id: string) => ({ id, data: () => ({ ...state.docs.get(id)! }), ref: { set: async (patch: Record<string, unknown>, options: { merge: boolean }) => {
    state.docs.set(id, options.merge ? { ...state.docs.get(id), ...patch } : patch);
  } } });
  const query = {
    where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
    limit() { return query; },
    async get() {
      const ids = [...state.docs].filter(([, data]) => filters.every(([field, value]) => data[field] === value)).map(([id]) => id);
      return { empty: !ids.length, docs: ids.map(doc) };
    },
    async add(data: Record<string, unknown>) { const id = `org-${state.docs.size + 1}`; state.docs.set(id, data); return { id }; },
  };
  return query;
} } }));

import { POST } from '../app/api/tax/organizer/route';
import { decryptSensitive } from '../lib/security/utils';

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => { state.docs.clear(); });

describe('partial planner organizer save', () => {
  it('keeps previously saved organizer fields when the card posts only its answers', async () => {
    expect((await post({ taxYear: 2026, taxpayerSSN: '900000001', filingStatus: 'single', hasDependents: 'no' })).status).toBe(201);
    const partial = await post({
      taxYear: 2026,
      priorYearLine24Tax: '8500',
      priorYearRefundableCredits: '0',
      priorYearTax: '8500',
      priorYearAGI: '100000',
      priorReturnCoveredTwelveMonths: 'yes',
      priorYearFullYearCitizenOrResident: 'yes',
    });
    expect(partial.status).toBe(200);
    const stored = [...state.docs.values()][0];
    expect(decryptSensitive(String(stored.taxpayerSSN))).toBe('900000001');
    expect(stored.filingStatus).toBe('single');
    expect(stored.hasDependents).toBe('no');
    expect(stored.priorYearLine24Tax).toBe('8500');
    expect(stored.priorYearTax).toBe('8500');
    expect(stored).not.toHaveProperty('madeQuarterlyPayments');
    expect(stored).not.toHaveProperty('quarterlyTotal');
  });
});
