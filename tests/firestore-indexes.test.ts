import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Static index coverage: every multi-field filter / filter + orderBy query in the codebase is
 * catalogued here and must be served by an entry in firestore.indexes.json.
 *
 * Matching follows the Firestore planner rules: the index prefix must contain the query's equality
 * fields (any order, direction irrelevant), followed by the orderBy / range fields in exact order and
 * direction, with nothing else after them. Equality-only queries can be served by merging single-field
 * indexes, but the repo policy is an explicit composite entry for each of them as well.
 */

type Dir = 'ASCENDING' | 'DESCENDING';
type Scope = 'COLLECTION' | 'COLLECTION_GROUP';
interface CatalogEntry {
  source: string;
  collection: string;
  scope: Scope;
  equality: string[];
  order?: Array<[string, Dir]>;
}
interface IndexField { fieldPath: string; order?: Dir; arrayConfig?: 'CONTAINS' }
interface CompositeIndex { collectionGroup: string; queryScope: Scope; fields: IndexField[] }
interface FieldOverride { collectionGroup: string; fieldPath: string; indexes: Array<{ order?: Dir; arrayConfig?: 'CONTAINS'; queryScope: Scope }> }

const file = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')) as
  { indexes: CompositeIndex[]; fieldOverrides?: FieldOverride[] };

const cg = (source: string, equality: string[], order?: Array<[string, Dir]>): CatalogEntry =>
  ({ source, collection: 'transactions', scope: 'COLLECTION_GROUP', equality, order });
const col = (source: string, collection: string, equality: string[], order?: Array<[string, Dir]>): CatalogEntry =>
  ({ source, collection, scope: 'COLLECTION', equality, order });

const TAX_YEAR_COLLECTIONS = ['gross_receipts', 'income_1099', 'w2_income', 'tax_deductions', 'tax_organizers', 'form_8879', 'income_reconciliations'];
const PAGINATED_SORT_FIELDS = ['updated_at', 'date', 'amount', 'merchant_name'];

export const QUERY_CATALOG: CatalogEntry[] = [
  // Owner + trans_id lookups (server and client).
  cg('lib/firebase/transactions-server.ts getTransactionServer/updateTransactionServerWithUserId', ['userId', 'trans_id']),
  cg('lib/firebase/transactions-server.ts legacy owner field', ['user_id', 'trans_id']),
  cg('app/api/ai/analyze-transaction/route.ts ownedTransactionRef', ['userId', 'trans_id']),
  cg('app/api/transactions/[id]/route.ts', ['user_id', 'trans_id']),
  cg('lib/firebase/hooks.ts useTransaction / lib/firebase/mutations.ts', ['trans_id', 'userId']),

  // Owner listings ordered by date (paged server reads, dashboard realtime listener, stats hook).
  cg('lib/firebase/transactions-server.ts getTransactionsServer({ limit })', ['userId'], [['date', 'DESCENDING']]),
  cg('lib/firebase/transactions-server.ts getTransactionsServer({ limit }) legacy owner field', ['user_id'], [['date', 'DESCENDING']]),
  cg('lib/firebase/hooks.ts useTransactions or(userId) branch', ['userId'], [['date', 'DESCENDING']]),
  cg('lib/firebase/hooks.ts useTransactions or(user_id) branch', ['user_id'], [['date', 'DESCENDING']]),
  cg('lib/firebase/hooks.ts useUserStats', ['userId'], [['date', 'DESCENDING']]),

  // AI priors and notification jobs.
  cg('lib/ai/taxpayer-context-server.ts confirmed history', ['userId', 'review_status'], [['date', 'DESCENDING']]),
  cg('lib/notifications/notification-engine.ts unreviewed count()', ['userId', 'analysis_status']),
  cg('lib/notifications/notification-engine.ts mileage reminder (date range)', ['userId', 'category'], [['date', 'DESCENDING']]),
  cg('lib/notifications/notification-engine.ts celebrations (date range)', ['userId', 'is_deductible'], [['date', 'DESCENDING']]),

  // Account deletion (collection group and legacy top-level collection).
  cg('lib/firebase/accounts-server.ts deleteAccountServer step 2', ['account_id', 'userId']),
  cg('lib/firebase/accounts-server.ts deleteAccountServer step 2 (user_id)', ['account_id', 'user_id']),
  cg('app/api/debug/transactions/route.ts', ['user_id', 'account_id']),
  col('lib/firebase/accounts-server.ts deleteAccountServer step 2b', 'transactions', ['account_id', 'userId']),
  col('lib/firebase/accounts-server.ts deleteAccountServer step 2b (user_id)', 'transactions', ['account_id', 'user_id']),

  // getPaginatedTransactionsServer: userId [+ is_deductible] + any of four sort fields in either direction.
  ...[false, true].flatMap(withStatus => PAGINATED_SORT_FIELDS.flatMap(sort => (['ASCENDING', 'DESCENDING'] as Dir[]).map(dir =>
    cg(`lib/firebase/transactions-server.ts getPaginatedTransactionsServer sortBy=${sort} ${dir}${withStatus ? ' status filter' : ''}`,
      withStatus ? ['userId', 'is_deductible'] : ['userId'], [[sort, dir]])))),

  // Other collections.
  col('app/api/analysis-status/route.ts, lib/firebase/analysis-subscription.ts', 'analysis_status', ['userId'], [['created_at', 'DESCENDING']]),
  col('app/api/cpa-question/route.ts GET', 'cpa_questions', ['userId'], [['createdAt', 'DESCENDING']]),
  col('lib/notifications/notification-engine.ts getUserNotifications', 'notifications', ['userId'], [['sentAt', 'DESCENDING']]),
  col('lib/ai/learning-engine.ts, lib/firebase/corrections.ts', 'user_corrections', ['userId'], [['timestamp', 'DESCENDING']]),
  col('lib/firebase/corrections.ts by merchant', 'user_corrections', ['userId', 'merchantName'], [['timestamp', 'DESCENDING']]),
  col('lib/firebase/corrections.ts by category', 'user_corrections', ['userId', 'category'], [['timestamp', 'DESCENDING']]),
  col('app/api/tax/import-document/route.ts duplicate W-2', 'w2_income', ['userId', 'taxYear', 'employerEIN']),
  ...TAX_YEAR_COLLECTIONS.map(name => col('tax year records (compute-1040, form-1040, schedule-c, export-records, quarterly-reminders)', name, ['userId', 'taxYear'])),
];

