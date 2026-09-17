/**
 * Firestore binding for lib/security/rate-limit.ts.
 *
 * Kept apart from the limiter so the throttle store can be substituted
 * independently of a route's own database access: route tests replace this
 * module with an in-memory store while keeping their Admin SDK doubles for the
 * data the route actually reads and writes. Production always resolves to the
 * shared Admin Firestore instance. The import is deferred so an Admin SDK
 * initialization failure surfaces as "store unavailable" (and the per-call
 * policy) instead of failing every route module at load time.
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

export interface RateLimitStore {
  doc(path: string): DocumentReference;
  runTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
}

export async function rateLimitStore(): Promise<RateLimitStore> {
  const { adminDb } = await import('@/lib/firebase/admin');
  return adminDb;
}
