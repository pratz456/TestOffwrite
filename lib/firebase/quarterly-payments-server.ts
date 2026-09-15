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

/** Read the same owner-scoped records written by the payment-tracking screen. No writes on reads. */
export async function getRecordedQuarterlyPayments(userId: string, year: number): Promise<RecordedQuarterlyPayment[]> {
  const collection = adminDb.collection('user_profiles').doc(userId).collection('quarterly_payments');
  return Promise.all(([1, 2, 3, 4] as const).map(async quarter => {
    const snapshot = await collection.doc(`Q${quarter}_${year}`).get();
    const record = snapshot.exists ? snapshot.data() ?? null : null;
    return { quarter, paidAmount: paymentAmount(record?.paidAmount), record };
  }));
}

export function totalRecordedPayments(payments: RecordedQuarterlyPayment[]): number {
  return payments.reduce((sum, payment) => sum + Math.round(payment.paidAmount * 100), 0) / 100;
}
