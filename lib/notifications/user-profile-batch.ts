import { FieldPath } from 'firebase-admin/firestore';

/** Page size for "iterate all user_profiles" jobs. */
export const USER_PROFILE_PAGE_SIZE = 200;
/** Default wall-clock budget; leaves headroom under the 60 s Hosting SSR limit. */
export const DEFAULT_BATCH_TIME_BUDGET_MS = 50_000;

export interface BatchOptions {
  pageSize?: number;
  timeBudgetMs?: number;
  /** `nextCursor` from a previous incomplete run. */
  cursor?: string | null;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface BatchResult {
  /** Profiles handed to the handler (including ones whose handler threw). */
  processed: number;
  failures: number;
  pages: number;
  /** True when the last page was exhausted; false when the time budget stopped the run. */
  complete: boolean;
  /** Resume marker for the next run; `null` once the whole collection was covered. */
  nextCursor: string | null;
  elapsedMs: number;
}

/**
 * Minimal query surface used by the pager, so tests can supply an in-memory fake and production
 * passes a `FirebaseFirestore.Query`.
 */
export interface PageableQuery {
  orderBy(field: string | FieldPath, direction?: 'asc' | 'desc'): PageableQuery;
  startAfter(...values: unknown[]): PageableQuery;
  limit(count: number): PageableQuery;
  get(): Promise<{ docs: PageDocument[] }>;
}

export interface PageDocument {
  id: string;
  data(): Record<string, any>;
  get(field: string): unknown;
}

interface CursorPayload { id: string; values: unknown[] }

export function encodeBatchCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeBatchCursor(cursor: string | null | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.id !== 'string' || !Array.isArray(parsed.values)) return null;
    return { id: parsed.id, values: parsed.values };
  } catch {
    return null;
  }
}

/**
 * Iterate a `user_profiles` query in pages of `pageSize`, ordered by `orderField` (required to be the
 * range-filtered field when the base query has one) and then document ID, stopping once the time
 * budget is spent. Each page costs one query; the cursor lets the next run resume where this one stopped.
 */
export async function runUserProfileBatch(
  base: PageableQuery,
  orderField: string | null,
  handler: (doc: PageDocument) => Promise<void>,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const now = options.now ?? Date.now;
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? USER_PROFILE_PAGE_SIZE));
  const budgetMs = options.timeBudgetMs ?? DEFAULT_BATCH_TIME_BUDGET_MS;
  const startedAt = now();
  let cursor = decodeBatchCursor(options.cursor);
  const result: BatchResult = { processed: 0, failures: 0, pages: 0, complete: false, nextCursor: null, elapsedMs: 0 };

  for (;;) {
    let query = orderField ? base.orderBy(orderField).orderBy(FieldPath.documentId()) : base.orderBy(FieldPath.documentId());
    if (cursor) query = orderField ? query.startAfter(...cursor.values, cursor.id) : query.startAfter(cursor.id);
    const { docs } = await query.limit(pageSize).get();
    result.pages++;

    let stoppedMidPage = false;
    for (const doc of docs) {
      result.processed++;
      try {
        await handler(doc);
      } catch (error) {
        result.failures++;
        console.error('[user-profile-batch] handler failed for profile', doc.id, error);
      }
      // The cursor always names the last profile handed to the handler, so a resume skips nothing.
      cursor = { id: doc.id, values: orderField ? [doc.get(orderField)] : [] };
      if (now() - startedAt >= budgetMs) {
        stoppedMidPage = doc !== docs[docs.length - 1];
        break;
      }
    }

    const fullPage = docs.length >= pageSize;
    if (!fullPage && !stoppedMidPage) {
      result.complete = true;
      break;
    }
    if (now() - startedAt >= budgetMs) {
      result.complete = false;
      break;
    }
  }

  result.nextCursor = result.complete ? null : cursor ? encodeBatchCursor(cursor) : null;
  result.elapsedMs = now() - startedAt;
  return result;
}
