/**
 * Which saved transaction records count.
 *
 * Every total, review queue and export reader shares these predicates so a
 * record excluded for one reason is excluded everywhere:
 * - pending: the bank has not posted it yet;
 * - bank_removed: the bank withdrew it (the sync also sets pending, which is
 *   why older callers that only check `pending` still exclude it);
 * - superseded: a relinked bank re-imported a purchase the owner already
 *   reviewed on an earlier record (see historical-overlap.ts).
 */
import { isSupersededRecord, type SupersedableRecord } from './historical-overlap';

export { isSupersededRecord };

export type ScopedRecord = SupersedableRecord & { pending?: unknown; bank_removed?: unknown };

export function isBankRemovedRecord(record: ScopedRecord | null | undefined): boolean {
  return record?.bank_removed === true;
}

/** Posted, still reported by the bank, and not superseded by an earlier record. */
export function isCountableRecord(record: ScopedRecord | null | undefined): boolean {
  return !!record && record.pending !== true && !isBankRemovedRecord(record) && !isSupersededRecord(record);
}
