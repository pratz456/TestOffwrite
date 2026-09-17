import { adminDb } from '@/lib/firebase/admin';
import { readOwnedYearRecords } from '@/lib/reports/export-records';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import type { IncomeRecord } from '@/lib/tax-rules/business-income';
import type { IncomeSourceRef, ReconciliationDecisionType } from '@/lib/tax-rules/income-reconciliation';

/** Server-only collection: `income_reconciliations/{id}`; clients never read or write it directly. */
export const INCOME_RECONCILIATIONS_COLLECTION = 'income_reconciliations';

export class IncomeReconciliationAccessError extends Error {
  constructor(message: string, readonly status: 403 | 404) { super(message); }
}

/** Saved decisions for one owner and tax year; the shared reader fails closed on ownership conflicts. */
export function readIncomeReconciliationDecisions(uid: string, taxYear: number): Promise<IncomeRecord[]> {
  return readOwnedYearRecords(uid, INCOME_RECONCILIATIONS_COLLECTION, taxYear);
}

/** Every record the reconciliation engine considers for a tax year, all owner-scoped. */
export async function readIncomeSourceRecords(uid: string, taxYear: number) {
  const [transactions, receipts, forms, decisions] = await Promise.all([
    readTaxExportTransactions(uid, taxYear),
    readOwnedYearRecords(uid, 'gross_receipts', taxYear),
    readOwnedYearRecords(uid, 'income_1099', taxYear),
    readIncomeReconciliationDecisions(uid, taxYear),
  ]);
  return { transactions: transactions as IncomeRecord[], receipts, forms, decisions };
}

export interface StoredDecisionInput {
  taxYear: number;
  decision: ReconciliationDecisionType;
  sources: Array<IncomeSourceRef & { label: string }>;
  platformFeeAmount: number;
  note: string;
  countedAmount: number;
}

function decisionData(uid: string, input: StoredDecisionInput, now: Date) {
  return {
    userId: uid, taxYear: input.taxYear, decision: input.decision, sources: input.sources,
    platformFeeAmount: input.platformFeeAmount || null, note: input.note, countedAmount: input.countedAmount,
    decidedBy: uid, decidedAt: now.toISOString(), updatedAt: now, version: 1,
  };
}

export async function createIncomeReconciliationDecision(uid: string, input: StoredDecisionInput): Promise<string> {
  const now = new Date();
  const ref = await adminDb.collection(INCOME_RECONCILIATIONS_COLLECTION).add({ ...decisionData(uid, input, now), createdAt: now });
  return ref.id;
}

async function ownedDecisionRef(uid: string, id: string) {
  const ref = adminDb.collection(INCOME_RECONCILIATIONS_COLLECTION).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new IncomeReconciliationAccessError('Reconciliation decision not found', 404);
  if (snapshot.data()?.userId !== uid) throw new IncomeReconciliationAccessError('Forbidden', 403);
  return { ref, data: snapshot.data() as Record<string, unknown> };
}

/** One saved decision, only when `uid` owns it (403 otherwise, 404 when missing). */
export async function getOwnedIncomeReconciliationDecision(uid: string, id: string): Promise<IncomeRecord> {
  const { data } = await ownedDecisionRef(uid, id);
  return { ...data, id };
}

/** Replaces the decision body; the original creation time is retained as history. */
export async function updateIncomeReconciliationDecision(uid: string, id: string, input: StoredDecisionInput): Promise<void> {
  const { ref, data } = await ownedDecisionRef(uid, id);
  await ref.set({ ...decisionData(uid, input, new Date()), createdAt: data.createdAt ?? new Date() });
}

export async function deleteIncomeReconciliationDecision(uid: string, id: string): Promise<void> {
  const { ref } = await ownedDecisionRef(uid, id);
  await ref.delete();
}
