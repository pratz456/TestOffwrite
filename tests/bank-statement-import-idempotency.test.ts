import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { overlapKey } from '@/lib/transactions/historical-overlap';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const docs = new Map<string, Record<string, unknown>>();
let randomIds = 0;
const OWNER = 'synthetic-import-owner';
const IMPORT_PREFIX = `user_profiles/${OWNER}/accounts/statement-imports/transactions/`;

function freeze(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? { t: 'date', v: item.toISOString() } : item);
}
function cloned(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}
function ref(path: string): any {
  const node = {
    path,
    id: path.split('/').at(-1),
    collection: (name: string) => ref(`${path}/${name}`),
    doc: (name?: string) => ref(`${path}/${name || `random-${++randomIds}`}`),
    select() { return node; },
    async get() {
      const children = [...docs.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'));
      return {
        exists: docs.has(path), empty: children.length === 0, id: node.id, ref: node,
        data: () => docs.has(path) ? cloned(docs.get(path)!) : undefined,
        docs: children.map(([key, data]) => ({ id: key.split('/').at(-1), ref: ref(key), data: () => cloned(data) })),
      };
    },
  };
  return node;
}
function batch() {
  const ops: Array<{ type: 'set' | 'create'; path: string; data: Record<string, unknown> }> = [];
  return {
    set: (target: { path: string }, data: Record<string, unknown>) => { ops.push({ type: 'set', path: target.path, data: cloned(data) }); },
    create: (target: { path: string }, data: Record<string, unknown>) => { ops.push({ type: 'create', path: target.path, data: cloned(data) }); },
    commit: async () => {
      if (ops.some(op => op.type === 'create' && docs.has(op.path))) {
        const error = new Error('already exists') as Error & { code: number };
        error.code = 6;
        throw error;
      }
      for (const op of ops) docs.set(op.path, op.data);
    },
  };
}
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: OWNER }, error: null }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/openai/client', () => ({ getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }) }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (path: string) => ref(path),
    batch,
    getAll: async (...targets: Array<{ path?: string }>) => targets.filter(item => item?.path).map(item => ({
      exists: docs.has(item.path!), id: item.path!.split('/').at(-1),
      data: () => docs.has(item.path!) ? cloned(docs.get(item.path!)!) : undefined,
    })),
    runTransaction: async (work: (tx: { get: (target: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; create: (target: { path: string }, data: Record<string, unknown>) => void }) => Promise<unknown>) => {
      const staged: Array<{ path: string; data: Record<string, unknown> }> = [];
      const result = await work({
        get: async target => ({ exists: docs.has(target.path), data: () => docs.has(target.path) ? cloned(docs.get(target.path)!) : undefined }),
        create: (target, data) => {
          if (docs.has(target.path) || staged.some(op => op.path === target.path)) {
            const error = new Error('already exists') as Error & { code: number };
            error.code = 6;
            throw error;
          }
          staged.push({ path: target.path, data: cloned(data) });
        },
      });
      for (const op of staged) docs.set(op.path, op.data);
      return result;
    },
  },
}));
import { POST } from '../app/api/tax/import-bank-statement/route';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
type Row = { date: string; description: string; amount: number; transaction_type: 'debit' | 'credit'; category?: string };
const DEFAULT_BANK = 'Synthetic Bank';
const DEFAULT_LAST4 = '0000';
type Identity = { bankName?: string | null; accountLast4?: string | null };
const completion = (transactions: Row[], identity: Identity = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
  currency: 'USD',
  bankName: identity.bankName === undefined ? DEFAULT_BANK : identity.bankName,
  accountLast4: identity.accountLast4 === undefined ? DEFAULT_LAST4 : identity.accountLast4,
  statementPeriod: { start: '2026-09-01', end: '2026-09-30' },
  transactions, confidence: 'high',
}), refusal: null } }] });
function request(docType = 'bank_statement', bytes: Buffer = PNG) {
  const form = new FormData();
  form.set('file', new File([bytes], 'synthetic.png', { type: 'image/png' }));
  form.set('docType', docType);
  form.set('year', '2026');
  return new NextRequest('http://localhost/api/tax/import-bank-statement', { method: 'POST', body: form });
}
function importDocs() {
  return [...docs.entries()].filter(([path]) => path.startsWith(IMPORT_PREFIX)).map(([path, data]) => ({ id: path.slice(IMPORT_PREFIX.length), path, data }));
}
function frozenImportDocs() {
  return new Map(importDocs().map(doc => [doc.path, freeze(doc.data)]));
}
async function upload(transactions: Row[], identity: Identity = {}, bytes: Buffer = PNG) {
  mocks.create.mockResolvedValueOnce(completion(transactions, identity));
  const response = await POST(request('bank_statement', bytes));
  const body = await response.json() as { imported: number; alreadyImported: number; flaggedLegacy: number; transactionsImported: number };
  return { status: response.status, body };
}
function accountScope(identity: Identity = {}): string {
  const bank = identity.bankName === undefined ? DEFAULT_BANK : identity.bankName;
  const last4 = identity.accountLast4 === undefined ? DEFAULT_LAST4 : identity.accountLast4;
  const bankText = typeof bank === 'string' ? bank.trim() : '';
  const last4Text = typeof last4 === 'string' ? last4.trim() : '';
  if (!bankText && !last4Text) return '';
  return `account:${last4Text}:${bankText.toUpperCase().replace(/\s+/g, ' ').trim()}`;
}
function fileScope(bytes: Buffer = PNG): string {
  return `file:${createHash('sha256').update(bytes).digest('hex')}`;
}
function expectedId(row: Row, occurrence: number, scope = accountScope(), namespace: 'statement' | 'receipt' = 'statement') {
  const amount = row.transaction_type === 'credit' ? -Math.abs(row.amount) : Math.abs(row.amount);
  const description = row.description.toUpperCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(JSON.stringify([
    OWNER, namespace, scope, row.date, Math.round(amount * 100), row.transaction_type, description, occurrence,
  ])).digest('hex');
}
function seedLegacy(id: string, row: Row) {
  docs.set(`${IMPORT_PREFIX}${id}`, {
    userId: OWNER, account_id: 'statement-imports', merchant_name: row.description, name: row.description,
    amount: row.transaction_type === 'credit' ? -Math.abs(row.amount) : Math.abs(row.amount),
    iso_currency_code: 'USD', date: row.date, category: row.category || 'Other', transaction_type: row.transaction_type,
    is_deductible: null, deduction_score: null, analyzed: false, analysis_status: 'pending', analysisStatus: 'pending',
    pending: false, source: 'manual', import_source: 'manual_statement', trans_id: id,
  });
}

