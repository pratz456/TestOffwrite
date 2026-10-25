import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const store = vi.hoisted(() => ({ uid: 'owner-a' as string | null }));
const updateAsset = vi.hoisted(() => vi.fn());
const saveAsset = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: store.uid ? { uid: store.uid } : null, error: store.uid ? null : 'unauthenticated' }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ updateAsset, saveAsset }));
import { PUT } from '../app/api/settings/assets/route';

const valid = {
  assetId: 'computer',
  description: 'Computer',
  cost: 9000,
  datePlacedInService: '2026-03-15T00:00:00.000Z',
  businessUsePercent: 100,
  category: 'computer',
  method: 'MACRS_5YR',
  section179Requested: true,
  bonusEligible: false,
};

const put = (body?: unknown, raw?: string) => new NextRequest('http://localhost/api/settings/assets', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
});

beforeEach(() => {
  store.uid = 'owner-a';
  updateAsset.mockReset();
  saveAsset.mockReset();
  updateAsset.mockResolvedValue({ data: { id: 'computer', description: 'Computer' }, error: null });
});

describe('PUT /api/settings/assets', () => {
  it('returns 401 when signed out and does not write', async () => {
    store.uid = null;
    const response = await PUT(put(valid));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(updateAsset).not.toHaveBeenCalled();
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['slash', 'assets/computer'],
    ['control char', 'computer\u0001'],
    ['more than 256 chars', 'a'.repeat(257)],
  ])('returns 400 for a bad assetId (%s)', async (_label, assetId) => {
    const response = await PUT(put({ ...valid, assetId }));
    expect(response.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['missing description', { description: undefined }],
    ['cost 0', { cost: 0 }],
    ['negative cost', { cost: -1 }],
    ['string cost', { cost: '9000' }],
    ['cost over 100M', { cost: 100_000_001 }],
    ['bad date', { datePlacedInService: 'not-a-date' }],
    ['business use below 0', { businessUsePercent: -1 }],
    ['business use above 100', { businessUsePercent: 101 }],
    ['string election flag', { section179Requested: 'yes' }],
    ['numeric bonus flag', { bonusEligible: 1 }],
  ])('returns 400 for %s', async (_label, patch) => {
    const body = { ...valid, ...patch };
    if (patch.description === undefined) delete body.description;
    const response = await PUT(put(body));
    expect(response.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it('returns 400 for a NaN cost', async () => {
    const request = put(valid);
    request.json = async () => ({ ...valid, cost: Number.NaN });
    const response = await PUT(request);
    expect(response.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await PUT(put(undefined, '{'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Request body must be a JSON object' });
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('updates the caller asset and omits undefined optional fields', async () => {
    const response = await PUT(put(valid));
    expect(response.status).toBe(200);
    expect(updateAsset).toHaveBeenCalledTimes(1);
    expect(updateAsset.mock.calls[0][0]).toBe('owner-a');
    expect(updateAsset.mock.calls[0][1]).toBe('computer');
    const payload = updateAsset.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.values(payload)).not.toContain(undefined);
    expect(payload).toMatchObject({
      description: 'Computer',
      cost: 9000,
      businessUsePercent: 100,
      category: 'computer',
      method: 'MACRS_5YR',
      section179Requested: true,
      bonusEligible: false,
    });
    expect(payload.datePlacedInService).toBeInstanceOf(Date);
    expect(saveAsset).not.toHaveBeenCalled();

    updateAsset.mockClear();
    const partial = await PUT(put({ assetId: 'computer', description: 'Desk', cost: 0.01, datePlacedInService: '2026-04-01', businessUsePercent: 0, section179Requested: false }));
    expect(partial.status).toBe(200);
    const omitted = updateAsset.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.values(omitted)).not.toContain(undefined);
    expect(Object.keys(omitted).sort()).toEqual(['businessUsePercent', 'cost', 'datePlacedInService', 'description', 'section179Requested']);
    expect(omitted).not.toHaveProperty('category');
    expect(omitted).not.toHaveProperty('method');
    expect(omitted).not.toHaveProperty('bonusEligible');
    expect(omitted.businessUsePercent).toBe(0);
    expect(omitted.section179Requested).toBe(false);
  });

  it('returns 404 for a missing asset and does not create one', async () => {
    updateAsset.mockResolvedValue({ data: null, error: Object.assign(new Error('5 NOT_FOUND: No document to update'), { code: 'NOT_FOUND' }) });
    const response = await PUT(put(valid));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Asset not found' });
    expect(updateAsset).toHaveBeenCalledTimes(1);
    expect(updateAsset.mock.calls[0][0]).toBe('owner-a');
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it('returns 500 for another update error without internal detail', async () => {
    const marker = 'contract-internal-detail-7f3a /srv/node_modules/firebase-admin/lib/firestore.js';
    updateAsset.mockResolvedValue({ data: null, error: new Error(marker) });
    const response = await PUT(put(valid));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Failed to update asset' });
    expect(JSON.stringify(body)).not.toContain('contract-internal-detail');
    expect(JSON.stringify(body)).not.toContain('/srv');
    expect(saveAsset).not.toHaveBeenCalled();
  });
});
