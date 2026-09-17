import { FieldPath } from 'firebase-admin/firestore';
import { taxDecisionUpdate } from '@/lib/transactions/tax-decision';
import { recordedTransactionType, reviewHydrationFields, type AiReviewSuggestion, type TransactionKind } from '@/lib/transactions/ai-review-contract';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
// lib/firebase/transactions-server.ts
import { adminDb } from './admin';

export interface Transaction {
  ai_suggestion?: AiReviewSuggestion | null;
  transaction_kind?: TransactionKind;
  review_status?: string;
  review_source?: string;
  tax_review_required?: boolean;
  id: string;
  trans_id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  datetime?: string; // Full datetime from Plaid (ISO format)
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  expense_type?: 'business' | 'personal'; // Explicit classification from AI or user
  deductible_reason?: string;
  deduction_score?: number | null;
  ai_analysis?: string;
  user_classification_reason?: string;
  description?: string;
  notes?: string;
  receipt_url?: string;
  receipt_filename?: string;

  // Additional Plaid Transaction Fields
  merchant_category_code?: string;
  location?: {
    address?: string;
    city?: string;
    state?: string;
    lat?: number;
    lon?: number;
  };
  payment_channel?: 'in_store' | 'online' | 'other';
  authorized_date?: string;
  iso_currency_code?: string;
  unofficial_currency_code?: string;
  personal_finance_category?: {
    primary?: string;
    detailed?: string;
    confidence?: string;
  };
  pending?: boolean;
  pending_transaction_id?: string;
  account_owner?: string;
  transaction_code?: string;
  /** Server-only: path of the earlier reviewed record this bank import duplicates. */
  superseded_by?: string | null;

  account_id?: string;
  accountId?: string;
  user_id?: string;
  userId?: string;
  analyzed?: boolean;
  analysis_status?: 'pending' | 'running' | 'completed' | 'failed';
  analysisStatus?: 'pending' | 'running' | 'completed' | 'failed';
  transactionHash?: string;
  analysisStartedAt?: any;
  analysisCompletedAt?: any;
  created_at?: any;
  updated_at?: any;
  ai?: any | null;
  _source?: string;
  ocr_data?: any;
  counterparties?: any[];
  logo_url?: string;
  merchant_entity_id?: string;
}

/** Helper: convert possible Firestore timestamp or string to ISO date string (safe) */
function parseDateToISO(dateLike: any): string {
  try {
    if (!dateLike) return '';
    // Firestore Timestamp has toDate()
    if (typeof dateLike?.toDate === 'function') {
      return dateLike.toDate().toISOString();
    }
    // If it's a Date
    if (dateLike instanceof Date) return dateLike.toISOString();
    // If it's numeric (epoch millis)
    if (typeof dateLike === 'number') return new Date(dateLike).toISOString();
    // If it's string already
    if (typeof dateLike === 'string') {
      const d = new Date(dateLike);
      return isNaN(d.getTime()) ? dateLike : d.toISOString();
    }
    return String(dateLike);
  } catch {
    return String(dateLike);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/** Recursively omit undefined (Firestore rejects nested undefined). Preserves Date and non-plain objects. */
function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const cleaned = stripUndefinedDeep(v);
    if (cleaned === undefined) continue;
    if (isPlainObject(cleaned) && Object.keys(cleaned).length === 0) continue;
    out[k] = cleaned;
  }
  return out as T;
}

/** Normalize a single Firestore doc into Transaction shape */
function normalizeDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): Transaction {
  const data: any = doc.data();
  const dateIso = parseDateToISO(data.date ?? data.created_at ?? data.updated_at);
  const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount) || 0;

  return {
    id: data.trans_id || doc.id,
    trans_id: data.trans_id || doc.id,
    merchant_name: data.merchant_name || data.merchant || '',
    amount,
    category: data.category || '',
    date: dateIso,
    type: recordedTransactionType({ ...data, amount }),
    is_deductible: data.is_deductible ?? data.deductible ?? null,
    pending: data.pending ?? null,
    deductible_reason: data.deductible_reason || null,
    deduction_score: data.deduction_score || null,
    ai_analysis: data.ai_analysis || null,
    user_classification_reason: data.user_classification_reason || null,
    description: data.description,
    notes: data.notes,
    receipt_url: data.receipt_url ?? undefined,
    receipt_filename: data.receipt_filename ?? undefined,

    account_id: data.account_id || data.accountId || null,
    userId: data.userId || data.user_id || null,
    analyzed: data.analyzed ?? false,
    analysisStatus: data.analysis_status || data.analysisStatus,
    transactionHash: data.transactionHash,
    analysisStartedAt: data.analysisStartedAt,
    analysisCompletedAt: data.analysisCompletedAt,
    created_at: data.created_at,
    updated_at: data.updated_at,
    ai: data.ai || null,
    ...reviewHydrationFields(data),
  };
}

