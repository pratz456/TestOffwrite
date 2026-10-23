import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// In-memory Firestore for the top-level tax collections; bank transactions come from the shared reader mock.
const state = vi.hoisted(() => ({
  uid: 'owner-a' as string | null,
  docs: new Map<string, Record<string, unknown>>(),
  transactions: {} as Record<string, Record<string, unknown>[]>,
  txError: null as Error | null,
  writes: [] as string[],
  seq: 0,
}));
vi.mock('@/lib/firebase/api-auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/firebase/api-auth')>(),
  getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null, error: state.uid ? null : 'Unauthorized' }),
}));
vi.mock('@/lib/reports/tax-export-transactions', () => ({
  readTaxExportTransactions: async (uid: string, year: number) => {
    if (state.txError) throw state.txError;
    return (state.transactions[uid] ?? []).filter(tx => String(tx.date).startsWith(String(year)));
  },
}));
vi.mock('@/lib/firebase/admin', () => {
  const snapshot = (path: string) => ({ id: path.split('/').pop()!, ref: { path }, exists: state.docs.has(path), data: () => state.docs.get(path) });
  const query = (name: string, filters: Array<[string, unknown]>) => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    get: async () => {
      const docs = [...state.docs.entries()]
        .filter(([path, data]) => path.startsWith(`${name}/`) && path.split('/').length === 2 && filters.every(([field, value]) => data[field] === value))
        .map(([path]) => snapshot(path));
      return { empty: docs.length === 0, docs };
    },
  });
  return { adminDb: { collection: (name: string) => ({
    ...query(name, []),
    add: async (data: Record<string, unknown>) => {
      const id = `${name}-${++state.seq}`;
      state.docs.set(`${name}/${id}`, data); state.writes.push(`add ${name}/${id}`);
      return { id };
    },
    doc: (id: string) => ({
      get: async () => snapshot(`${name}/${id}`),
      set: async (data: Record<string, unknown>) => { state.docs.set(`${name}/${id}`, data); state.writes.push(`set ${name}/${id}`); },
      delete: async () => { state.docs.delete(`${name}/${id}`); state.writes.push(`delete ${name}/${id}`); },
    }),
  }) } };
});
import { DELETE, GET, PATCH, POST } from '../app/api/income/reconciliation/route';
import { ExportReviewRequiredError } from '../lib/reports/transaction-export';
import { ExportDataUnavailableError } from '../lib/reports/export-records';
import { CONFIRM_FORMS_REQUIRED, ERR_SAME_NEEDS_K, STALE_APP_REFRESH } from '../lib/tax-rules/income-reconciliation-copy';

