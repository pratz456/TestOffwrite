import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MILEAGE_VEHICLE_COPY } from '@/lib/mileage/vehicle-copy';

const database = vi.hoisted(() => ({
  fail: '' as '' | 'read' | 'write' | 'assign' | 'delete',
  trips: [] as Array<{ id: string; data: Record<string, unknown> }>,
  vehicles: [] as string[],
  written: null as Record<string, unknown> | null,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));

vi.mock('@/lib/firebase/admin', () => {
  function snapshot(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
    return { docs, empty: docs.length === 0, forEach(fn: (doc: (typeof docs)[number]) => void) { docs.forEach(fn); } };
  }
  function tripDoc(id = 'created-trip') {
    return {
      id,
      path: `user_profiles/owner/mileage_trips/${id}`,
      get: async () => {
        const found = database.trips.find(trip => trip.id === id);
        return { exists: Boolean(found), id, data: () => found?.data };
      },
      delete: async () => { if (database.fail === 'delete') throw new Error('database down'); },
    };
  }
  function vehicleDoc(id: string) {
    return {
      id,
      path: `user_profiles/owner/vehicles/${id}`,
      get: async () => ({ exists: database.vehicles.includes(id), id, data: () => ({}) }),
    };
  }
  function trips() {
    return {
      add: async () => tripDoc(),
      get: async () => {
        if (database.fail === 'read' || database.fail === 'write') throw new Error('database down');
        return snapshot(database.trips.map(trip => ({ id: trip.id, data: () => trip.data })));
      },
      doc(id?: string) { return tripDoc(id); },
    };
  }
  function vehicles() {
    return { doc: (id: string) => vehicleDoc(id) };
  }
  const profile = {
    collection(name: string) {
      if (name === 'vehicles') return vehicles();
      return trips();
    },
  };
  return {
    adminDb: {
      collection: () => ({ doc: () => profile }),
      doc: () => profile,
      getAll: async (...refs: Array<{ id: string }>) => {
        if (database.fail === 'assign') throw new Error('database down');
        return refs.map(ref => {
          const found = database.trips.find(trip => trip.id === ref.id);
          return { id: ref.id, exists: Boolean(found), data: () => found?.data ?? {} };
        });
      },
      batch() {
        const pending: Array<{ id: string; data: Record<string, unknown> }> = [];
        return {
          update(_ref: { id: string }, data: Record<string, unknown>) { pending.push({ id: _ref.id, data }); },
          async commit() { database.updates.push(...pending); },
        };
      },
      runTransaction: async (callback: (tx: {
        get: (ref: { get?: () => Promise<unknown>; add?: unknown; doc?: unknown }) => Promise<unknown>;
        set: (ref: unknown, data: Record<string, unknown>) => void;
      }) => Promise<unknown>) => callback({
        async get(ref) {
          if (database.fail === 'read' || database.fail === 'write') throw new Error('database down');
          if (ref && typeof ref.add === 'function') return trips().get();
          if (ref && typeof ref.get === 'function') return ref.get();
          return { exists: false, docs: [], data: () => undefined };
        },
        set(_ref, data) { database.written = data; },
      }),
    },
  };
});

import { assignMileageTrips, createMileageTrip, deleteMileageTrip, getMileageTrips, mileageTripFromDocument } from '@/lib/firebase/mileage-server';

const tripInput = {
  userId: 'owner', date: '2026-03-01', startLocation: 'Home', endLocation: 'Client', miles: 8, businessPurpose: 'Client meeting', roundTrip: false,
};

beforeEach(() => {
  database.fail = '';
  database.trips = [];
  database.vehicles = ['car-1'];
  database.written = null;
  database.updates = [];
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe('mileage server', () => {
  it('the shared read helper turns a stored trip into miles and leaves purpose text untyped', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const trip = mileageTripFromDocument('trip-1', 'owner', { miles: '12', businessPurpose: 'Business commute to the client', date: '2026-02-02' });
    expect(trip.miles).toBe(0);
    expect(trip.tripType).toBeNull();
    expect(trip.businessPurpose).toBe('Business commute to the client');
    const counted = mileageTripFromDocument('trip-2', 'owner', { miles: 4.5, date: '2026-02-03', roundTrip: true });
    expect(counted.miles).toBe(4.5);
    expect(counted.roundTrip).toBe(true);
  });

  it('reads the chosen year through that helper and drops a trip with no date', async () => {
    database.trips = [
      { id: 'newer', data: { date: '2026-04-02', miles: 3, startLocation: 'A', endLocation: 'B' } },
      { id: 'blank', data: { miles: 9 } },
      { id: 'older', data: { date: '2026-01-02', miles: 1, startLocation: 'C', endLocation: 'D' } },
      { id: 'last-year', data: { date: '2025-12-01', miles: 6 } },
    ];
    const read = await getMileageTrips('owner', 2026);
    expect(read.error).toBeNull();
    expect(read.data.map(trip => trip.id)).toEqual(['newer', 'older']);
    expect(read.data[0].miles).toBe(3);
  });

  it('a new trip with the switch off stores the base fields and is not refused after a sorted trip', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    database.trips = [{ id: 'sorted', data: { date: '2026-01-02', startLocation: 'Home', endLocation: 'Client', miles: 4, vehicleId: 'car-1', tripType: 'business' } }];
    const created = await createMileageTrip({ ...tripInput, vehicleId: 'missing', tripType: 'business' });
    expect(created.error).toBeNull();
    expect(created.data?.id).toBe('created-trip');
    expect(database.written).toEqual({
      userId: 'owner', date: '2026-03-01', startLocation: 'Home', endLocation: 'Client', miles: 8,
      businessPurpose: 'Client meeting', roundTrip: false, createdAt: expect.any(Date), updatedAt: expect.any(Date),
    });
    expect(database.written).not.toHaveProperty('vehicleId');
    expect(database.written).not.toHaveProperty('tripType');
    expect(database.written).not.toHaveProperty('homeDestination');
    expect(JSON.stringify(created.data)).not.toContain(MILEAGE_VEHICLE_COPY.pickTripType);
  });

  it('a new trip with the switch on is refused once every stored trip is sorted', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    database.trips = [{ id: 'sorted', data: { date: '2026-01-02', startLocation: 'Home', endLocation: 'Client', miles: 4, vehicleId: 'car-1', tripType: 'business' } }];
    const refused = await createMileageTrip(tripInput);
    expect(refused.data).toBeNull();
    expect(refused.error).toEqual({ status: 400, message: MILEAGE_VEHICLE_COPY.pickTripType });
    expect(database.written).toBeNull();
    const accepted = await createMileageTrip({ ...tripInput, vehicleId: 'car-1', tripType: 'business' });
    expect(accepted.error).toBeNull();
    expect(database.written).toMatchObject({ vehicleId: 'car-1', tripType: 'business', homeDestination: null });
  });

  it('trip sort writes the vehicle, the type, and the home answer', async () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    database.trips = [{ id: 'home', data: { date: '2026-03-01', startLocation: 'Home', endLocation: 'Office', miles: 8, businessPurpose: '' } }];
    const sorted = await assignMileageTrips('owner', [{ tripId: 'home', vehicleId: 'car-1', tripType: 'commute', homeDestination: 'regular_work' }]);
    expect(sorted.error).toBeNull();
    expect(database.updates).toEqual([{
      id: 'home',
      data: { vehicleId: 'car-1', tripType: 'commute', homeDestination: 'regular_work', updatedAt: expect.any(Date) },
    }]);
    const reviewed = await assignMileageTrips('owner', [{ tripId: 'home', vehicleId: 'car-1', tripType: 'commute', homeDestination: 'regular_work' }], {
      qualifyingUse: 'principal_place_of_business', regularUse: 'yes', exclusiveUse: 'yes',
    });
    expect(reviewed.data?.[0]).toMatchObject({ tripType: null, homeDestination: null, vehicleId: 'car-1' });
  });

  it('read, create, sort, and delete failures keep their error shapes', async () => {
    database.fail = 'read';
    expect(await getMileageTrips('owner')).toEqual({ data: [], error: { message: 'Failed to fetch mileage trips' } });
    database.fail = 'write';
    expect(await createMileageTrip(tripInput)).toEqual({ data: null, error: { message: 'Failed to create mileage trip' } });
    database.fail = 'assign';
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    expect(await assignMileageTrips('owner', [{ tripId: 'home', vehicleId: 'car-1', tripType: 'business' }])).toEqual({
      data: null, error: { message: MILEAGE_VEHICLE_COPY.sortFailed },
    });
    database.fail = 'delete';
    expect(await deleteMileageTrip('owner', 'trip-1')).toEqual({ success: false, error: { message: 'Failed to delete mileage trip' } });
  });
});
