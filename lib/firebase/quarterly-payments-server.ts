import { adminDb } from '@/lib/firebase/admin';

export interface RecordedQuarterlyPayment {
  quarter: 1 | 2 | 3 | 4;
  paidAmount: number;
  record: Record<string, unknown> | null;
}

export function paymentAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : 0;
}

const LEGACY_PAYMENT_DOC_ID = /^Q([1-4])_(\d{4})$/;

export function isLegacyQuarterlyPaymentId(id: string): boolean {
  return LEGACY_PAYMENT_DOC_ID.test(id);
}

function quarterOf(value: unknown): 1 | 2 | 3 | 4 | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function integerYear(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
}

function superseded(record: Record<string, unknown>): boolean {
  return typeof record.supersededBy === 'string' && record.supersededBy.length > 0;
}

/** Tax year a separately stored payment counts toward. Legacy Q{n}_{year} docs keep the year in their id. */
function paymentTaxYear(record: Record<string, unknown>, fallbackYear: number): number {
  return integerYear(record.designatedTaxYear) ?? integerYear(record.year) ?? fallbackYear;
}

/**
 * Read owner-scoped quarterly payments. Legacy Q{n}_{year} documents are still read by that id.
 * A legacy document with supersededBy is the user's edited record and is not counted.
 * Separately stored payments count toward the tax year they were saved for.
 * No writes on reads.
 */
export async function getRecordedQuarterlyPayments(userId: string, year: number): Promise<RecordedQuarterlyPayment[]> {
  const collection = adminDb.collection('user_profiles').doc(userId).collection('quarterly_payments');
  const legacy = await Promise.all(([1, 2, 3, 4] as const).map(async quarter => {
    const snapshot = await collection.doc(`Q${quarter}_${year}`).get();
    return { quarter, snapshot };
  }));
  const listed = await collection.get();
  const payments: RecordedQuarterlyPayment[] = [];
  for (const item of legacy) {
    if (!item.snapshot.exists) continue;
    const record = item.snapshot.data() ?? null;
    if (!record || superseded(record)) continue;
    payments.push({ quarter: item.quarter, paidAmount: paymentAmount(record.paidAmount), record });
  }
  for (const doc of listed.docs) {
    if (isLegacyQuarterlyPaymentId(doc.id)) continue;
    const record = doc.data() ?? null;
    if (!record || superseded(record) || paymentTaxYear(record, year) !== year) continue;
    const quarter = quarterOf(record.quarter);
    if (!quarter) continue;
    payments.push({ quarter, paidAmount: paymentAmount(record.paidAmount), record });
  }
  return payments;
}

export function totalRecordedPayments(payments: RecordedQuarterlyPayment[]): number {
  return payments.reduce((sum, payment) => sum + Math.round(payment.paidAmount * 100), 0) / 100;
}