/**
 * getTransactionServer - one row by `trans_id`, trying the canonical `userId` owner field first and
 * the legacy `user_id` field only when nothing matched (indexes: (trans_id, userId) / (trans_id, user_id)).
 */
export async function getTransactionServer(
  userId: string,
  transactionId: string
): Promise<{ data: Transaction | null; error: any }> {
  try {
    // Try collectionGroup query with userId + trans_id
    const snap = await adminDb
      .collectionGroup('transactions')
      .where('userId', '==', userId)
      .where('trans_id', '==', transactionId)
      .limit(1)
      .get();

    if (!snap.empty) {
      return { data: normalizeDoc(snap.docs[0]), error: null };
    }

    // Fallback: try with user_id (snake_case) for legacy data
    const snap2 = await adminDb
      .collectionGroup('transactions')
      .where('user_id', '==', userId)
      .where('trans_id', '==', transactionId)
      .limit(1)
      .get();

    if (!snap2.empty) {
      return { data: normalizeDoc(snap2.docs[0]), error: null };
    }

    return { data: null, error: null }; // Not found
  } catch (error) {
    console.warn('⚠️ [getTransactionServer] Error fetching single transaction:', error);
    return { data: null, error };
  }
}

export interface GetTransactionsOptions {
  /**
   * Page size. When set, results are ordered by `date desc` (then document path) and at most
   * `limit` rows are returned together with `nextCursor`. Omit for the legacy full read.
   */
  limit?: number;
  /** Opaque cursor returned as `nextCursor` by the previous page. Only used together with `limit`. */
  cursor?: string | null;
  /**
   * Field projection. Reads are billed per document either way, but projecting the few fields an
   * aggregate needs cuts payload size and SSR memory. Identity fields are always included.
   */
  fields?: string[];
  /** Include records superseded by historical-overlap reconciliation; lists, totals and analysis never want them. */
  includeSuperseded?: boolean;
}

export interface TransactionsResult {
  data: Transaction[];
  error: any;
  /** Present only for paged reads; `null` when the page was the last one. */
  nextCursor: string | null;
}

/** Hard ceiling for a single paged read; callers wanting more must page. */
export const MAX_TRANSACTIONS_PAGE_SIZE = 500;

/** Fields the normalizer and dedupe key rely on; always projected. */
const PROJECTION_IDENTITY_FIELDS = ['trans_id', 'account_id', 'accountId', 'userId', 'user_id', 'date', 'created_at', 'updated_at', 'amount'];

interface TransactionsCursor { date: string; path: string }

export function encodeTransactionsCursor(cursor: TransactionsCursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.date, p: cursor.path }), 'utf8').toString('base64url');
}

export function decodeTransactionsCursor(value: string | null | undefined): TransactionsCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed?.d !== 'string' || typeof parsed?.p !== 'string' || parsed.p.split('/').at(-2) !== 'transactions') return null;
    return { date: parsed.d, path: parsed.p };
  } catch {
    return null;
  }
}

function normalizeGetTransactionsOptions(options?: GetTransactionsOptions | string[]): Required<Pick<GetTransactionsOptions, 'fields'>> & { limit: number | null; cursor: TransactionsCursor | null; includeSuperseded: boolean } {
  const opts: GetTransactionsOptions = Array.isArray(options) ? { fields: options } : options ?? {};
  const limit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
    ? Math.min(Math.floor(opts.limit), MAX_TRANSACTIONS_PAGE_SIZE)
    : null;
  return { fields: opts.fields ?? [], limit, cursor: limit ? decodeTransactionsCursor(opts.cursor) : null, includeSuperseded: opts.includeSuperseded === true };
}

