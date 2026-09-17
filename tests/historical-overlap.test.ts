import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';

const state = vi.hoisted(() => ({ db: null as unknown as FakeFirestore }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (path: string) => state.db.collection(path),
    collectionGroup: (name: string) => state.db.collectionGroup(name),
    doc: (path: string) => state.db.doc(path),
  },
}));

import { buildProductionMigrationInventory } from '../scripts/production-migration-inventory.mjs';
import {
  assertConsistentHistoricalOverlapDecisions, HistoricalOverlapError, isOverlapCandidateRecord, matchHistoricalOverlaps, overlapCandidateKey, overlapKey,
  OVERLAP_SERVER_ONLY_FIELDS, parseTransactionRecordPath, planHistoricalOverlapDecision, type HistoricalOverlapDecision, type OverlapRecord,
} from '@/lib/transactions/historical-overlap';
import { isBankRemovedRecord, isCountableRecord, isSupersededRecord } from '@/lib/transactions/record-scope';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { readOwnedTransactions } from '@/lib/reports/export-records';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { assembleAuditSupportPacket, readAuditSupportPacket } from '@/lib/reports/audit-support-packet';
import { listIncomeSourceCandidates } from '@/lib/tax-rules/business-income';
import { loadConfirmedTransactionRecords } from '@/lib/ai/taxpayer-context-server';
import { summarizeDashboardRecords } from '@/lib/dashboard/record-summary';
import type { ExportRecord } from '@/lib/reports/transaction-export';

const uid = 'legacy-user';
const OLD = 'old-account';
const NEW = 'relinked-account';
const recordPath = (account: string, id: string) => `user_profiles/${uid}/accounts/${account}/transactions/${id}`;
const CANONICAL = recordPath(OLD, 'old-coffee');
const CANDIDATE = recordPath(NEW, 'new-coffee');
const now = new Date('2026-09-17T12:00:00.000Z');

/** A posted bank purchase the owner confirmed on the old Item; overrides describe the relinked copy. */
function purchase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: uid, date: '2026-03-10', amount: 42.5, merchant_name: 'Coffee Shop', iso_currency_code: 'USD', pending: false,
    category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true, review_status: 'confirmed', reviewed_at: '2026-04-01T12:00:00.000Z', ...overrides,
  };
}
const record = (path: string, data: Record<string, unknown>): OverlapRecord => ({ path, data });
const duplicate = (overrides: Partial<HistoricalOverlapDecision> = {}): HistoricalOverlapDecision => ({ canonical: CANONICAL, candidate: CANDIDATE, decision: 'duplicate', ...overrides });
function plan(decision: HistoricalOverlapDecision, canonical: Record<string, unknown> | null = purchase({ trans_id: 'old-plaid-id' }), candidate: Record<string, unknown> | null = purchase({ trans_id: 'new-plaid-id', review_status: undefined, is_deductible: null, reviewed_at: undefined })) {
  return planHistoricalOverlapDecision(decision, {
    canonical: canonical && record(decision.canonical, canonical),
    candidate: candidate && record(decision.candidate, candidate),
  }, { decisionId: 'decision-1', now });
}
const refusal = (work: () => unknown) => {
  try { work(); } catch (error) { if (error instanceof HistoricalOverlapError) return error.code; throw error; }
  return 'accepted';
};

