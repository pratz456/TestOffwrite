import { adminDb } from './admin';
import type { TaxFilingSummary, TaxFilingStatus } from '../tax-provider/types';

export interface TaxFilingSessionRecord {
  sessionId: string;
  userId: string;
  provider: string;
  taxYear: string;
  status: TaxFilingStatus;
  redirectAttemptCount: number;
  lastUpdatedAt: Date;
  createdAt: Date;
  summary?: TaxFilingSummary;
}

const COLLECTION = 'user_tax_filing_sessions';

export async function createTaxFilingSession(input: {
  userId: string;
  provider: string;
  taxYear: string;
  summary: TaxFilingSummary;
}): Promise<TaxFilingSessionRecord> {
  const sessionDoc = adminDb.collection(COLLECTION).doc();
  const now = new Date();

  const record: Omit<TaxFilingSessionRecord, 'sessionId'> = {
    userId: input.userId,
    provider: input.provider,
    taxYear: input.taxYear,
    // The only time we create a session in the current flow is after the user confirms redirect.
    // Marking as redirected improves transparency and analytics correlation.
    status: 'redirected',
    redirectAttemptCount: 1,
    createdAt: now,
    lastUpdatedAt: now,
    summary: input.summary,
  };

  await sessionDoc.set(record);

  return {
    sessionId: sessionDoc.id,
    ...record,
  };
}

export async function getTaxFilingSessionById(sessionId: string) {
  const doc = await adminDb.collection(COLLECTION).doc(sessionId).get();
  if (!doc.exists) return null;
  return { sessionId: doc.id, ...(doc.data() || {}) } as TaxFilingSessionRecord & {
    summary?: TaxFilingSummary;
  };
}

export async function updateTaxFilingSession(input: {
  sessionId: string;
  status: TaxFilingStatus;
  provider?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  await adminDb
    .collection(COLLECTION)
    .doc(input.sessionId)
    .update({
      status: input.status,
      provider: input.provider,
      lastUpdatedAt: now,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
}

