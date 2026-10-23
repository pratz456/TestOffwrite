import { safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';

/** Holding bucket for a saved receipt whose calendar day is still unset. */
export const NEEDS_MORE_INFORMATION = 'Needs more information';

export interface ReceiptDatePlacement {
  /** Stored calendar day, or an empty string when the printed date is unset. */
  date: string;
  taxYear: number | null;
  /** Set when the receipt is saved with an amount and no calendar day. */
  status: typeof NEEDS_MORE_INFORMATION | null;
}

/**
 * The calendar day to store for a receipt.
 * An unreadable or ambiguous value stays empty. Today, the upload time and the
 * file timestamp are never substituted.
 */
export function placeReceiptDate(dateLike: unknown): ReceiptDatePlacement {
  const date = safeYMD(dateLike) ?? '';
  const taxYear = date ? safeTaxYear(date) : null;
  return { date, taxYear, status: date ? null : NEEDS_MORE_INFORMATION };
}

/**
 * Year totals include only receipts with a calendar day. Undated receipts stay
 * in Needs more information so their amounts are not dropped from every year.
 */
export function summarizeReceiptYears<T extends { amount: number; date?: unknown }>(records: readonly T[]) {
  const needsMoreInformation = { label: NEEDS_MORE_INFORMATION, count: 0, amount: 0 };
  const years = new Map<number, { count: number; amount: number }>();
  for (const record of records) {
    const place = placeReceiptDate(record.date);
    const amount = Number(record.amount);
    const cents = Number.isFinite(amount) ? amount : 0;
    if (place.status) {
      needsMoreInformation.count += 1;
      needsMoreInformation.amount += cents;
      continue;
    }
    const bucket = years.get(place.taxYear!) ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += cents;
    years.set(place.taxYear!, bucket);
  }
  return { needsMoreInformation, years };
}
