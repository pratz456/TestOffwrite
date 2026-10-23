import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  user: { uid: 'owner' } as { uid: string } | null,
  error: null as string | null,
}));

vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: auth.user, error: auth.error }),
}));
vi.mock('@/lib/firebase/vehicle-server', () => ({
  ensureUserVehicles: async () => { throw new Error('vehicle read'); },
  addUserVehicle: async () => { throw new Error('vehicle write'); },
  saveUserVehicle: async () => { throw new Error('vehicle write'); },
}));
vi.mock('@/lib/firebase/mileage-server', () => ({
  assignMileageTrips: async () => { throw new Error('trip write'); },
}));
vi.mock('@/lib/firebase/settings-server', () => ({
  getHomeOfficeSettings: async () => { throw new Error('settings read'); },
}));

import { POST as assignTrips } from '@/app/api/mileage/assignments/route';
import { GET as listVehicles, POST as addVehicle } from '@/app/api/mileage/vehicles/route';
import { PATCH as saveVehicle } from '@/app/api/mileage/vehicles/[id]/route';

const unavailable = "Vehicle tracking isn't available yet";
const sortBody = { userId: 'owner', updates: [{ tripId: 'trip-1', vehicleId: null, tripType: null }] };

function request(url: string, body?: unknown, method = 'POST') {
  return new NextRequest(url, body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  auth.user = { uid: 'owner' };
  auth.error = null;
  vi.unstubAllEnvs();
});

describe('vehicle routes stay closed until the copy switch is on', () => {
  it('GET /api/mileage/vehicles returns 404 after the sign in and user checks', async () => {
    auth.user = null;
    auth.error = 'missing';
    const signedOut = await listVehicles(request('https://writeoff.test/api/mileage/vehicles?userId=owner', undefined, 'GET'));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: 'Unauthorized' });

    auth.user = { uid: 'owner' };
    auth.error = null;
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const other = await listVehicles(request('https://writeoff.test/api/mileage/vehicles?userId=someone-else', undefined, 'GET'));
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: 'Forbidden' });
    const hidden = await listVehicles(request('https://writeoff.test/api/mileage/vehicles?userId=owner', undefined, 'GET'));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: unavailable });
  });

  it('POST /api/mileage/vehicles returns 404 after the userId checks', async () => {
    auth.user = null;
    const signedOut = await addVehicle(request('https://writeoff.test/api/mileage/vehicles', { userId: 'owner' }));
    expect(signedOut.status).toBe(401);

    auth.user = { uid: 'owner' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const missing = await addVehicle(request('https://writeoff.test/api/mileage/vehicles', {}));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'Invalid or unauthorized userId' });
    const other = await addVehicle(request('https://writeoff.test/api/mileage/vehicles', { userId: 'someone-else' }));
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: 'Invalid or unauthorized userId' });
    const hidden = await addVehicle(request('https://writeoff.test/api/mileage/vehicles', { userId: 'owner' }));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: unavailable });
  });

  it('PATCH /api/mileage/vehicles/[id] returns 404 after the userId check', async () => {
    auth.user = null;
    const signedOut = await saveVehicle(request('https://writeoff.test/api/mileage/vehicles/car-1', { userId: 'owner' }), { params: Promise.resolve({ id: 'car-1' }) });
    expect(signedOut.status).toBe(401);

    auth.user = { uid: 'owner' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const other = await saveVehicle(request('https://writeoff.test/api/mileage/vehicles/car-1', { userId: 'someone-else' }), { params: Promise.resolve({ id: 'car-1' }) });
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: 'Invalid or unauthorized userId' });
    const hidden = await saveVehicle(request('https://writeoff.test/api/mileage/vehicles/car-1', { userId: 'owner' }), { params: Promise.resolve({ id: 'car-1' }) });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: unavailable });
  });

  it('POST /api/mileage/assignments returns 404 after the userId check', async () => {
    auth.user = null;
    const signedOut = await assignTrips(request('https://writeoff.test/api/mileage/assignments', sortBody));
    expect(signedOut.status).toBe(401);

    auth.user = { uid: 'owner' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const other = await assignTrips(request('https://writeoff.test/api/mileage/assignments', { ...sortBody, userId: 'someone-else' }));
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: 'Invalid or unauthorized userId' });
    const hidden = await assignTrips(request('https://writeoff.test/api/mileage/assignments', sortBody));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: unavailable });
  });
});