type Body = Record<string, unknown>;
function request(method: string, { body, query = '', headers = {} }: { body?: unknown; query?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost/api/income/reconciliation${query}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const seed = (collection: string, id: string, data: Record<string, unknown>) => state.docs.set(`${collection}/${id}`, { ...data });
const deposit = (id: string, amount: number, date = '2026-03-01') => ({ id, trans_id: id, account_id: 'bank-1', amount: -amount, category: 'income', type: 'income', date, merchant_name: 'Synthetic platform payout' });
const ref = (kind: string, id: string, amount: number) => ({ kind, id, amount });
const samePayments = (sources: Body[], extra: Body = {}) => ({ taxYear: 2026, decision: 'same_payments', sources, explicitChoice: true, ...extra });
async function json(response: Response) { return { status: response.status, body: await response.json() as Body }; }

beforeEach(() => {
  state.uid = 'owner-a'; state.docs.clear(); state.transactions = {}; state.txError = null; state.writes.length = 0; state.seq = 0;
  seed('gross_receipts', 'r1', { userId: 'owner-a', taxYear: 2026, amount: 12000, source: 'Synthetic platform', date: '2026-01-31', type: 'freelance' });
  seed('gross_receipts', 'r-other-owner', { userId: 'owner-b', taxYear: 2026, amount: 5000, source: 'Other owner', date: '2026-02-01', type: 'freelance' });
  seed('gross_receipts', 'r-prior-year', { userId: 'owner-a', taxYear: 2025, amount: 7000, source: 'Prior year', date: '2025-06-01', type: 'freelance' });
  seed('income_1099', 'k1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-K', payerName: 'Synthetic platform' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('income reconciliation API access', () => {
  it('rejects unauthenticated requests before reading or writing anything', async () => {
    state.uid = null;
    expect((await GET(request('GET', { query: '?year=2026' }))).status).toBe(401);
    expect((await POST(request('POST', { body: samePayments([]) }))).status).toBe(401);
    expect((await PATCH(request('PATCH', { body: { id: 'x', ...samePayments([]) } }))).status).toBe(401);
    expect((await DELETE(request('DELETE', { query: '?id=x' }))).status).toBe(401);
    expect(state.writes).toEqual([]);
  });

  it.each([{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://attacker.example' }])('rejects cross-site mutations %j while leaving reads owner-scoped', async headers => {
    const body = samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)]);
    expect((await POST(request('POST', { body, headers }))).status).toBe(403);
    expect((await PATCH(request('PATCH', { body: { id: 'x', ...body }, headers }))).status).toBe(403);
    expect((await DELETE(request('DELETE', { query: '?id=x', headers }))).status).toBe(403);
    expect(state.writes).toEqual([]);
    expect((await POST(request('POST', { body, headers: { origin: 'http://localhost' } }))).status).toBe(201);
  });

  it.each(['abc', '20', '2026.5', ''])('rejects the tax year %s', async year => {
    expect((await GET(request('GET', { query: `?year=${year}` }))).status).toBe(400);
  });
});

describe('income reconciliation explainer', () => {
  it('lists only the owner’s records for the year, with the conflicts that block a total and no merge', async () => {
    const response = await GET(request('GET', { query: '?year=2026' }));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { status, body } = await json(response);
    expect(status).toBe(200);
    expect(body.candidates).toEqual([
      { kind: 'gross_receipt', id: 'r1', amount: 12000, label: 'Direct income · Synthetic platform', date: '2026-01-31' },
      { kind: 'form_1099', id: 'k1', amount: 12000, formType: '1099-K', payerName: 'Synthetic platform', label: '1099-K · Synthetic platform' },
    ]);
    expect(body.conflicts).toEqual([expect.objectContaining({ reason: 'overlapping_sources', sources: [expect.objectContaining({ id: 'r1' }), expect.objectContaining({ id: 'k1' })] })]);
    expect(body).toMatchObject({ taxYear: 2026, grossReceipts: null, decisions: [], unclaimedAmount: 24000, reconciledAmount: 0 });
    expect(String(body.policy)).toContain('never merges');
    expect(JSON.stringify(body)).not.toContain('owner-');
    expect(state.writes).toEqual([]);
  });

  it('describes records that need review outside this workflow instead of guessing', async () => {
    seed('income_1099', 'misc', { userId: 'owner-a', taxYear: 2026, amount: 900, formType: '1099-MISC', payerName: 'Rents Inc' });
    const { status, body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(status).toBe(200);
    expect(body.unsupported).toContain('Confirm the tax treatment of this 1099');
    expect(body).toMatchObject({ candidates: [], conflicts: [], grossReceipts: null });
    const rejected = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)]) })));
    expect(rejected.status).toBe(422);
    expect(state.writes).toEqual([]);
  });

  it('reports a saved decision that no longer matches the records as stale rather than applying it', async () => {
    seed('income_reconciliations', 'old', { userId: 'owner-a', taxYear: 2026, decision: 'same_payments', platformFeeAmount: null, decidedAt: '2026-02-01T00:00:00.000Z',
      sources: [{ ...ref('form_1099', 'k1', 11000), label: '1099-K · Synthetic platform' }, { ...ref('gross_receipt', 'r1', 11000), label: 'Direct income · Synthetic platform' }] });
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'stale_decision', decisionId: 'old' })]));
    expect(body.decisions).toEqual([expect.objectContaining({ id: 'old', decision: 'same_payments', applied: false, decidedAt: '2026-02-01T00:00:00.000Z' })]);
    expect(body.grossReceipts).toBeNull();
  });

  it('passes transaction review and data-availability failures through as 422 and 503 without leaking details', async () => {
    state.txError = new ExportReviewRequiredError('Duplicate transaction identifiers exist in saved records.');
    const review = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(review).toMatchObject({ status: 422, body: { code: 'EXPORT_REVIEW_REQUIRED' } });
    state.txError = new ExportDataUnavailableError();
    expect((await GET(request('GET', { query: '?year=2026' }))).status).toBe(503);
    state.txError = new Error('provider outage details');
    const outage = await GET(request('GET', { query: '?year=2026' }));
    expect(outage.status).toBe(500);
    expect(await outage.text()).not.toContain('provider outage');
  });
});

