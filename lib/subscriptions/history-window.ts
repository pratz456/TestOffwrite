import { adminDb } from '@/lib/firebase/admin';
import { evaluateEntitlements } from './entitlements';

export function transactionHistoryWindow(profile: Record<string, unknown>, now = new Date()) {
  const days = evaluateEntitlements(profile, now).features.extended_history ? 730 : 90;
  const endDate = now.toISOString().slice(0, 10);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return { days, startDate: start.toISOString().slice(0, 10), endDate };
}

/** Import limits affect new ingestion, never delete previously saved records. */
export async function getTransactionHistoryWindow(uid: string) {
  const snapshot = await adminDb.doc(`user_profiles/${uid}`).get();
  if (!snapshot.exists) throw new Error('User profile not found');
  return transactionHistoryWindow(snapshot.data() ?? {});
}

export function isWithinHistoryWindow(date: unknown, window: { startDate: string; endDate: string }): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date &&
    date >= window.startDate && date <= window.endDate;
}
