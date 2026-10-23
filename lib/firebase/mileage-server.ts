import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import {
  assignTrips,
  normalizeStoredTrip,
  tripCreateRecord,
  type HomeDestination,
  type HomeOfficeTripFacts,
  type TripType,
} from '@/lib/mileage/vehicles';
import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from './admin';

export interface MileageTrip {
  id: string;
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
  vehicleId?: string | null;
  tripType?: TripType | null;
  homeDestination?: HomeDestination | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateMileageTripInput {
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
  vehicleId?: string | null;
  tripType?: TripType | null;
  homeDestination?: HomeDestination | null;
}

export interface MileageWriteError {
  message: string;
  status?: number;
}

/** Shared read for get, create, and sort. Missing miles become 0. Purpose text never becomes a trip type. */
export function mileageTripFromDocument(id: string, userId: string, data: DocumentData): MileageTrip {
  const normalized = normalizeStoredTrip({ ...data, id, businessPurpose: data.businessPurpose });
  const copyOn = mileageVehicleCopyEnabled();
  return {
    id: normalized.id,
    userId: typeof data.userId === 'string' ? data.userId : userId,
    date: normalized.date,
    startLocation: normalized.startLocation,
    endLocation: normalized.endLocation,
    miles: normalized.miles,
    businessPurpose: normalized.businessPurpose,
    roundTrip: normalized.roundTrip,
    createdAt: data.createdAt?.toDate?.() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
    ...(copyOn ? { vehicleId: normalized.vehicleId, tripType: normalized.tripType, homeDestination: normalized.homeDestination } : {}),
  };
}

function storedTripFields(trip: MileageTrip, createdAt: Date, copyOn: boolean): Record<string, unknown> {
  const base = {
    userId: trip.userId,
    date: trip.date,
    startLocation: trip.startLocation,
    endLocation: trip.endLocation,
    miles: trip.miles,
    businessPurpose: trip.businessPurpose,
    roundTrip: trip.roundTrip,
    createdAt,
    updatedAt: createdAt,
  };
  if (!copyOn) return base;
  return { ...base, vehicleId: trip.vehicleId ?? null, tripType: trip.tripType ?? null, homeDestination: trip.homeDestination ?? null };
}

function tripsCollection(userId: string) {
  return adminDb.collection('user_profiles').doc(userId).collection('mileage_trips');
}

/**
 * Get mileage trips for a user. Omit year for the current calendar year.
 * Pass null for every stored year.
 */
export async function getMileageTrips(
  userId: string,
  year?: number | null
): Promise<{ data: MileageTrip[]; error: MileageWriteError | null }> {
  try {
    const targetYear = year === null ? null : year ?? new Date().getFullYear();
    const querySnapshot = await tripsCollection(userId).get();
    const trips: MileageTrip[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const tripDate = data.date ? new Date(data.date) : null;
      if (targetYear !== null && (!tripDate || tripDate.getFullYear() !== targetYear)) return;
      trips.push(mileageTripFromDocument(doc.id, userId, data));
    });
    trips.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { data: trips, error: null };
  } catch (error) {
    console.error('mileage read failed', error);
    return { data: [], error: { message: 'Failed to fetch mileage trips' } };
  }
}

/**
 * Create a new mileage trip. Purpose text is stored and never becomes a trip type.
 */
export async function createMileageTrip(
  input: CreateMileageTripInput
): Promise<{ data: MileageTrip | null; error: MileageWriteError | null }> {
  try {
    const collectionRef = tripsCollection(input.userId);
    const copyOn = mileageVehicleCopyEnabled();
    const createdAt = new Date();
    const docRef = collectionRef.doc();
    const written = await adminDb.runTransaction(async tx => {
      const existingSnap = await tx.get(collectionRef);
      const existing = copyOn ? existingSnap.docs.map((doc: { id: string; data: () => DocumentData }) => normalizeStoredTrip({ id: doc.id, ...doc.data() })) : [];
      const decision = tripCreateRecord(input, existing);
      if (!decision.ok) return { data: null, error: { status: 400 as const, message: copyOn ? decision.reason : 'Failed to create mileage trip' } };
      if (copyOn && decision.trip.vehicleId) {
        const vehicle = await tx.get(adminDb.collection('user_profiles').doc(input.userId).collection('vehicles').doc(decision.trip.vehicleId));
        if (!vehicle.exists) return { data: null, error: { status: 400 as const, message: MILEAGE_VEHICLE_COPY.vehicleMissing } };
      }
      const trip = mileageTripFromDocument(docRef.id, input.userId, { ...decision.trip, createdAt, updatedAt: createdAt });
      tx.set(docRef, storedTripFields(trip, createdAt, copyOn));
      return { data: trip, error: null };
    });
    return written;
  } catch (error) {
    console.error('mileage create failed', error);
    return { data: null, error: { message: 'Failed to create mileage trip' } };
  }
}

export async function assignMileageTrips(
  userId: string,
  updates: Array<{ tripId: string; vehicleId: string | null; tripType: TripType | null; homeDestination?: HomeDestination | null }>,
  homeOffice?: HomeOfficeTripFacts,
): Promise<{ data: MileageTrip[] | null; error: MileageWriteError | null }> {
  try {
    if (updates.length < 1 || updates.length > 200) return { data: null, error: { status: 400, message: MILEAGE_VEHICLE_COPY.sortFailed } };
    const collectionRef = tripsCollection(userId);
    const refs = updates.map(update => collectionRef.doc(update.tripId));
    const snaps = await adminDb.getAll(...refs);
    if (snaps.some(snap => !snap.exists)) return { data: null, error: { status: 404, message: MILEAGE_VEHICLE_COPY.sortFailed } };
    const vehicleIds = [...new Set(updates.map(update => update.vehicleId).filter((id): id is string => Boolean(id)))];
    for (const vehicleId of vehicleIds) {
      const vehicle = await adminDb.collection('user_profiles').doc(userId).collection('vehicles').doc(vehicleId).get();
      if (!vehicle.exists) return { data: null, error: { status: 400, message: MILEAGE_VEHICLE_COPY.vehicleMissing } };
    }
    let trips = snaps.map(snap => mileageTripFromDocument(snap.id, userId, snap.data()));
    for (const update of updates) {
      trips = assignTrips(trips, [update.tripId], update, homeOffice);
    }
    const batch = adminDb.batch();
    const updatedAt = new Date();
    for (const trip of trips) {
      batch.update(collectionRef.doc(trip.id), {
        vehicleId: trip.vehicleId,
        tripType: trip.tripType,
        homeDestination: trip.homeDestination,
        updatedAt,
      });
    }
    await batch.commit();
    return { data: trips.map(trip => ({ ...trip, userId, updatedAt })), error: null };
  } catch (error) {
    console.error('mileage assign failed', error);
    return { data: null, error: { message: MILEAGE_VEHICLE_COPY.sortFailed } };
  }
}

export async function deleteMileageTrip(
  userId: string,
  tripId: string
): Promise<{ success: boolean; error: MileageWriteError | null }> {
  try {
    await tripsCollection(userId).doc(tripId).delete();
    return { success: true, error: null };
  } catch (error) {
    console.error('mileage delete failed', error);
    return { success: false, error: { message: 'Failed to delete mileage trip' } };
  }
}