describe('recording reconciliation decisions', () => {
  it('stores a validated same-payments decision with who/when and the amounts at decision time, then counts once', async () => {
    const before = JSON.stringify([state.docs.get('gross_receipts/r1'), state.docs.get('income_1099/k1')]);
    const created = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)], { note: '  Platform payouts  ' }) })));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ success: true, id: 'income_reconciliations-1', countedAmount: 12000 });
    const stored = state.docs.get('income_reconciliations/income_reconciliations-1')!;
    expect(stored).toMatchObject({
      userId: 'owner-a', decidedBy: 'owner-a', taxYear: 2026, decision: 'same_payments', note: 'Platform payouts', countedAmount: 12000, platformFeeAmount: null, version: 2, notBusinessParts: [],
      sources: [{ kind: 'form_1099', id: 'k1', amount: 12000, label: '1099-K · Synthetic platform' }, { kind: 'gross_receipt', id: 'r1', amount: 12000, label: 'Direct income · Synthetic platform' }],
    });
    expect(stored.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored.choiceConfirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.writes).toEqual(['add income_reconciliations/income_reconciliations-1']);
    expect(JSON.stringify([state.docs.get('gross_receipts/r1'), state.docs.get('income_1099/k1')])).toBe(before);

    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body).toMatchObject({ conflicts: [], grossReceipts: 12000, reconciledAmount: 12000, unclaimedAmount: 0 });
    expect(body.candidates).toEqual([expect.objectContaining({ id: 'r1', decisionId: 'income_reconciliations-1' }), expect.objectContaining({ id: 'k1', decisionId: 'income_reconciliations-1' })]);
    expect(body.decisions).toEqual([expect.objectContaining({ id: 'income_reconciliations-1', applied: true, countedAmount: 12000, note: 'Platform payouts' })]);
  });

  it.each([
    {},
    { taxYear: 2026, decision: 'merge', sources: [ref('form_1099', 'k1', 12000)] },
    { taxYear: 2026, decision: 'same_payments', sources: [] },
    { taxYear: 2026, decision: 'same_payments', sources: [ref('w2', 'k1', 12000), ref('gross_receipt', 'r1', 12000)] },
    { taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k1', -12000), ref('gross_receipt', 'r1', 12000)] },
    { taxYear: 'later', decision: 'same_payments', sources: [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)] },
    { taxYear: 2026, decision: 'k_includes_fees', sources: [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)], platformFeeAmount: 'ten' },
  ])('rejects a malformed decision body before any write: %j', async body => {
    const response = await POST(request('POST', { body }));
    expect(response.status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it('rejects decisions that disagree with the records, reuse a reconciled record, or name another owner’s record', async () => {
    state.transactions['owner-a'] = [deposit('t1', 12000)];
    const mismatch = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 11000), ref('gross_receipt', 'r1', 12000)]) })));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toContain('is $12,000.00 in your records, not the $11,000.00');
    const otherOwner = await json(await POST(request('POST', { body: { taxYear: 2026, decision: 'separate_income', explicitChoice: true, sources: [ref('gross_receipt', 'r-other-owner', 5000)] } })));
    expect(otherOwner.status).toBe(400);
    expect(otherOwner.body.error).toContain('no longer exists for this tax year');
    expect(state.writes).toEqual([]);

    expect((await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)]) }))).status).toBe(201);
    const reused = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 12000), ref('transaction', 't1', 12000)]) })));
    expect(reused.status).toBe(400);
    expect(reused.body.error).toContain('already reconciled in another saved decision');
    expect(state.writes).toHaveLength(1);
    // The remaining deposit still needs its own decision; nothing is inferred from matching amounts.
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.conflicts).toEqual([expect.objectContaining({ reason: 'unreconciled_against_decision', sources: [expect.objectContaining({ id: 't1' })] })]);
  });

  it('uses the 1099-K gross for a fee decision and flags the fee for review without creating an expense', async () => {
    state.docs.set('income_1099/k1', { ...state.docs.get('income_1099/k1'), amount: 10500 });
    state.docs.delete('gross_receipts/r1');
    state.transactions['owner-a'] = [deposit('t1', 6000), deposit('t2', 4000)];
    const body = { taxYear: 2026, decision: 'k_includes_fees', explicitChoice: true, platformFeeAmount: 500, sources: [ref('form_1099', 'k1', 10500), ref('transaction', 't1', 6000), ref('transaction', 't2', 4000)] };
    const created = await json(await POST(request('POST', { body })));
    expect(created).toMatchObject({ status: 201, body: { countedAmount: 10500 } });
    expect(state.docs.get('income_reconciliations/income_reconciliations-1')).toMatchObject({ platformFeeAmount: 500, countedAmount: 10500 });
    const summary = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(summary.body).toMatchObject({ grossReceipts: 10500, conflicts: [], feeExpenseCandidates: [{ decisionId: 'income_reconciliations-1', formId: 'k1', amount: 500 }] });
    expect(state.writes.filter(write => !write.includes('income_reconciliations'))).toEqual([]);
  });
});

