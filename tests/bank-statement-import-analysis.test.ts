import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), accountGet: vi.fn(), accountCreate: vi.fn(), runTransaction: vi.fn(), batch: vi.fn(), writes: [] as Array<{ path: string; data: Record<string, unknown> }>, batches: [] as Array<{ set: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> }>, id: 0 }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/openai/client', () => ({ getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }) }));
vi.mock('@/lib/firebase/admin', () => {
  function ref(path: string): any {
    return { path, id: path.split('/').at(-1), collection: (name: string) => ref(`${path}/${name}`), doc: (name?: string) => ref(`${path}/${name || `synthetic-${++mocks.id}`}`) };
  }
  return { adminDb: { collection: (path: string) => ref(path), runTransaction: mocks.runTransaction, batch: mocks.batch } };
});
import { POST } from '../app/api/tax/import-bank-statement/route';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const row = { date: '2026-09-15', description: 'Synthetic stationery', amount: 32.5, transaction_type: 'debit', category: 'Office Supplies' };
const statement = { currency: 'USD', bankName: 'Synthetic Bank', accountLast4: '0000', statementPeriod: { start: '2026-09-01', end: '2026-09-30' }, transactions: [row], confidence: 'high' };
function completion(data: unknown, finish_reason = 'stop') { return { choices: [{ finish_reason, message: { content: JSON.stringify(data), refusal: null } }] }; }
function request(fields: Record<string, string> = {}, file = new File([PNG], 'synthetic.png', { type: 'image/png' })) {
  const form = new FormData(); form.set('file', file); form.set('docType', 'bank_statement'); form.set('year', '2026');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest('http://localhost/api/tax/import-bank-statement', { method: 'POST', body: form });
}
beforeEach(() => {
  vi.clearAllMocks(); resetRateLimitStore(); mocks.writes = []; mocks.batches = []; mocks.id = 0;
  mocks.auth.mockResolvedValue({ user: { uid: 'synthetic-import-owner' }, error: null });
  mocks.create.mockResolvedValue(completion(statement));
  mocks.accountGet.mockResolvedValue({ exists: false });
  mocks.runTransaction.mockImplementation(async callback => callback({ get: mocks.accountGet, create: mocks.accountCreate }));
  mocks.batch.mockImplementation(() => {
    const batch = { set: vi.fn(), commit: vi.fn() };
    batch.commit.mockImplementation(async () => { for (const [ref, data] of batch.set.mock.calls) mocks.writes.push({ path: ref.path, data }); });
    mocks.batches.push(batch); return batch;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('document extraction joins the canonical automatic analysis pipeline', () => {
  it('saves owned posted USD records for analysis, preserving debit and credit direction without inventing income', async () => {
    mocks.create.mockResolvedValue(completion({ ...statement, transactions: [row,
      { ...row, description: 'Synthetic refund', amount: -15, transaction_type: 'credit' },
      { ...row, description: 'Synthetic transfer', amount: 125, transaction_type: 'credit' },
      { ...row, description: 'Synthetic correction', amount: -8, transaction_type: 'debit' },
    ] }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).transactionsImported).toBe(4);
    expect(mocks.accountCreate).toHaveBeenCalledWith(expect.objectContaining({ path: 'user_profiles/synthetic-import-owner/accounts/statement-imports' }), expect.objectContaining({ userId: 'synthetic-import-owner', usageType: 'unknown' }));
    expect(mocks.writes.map(write => write.data.amount)).toEqual([32.5, -15, -125, 8]);
    for (const write of mocks.writes) {
      expect(write.path).toMatch(/^user_profiles\/synthetic-import-owner\/accounts\/statement-imports\/transactions\/synthetic-/);
      expect(write.data).toMatchObject({ trans_id: write.path.split('/').at(-1), userId: 'synthetic-import-owner', account_id: 'statement-imports', iso_currency_code: 'USD', source: 'manual', import_source: 'manual_statement', pending: false, analyzed: false, analysis_status: 'pending', is_deductible: null });
      expect(write.data).not.toHaveProperty('type');
      expect(write.data).not.toHaveProperty('transaction_kind');
    }
  });
  it('uses a fresh batch for each group of 400 rows', async () => {
    mocks.create.mockResolvedValue(completion({ ...statement, transactions: Array.from({ length: 401 }, (_, i) => ({ ...row, description: `Synthetic row ${i}` })) }));
    expect((await POST(request())).status).toBe(200);
    expect(mocks.batches).toHaveLength(2);
    expect(mocks.batches.map(batch => batch.set.mock.calls.length)).toEqual([400, 1]);
    expect(mocks.batches.map(batch => batch.commit.mock.calls.length)).toEqual([1, 1]);
    expect(new Set(mocks.writes.map(write => write.path)).size).toBe(401);
  });
  it('keeps existing account usage choices', async () => {
    mocks.accountGet.mockResolvedValue({ exists: true, data: () => ({ userId: 'synthetic-import-owner', usageType: 'personal' }) });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });
  it.each([
    ['missing currency', { ...statement, currency: null }],
    ['foreign currency', { ...statement, currency: 'CAD' }],
    ['low confidence', { ...statement, confidence: 'low' }],
    ['non-numeric amount', { ...statement, transactions: [row, { ...row, amount: 'unknown' }] }],
    ['missing amount', { ...statement, transactions: [row, { ...row, amount: null }] }],
    ['invalid date', { ...statement, transactions: [row, { ...row, date: '2026-02-30' }] }],
    ['missing debit/credit', { ...statement, transactions: [row, { ...row, transaction_type: null }] }],
    ['unrelated year', { ...statement, transactions: [row, { ...row, date: '2020-01-01' }] }],
  ])('rejects %s before any writes', async (_name, data) => {
    mocks.create.mockResolvedValue(completion(data));
    expect((await POST(request())).status).toBe(422);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('does not save a truncated provider response even if it happens to contain valid JSON', async () => {
    mocks.create.mockResolvedValue(completion(statement, 'length'));
    expect((await POST(request())).status).toBe(422);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it('saves receipts through the same owned account with evidence and pending analysis', async () => {
    mocks.create.mockResolvedValue(completion({ currency: 'USD', merchant: 'Synthetic stationery', total: 32.5, date: '2026-09-15', category: 'Office Supplies', businessPurpose: 'Client project supplies', items: [{ description: 'paper', amount: 32.5 }], confidence: 'high' }));
    expect((await POST(request({ docType: 'receipt' }))).status).toBe(200);
    expect(mocks.writes[0].data).toMatchObject({ source: 'receipt', business_purpose: 'Client project supplies', is_deductible: null, analysis_status: 'pending', transaction_type: 'debit', amount: 32.5 });
  });
  it('does not invent today as the date of an unreadable receipt', async () => {
    mocks.create.mockResolvedValue(completion({ currency: 'USD', merchant: 'Synthetic', total: 32.5, date: null, confidence: 'high' }));
    expect((await POST(request({ docType: 'receipt' }))).status).toBe(422);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated uploads before provider or database work', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'Unauthorized' });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
  it.each([
    ['PDF', new File(['%PDF-test'], 'synthetic.pdf', { type: 'application/pdf' }), 415],
    ['mislabeled image', new File(['not-image'], 'synthetic.png', { type: 'image/png' }), 415],
    ['too large', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), 413],
  ])('rejects %s before the provider call', async (_name, file, status) => {
    expect((await POST(request({}, file))).status).toBe(status);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});