describe('overlap key parity with the read-only inventory', () => {
  it('normalizes date, cents, merchant text and currency the same way for every writer', () => {
    const base = overlapKey({ date: '2026-03-10', amount: 42.5, merchant_name: 'coffee shop', iso_currency_code: 'usd' });
    expect(base).toBe(JSON.stringify(['2026-03-10', 4250, 'coffee shop', 'USD']));
    expect(overlapKey({ date: '2026-03-10T00:00:00Z', amount: '42.50', name: '  COFFEE\u00a0 Shop ', iso_currency_code: 'USD' })).toBe(base);
    expect(overlapKey({ date: '2026-03-10', amount: 42.5, description: 'Coffee Shop', unofficial_currency_code: 'usd' })).toBe(base);
    expect(overlapKey({ date: '2026-03-10', amount: 42.5, merchant_name: 'Coffee Shop', iso_currency_code: 'EUR' })).not.toBe(base);
    expect(overlapKey({ date: '2026-03-10', amount: 42.51, merchant_name: 'Coffee Shop', iso_currency_code: 'USD' })).not.toBe(base);
    expect(overlapKey({ date: '2026-03-11', amount: 42.5, merchant_name: 'Coffee Shop', iso_currency_code: 'USD' })).not.toBe(base);
    expect(overlapKey({ date: '2026-03-10', amount: -42.5, merchant_name: 'Coffee Shop', iso_currency_code: 'USD' })).not.toBe(base);
    // Incomplete records never key: a null amount is not a zero-dollar purchase.
    expect(overlapKey({ date: '2026-03-10', amount: null, merchant_name: 'Coffee Shop' })).toBeNull();
    expect(overlapKey({ date: '2026-03-10', amount: '', merchant_name: 'Coffee Shop' })).toBeNull();
    expect(overlapKey({ date: 'March 10', amount: 42.5, merchant_name: 'Coffee Shop' })).toBeNull();
    expect(overlapKey({ date: '2026-03-10', amount: 42.5, merchant_name: '   ' })).toBeNull();
    expect(overlapKey({ date: '2026-03-10', amount: 0, merchant_name: 'Coffee Shop' })).toBe(JSON.stringify(['2026-03-10', 0, 'coffee shop', 'UNKNOWN']));
  });

  it('keeps pending, bank-removed, superseded and already-reviewed records out of every candidate group', () => {
    const posted = purchase();
    expect(isOverlapCandidateRecord(posted)).toBe(true);
    expect(overlapCandidateKey(posted)).toBe(overlapKey(posted));
    for (const excluded of [{ pending: true }, { bank_removed: true }, { superseded_by: CANONICAL }, { overlap_reviewed: true }]) {
      expect(isOverlapCandidateRecord(purchase(excluded))).toBe(false);
      expect(overlapCandidateKey(purchase(excluded))).toBeNull();
    }
  });

  it('groups exactly the records the inventory reports for a relinked owner', () => {
    const oldTransactions = [
      { id: 'old-coffee', data: purchase({ merchant_name: 'Coffee Shop' }) },
      { id: 'old-repeat', data: purchase({ merchant_name: 'Coffee Shop', date: '2026-03-11' }) },
      { id: 'old-superseded-never-canonical', data: purchase({ merchant_name: 'Hardware', amount: 80, superseded_by: recordPath('older', 'x') }) },
    ];
    const newTransactions = [
      { id: 'new-coffee', data: purchase({ merchant_name: '  COFFEE  shop', review_status: undefined, is_deductible: null }) },
      { id: 'new-hardware', data: purchase({ merchant_name: 'Hardware', amount: 80, review_status: undefined, is_deductible: null }) },
      { id: 'new-pending', data: purchase({ merchant_name: 'Coffee Shop', pending: true }) },
      { id: 'new-removed', data: purchase({ merchant_name: 'Coffee Shop', bank_removed: true }) },
      { id: 'new-reviewed-distinct', data: purchase({ merchant_name: 'Coffee Shop', overlap_reviewed: true }) },
      { id: 'new-already-superseded', data: purchase({ merchant_name: 'Coffee Shop', superseded_by: CANONICAL }) },
      { id: 'new-other-amount', data: purchase({ merchant_name: 'Coffee Shop', amount: 43 }) },
    ];
    const inventory = buildProductionMigrationInventory({
      sourceCommit: 'a'.repeat(40),
      profiles: [{
        uid,
        data: { plaid_token: 'legacy-secret' },
        accounts: [
          { id: OLD, data: { source: 'plaid', plaid_item_id: 'old-item', access_token: 'legacy-secret' }, transactions: oldTransactions },
          { id: NEW, data: { source: 'plaid', plaid_item_id: 'new-item' }, transactions: newTransactions },
        ],
      }],
    });
    const records = [
      ...oldTransactions.map(tx => record(recordPath(OLD, tx.id), tx.data)),
      ...newTransactions.map(tx => record(recordPath(NEW, tx.id), tx.data)),
    ];
    const groups = matchHistoricalOverlaps({ canonicalScope: [OLD], candidateScope: [NEW], records });
    const inventoryGroups = inventory.profiles[0].potentialHistoricalOverlaps as Array<{ records: Array<{ reference: string }> }>;
    const membership = (paths: string[][]) => paths.map(group => [...group].sort()).sort((a, b) => a.join().localeCompare(b.join()));
    expect(groups).toHaveLength(1);
    expect(membership(groups.map(group => [...group.canonical, ...group.candidates].map(item => item.path))))
      .toEqual(membership(inventoryGroups.map(group => group.records.map(item => item.reference))));
    expect(groups[0].canonical.map(item => item.path)).toEqual([CANONICAL]);
    expect(groups[0].candidates.map(item => item.path)).toEqual([CANDIDATE]);
    // The superseded old record is in no group on either side, so it can never be offered as canonical.
    expect(JSON.stringify([groups, inventoryGroups])).not.toContain('old-superseded-never-canonical');
  });

  it('scopes legacy root records by their recorded account and ignores paths that are not transaction records', () => {
    expect(parseTransactionRecordPath(CANONICAL)).toEqual({ kind: 'account', uid, accountId: OLD, transactionId: 'old-coffee' });
    expect(parseTransactionRecordPath('transactions/legacy')).toEqual({ kind: 'root', transactionId: 'legacy' });
    for (const invalid of ['user_profiles/x/accounts/a/transactions', 'user_profiles/x/accounts/a/transactions/../b', 'receipts/r', '', 'transactions/a/b', 42, null]) {
      expect(parseTransactionRecordPath(invalid)).toBeNull();
    }
    const root = record('transactions/legacy', { ...purchase({ userId: undefined, user_id: uid }), account_id: 'plaid-account-1' });
    const groups = matchHistoricalOverlaps({ canonicalScope: ['root:plaid-account-1'], candidateScope: [NEW], records: [root, record(CANDIDATE, purchase())] });
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical[0].path).toBe('transactions/legacy');
    expect(matchHistoricalOverlaps({ canonicalScope: [OLD], candidateScope: [NEW], records: [record('receipts/r', purchase()), record(CANDIDATE, purchase())] })).toEqual([]);
  });
});