describe('updating and removing decisions', () => {
  beforeEach(() => {
    seed('income_reconciliations', 'theirs', { userId: 'owner-b', taxYear: 2026, decision: 'separate_income', platformFeeAmount: null, createdAt: 'their-time',
      sources: [{ ...ref('gross_receipt', 'r-other-owner', 5000), label: 'Direct income · Other owner' }] });
  });

  it('refuses to update or remove another owner’s decision and reports missing ones', async () => {
    const body = { id: 'theirs', taxYear: 2026, decision: 'separate_income', explicitChoice: true, sources: [ref('gross_receipt', 'r1', 12000)] };
    expect((await PATCH(request('PATCH', { body }))).status).toBe(403);
    expect((await DELETE(request('DELETE', { query: '?id=theirs' }))).status).toBe(403);
    expect((await DELETE(request('DELETE', { query: '?id=missing' }))).status).toBe(404);
    expect((await DELETE(request('DELETE'))).status).toBe(400);
    expect(state.writes).toEqual([]);
    expect(state.docs.get('income_reconciliations/theirs')).toMatchObject({ userId: 'owner-b' });
    // Another owner's decision never enters this owner's explainer.
    const { body: summary } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(summary.decisions).toEqual([]);
  });

  it('replaces an owned decision after validation, keeps its year and creation time, and removes it without touching records', async () => {
    const created = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)]) })));
    const id = String(created.body.id);
    const createdAt = state.docs.get(`income_reconciliations/${id}`)!.createdAt;
    const otherYear = await json(await PATCH(request('PATCH', { body: { id, ...samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)], { taxYear: 2025 }) } })));
    expect(otherYear.status).toBe(400);
    const invalid = await json(await PATCH(request('PATCH', { body: { id, taxYear: 2026, decision: 'same_payments', explicitChoice: true, sources: [ref('form_1099', 'k1', 1), ref('gross_receipt', 'r1', 12000)] } })));
    expect(invalid.status).toBe(400);
    expect(String(invalid.body.error)).toContain('in your records');
    expect(state.writes).toHaveLength(1);

    const updated = await json(await PATCH(request('PATCH', { body: { id, ...samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)], { note: 'Confirmed against the platform statement' }) } })));
    expect(updated).toMatchObject({ status: 200, body: { success: true, id, countedAmount: 12000 } });
    expect(state.docs.get(`income_reconciliations/${id}`)).toMatchObject({ userId: 'owner-a', note: 'Confirmed against the platform statement', createdAt, countedAmount: 12000 });

    expect((await DELETE(request('DELETE', { query: `?id=${id}` }))).status).toBe(200);
    expect(state.docs.has(`income_reconciliations/${id}`)).toBe(false);
    expect(state.docs.get('gross_receipts/r1')).toMatchObject({ amount: 12000 });
    expect(state.docs.get('income_1099/k1')).toMatchObject({ amount: 12000 });
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.conflicts).toHaveLength(1);
    expect(body.grossReceipts).toBeNull();
  });
});