function sortNewestFirst(rows: Transaction[]): Transaction[] {
  return rows.sort((a, b) => {
    const ad = a.date ? new Date(a.date).getTime() : 0;
    const bd = b.date ? new Date(b.date).getTime() : 0;
    return bd - ad;
  });
}

function isMissingIndexError(error: any): boolean {
  return error?.code === 9 || error?.code === 'FAILED_PRECONDITION' || error?.code === 'failed-precondition';
}

/**
 * getTransactionsServer - load a user's transactions with a short-circuiting strategy chain.
 *
 * Strategies (each one runs only when the previous returned nothing):
 *  1) collectionGroup('transactions') where 'userId' == uid  — canonical field written by createTransactionServer.
 *     A collection group includes root-level `transactions` too, so no separate top-level query is needed.
 *  2) collectionGroup('transactions') where 'user_id' == uid — legacy snake_case rows.
 *  3) user_profiles/{uid}/accounts/{accountId}/transactions per account — rows with neither owner field.
 *
 * Pass `{ limit, cursor }` to page (ordered by `date desc`, document path as the tiebreaker; rows
 * without a `date` field are not part of paged results). Without `limit` the legacy full read is
 * preserved: all rows, sorted newest first in memory.
 */
export async function getTransactionsServer(
  userId: string,
  options?: GetTransactionsOptions | string[]
): Promise<TransactionsResult> {
  try {
    if (!userId) return { data: [], error: 'Missing userId', nextCursor: null };
    const { fields, limit, cursor, includeSuperseded } = normalizeGetTransactionsOptions(options);
    const projection = fields.length > 0 ? [...new Set([...PROJECTION_IDENTITY_FIELDS, ...fields])] : null;

    const foundMap = new Map<string, Transaction>(); // dedupe by trans_id (+ account_id when available)

    const addDocs = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
      for (const doc of docs) {
        try {
          const data: any = doc.data() || {};
          // Superseded duplicates of an earlier reviewed record never reach lists or totals.
          if (!includeSuperseded && isSupersededRecord(data)) continue;
          const transId: string | undefined = data?.trans_id || data?.transId || doc.id;
          const accountId: string | undefined = data?.account_id || data?.accountId;

          // Prefer a stable business identifier (trans_id) instead of doc.ref.path,
          // because the same transaction can appear in multiple document paths.
          const key = transId
            ? accountId
              ? `${accountId}::${transId}`
              : `${transId}`
            : doc.ref?.path || doc.id;
          if (foundMap.has(key)) continue;
          foundMap.set(key, normalizeDoc(doc));
        } catch (e) {
          console.warn('[getTransactionsServer] failed to normalize doc', e);
        }
      }
    };

    for (const ownerField of ['userId', 'user_id'] as const) {
      try {
        let query: FirebaseFirestore.Query = adminDb.collectionGroup('transactions').where(ownerField, '==', userId);
        if (projection) query = query.select(...projection);
        if (limit) {
          query = query.orderBy('date', 'desc').orderBy(FieldPath.documentId(), 'desc');
          if (cursor) query = query.startAfter(cursor.date, adminDb.doc(cursor.path));
          query = query.limit(limit + 1);
        }
        const snapshot = await query.get();
        if (snapshot.empty) continue;

        let docs = snapshot.docs;
        let nextCursor: string | null = null;
        if (limit && docs.length > limit) {
          docs = docs.slice(0, limit);
          const last = docs[docs.length - 1];
          nextCursor = encodeTransactionsCursor({ date: String(last.get('date') ?? ''), path: last.ref.path });
        }
        addDocs(docs);
        const data = Array.from(foundMap.values());
        return { data: limit ? data : sortNewestFirst(data), error: null, nextCursor };
      } catch (e: any) {
        if (!isMissingIndexError(e)) {
          console.warn(`[getTransactionsServer] collectionGroup(${ownerField}) query failed:`, e?.message ?? e);
        }
      }
    }

    // 3) Fallback: iterate user_profiles/{userId}/accounts/{accountId}/transactions
    try {
      const accountsSnap = await adminDb.collection('user_profiles').doc(userId).collection('accounts').get();
      const perAccount = await Promise.all(accountsSnap.docs.map(async accountDoc => {
        try {
          let query: FirebaseFirestore.Query = accountDoc.ref.collection('transactions');
          if (projection) query = query.select(...projection);
          return (await query.get()).docs;
        } catch (e: any) {
          console.warn(`[getTransactionsServer] failed to get transactions for account ${accountDoc.id}:`, e?.message ?? e);
          return [] as FirebaseFirestore.QueryDocumentSnapshot[];
        }
      }));
      addDocs(perAccount.flat());
      const data = sortNewestFirst(Array.from(foundMap.values()));
      // Per-account rows carry no collection-group cursor; a paged caller gets the newest slice.
      return { data: limit ? data.slice(0, limit) : data, error: null, nextCursor: null };
    } catch (fallbackError) {
      console.error('[getTransactionsServer] per-account fallback failed:', fallbackError);
      return { data: [], error: fallbackError, nextCursor: null };
    }
  } catch (error: any) {
    console.error('[getTransactionsServer] Unexpected error:', error);
    return { data: [], error, nextCursor: null };
  }
}

