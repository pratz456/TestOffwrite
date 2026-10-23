import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import {
  assignTrips,
  normalizeStoredTrip,
  tripCreateRecord,
  type HomeDestination,
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
  vehicleId: string | null;
  tripType: TripType | null;
  homeDestination: HomeDestination | null;
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

function tripFromData(id: string, userId: string, data: DocumentData): MileageTrip {
  const normalized = normalizeStoredTrip({ id, ...data, businessPurpose: data.businessPurpose });
  return {
    ...normalized,
    userId: typeof data.userId === 'string' ? data.userId : userId,
    createdAt: data.createdAt?.toDate?.() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
  };
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
      trips.push(tripFromData(doc.id, userId, data));
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
    const existingSnap = await collectionRef.get();
    const existing = existingSnap.docs.map(doc => normalizeStoredTrip({ id: doc.id, ...doc.data() }));
    const copyOn = mileageVehicleCopyEnabled();
    const decision = tripCreateRecord(input, copyOn ? existing : []);
    if (!decision.ok) return { data: null, error: { status: 400, message: copyOn ? decision.reason : 'Failed to create mileage trip' } };
    if (copyOn && decision.trip.vehicleId) {
      const vehicle = await adminDb.collection('user_profiles').doc(input.userId).collection('vehicles').doc(decision.trip.vehicleId).get();
      if (!vehicle.exists) return { data: null, error: { status: 400, message: MILEAGE_VEHICLE_COPY.vehicleMissing } };
    }
    const createdAt = new Date();
    const docRef = await collectionRef.add({
      userId: input.userId,
      date: decision.trip.date,
      startLocation: decision.trip.startLocation,
      endLocation: decision.trip.endLocation,
      miles: decision.trip.miles,
      businessPurpose: decision.trip.businessPurpose,
      roundTrip: decision.trip.roundTrip,
      vehicleId: decision.trip.vehicleId,
      tripType: decision.trip.tripType,
      homeDestination: decision.trip.homeDestination,
      createdAt,
      updatedAt: createdAt,
    });
    return {
      data: { ...decision.trip, id: docRef.id, userId: input.userId, createdAt, updatedAt: createdAt },
      error: null,
    };
  } catch (error) {
    console.error('mileage create failed', error);
    return { data: null, error: { message: 'Failed to create mileage trip' } };
  }
}

export async function assignMileageTrips(
  userId: string,
  updates: Array<{ tripId: string; vehicleId: string | null; tripType: TripType | null; homeDestination?: HomeDestination | null }>,
  homeOffice?: { qualifyingUse?: string | null } | null,
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
    let trips = snaps.map(snap => normalizeStoredTrip({ id: snap.id, ...snap.data() }));
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