describe('explicit choice and save rules', () => {
  it('rejects a valid same-payments body that omits explicitChoice before any other validation', async () => {
    const created = await json(await POST(request('POST', { body: { taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)] } })));
    expect(created).toMatchObject({ status: 400, body: { error: STALE_APP_REFRESH } });
    expect(state.writes).toEqual([]);
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.grossReceipts).toBeNull();
  });

  it('refuses to count a 1099-K and a 1099-NEC as $12,000 without an explicit choice', async () => {
    state.docs.delete('gross_receipts/r1');
    seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Synthetic client' });
    const created = await json(await POST(request('POST', { body: { taxYear: 2026, decision: 'same_payments', sources: [ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 12000)] } })));
    expect(created).toMatchObject({ status: 400, body: { error: STALE_APP_REFRESH } });
    expect(state.writes).toEqual([]);
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.grossReceipts).toBeNull();
    expect(body.grossReceipts).not.toBe(12000);
  });

  it('rejects same payments for two 1099-NEC forms and counts a separate-income save as $24,000', async () => {
    state.docs.delete('gross_receipts/r1');
    state.docs.delete('income_1099/k1');
    seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client A' });
    seed('income_1099', 'n2', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client B' });
    const rejected = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)]) })));
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe(ERR_SAME_NEEDS_K);
    expect(state.writes).toEqual([]);
    const saved = await json(await POST(request('POST', { body: { taxYear: 2026, decision: 'separate_income', explicitChoice: true, sources: [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)] } })));
    expect(saved.status).toBe(201);
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.grossReceipts).toBe(24000);
    expect(body.conflicts).toEqual([]);
  });

  it('hides the not-business decision from the API unless the flag is on', async () => {
    delete process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME;
    state.docs.delete('gross_receipts/r1');
    const body = { taxYear: 2026, decision: 'k_not_business_income', explicitChoice: true, sources: [ref('form_1099', 'k1', 12000)], notBusinessParts: [{ reason: 'personal', amount: 12000 }] };
    const hidden = await json(await POST(request('POST', { body })));
    expect(hidden.status).toBe(400);
    expect(String(hidden.body.error)).not.toContain('k_not_business_income');
    expect(state.writes).toEqual([]);
    process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME = '1';
    const shown = await json(await POST(request('POST', { body })));
    expect(shown.status).toBe(201);
    delete process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME;
    const { body: summary } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(summary.grossReceipts).toBe(0);
    expect(summary.outsideScheduleC).toEqual([expect.objectContaining({ amount: 12000 })]);
  });

  it('refuses a two-form same-payments save until the form total is confirmed', async () => {
    state.docs.delete('gross_receipts/r1');
    seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client A' });
    const sources = [ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 12000)];
    const missing = await json(await POST(request('POST', { body: samePayments(sources) })));
    const short = await json(await POST(request('POST', { body: samePayments(sources, { confirmedFormsTotal: 23999.99 }) })));
    expect(missing).toMatchObject({ status: 400, body: { error: CONFIRM_FORMS_REQUIRED } });
    expect(short).toMatchObject({ status: 400, body: { error: CONFIRM_FORMS_REQUIRED } });
    expect(state.writes).toEqual([]);
    const saved = await json(await POST(request('POST', { body: samePayments(sources, { confirmedFormsTotal: 24000 }) })));
    expect(saved.status).toBe(201);
    expect(state.docs.get(`income_reconciliations/${String(saved.body.id)}`)).not.toHaveProperty('confirmedFormsTotal');
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.grossReceipts).toBe(12000);
  });

  it('does not ask for a form total when only one 1099 is selected', async () => {
    const saved = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)]) })));
    expect(saved.status).toBe(201);
    expect(saved.body).not.toHaveProperty('error');
  });

  it('rejects same payments for two 1099-NECs even when the form total is confirmed', async () => {
    state.docs.delete('gross_receipts/r1');
    state.docs.delete('income_1099/k1');
    for (const payer of ['Client B', 'Client A']) {
      state.docs.clear();
      state.writes.length = 0;
      seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client A' });
      seed('income_1099', 'n2', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: payer });
      const rejected = await json(await POST(request('POST', { body: samePayments([ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)], { confirmedFormsTotal: 24000 }) })));
      expect(rejected).toMatchObject({ status: 400, body: { error: ERR_SAME_NEEDS_K } });
      expect(state.writes).toEqual([]);
    }
    const saved = await json(await POST(request('POST', { body: { taxYear: 2026, decision: 'separate_income', explicitChoice: true, sources: [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)] } })));
    expect(saved.status).toBe(201);
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.grossReceipts).toBe(24000);
  });

  it('deletes only the decision when a corrected form is removed', async () => {
    state.docs.delete('gross_receipts/r1');
    state.docs.delete('income_1099/k1');
    seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client A' });
    seed('income_1099', 'n2', { userId: 'owner-a', taxYear: 2026, amount: 12500, formType: '1099-NEC', payerName: 'Client A' });
    const before = JSON.stringify(state.docs.get('income_1099/n1'));
    const created = await json(await POST(request('POST', { body: {
      taxYear: 2026, decision: 'corrected_form_replaces', explicitChoice: true, correctedFormId: 'n2',
      sources: [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12500)],
    } })));
    expect(created.status).toBe(201);
    expect(state.docs.get(`income_reconciliations/${String(created.body.id)}`)).toMatchObject({ correctedFormId: 'n2', countedAmount: 12500 });
    expect((await DELETE(request('DELETE', { query: `?id=${String(created.body.id)}` }))).status).toBe(200);
    expect(state.writes.filter(write => write.includes('income_1099'))).toEqual([]);
    expect(JSON.stringify(state.docs.get('income_1099/n1'))).toBe(before);
    const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
    expect(body.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'multiple_forms', sources: expect.arrayContaining([
        expect.objectContaining({ id: 'n1' }), expect.objectContaining({ id: 'n2' }),
      ]) }),
    ]));
  });

  it('rejects a PATCH that omits explicitChoice before any write', async () => {
    seed('income_reconciliations', 'd1', {
      userId: 'owner-a', taxYear: 2026, decision: 'same_payments', countedAmount: 12000,
      sources: [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)],
    });
    const response = await json(await PATCH(request('PATCH', { body: {
      id: 'd1', taxYear: 2026, decision: 'same_payments',
      sources: [ref('form_1099', 'k1', 12000), ref('gross_receipt', 'r1', 12000)],
    } })));
    expect(response).toMatchObject({ status: 400, body: { error: STALE_APP_REFRESH } });
    expect(state.writes).toEqual([]);
  });

  it('rejects a PATCH of the not-business decision while its flag is off and writes nothing', async () => {
    delete process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME;
    state.docs.delete('gross_receipts/r1');
    seed('income_reconciliations', 'd1', {
      userId: 'owner-a', taxYear: 2026, decision: 'separate_income', countedAmount: 12000,
      sources: [ref('form_1099', 'k1', 12000)],
    });
    const response = await json(await PATCH(request('PATCH', { body: {
      id: 'd1', taxYear: 2026, decision: 'k_not_business_income', explicitChoice: true,
      sources: [ref('form_1099', 'k1', 12000)],
      notBusinessParts: [{ reason: 'personal', amount: 12000 }],
    } })));
    expect(response.status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it('rejects a PATCH of two forms until the form total is confirmed and writes nothing', async () => {
    state.docs.delete('gross_receipts/r1');
    seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client A' });
    seed('income_reconciliations', 'd1', {
      userId: 'owner-a', taxYear: 2026, decision: 'same_payments', countedAmount: 12000,
      sources: [ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 12000)],
    });
    const response = await json(await PATCH(request('PATCH', { body: samePayments([
      ref('form_1099', 'k1', 12000), ref('form_1099', 'n1', 12000),
    ], { id: 'd1' }) })));
    expect(response).toMatchObject({ status: 400, body: { error: CONFIRM_FORMS_REQUIRED } });
    expect(state.writes).toEqual([]);
  });

  it('rejects duplicate not-business reasons before any write', async () => {
    process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME = '1';
    try {
      state.docs.delete('gross_receipts/r1');
      const body = {
        taxYear: 2026, decision: 'k_not_business_income', explicitChoice: true,
        sources: [ref('form_1099', 'k1', 12000)],
        notBusinessParts: [{ reason: 'personal', amount: 12000 }, { reason: 'personal', amount: 1 }],
      };
      const created = await json(await POST(request('POST', { body })));
      expect(created.status).toBe(400);
      expect(state.writes).toEqual([]);
      seed('income_reconciliations', 'd1', {
        userId: 'owner-a', taxYear: 2026, decision: 'separate_income', countedAmount: 12000,
        sources: [ref('form_1099', 'k1', 12000)],
      });
      const updated = await json(await PATCH(request('PATCH', { body: { id: 'd1', ...body } })));
      expect(updated.status).toBe(400);
      expect(state.writes).toEqual([]);
      expect(state.docs.get('income_reconciliations/d1')).toMatchObject({ decision: 'separate_income' });
    } finally {
      delete process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME;
    }
  });

  it('saves yes for a legacy NEC-only same-payments decision and for two NECs plus deposits, and keeps each saved total', async () => {
    delete process.env.legacyNecReopen;
    for (const withDeposit of [false, true]) {
      state.docs.clear();
      state.writes.length = 0;
      state.transactions = {};
      seed('income_1099', 'n1', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client A' });
      seed('income_1099', 'n2', { userId: 'owner-a', taxYear: 2026, amount: 12000, formType: '1099-NEC', payerName: 'Client B' });
      const sources = [ref('form_1099', 'n1', 12000), ref('form_1099', 'n2', 12000)];
      if (withDeposit) {
        state.transactions['owner-a'] = [deposit('t1', 12000)];
        sources.push(ref('transaction', 't1', 12000));
      }
      seed('income_reconciliations', 'legacy', {
        userId: 'owner-a', taxYear: 2026, decision: 'same_payments', version: 1, countedAmount: 12000, sources,
      });
      const saved = await json(await PATCH(request('PATCH', { body: samePayments(sources, { id: 'legacy', confirmedFormsTotal: 24000 }) })));
      expect(saved.status, withDeposit ? 'deposits' : 'forms').toBe(200);
      expect(saved.body.countedAmount).toBe(12000);
      expect(state.docs.get('income_reconciliations/legacy')).toMatchObject({ decision: 'same_payments', countedAmount: 12000, version: 2 });
      const { body } = await json(await GET(request('GET', { query: '?year=2026' })));
      expect(body.grossReceipts).toBe(12000);
      expect(body.conflicts).toEqual([]);
    }
  });
});
