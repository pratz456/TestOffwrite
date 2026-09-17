/**
 * Server-confirmed deduction contract shared by Schedule C aggregation, review
 * flags and dashboard summaries.
 *
 * Firestore rules let the owner write `is_deductible` directly, while
 * `review_status`, `tax_review_required` and `ai_suggestion` are server-only.
 * A confirmed total therefore trusts `is_deductible === true` only when the
 * server recorded the decision (`review_status === 'confirmed'`), or for a
 * legacy record confirmed before the server began stamping every decision.
 */
export const LEGACY_CONFIRMATION_CUTOFF = '2026-09-18T00:00:00.000Z';

/** Any of these fields means the record went through the server review pipeline. */
const REVIEW_PIPELINE_FIELDS = ['review_status', 'review_source', 'review_suggestion_id', 'reviewed_at', 'ai_suggestion'] as const;

export interface ConfirmableRecord {
  is_deductible?: boolean | null;
  tax_review_required?: boolean;
  review_status?: unknown;
  created_at?: unknown;
  date?: unknown;
  [key: string]: unknown;
}

/** Firestore Timestamp (admin/client/JSON), Date, ISO string or epoch milliseconds → ms. */
export function recordTimestampMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Date-only strings are calendar dates; read them as UTC midnight, not local time.
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value && typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof candidate.toMillis === 'function') return recordTimestampMs(candidate.toMillis());
    if (typeof candidate.toDate === 'function') return recordTimestampMs(candidate.toDate());
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

/**
 * Legacy confirmation: a boolean decision saved before the cutoff, with no review
 * pipeline fields. Creation time comes from the server-set `created_at`; records
 * without one (older code paths) fall back to the transaction date. Clients can
 * neither create records nor edit `created_at`, so a post-cutoff record cannot
 * be made to look legacy.
 */
export function isLegacyConfirmedRecord(record: ConfirmableRecord, cutoff: string = LEGACY_CONFIRMATION_CUTOFF): boolean {
  if (typeof record.is_deductible !== 'boolean') return false;
  if (REVIEW_PIPELINE_FIELDS.some(field => record[field] !== undefined && record[field] !== null)) return false;
  const createdAt = recordTimestampMs(record.created_at) ?? recordTimestampMs(record.date);
  const cutoffMs = recordTimestampMs(cutoff);
  return createdAt !== null && cutoffMs !== null && createdAt < cutoffMs;
}

/** True when a deduction may enter confirmed totals without further tax review. */
export function isServerConfirmedDeduction(record: ConfirmableRecord, cutoff: string = LEGACY_CONFIRMATION_CUTOFF): boolean {
  if (record.is_deductible !== true || record.tax_review_required === true) return false;
  if (record.review_status === 'confirmed') return true;
  return isLegacyConfirmedRecord(record, cutoff);
}
