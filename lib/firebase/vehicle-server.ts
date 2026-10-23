import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import {
  blankVehicle,
  planLegacyVehicle,
  saveVehicle,
  vehicleFromDocument,
  vehicleToDocument,
  type LegacyVehicleProfile,
  type VehiclePatch,
  type VehicleRecord,
} from '@/lib/mileage/vehicles';
import { adminDb } from './admin';

function profileFrom(data: Record<string, unknown> | undefined): LegacyVehicleProfile {
  const nested = data?.business_vehicle;
  return {
    vehicle_deduction_method: typeof data?.vehicle_deduction_method === 'string' ? data.vehicle_deduction_method : null,
    vehicle_business_use_percentage: typeof data?.vehicle_business_use_percentage === 'number' ? data.vehicle_business_use_percentage : null,
    business_vehicle: nested && typeof nested === 'object' ? nested as LegacyVehicleProfile['business_vehicle'] : null,
  };
}

/** Owner vehicle list only. A failed read leaves the caller on the profile fallback. */
export async function readUserVehicleRecords(userId: string): Promise<VehicleRecord[] | undefined> {
  try {
    const snap = await adminDb.doc(`user_profiles/${userId}`).collection('vehicles').get();
    const docs = (snap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs;
    return Array.isArray(docs) ? docs.map(doc => vehicleFromDocument(doc.id, doc.data())) : undefined;
  } catch {
    return undefined;
  }
}

/** Builds vehicle 1 from old profile fields for this read. Stored data is left unchanged. */
export async function ensureUserVehicles(userId: string): Promise<{ data: VehicleRecord[]; error: { message: string } | null }> {
  try {
    const profileRef = adminDb.collection('user_profiles').doc(userId);
    const vehiclesRef = profileRef.collection('vehicles');
    const vehicles = await adminDb.runTransaction(async tx => {
      const profileSnap = await tx.get(profileRef);
      const vehicleSnap = await tx.get(vehiclesRef);
      const existing = vehicleSnap.docs.map(doc => vehicleFromDocument(doc.id, doc.data()));
      return planLegacyVehicle(profileFrom(profileSnap.data()), existing).vehicles;
    });
    return { data: vehicles, error: null };
  } catch (error) {
    console.error('vehicle read failed', error);
    return { data: [], error: { message: MILEAGE_VEHICLE_COPY.loadFailed } };
  }
}

export async function addUserVehicle(userId: string): Promise<{ data: VehicleRecord | null; error: { message: string; status: number } | null }> {
  if (!mileageVehicleCopyEnabled()) return { data: null, error: { message: MILEAGE_VEHICLE_COPY.addFailed, status: 403 } };
  try {
    const profileRef = adminDb.collection('user_profiles').doc(userId);
    const vehiclesRef = profileRef.collection('vehicles');
    const created = await adminDb.runTransaction(async tx => {
      const profileSnap = await tx.get(profileRef);
      const vehicleSnap = await tx.get(vehiclesRef);
      const existing = vehicleSnap.docs.map(doc => vehicleFromDocument(doc.id, doc.data()));
      const plan = planLegacyVehicle(profileFrom(profileSnap.data()), existing);
      if (plan.inserted) tx.set(vehiclesRef.doc(plan.inserted.id), vehicleToDocument(plan.inserted));
      const id = vehiclesRef.doc().id;
      const vehicle = blankVehicle(id, plan.vehicles.length);
      tx.set(vehiclesRef.doc(id), vehicleToDocument(vehicle));
      return vehicle;
    });
    return { data: created, error: null };
  } catch (error) {
    console.error('vehicle add failed', error);
    return { data: null, error: { message: MILEAGE_VEHICLE_COPY.addFailed, status: 500 } };
  }
}

export async function saveUserVehicle(
  userId: string,
  vehicleId: string,
  patch: VehiclePatch,
): Promise<{ data: VehicleRecord | null; error: { message: string; status: number } | null }> {
  if (!mileageVehicleCopyEnabled()) return { data: null, error: { message: MILEAGE_VEHICLE_COPY.saveFailed, status: 403 } };
  try {
    const profileRef = adminDb.collection('user_profiles').doc(userId);
    const vehiclesRef = profileRef.collection('vehicles');
    let saved: VehicleRecord | null = null;
    let reason: string | null = null;
    await adminDb.runTransaction(async tx => {
      saved = null;
      reason = null;
      const profileSnap = await tx.get(profileRef);
      const vehicleSnap = await tx.get(vehiclesRef);
      const existing = vehicleSnap.docs.map(doc => vehicleFromDocument(doc.id, doc.data()));
      const plan = planLegacyVehicle(profileFrom(profileSnap.data()), existing);
      if (plan.inserted) tx.set(vehiclesRef.doc(plan.inserted.id), vehicleToDocument(plan.inserted));
      const result = saveVehicle(plan.vehicles, vehicleId, patch);
      if (!result.ok) {
        reason = result.reason;
        return;
      }
      const vehicle = result.vehicles.find(item => item.id === vehicleId) ?? null;
      if (!vehicle) {
        reason = MILEAGE_VEHICLE_COPY.vehicleMissing;
        return;
      }
      tx.set(vehiclesRef.doc(vehicleId), vehicleToDocument(vehicle));
      saved = vehicle;
    });
    if (reason || !saved) return { data: null, error: { message: reason ?? MILEAGE_VEHICLE_COPY.saveFailed, status: reason ? 400 : 500 } };
    return { data: saved, error: null };
  } catch (error) {
    console.error('vehicle save failed', error);
    return { data: null, error: { message: MILEAGE_VEHICLE_COPY.saveFailed, status: 500 } };
  }
}
