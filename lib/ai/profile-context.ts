import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { convertToEnhancedContext } from './analyzeTransaction';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value ?? null;
}

/** Hash exactly the normalized tax facts used by analysis, excluding a synthetic/derived record ID. */
export function analysisProfileHash(profile: Record<string, unknown>, date: string) {
  const context = { ...convertToEnhancedContext(profile, date), user_id: undefined };
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
