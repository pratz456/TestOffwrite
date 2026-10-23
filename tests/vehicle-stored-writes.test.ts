import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writes: string[] = [];
const sets: Array<{ path: string; data: Record<string, unknown> }> = [];
const profileData = {
  vehicle_deduction_method: 'standard_mileage',
  vehicle_business_use_percentage: 40,
  business_vehicle: { make: 'Honda', model: 'Civic', year: 2019, deduction_method: 'standard_mileage', business_use_percentage: 40 },
};

function collection(path: string) {
  return {
    path,
    doc(id?: string) {
      return document(`${path}/${id ?? 'generated-vehicle'}`);
    },
  };
}

function document(path: string) {
  return {
    path,
    id: path.split('/').pop(),
    collection(name: string) {
      return collection(`${path}/${name}`);
    },
  };
}

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection,
    doc: document,
    runTransaction: async (callback: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => unknown; docs: Array<{ id: string; data: () => Record<string, unknown> }> }>;
      set: (ref: { path: string }, data: unknown) => void;
    }) => Promise<unknown>) => callback({
      async get(ref) {
        if (ref.path === 'user_profiles/owner') return { exists: true, data: () => profileData, docs: [] };
        return { exists: false, data: () => undefined, docs: [] };
      },
      set(ref, data) {
        writes.push(ref.path);
        sets.push({ path: ref.path, data: data as Record<string, unknown> });
      },
    }),
  },
}));

import { addUserVehicle, ensureUserVehicles, saveUserVehicle } from '@/lib/firebase/vehicle-server';

beforeEach(() => {
  writes.length = 0;
  sets.length = 0;
  vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
});
afterEach(() => vi.unstubAllEnvs());

describe('vehicle list writes', () => {
  it('11e a profile read with the switch off writes nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const read = await ensureUserVehicles('owner');
    expect(read.error).toBeNull();
    expect(read.data.map(vehicle => vehicle.id)).toEqual(['legacy-vehicle-1']);
    expect(writes).toEqual([]);
  });

  it('11e a profile read with the switch on writes nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const read = await ensureUserVehicles('owner');
    expect(read.error).toBeNull();
    expect(read.data.map(vehicle => vehicle.id)).toEqual(['legacy-vehicle-1']);
    expect(writes).toEqual([]);
  });

  it('11e a save with the switch off does not write vehicles', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const saved = await saveUserVehicle('owner', 'legacy-vehicle-1', { name: 'Civic', taxYear: 2026 });
    const added = await addUserVehicle('owner');
    expect(saved.data).toBeNull();
    expect(added.data).toBeNull();
    expect(writes).toEqual([]);
  });

  it('11e a save with the switch on writes the vehicles list', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const saved = await saveUserVehicle('owner', 'legacy-vehicle-1', { name: 'Civic', taxYear: 2026 });
    expect(saved.error).toBeNull();
    expect(saved.data?.id).toBe('legacy-vehicle-1');
    expect(writes).toEqual([
      'user_profiles/owner/vehicles/legacy-vehicle-1',
      'user_profiles/owner/vehicles/legacy-vehicle-1',
      'user_profiles/owner',
      'profile_analysis_refresh/owner',
    ]);
    const stamp = sets.find(entry => entry.path === 'user_profiles/owner')?.data.vehicles as Array<{ id: string; method: string }>;
    expect(stamp.map(vehicle => vehicle.id)).toEqual(['legacy-vehicle-1']);
    expect(stamp[0].method).toBe('standard_mileage');
  });
});