/** Collection-scoped single-field owner queries on `transactions` (deleteUserData, account deletion step 2b). */
const SINGLE_FIELD_REQUIREMENTS: Array<{ source: string; collection: string; field: string; scope: Scope }> = [
  { source: 'lib/firebase/delete-user-data.ts OWNED_COLLECTIONS.transactions', collection: 'transactions', field: 'userId', scope: 'COLLECTION' },
  { source: 'lib/firebase/delete-user-data.ts OWNED_COLLECTIONS.transactions', collection: 'transactions', field: 'user_id', scope: 'COLLECTION' },
  { source: 'lib/firebase/transactions-server.ts collectionGroup owner reads', collection: 'transactions', field: 'userId', scope: 'COLLECTION_GROUP' },
  { source: 'lib/firebase/transactions-server.ts collectionGroup owner reads', collection: 'transactions', field: 'user_id', scope: 'COLLECTION_GROUP' },
];

function indexFields(index: CompositeIndex): IndexField[] {
  const fields = [...index.fields];
  if (fields.at(-1)?.fieldPath === '__name__') fields.pop();
  return fields;
}

export function servesQuery(index: CompositeIndex, entry: CatalogEntry): boolean {
  if (index.collectionGroup !== entry.collection || index.queryScope !== entry.scope) return false;
  const fields = indexFields(index);
  const order = entry.order ?? [];
  if (fields.length !== entry.equality.length + order.length) return false;
  const prefix = fields.slice(0, entry.equality.length).map(field => field.fieldPath).sort();
  if (prefix.join(',') !== [...entry.equality].sort().join(',')) return false;
  return fields.slice(entry.equality.length).every((field, i) => field.fieldPath === order[i][0] && field.order === order[i][1]);
}

describe('firestore.indexes.json structure', () => {
  it('is comment-free JSON with well-formed composite entries and no duplicates', () => {
    const seen = new Set<string>();
    for (const index of file.indexes) {
      expect(['COLLECTION', 'COLLECTION_GROUP']).toContain(index.queryScope);
      expect(index.fields.length).toBeGreaterThanOrEqual(2);
      for (const field of index.fields) {
        expect(typeof field.fieldPath).toBe('string');
        expect([field.order, field.arrayConfig].filter(Boolean)).toHaveLength(1);
      }
      const key = `${index.collectionGroup}|${index.queryScope}|${index.fields.map(f => `${f.fieldPath}:${f.order ?? f.arrayConfig}`).join(',')}`;
      expect(seen.has(key), `duplicate index ${key}`).toBe(false);
      seen.add(key);
    }
    expect(file.indexes.length).toBeLessThanOrEqual(200);
  });
});

describe('every catalogued multi-field query has a composite index', () => {
  it.each(QUERY_CATALOG.map(entry => [
    `${entry.collection} (${entry.scope}) ${entry.equality.join('=,')}=${entry.order ? ' ' + entry.order.map(([f, d]) => `${f} ${d}`).join(', ') : ''} — ${entry.source}`,
    entry,
  ] as const))('%s', (_label, entry) => {
    const match = file.indexes.find(index => servesQuery(index, entry));
    expect(match, `no index serves ${JSON.stringify(entry)}`).toBeDefined();
  });
});

describe('single-field overrides keep the scopes the code queries', () => {
  it.each(SINGLE_FIELD_REQUIREMENTS.map(req => [`${req.collection}.${req.field} @ ${req.scope} — ${req.source}`, req] as const))('%s', (_label, req) => {
    const override = (file.fieldOverrides ?? []).find(o => o.collectionGroup === req.collection && o.fieldPath === req.field);
    if (req.scope === 'COLLECTION' && !override) return; // automatic single-field indexing applies
    expect(override, `collection-group scope requires an explicit override for ${req.collection}.${req.field}`).toBeDefined();
    expect(override!.indexes.some(entry => entry.order === 'ASCENDING' && entry.queryScope === req.scope)).toBe(true);
  });
});

describe('servesQuery matcher', () => {
  const index: CompositeIndex = { collectionGroup: 'transactions', queryScope: 'COLLECTION_GROUP',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'is_deductible', order: 'ASCENDING' }, { fieldPath: 'date', order: 'DESCENDING' }] };
  it('accepts equality fields in any order and requires exact ordering fields', () => {
    expect(servesQuery(index, cg('t', ['is_deductible', 'userId'], [['date', 'DESCENDING']]))).toBe(true);
    expect(servesQuery(index, cg('t', ['userId', 'is_deductible'], [['date', 'ASCENDING']]))).toBe(false);
    expect(servesQuery(index, cg('t', ['userId'], [['date', 'DESCENDING']]))).toBe(false);
    expect(servesQuery(index, cg('t', ['userId', 'is_deductible']))).toBe(false);
    expect(servesQuery({ ...index, queryScope: 'COLLECTION' }, cg('t', ['is_deductible', 'userId'], [['date', 'DESCENDING']]))).toBe(false);
  });
});
