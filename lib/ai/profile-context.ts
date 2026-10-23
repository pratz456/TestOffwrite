import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { convertToEnhancedContext } from './analyzeTransaction';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value ?? null;
}

/** Same numeric normalization the base profile hash applied to square footage and business-use percent. */
function finiteNonnegative(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const text = value.trim().replace(/^\$\s*/, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return undefined;
    value = Number(text.replace(/,/g, ''));
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}

/**
 * Vehicle inputs the base profile hash used, taken from the saved profile.
 * The switch changes how analysis describes a car. It does not change these fields.
 */
function savedVehicleHashInputs(profile: Record<string, unknown>) {
  return {
    home_office_sqft: finiteNonnegative(profile.home_office_sqft),
    vehicle_business_use_percentage: finiteNonnegative(profile.vehicle_business_use_percentage),
    vehicle_deduction_method: profile.vehicle_deduction_method,
    business_vehicle: profile.business_vehicle,
  };
}

/** Hash the normalized tax facts, with vehicle inputs read from the saved profile. */
export function analysisProfileHash(profile: Record<string, unknown>, date: string) {
  const context = { ...convertToEnhancedContext(profile, date), ...savedVehicleHashInputs(profile), user_id: undefined };
  return createHash('sha256').update(JSON.stringify(canonical(context))).digest('hex');
}

/** Analysis needs the full saved context, not the public profile response's display-field subset. */
export async function getAnalysisProfile(uid: string) {
  try {
    const snapshot = await adminDb.doc(`user_profiles/${uid}`).get();
    return { data: snapshot.exists ? { ...snapshot.data(), id: uid } : null, error: null };
  } catch {
    return { data: null, error: 'PROFILE_UNAVAILABLE' };
  }
}
