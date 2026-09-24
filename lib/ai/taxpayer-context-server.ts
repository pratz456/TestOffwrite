import { adminDb } from '@/lib/firebase/admin';
import { isCountableRecord } from '@/lib/transactions/record-scope';
import type { UserContext } from './analyzeTransaction';
import { buildTaxpayerContext, summarizeConfirmedMerchants, type ConfirmedTransactionRecord, type HomeOfficeFacts, type TaxpayerAnalysisContext } from './taxpayer-context';

/** Per-account cap used by the legacy per-account fallback read. */
export const CONFIRMED_PER_ACCOUNT = 150;
/** Total cap for one user's confirmed-history priors, newest transactions first. */
export const CONFIRMED_HISTORY_CAP = 500;
/** In-process memo lifetime; bounds cross-instance staleness after a confirmation. */
export const CONFIRMED_HISTORY_TTL_MS = 60_000;
/** Bounds memo memory on a 1 GiB SSR instance (~500 small records per entry worst case). */
export const CONFIRMED_HISTORY_CACHE_MAX_ENTRIES = 256;

interface CacheEntry { expiresAt: number; value: Promise<ConfirmedTransactionRecord[]> }
const confirmedHistoryCache = new Map<string, CacheEntry>();

function toRecord(doc: FirebaseFirestore.QueryDocumentSnapshot): ConfirmedTransactionRecord {
  const data = doc.data();
  return {
    merchant_name: data.merchant_name ?? null, name: data.name ?? null, category: data.category ?? null,
    expense_type: data.expense_type ?? null, is_deductible: typeof data.is_deductible === 'boolean' ? data.is_deductible : null,
    review_status: data.review_status ?? null, business_purpose: data.business_purpose ?? null,
    date: data.date ?? null, reviewed_at: data.reviewed_at ?? null,
  };
}

function isMissingIndexError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 9 || code === 'FAILED_PRECONDITION' || code === 'failed-precondition';
}

/** Legacy shape: one query per account, capped per account and in total. Rows need no owner field. */
async function readConfirmedPerAccount(uid: string): Promise<ConfirmedTransactionRecord[]> {
  const accounts = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();
  const snapshots = await Promise.all(accounts.docs.map(account =>
    account.ref.collection('transactions').where('review_status', '==', 'confirmed').limit(CONFIRMED_PER_ACCOUNT).get()));
  // Only posted, still-active records are useful priors, even if the user
  // confirmed a transaction before the bank withdrew or replaced it.
  return snapshots.flatMap(snapshot => snapshot.docs.filter(doc => isCountableRecord(doc.data())).map(toRecord)).slice(0, CONFIRMED_HISTORY_CAP);
}

/**
 * One collection-group query (index: transactions userId ASC, review_status ASC, date DESC) replaces
 * the 1 + accounts reads of the legacy path. Rows are restricted to the owner's account subcollections.
 * Falls back to the per-account read when the index is unavailable or nothing carries `userId`
 * (legacy rows), so the set of priors is never smaller than before.
 */
async function readConfirmedTransactionRecords(uid: string): Promise<ConfirmedTransactionRecord[]> {
  try {
    const snapshot = await adminDb.collectionGroup('transactions')
      .where('userId', '==', uid)
      .where('review_status', '==', 'confirmed')
      .orderBy('date', 'desc')
      .limit(CONFIRMED_HISTORY_CAP)
      .get();
    const owned = snapshot.docs.filter(doc => doc.ref.path.startsWith(`user_profiles/${uid}/accounts/`) && isCountableRecord(doc.data()));
    if (owned.length > 0) return owned.map(toRecord);
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
  }
  return readConfirmedPerAccount(uid);
}

/**
 * Reads only user-confirmed rows; AI suggestions and pending records never become priors.
 * Memoized per uid for CONFIRMED_HISTORY_TTL_MS so an analysis batch of N tasks for one user reads
 * the history once instead of N times. Failures are not cached.
 */
export function loadConfirmedTransactionRecords(uid: string): Promise<ConfirmedTransactionRecord[]> {
  const now = Date.now();
  const cached = confirmedHistoryCache.get(uid);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = readConfirmedTransactionRecords(uid);
  confirmedHistoryCache.delete(uid);
  confirmedHistoryCache.set(uid, { expiresAt: now + CONFIRMED_HISTORY_TTL_MS, value });
  while (confirmedHistoryCache.size > CONFIRMED_HISTORY_CACHE_MAX_ENTRIES) {
    const oldest = confirmedHistoryCache.keys().next().value;
    if (oldest === undefined) break;
    confirmedHistoryCache.delete(oldest);
  }
  value.catch(() => { if (confirmedHistoryCache.get(uid)?.value === value) confirmedHistoryCache.delete(uid); });
  return value;
}

/**
 * Drop memoized history for a user (or everyone). Called after a review confirms or corrects a
 * transaction so the next analysis on this instance sees the new prior; other instances age out
 * within CONFIRMED_HISTORY_TTL_MS.
 */
export function invalidateTaxpayerContextCache(uid?: string): void {
  if (uid === undefined) confirmedHistoryCache.clear();
  else confirmedHistoryCache.delete(uid);
}

/** Test/diagnostic hook: number of memoized users. */
export function taxpayerContextCacheSize(): number {
  return confirmedHistoryCache.size;
}

async function loadHomeOfficeFacts(uid: string): Promise<HomeOfficeFacts | null> {
  const snapshot = await adminDb.collection('user_profiles').doc(uid).collection('settings').doc('homeOffice').get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  return { officeSqFt: typeof data.officeSqFt === 'number' ? data.officeSqFt : null, totalHomeSqFt: typeof data.totalHomeSqFt === 'number' ? data.totalHomeSqFt : null };
}

/**
 * Best-effort enrichment. Any read failure yields profile-only context so
 * analysis still runs; it never fails a transaction because history was unavailable.
 */
export async function loadTaxpayerContext(uid: string, profile: UserContext, merchant: string | null | undefined, transactionDate: string | null): Promise<TaxpayerAnalysisContext> {
  const [homeOffice, confirmed] = await Promise.all([
    loadHomeOfficeFacts(uid).catch(() => null),
    loadConfirmedTransactionRecords(uid).then(summarizeConfirmedMerchants).catch(() => [] as ReturnType<typeof summarizeConfirmedMerchants>),
  ]);
  return buildTaxpayerContext({ profile, homeOffice, confirmed, merchant, transactionDate });
}
