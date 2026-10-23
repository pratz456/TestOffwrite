import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { analysisProfileFieldsKey } from '@/functions-analysis/src/profile-fields';

const model = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  transactionSet: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ ...model.stored }) }) }),
    runTransaction: (callback: (tx: { get: () => Promise<unknown>; set: typeof model.transactionSet }) => Promise<void>) => model.transaction(callback),
  },
  FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__server_time__' },
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner', emailVerified: true } }) }));
vi.mock('@/lib/plaid/connections', () => ({ migrateLegacyPlaidConnection: async () => undefined }));

import { POST } from '@/app/api/database/profiles/route';

const request = (body: unknown) => new NextRequest('https://writeoff.test/api/database/profiles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  model.stored = { name: 'Owner' };
  model.transactionSet.mockImplementation((_ref: unknown, fields: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(fields)) {
      if (value === '__delete__') delete model.stored[key];
      else model.stored[key] = value;
    }
  });
  model.transaction.mockImplementation(async (callback: (tx: { get: () => Promise<unknown>; set: typeof model.transactionSet }) => Promise<void>) => callback({
    get: async () => ({ exists: true, data: () => ({ ...model.stored }) }),
    set: model.transactionSet,
  }));
});

describe('vehicle profile field lists', () => {
  it('11d a profile save keeps the vehicles field', async () => {
    const vehicles = [{ id: 'legacy-vehicle-1', name: 'Civic' }];
    const response = await POST(request({ vehicles }));
    expect(response.status).toBe(200);
    expect(model.stored.vehicles).toEqual(vehicles);
    expect(model.stored.name).toBe('Owner');
  });

  it('11d analysisProfileFieldsKey changes when vehicles changes', () => {
    const before = { profession: 'Designer', vehicles: [{ id: 'legacy-vehicle-1', method: 'unset' }] };
    const after = { profession: 'Designer', vehicles: [{ id: 'legacy-vehicle-1', method: 'standard_mileage' }] };
    expect(analysisProfileFieldsKey(before)).not.toBe(analysisProfileFieldsKey(after));
    expect(analysisProfileFieldsKey({ profession: 'Designer' })).not.toBe(analysisProfileFieldsKey(before));
  });
});