/**
 * Update a transaction identified by transactionId for a specific userId.
 * Tries collectionGroup first, falls back to searching user's accounts.
 */
export async function updateTransactionServerWithUserId(
  userId: string,
  transactionId: string,
  updates: {
    is_deductible?: boolean | null;
    expense_type?: 'business' | 'personal' | null; // null clears until user confirms
    deductible_reason?: string;
    deduction_score?: number;
    ai_analysis?: string;
    user_classification_reason?: string;
    notes?: string;
    analyzed?: boolean;
    analysisStatus?: 'pending' | 'running' | 'completed' | 'failed';
    analysisStartedAt?: Date;
    analysisCompletedAt?: Date;

    // New AI Analysis Fields
    deductionStatus?: 'Likely Deductible' | 'Possibly Deductible' | 'Non-Deductible';
    confidence?: number;
    reasoning?: string;
    irsPublication?: string;
    irsSection?: string;
    analysisUpdatedAt?: string;
  }
): Promise<{ data: any; error: any }> {
  try {
    console.log('🔄 [UPDATE→DB Server] Updating transaction with userId:', userId, transactionId, updates);

    // Strategy 1: Try collectionGroup query first (more efficient with userId filter)
    try {
      console.log('🔍 [UPDATE→DB Server] Attempting collectionGroup query with userId filter...');
      const transactionsQuery = adminDb
        .collectionGroup('transactions')
        .where('userId', '==', userId)
        .where('trans_id', '==', transactionId)
        .limit(1);

      const querySnapshot = await transactionsQuery.get();

      if (!querySnapshot.empty) {
        console.log('✅ [UPDATE→DB Server] Found transaction via collectionGroup query');
        const docRef = querySnapshot.docs[0].ref;
        const updateData: any = stripUndefinedDeep({
          ...updates,
          ...taxDecisionUpdate(querySnapshot.docs[0].data(), updates),
          updated_at: new Date(),
        });

        console.log('📝 [UPDATE→DB Server] Updating document at path:', docRef.path);
        await docRef.update(updateData);

        // Read back to verify the update
        const updatedDoc = await docRef.get();
        if (updatedDoc.exists) {
          const data = updatedDoc.data();
          console.log('✅ [READBACK←DB Server] Update verified:', {
            trans_id: data?.trans_id,
            is_deductible: data?.is_deductible,
            deductible_reason: data?.deductible_reason,
            deduction_score: data?.deduction_score,
          });
          return { data: [data], error: null };
        }

        return { data: null, error: new Error('Failed to verify update') };
      }

      console.log('⚠️ [UPDATE→DB Server] No transaction found via collectionGroup query, trying fallback...');
    } catch (collectionGroupError: any) {
      console.warn('⚠️ [UPDATE→DB Server] CollectionGroup query failed:', collectionGroupError);
      console.warn('⚠️ [UPDATE→DB Server] Error code:', collectionGroupError.code);
      console.warn('⚠️ [UPDATE→DB Server] Error message:', collectionGroupError.message);

      // If it's a FAILED_PRECONDITION, it's likely a missing index
      if (collectionGroupError.code === 9 || collectionGroupError.code === 'FAILED_PRECONDITION') {
        console.log('🔧 [UPDATE→DB Server] FAILED_PRECONDITION detected - likely missing index, using fallback method');
      }
    }

    // Strategy 2: Fallback - search through user's accounts only
    console.log('🔄 [UPDATE→DB Server] Using fallback method - searching through user accounts...');

    try {
      // Get all accounts for this specific user
      const accountsSnapshot = await adminDb.collection('user_profiles').doc(userId).collection('accounts').get();
      console.log(`🔍 [UPDATE→DB Server] Found ${accountsSnapshot.size} accounts for user ${userId}`);

      for (const accountDoc of accountsSnapshot.docs) {
        const accountId = accountDoc.id;
        console.log(`🔍 [UPDATE→DB Server] Checking account: ${accountId}`);

        // Get all transactions for this account
        const transactionsSnapshot = await adminDb
          .collection('user_profiles')
          .doc(userId)
          .collection('accounts')
          .doc(accountId)
          .collection('transactions')
          .get();

        console.log(`🔍 [UPDATE→DB Server] Found ${transactionsSnapshot.size} transactions for account ${accountId}`);

        // Find the specific transaction
        const targetTransaction = transactionsSnapshot.docs.find((doc) => {
          const data = doc.data();
          return data.trans_id === transactionId;
        });

        if (targetTransaction) {
          console.log('✅ [UPDATE→DB Server] Found transaction via fallback method');
          const docRef = targetTransaction.ref;
          const updateData: any = stripUndefinedDeep({
            ...updates,
            ...taxDecisionUpdate(targetTransaction.data(), updates),
            updated_at: new Date(),
          });

          console.log('📝 [UPDATE→DB Server] Updating document at path:', docRef.path);
          await docRef.update(updateData);

          // Read back to verify the update
          const updatedDoc = await docRef.get();
          if (updatedDoc.exists) {
            const data = updatedDoc.data();
            console.log('✅ [READBACK←DB Server] Update verified:', {
              trans_id: data?.trans_id,
              is_deductible: data?.is_deductible,
              deductible_reason: data?.deductible_reason,
              deduction_score: data?.deduction_score,
            });
            return { data: [data], error: null };
          }

          return { data: null, error: new Error('Failed to verify update') };
        }
      }

      console.error('❌ [UPDATE→DB Server] Transaction not found in user accounts');
      return { data: null, error: new Error('Transaction not found') };
    } catch (fallbackError: any) {
      console.error('❌ [UPDATE→DB Server] Fallback method failed:', fallbackError);
      console.error('❌ [UPDATE→DB Server] Fallback error code:', fallbackError.code);
      console.error('❌ [UPDATE→DB Server] Fallback error message:', fallbackError.message);
      throw fallbackError;
    }
  } catch (error: any) {
    console.error('❌ [UPDATE→DB Server] Update failed:', error);
    console.error('❌ [UPDATE→DB Server] Error type:', typeof error);
    console.error('❌ [UPDATE→DB Server] Error code:', error.code);
    console.error('❌ [UPDATE→DB Server] Error message:', error.message);

    // Handle specific Firebase errors
    if (error.code === 9 || error.code === 'FAILED_PRECONDITION') {
      console.error('❌ [UPDATE→DB Server] FAILED_PRECONDITION - This could be due to:');
      console.error('   - Missing composite index for collectionGroup query');
      console.error('   - Security rules preventing the operation');
      console.error('   - Invalid query structure');
      return {
        data: null,
        error: {
          code: 'FAILED_PRECONDITION',
          message: 'Database operation failed. This may be due to missing indexes or security rules.',
          details: error.message,
        },
      };
    } else if (error.code === 'permission-denied') {
      console.error('❌ [UPDATE→DB Server] Permission denied - check Firestore rules');
      return {
        data: null,
        error: {
          code: 'permission-denied',
          message: 'Permission denied. Check Firestore security rules.',
          details: error.message,
        },
      };
    } else if (error.code === 'unavailable') {
      console.error('❌ [UPDATE→DB Server] Firebase service unavailable');
      return {
        data: null,
        error: {
          code: 'unavailable',
          message: 'Database service temporarily unavailable.',
          details: error.message,
        },
      };
    }

    return { data: null, error };
  }
}