const stationery: Row = { date: '2026-09-15', description: 'Synthetic stationery', amount: 32.5, transaction_type: 'debit', category: 'Office Supplies' };
const coffee: Row = { date: '2026-09-15', description: 'Coffee Shop', amount: 6.5, transaction_type: 'debit', category: 'Food & Drink' };
const toll: Row = { date: '2026-09-15', description: 'Bridge toll', amount: 6.5, transaction_type: 'debit', category: 'Travel' };

beforeEach(() => { docs.clear(); randomIds = 0; vi.clearAllMocks(); resetRateLimitStore(); });
afterEach(() => vi.restoreAllMocks());

describe('statement import document ids', () => {
  it('saves a statement once and a second upload adds nothing', async () => {
    const rows = [stationery, coffee, toll];
    const first = await upload(rows);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ imported: 3, alreadyImported: 0, flaggedLegacy: 0, transactionsImported: 3 });
    expect(importDocs().map(doc => doc.id).sort()).toEqual(rows.map(row => expectedId(row, 1)).sort());
    const before = frozenImportDocs();
    const second = await upload(rows);
    expect(second.body).toMatchObject({ imported: 0, alreadyImported: 3, flaggedLegacy: 0, transactionsImported: 0 });
    expect(frozenImportDocs()).toEqual(before);
  });

  it('saves two identical same day rows and a second upload leaves both', async () => {
    const rows = [coffee, { ...coffee }];
    const first = await upload(rows);
    expect(first.body.imported).toBe(2);
    expect(importDocs().map(doc => doc.id).sort()).toEqual([expectedId(coffee, 1), expectedId(coffee, 2)].sort());
    const before = frozenImportDocs();
    const second = await upload(rows);
    expect(second.body).toMatchObject({ imported: 0, alreadyImported: 2, flaggedLegacy: 0 });
    expect(importDocs()).toHaveLength(2);
    expect(frozenImportDocs()).toEqual(before);
  });

  it('saves only a changed amount when the rest of the statement was already imported', async () => {
    const rows = [stationery, coffee, toll];
    await upload(rows);
    const before = frozenImportDocs();
    const changed = { ...coffee, amount: 7.25 };
    const second = await upload([stationery, changed, toll]);
    expect(second.body).toMatchObject({ imported: 1, alreadyImported: 2, flaggedLegacy: 0 });
    expect(importDocs()).toHaveLength(4);
    expect(importDocs().some(doc => doc.id === expectedId(changed, 1))).toBe(true);
    for (const [path, frozen] of before) expect(freeze(docs.get(path))).toBe(frozen);
  });

  it('maps description case and whitespace to the same row', async () => {
    const first = await upload([coffee]);
    expect(first.body.imported).toBe(1);
    const id = expectedId(coffee, 1);
    expect(importDocs()[0].id).toBe(id);
    const before = frozenImportDocs();
    const second = await upload([{ ...coffee, description: '  coffee   shop ' }]);
    expect(second.body).toMatchObject({ imported: 0, alreadyImported: 1, flaggedLegacy: 0 });
    expect(expectedId({ ...coffee, description: '  coffee   shop ' }, 1)).toBe(id);
    expect(importDocs()).toHaveLength(1);
    expect(frozenImportDocs()).toEqual(before);
  });

  it('saves a row that matches a bank linked transaction and marks possibleDuplicate', async () => {
    const bank = { date: coffee.date, amount: coffee.amount, merchant_name: 'coffee   shop', iso_currency_code: 'USD' };
    docs.set(`user_profiles/${OWNER}/accounts/plaid-account`, { source: 'plaid', plaid_item_id: 'item-1', userId: OWNER });
    docs.set(`user_profiles/${OWNER}/accounts/plaid-account/transactions/plaid-tx-1`, { ...bank });
    const before = freeze(docs.get(`user_profiles/${OWNER}/accounts/plaid-account/transactions/plaid-tx-1`));
    const result = await upload([coffee]);
    expect(result.body).toMatchObject({ imported: 1, alreadyImported: 0, flaggedLegacy: 0 });
    const saved = importDocs()[0].data;
    expect(saved.possibleDuplicate).toBe(true);
    expect(saved.possibleDuplicateReason).toBe('bank_linked');
    expect(overlapKey(saved)).toBe(overlapKey(bank));
    expect(freeze(docs.get(`user_profiles/${OWNER}/accounts/plaid-account/transactions/plaid-tx-1`))).toBe(before);
  });

  it('saves every row that matches an older random id import, flags it, and leaves the old rows untouched', async () => {
    const rows: Row[] = [
      { ...coffee, description: 'Coffee  Shop' },
      { ...coffee, description: 'Coffee  Shop' },
      stationery,
      { date: '2026-09-16', description: 'Client refund', amount: 18, transaction_type: 'credit', category: 'Other' },
    ];
    rows.forEach((row, index) => seedLegacy(`random-legacy-${index}`, row));
    const before = frozenImportDocs();
    const incoming: Row[] = [
      { ...coffee, description: ' coffee   shop ' },
      { ...coffee, description: 'COFFEE SHOP' },
      stationery,
      { date: '2026-09-16', description: 'Client refund', amount: 18, transaction_type: 'credit', category: 'Shopping' },
    ];
    const result = await upload(incoming);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ imported: 4, alreadyImported: 0, flaggedLegacy: 4, transactionsImported: 4 });
    const created = importDocs().filter(doc => !doc.id.startsWith('random-legacy-'));
    expect(created).toHaveLength(4);
    expect(created.every(doc => doc.data.possibleDuplicate === true && doc.data.possibleDuplicateReason === 'legacy_match' && doc.data.import_row_id === doc.id)).toBe(true);
    expect(created.map(doc => doc.id).sort()).toEqual([
      expectedId(incoming[0], 1), expectedId(incoming[1], 2), expectedId(stationery, 1), expectedId(incoming[3], 1),
    ].sort());
    for (const [path, frozen] of before) expect(freeze(docs.get(path))).toBe(frozen);
    const againBefore = frozenImportDocs();
    const again = await upload(incoming);
    expect(again.body).toMatchObject({ imported: 0, alreadyImported: 4, flaggedLegacy: 0 });
    expect(frozenImportDocs()).toEqual(againBefore);
  });

  it('does not flag a debit as a legacy match for a credit of the same cents', async () => {
    seedLegacy('random-credit', { date: '2026-09-16', description: 'Client refund', amount: 18, transaction_type: 'credit' });
    const before = frozenImportDocs();
    const result = await upload([{ date: '2026-09-16', description: 'Client refund', amount: 18, transaction_type: 'debit', category: 'Other' }]);
    expect(result.body).toMatchObject({ imported: 1, alreadyImported: 0, flaggedLegacy: 0 });
    expect(importDocs().find(doc => !doc.id.startsWith('random-'))?.data).not.toHaveProperty('possibleDuplicate');
    for (const [path, frozen] of before) expect(freeze(docs.get(path))).toBe(frozen);
  });

  it('saves two identical 5.00 coffees and a second upload of the same statement imports nothing', async () => {
    const five: Row = { date: '2026-09-15', description: 'Coffee Shop', amount: 5, transaction_type: 'debit', category: 'Food & Drink' };
    const first = await upload([five, { ...five }]);
    expect(first.body).toMatchObject({ imported: 2, alreadyImported: 0, flaggedLegacy: 0 });
    expect(importDocs().map(doc => doc.id).sort()).toEqual([expectedId(five, 1), expectedId(five, 2)].sort());
    const second = await upload([five, { ...five }]);
    expect(second.body).toMatchObject({ imported: 0, alreadyImported: 2, flaggedLegacy: 0 });
    expect(importDocs()).toHaveLength(2);
  });

  it('saves the same charge on two different cards', async () => {
    const charge: Row = { date: '2026-09-15', description: 'Coffee Shop', amount: 5, transaction_type: 'debit' };
    const first = await upload([charge], { accountLast4: '1111' });
    const second = await upload([charge], { accountLast4: '2222' });
    expect(first.body).toMatchObject({ imported: 1, alreadyImported: 0 });
    expect(second.body).toMatchObject({ imported: 1, alreadyImported: 0 });
    expect(importDocs().map(doc => doc.id).sort()).toEqual([
      expectedId(charge, 1, accountScope({ accountLast4: '1111' })),
      expectedId(charge, 1, accountScope({ accountLast4: '2222' })),
    ].sort());
  });

  it('dedupes a statement with no account identity only when the file bytes match', async () => {
    const identity = { bankName: null, accountLast4: null };
    const first = await upload([coffee], identity);
    expect(first.body).toMatchObject({ imported: 1, alreadyImported: 0 });
    expect(importDocs()[0].id).toBe(expectedId(coffee, 1, fileScope(PNG)));
    const second = await upload([coffee], identity);
    expect(second.body).toMatchObject({ imported: 0, alreadyImported: 1 });
    const other = Buffer.concat([PNG, Buffer.from([1])]);
    const third = await upload([coffee], identity, other);
    expect(third.body).toMatchObject({ imported: 1, alreadyImported: 0 });
    expect(importDocs().map(doc => doc.id).sort()).toEqual([
      expectedId(coffee, 1, fileScope(PNG)),
      expectedId(coffee, 1, fileScope(other)),
    ].sort());
  });

  it('saves a receipt that matches a statement row, flags it, and leaves the statement row unchanged', async () => {
    const first = await upload([coffee]);
    expect(first.body.imported).toBe(1);
    const before = frozenImportDocs();
    mocks.create.mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      currency: 'USD', merchant: ' coffee   shop ', date: coffee.date, total: coffee.amount, category: 'Food & Drink',
      businessPurpose: 'Client meeting', items: [{ description: 'latte', amount: 6.5 }], confidence: 'high',
    }), refusal: null } }] });
    const response = await POST(request('receipt'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ imported: 1, alreadyImported: 0, flaggedLegacy: 0 });
    const created = importDocs().filter(doc => !before.has(doc.path));
    expect(created).toHaveLength(1);
    expect(created[0].data).toMatchObject({
      possibleDuplicate: true, possibleDuplicateReason: 'statement_match', source: 'receipt',
      business_purpose: 'Client meeting', receiptItems: [{ description: 'latte', amount: 6.5 }], amount: 6.5,
    });
    expect(created[0].id).toBe(expectedId(
      { date: coffee.date, description: ' coffee   shop ', amount: coffee.amount, transaction_type: 'debit' },
      1, fileScope(PNG), 'receipt',
    ));
    for (const [path, frozen] of before) expect(freeze(docs.get(path))).toBe(frozen);
  });

  it('keeps document ids opaque', async () => {
    const five: Row = { date: '2026-09-15', description: 'Coffee Shop', amount: 5, transaction_type: 'debit' };
    await upload([five, { ...five }], { bankName: 'First National', accountLast4: '1111' });
    expect(importDocs().length).toBeGreaterThan(0);
    for (const doc of importDocs()) {
      expect(doc.id).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.id.includes(five.date)).toBe(false);
      expect(doc.id.includes(five.description)).toBe(false);
      expect(doc.id.includes('5.00')).toBe(false);
      expect(doc.id.includes('First National')).toBe(false);
    }
  });
});