describe('reviewed decisions', () => {
  it('supersedes a duplicate candidate with server-only fields and leaves both records\u2019 review untouched', () => {
    const result = plan(duplicate());
    expect(result).toMatchObject({ decisionId: 'decision-1', decision: 'duplicate', action: 'supersede', alreadyApplied: false, canonical: CANONICAL, candidate: CANDIDATE });
    expect(result.update).toEqual({
      superseded_by: CANONICAL, superseded_at: '2026-09-17T12:00:00.000Z', superseded_reason: 'historical_overlap', superseded_decision_id: 'decision-1',
    });
    for (const field of Object.keys(result.update!)) expect(OVERLAP_SERVER_ONLY_FIELDS).toContain(field);
    expect(Object.keys(result.update!)).not.toEqual(expect.arrayContaining(['is_deductible', 'review_status', 'notes', 'receipt_url']));
  });

  it('records a distinct candidate as reviewed so it leaves the inventory without touching the canonical record', () => {
    const result = plan(duplicate({ decision: 'distinct' }));
    expect(result).toMatchObject({ action: 'mark_reviewed', alreadyApplied: false });
    expect(result.update).toEqual({ overlap_reviewed: true, overlap_reviewed_at: '2026-09-17T12:00:00.000Z', overlap_reviewed_decision_id: 'decision-1' });
    expect(Object.keys(result.update!).every(field => (OVERLAP_SERVER_ONLY_FIELDS as readonly string[]).includes(field))).toBe(true);
  });

  it('defers without reading or writing anything', () => {
    expect(plan(duplicate({ decision: 'defer' }), null, null)).toMatchObject({ action: 'none', alreadyApplied: false, update: null });
  });

  it('is idempotent: a decision already carried by the candidate plans no write', () => {
    expect(plan(duplicate(), undefined, purchase({ superseded_by: CANONICAL, superseded_decision_id: 'earlier' }))).toMatchObject({ action: 'supersede', alreadyApplied: true, update: null });
    expect(plan(duplicate({ decision: 'distinct' }), undefined, purchase({ overlap_reviewed: true }))).toMatchObject({ action: 'mark_reviewed', alreadyApplied: true, update: null });
  });

  it.each<[string, () => unknown, string]>([
    ['a superseded record can never be canonical', () => plan(duplicate(), purchase({ superseded_by: recordPath('older', 'x') })), 'canonical_superseded'],
    ['a candidate superseded by another record is not superseded twice', () => plan(duplicate(), undefined, purchase({ superseded_by: recordPath(OLD, 'other') })), 'candidate_superseded_elsewhere'],
    ['a candidate superseded by another record is not recorded as distinct', () => plan(duplicate({ decision: 'distinct' }), undefined, purchase({ superseded_by: recordPath(OLD, 'other') })), 'candidate_superseded_elsewhere'],
    ['a distinct decision does not reverse an applied duplicate', () => plan(duplicate({ decision: 'distinct' }), undefined, purchase({ superseded_by: CANONICAL })), 'conflicting_decisions'],
    ['a duplicate decision does not reverse an applied distinct', () => plan(duplicate(), undefined, purchase({ overlap_reviewed: true })), 'conflicting_decisions'],
    ['a pending candidate waits for the bank', () => plan(duplicate(), undefined, purchase({ pending: true })), 'record_pending'],
    ['a pending canonical waits for the bank', () => plan(duplicate(), purchase({ pending: true })), 'record_pending'],
    ['a bank-removed record is not reconciled', () => plan(duplicate(), undefined, purchase({ bank_removed: true })), 'record_removed'],
    ['an amount that changed since the inventory', () => plan(duplicate(), undefined, purchase({ amount: 42.51 })), 'key_mismatch'],
    ['a date that changed since the inventory', () => plan(duplicate(), purchase({ date: '2026-03-11' })), 'key_mismatch'],
    ['a currency that differs', () => plan(duplicate(), undefined, purchase({ iso_currency_code: 'CAD' })), 'key_mismatch'],
    ['a record without merchant text', () => plan(duplicate(), undefined, purchase({ merchant_name: undefined })), 'key_incomplete'],
    ['records from the same account scope', () => plan(duplicate({ candidate: recordPath(OLD, 'sibling') })), 'same_scope'],
    ['records with different owners', () => plan(duplicate(), undefined, purchase({ userId: 'someone-else' })), 'owner_mismatch'],
    ['a record whose path and owner field disagree', () => plan(duplicate(), purchase({ userId: 'someone-else' })), 'owner_mismatch'],
    ['a missing canonical', () => plan(duplicate(), null), 'record_missing'],
    ['a missing candidate', () => plan(duplicate(), undefined, null), 'record_missing'],
    ['a record paired with itself', () => plan(duplicate({ candidate: CANONICAL })), 'same_record'],
    ['a reference that is not a transaction record', () => plan(duplicate({ candidate: `user_profiles/${uid}/receipts/r` })), 'invalid_record_path'],
    ['an unknown decision kind', () => plan({ ...duplicate(), decision: 'merge' as never }), 'invalid_decision'],
  ])('refuses %s', (_label, work, code) => {
    expect(refusal(work)).toBe(code);
  });

  it('refuses decision files whose decisions contradict each other', () => {
    const otherCandidate = recordPath(NEW, 'new-other');
    const otherCanonical = recordPath(OLD, 'old-other');
    expect(refusal(() => assertConsistentHistoricalOverlapDecisions([duplicate(), duplicate({ candidate: otherCandidate, decision: 'distinct' }), duplicate({ canonical: otherCanonical, candidate: otherCandidate, decision: 'defer' })]))).toBe('accepted');
    expect(refusal(() => assertConsistentHistoricalOverlapDecisions([duplicate(), duplicate()]))).toBe('conflicting_decisions');
    expect(refusal(() => assertConsistentHistoricalOverlapDecisions([duplicate(), duplicate({ canonical: otherCanonical })]))).toBe('conflicting_decisions');
    expect(refusal(() => assertConsistentHistoricalOverlapDecisions([duplicate(), duplicate({ canonical: otherCanonical, decision: 'distinct' })]))).toBe('conflicting_decisions');
    // A candidate superseded by one decision cannot be the canonical record of another.
    expect(refusal(() => assertConsistentHistoricalOverlapDecisions([duplicate(), duplicate({ canonical: CANDIDATE, candidate: otherCandidate })]))).toBe('conflicting_decisions');
    expect(refusal(() => assertConsistentHistoricalOverlapDecisions([duplicate(), { canonical: CANONICAL, candidate: otherCandidate, decision: 'later' as never }]))).toBe('invalid_decision');
  });
});