/**
 * Update core transaction fields from Plaid (used by Transactions Sync API for "modified").
 * Finds transaction by userId + trans_id via collectionGroup, then updates only the given fields.
 */
export async function updateTransactionFromPlaidServer(
  userId: string,
  transactionId: string,
  plaidFields: {
    date?: string;
    amount?: number;
    merchant_name?: string;
    category?: string;
    description?: string;
  }
): Promise<{ data: any; error: any }> {
  try {
    const transactionsQuery = adminDb
      .collectionGroup('transactions')
      .where('userId', '==', userId)
      .where('trans_id', '==', transactionId)
      .limit(1);
    const querySnapshot = await transactionsQuery.get();
    if (querySnapshot.empty) {
      return { data: null, error: new Error('Transaction not found') };
    }
    const docRef = querySnapshot.docs[0].ref;
    const updateData: any = {
      ...plaidFields,
      updated_at: new Date(),
    };
    Object.keys(updateData).forEach((k) => updateData[k] === undefined && delete updateData[k]);
    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    return { data: updatedDoc.exists ? updatedDoc.data() : null, error: null };
  } catch (error: any) {
    console.error('❌ [updateTransactionFromPlaidServer]', error);
    return { data: null, error };
  }
}

/**
 * Delete a transaction by userId and trans_id (used by Transactions Sync API for "removed").
 */
