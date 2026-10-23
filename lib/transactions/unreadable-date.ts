import { FieldValue } from 'firebase-admin/firestore';
import { UNREADABLE_DATE_REASON } from '@/lib/receipts/receipt-date';
import { safeYMD } from '@/lib/schedule-c/taxDate';

/**
 * When a write sets a readable calendar day on a row held only because the
 * date could not be read, clear that hold in the same write. Any other
 * status, including Needs more information for a different reason or an older
 * row with no reason, is left untouched. Callers then apply their normal
 * status update, if they have one; a date by itself does not invent a status.
 */
export function clearUnreadableDateHold(
  record: { statusReason?: unknown } | null | undefined,
  updates: { date?: unknown },
): { deductionStatus?: FieldValue; statusReason?: FieldValue } {
  if (typeof updates.date !== 'string' || safeYMD(updates.date) !== updates.date) return {};
  if (record?.statusReason !== UNREADABLE_DATE_REASON) return {};
  return { deductionStatus: FieldValue.delete(), statusReason: FieldValue.delete() };
}