describe('superseded records leave every total', () => {
  const superseded = purchase({ trans_id: 'new-plaid-id', superseded_by: CANONICAL, superseded_reason: 'historical_overlap' });
  const canonical = purchase({ trans_id: 'old-plaid-id' });

  it('shares one countable predicate across pending, bank-removed and superseded records', () => {
    expect(isSupersededRecord(superseded)).toBe(true);
    expect(isSupersededRecord(canonical)).toBe(false);
    expect(isSupersededRecord({ superseded_by: '' })).toBe(false);
    expect(isSupersededRecord(null)).toBe(false);
    expect(isBankRemovedRecord(purchase({ bank_removed: true }))).toBe(true);
    expect(isCountableRecord(canonical)).toBe(true);
    for (const excluded of [superseded, purchase({ pending: true }), purchase({ bank_removed: true }), null]) expect(isCountableRecord(excluded)).toBe(false);
  });

  it('counts the purchase once in Schedule C totals in both aggregation modes', () => {
    const transactions = [canonical, superseded, purchase({ trans_id: 'distinct', merchant_name: 'Hardware', amount: 80 })].map(tx => ({ ...tx, id: String(tx.trans_id) }));
    for (const mode of ['default', 'confirmed-only'] as const) {
      const result = aggregateScheduleC(transactions as never, '2026', CATEGORY_MAP, { mode });
      expect(result.totalDeductible).toBe(122.5);
      expect(result.counts.year).toBe(2);
      expect(result.counts.deductible).toBe(2);
    }
    expect(aggregateScheduleC([superseded as never], '2026', CATEGORY_MAP).totalDeductible).toBe(0);
  });

  it('keeps superseded purchases out of income candidates and dashboard counts', () => {
    const income = (overrides: Record<string, unknown>) => purchase({ category: 'INCOME', amount: -1000, is_deductible: false, merchant_name: 'Client Pay', ...overrides });
    const result = listIncomeSourceCandidates(2026, [income({ trans_id: 'old-pay' }), income({ trans_id: 'new-pay', superseded_by: CANONICAL })], [], []);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ kind: 'transaction', id: 'old-pay', amount: 1000 });
    expect(result.unclassifiedCreditCount).toBe(0);
    const unreviewedCopy = purchase({ superseded_by: CANONICAL, is_deductible: null, review_status: undefined, tax_review_required: true });
    expect(summarizeDashboardRecords([canonical, superseded, unreviewedCopy] as never)).toMatchObject({ deductibleCount: 1, needsReviewCount: 0, pendingCount: 0 });
  });

  it('excludes superseded records from the audit packet deductions while counting them', () => {
    const asExport = (data: Record<string, unknown>, id: string): ExportRecord => ({ ...data, id, recordPath: recordPath(id.startsWith('old') ? OLD : NEW, id), exportReference: `transaction-${id}` });
    const packet = assembleAuditSupportPacket(uid, 2026, { transactions: [asExport(canonical, 'old-coffee'), asExport(superseded, 'new-coffee')], trips: [], receipts: [] }, now);
    expect(packet.deductions.map(deduction => deduction.transactionId)).toEqual(['old-plaid-id']);
    expect(packet.summary).toMatchObject({ deductionCount: 1, recordedAmount: 42.5, excluded: { superseded: 1, pending: 0, bankRemoved: 0, notConfirmed: 0, reviewRequired: 0 } });
  });

  describe('owner readers', () => {
    beforeEach(() => {
      state.db = createFakeFirestore();
      state.db.records.set(`user_profiles/${uid}/accounts/${OLD}`, { name: 'Checking (old Item)' });
      state.db.records.set(`user_profiles/${uid}/accounts/${NEW}`, { name: 'Checking (relinked)' });
      state.db.records.set(CANONICAL, canonical);
      state.db.records.set(CANDIDATE, superseded);
      state.db.records.set(recordPath(NEW, 'new-hardware'), purchase({ trans_id: 'hardware', merchant_name: 'Hardware', amount: 80, overlap_reviewed: true }));
    });

    it('drops superseded records from the export reader unless the caller asks for the complete archive', async () => {
      expect((await readOwnedTransactions(uid)).map(record => record.trans_id)).toEqual(['old-plaid-id', 'hardware']);
      const complete = await readOwnedTransactions(uid, { includeSuperseded: true });
      expect(complete.map(record => record.trans_id)).toEqual(['old-plaid-id', 'new-plaid-id', 'hardware']);
      expect(complete.find(record => record.trans_id === 'new-plaid-id')?.superseded_by).toBe(CANONICAL);
    });

    it('never lets a tax export or Schedule C total count the superseded copy', async () => {
      const transactions = await readTaxExportTransactions(uid, 2026);
      expect(transactions.map(tx => tx.trans_id)).toEqual(['old-plaid-id', 'hardware']);
      expect(aggregateScheduleC(transactions, '2026', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(122.5);
    });

    it('reports the superseded copy as an exclusion in the audit packet', async () => {
      const packet = await readAuditSupportPacket(uid, 2026);
      expect(packet.deductions.map(deduction => deduction.transactionId).sort()).toEqual(['hardware', 'old-plaid-id']);
      expect(packet.summary.excluded).toMatchObject({ superseded: 1 });
    });

    it('does not repeat the canonical history to the AI taxpayer context', async () => {
      const history = await loadConfirmedTransactionRecords(uid);
      expect(history).toHaveLength(2);
      expect(history.map(item => item.merchant_name).sort()).toEqual(['Coffee Shop', 'Hardware']);
    });
  });
});