export async function deleteTransactionByUserIdAndTransId(
  userId: string,
  transactionId: string
): Promise<{ deleted: boolean; error: any }> {
  try {
    const transactionsQuery = adminDb
      .collectionGroup('transactions')
      .where('userId', '==', userId)
      .where('trans_id', '==', transactionId)
      .limit(1);
    const querySnapshot = await transactionsQuery.get();
    if (querySnapshot.empty) {
      return { deleted: false, error: null };
    }
    const docRef = querySnapshot.docs[0].ref;
    await docRef.delete();
    return { deleted: true, error: null };
  } catch (error: any) {
    console.error('❌ [deleteTransactionByUserIdAndTransId]', error);
    return { deleted: false, error };
  }
}

/**
 * Paginated transactions using collectionGroup with optional filters.
 * NOTE: offset-based pagination used for simplicity — consider cursor-based for large datasets.
 */
export async function getPaginatedTransactionsServer(
  userId: string,
  options: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
    category?: string;
    amountMin?: number;
    amountMax?: number;
  }
): Promise<{ data: Transaction[]; error: any; pagination: any }> {
  try {
    console.log('🔍 [Firebase Server] Fetching paginated transactions for user:', userId, options);

    const {
      page,
      limit,
      status,
      search,
      sortBy = 'updated_at',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
      category,
      amountMin,
      amountMax,
    } = options;
    const offset = (page - 1) * limit;

    let query: any = adminDb.collectionGroup('transactions').where('userId', '==', userId);

    // Date range filter (use date orderBy when filtering by date for index compatibility)
    const useDateRange = dateFrom && dateTo;
    if (useDateRange) {
      query = query.where('date', '>=', dateFrom).where('date', '<=', dateTo);
    }

    // Apply status filter if specified
    if (status && status !== 'all') {
      if (status === 'deductible') {
        query = query.where('is_deductible', '==', true);
      } else if (status === 'personal') {
        query = query.where('is_deductible', '==', false);
      } else if (status === 'pending') {
        query = query.where('is_deductible', '==', null);
      }
    }

    // Apply sorting (when using date range, orderBy must be date)
    const effectiveSortBy = useDateRange ? 'date' : sortBy;
    if (effectiveSortBy === 'updated_at') {
      query = query.orderBy('updated_at', sortOrder);
    } else if (effectiveSortBy === 'date') {
      query = query.orderBy('date', sortOrder);
    } else if (effectiveSortBy === 'amount') {
      query = query.orderBy('amount', sortOrder);
    } else if (effectiveSortBy === 'merchant_name') {
      query = query.orderBy('merchant_name', sortOrder);
    }

    // Total count via aggregation: billed per 1,000 index entries instead of one read per document.
    const countQuery = query;
    const countSnapshot = await countQuery.count().get();
    const totalCount: number = countSnapshot.data().count;

    // Apply pagination (offset-based)
    query = query.limit(limit);
    if (offset > 0) {
      // Skipped rows are still billed as reads, so page numbers should stay small; the projection
      // keeps the skip cheap on payload. Cursor paging lives in getTransactionsServer({ limit, cursor }).
      const skipSnapshot = await countQuery.select(effectiveSortBy).limit(offset).get();
      const lastDoc = skipSnapshot.docs[skipSnapshot.docs.length - 1];
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
    }

    const querySnapshot = await query.get();
    console.log(`📊 [Firebase Server] Found ${querySnapshot.size} transactions for page ${page}`);

    const transactions: Transaction[] = [];
    querySnapshot.forEach((doc: any) => {
      const data = doc.data();
      // Superseded duplicates of an earlier reviewed record never reach a list; like the other in-memory filters below.
      if (isSupersededRecord(data)) return;
      const transaction: Transaction = {
        id: data.trans_id || doc.id,
        trans_id: data.trans_id || doc.id,
        merchant_name: data.merchant_name || '',
        amount: data.amount || 0,
        category: data.category || '',
        date: data.date || '',
        type: data.amount < 0 ? 'income' : 'expense',
        is_deductible: data.is_deductible,
        deductible_reason: data.deductible_reason || null,
        deduction_score: data.deduction_score || null,
        ai_analysis: data.ai_analysis || null,
        user_classification_reason: data.user_classification_reason || null,
        description: data.description,
        notes: data.notes,
        receipt_url: data.receipt_url,
        receipt_filename: data.receipt_filename,

        account_id: data.account_id,
        userId: data.userId || data.user_id,
        analyzed: data.analyzed,
        analysisStatus: data.analysis_status || data.analysisStatus, // Support both field names
        transactionHash: data.transactionHash,
        analysisStartedAt: data.analysisStartedAt,
        analysisCompletedAt: data.analysisCompletedAt,
        created_at: data.created_at,
        updated_at: data.updated_at,

        // Include AI analysis data
        ai: data.ai || null,
    ...reviewHydrationFields(data),
      };

      // Apply search filter if specified
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !transaction.merchant_name.toLowerCase().includes(searchLower) &&
          !transaction.category.toLowerCase().includes(searchLower) &&
          !(transaction.notes && transaction.notes.toLowerCase().includes(searchLower))
        ) {
          return;
        }
      }
      // In-memory filters for category and amount (date range already in query)
      if (category && category !== 'all' && transaction.category !== category) return;
      if (amountMin != null && transaction.amount < amountMin) return;
      if (amountMax != null && transaction.amount > amountMax) return;
      transactions.push(transaction);
    });

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    const pagination = {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage,
      hasPrevPage,
      offset,
    };

    console.log('✅ [Firebase Server] Successfully processed paginated transactions:', {
      count: transactions.length,
      pagination,
    });

    return {
      data: transactions,
      error: null,
      pagination,
    };
  } catch (error: any) {
    console.error('❌ [Firebase Server] Error getting paginated transactions:', error);

    // Handle specific Firebase errors
    if (error.code === 'permission-denied') {
      return {
        data: [],
        error: { code: 'permission-denied', message: 'Permission denied. Check Firestore security rules.' },
        pagination: null,
      };
    } else if (error.code === 'unavailable') {
      return {
        data: [],
        error: { code: 'unavailable', message: 'Database service temporarily unavailable.' },
        pagination: null,
      };
    } else if (error.code === 'failed-precondition') {
      return {
        data: [],
        error: { code: 'failed-precondition', message: 'Database query failed. Missing required index.' },
        pagination: null,
      };
    }

    return { data: [], error, pagination: null };
  }
}

/**
 * Create a new transaction under user_profiles/{userId}/accounts/{accountId}/transactions/{transId}
 */
export async function createTransactionServer(
  userId: string,
  accountId: string,
  transactionData: Partial<Transaction>
): Promise<{ data: Transaction | null; error: any }> {
  try {
    const transId = transactionData.trans_id || `trans_${Date.now()}`;
    const docRef = adminDb
      .collection('user_profiles')
      .doc(userId)
      .collection('accounts')
      .doc(accountId)
      .collection('transactions')
      .doc(transId);

    // Check if transaction already exists
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      console.log(`🔄 [createTransactionServer] Transaction ${transId} already exists, skipping creation`);
      const existingData = existingDoc.data();
      return {
        data: {
          id: existingData?.trans_id || existingDoc.id,
          trans_id: existingData?.trans_id || existingDoc.id,
          merchant_name: existingData?.merchant_name || '',
          amount: existingData?.amount || 0,
          category: existingData?.category || '',
          date: existingData?.date || '',
          type: existingData?.amount < 0 ? 'income' : 'expense',
          is_deductible: existingData?.is_deductible,
          deductible_reason: existingData?.deductible_reason,
          deduction_score: existingData?.deduction_score,
          description: existingData?.description,
          notes: existingData?.notes,
          receipt_url: existingData?.receipt_url,
          receipt_filename: existingData?.receipt_filename,
          analyzed: existingData?.analyzed,
          analysis_status: existingData?.analysis_status,
          analysisStatus: existingData?.analysisStatus,
          ai: existingData?.ai,
          userId: existingData?.userId || existingData?.user_id,
          account_id: existingData?.account_id,
          created_at: existingData?.created_at,
          updated_at: existingData?.updated_at,
          business_purpose: existingData?.business_purpose,
          attendees: existingData?.attendees,
          travel_destination: existingData?.travel_destination,
          equipment_details: existingData?.equipment_details,
          client_project: existingData?.client_project,
          documentation_status: existingData?.documentation_status,
          meeting_notes: existingData?.meeting_notes,
          mileage_details: existingData?.mileage_details,
        } as Transaction,
        error: null
      };
    }

    const cleanTransactionData = stripUndefinedDeep(transactionData);

    const newTransaction = {
      ...cleanTransactionData,
      trans_id: transId,
      userId: userId,
      account_id: accountId,
      analyzed: transactionData.analyzed || false,
      analysisStatus: transactionData.analysisStatus || 'pending',
      transactionHash: transactionData.transactionHash || null,
      analysisStartedAt: transactionData.analysisStartedAt || null,
      analysisCompletedAt: transactionData.analysisCompletedAt || null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await docRef.set(newTransaction);

    // Return the created transaction
    const createdDoc = await docRef.get();
    if (createdDoc.exists) {
      const data = createdDoc.data();
      return {
        data: {
          id: data?.trans_id || createdDoc.id,
          trans_id: data?.trans_id || createdDoc.id,
          merchant_name: data?.merchant_name || '',
          amount: data?.amount || 0,
          category: data?.category || '',
          date: data?.date || '',
          type: data?.amount < 0 ? 'income' : 'expense',
          is_deductible: data?.is_deductible,
          deductible_reason: data?.deductible_reason,
          deduction_score: data?.deduction_score,
          description: data?.description,
          notes: data?.notes,
          receipt_url: data?.receipt_url,
          receipt_filename: data?.receipt_filename,

          account_id: data?.account_id,
          userId: data?.userId || data?.user_id,
          analyzed: data?.analyzed,
          analysisStatus: data?.analysisStatus,
          transactionHash: data?.transactionHash,
          analysisStartedAt: data?.analysisStartedAt,
          analysisCompletedAt: data?.analysisCompletedAt,
          created_at: data?.created_at,
          updated_at: data?.updated_at,
        } as Transaction,
        error: null,
      };
    }

    return { data: null, error: new Error('Failed to retrieve created transaction') };
  } catch (error: any) {
    console.error('Error creating transaction (server):', error);
    return { data: null, error };
  }
}
