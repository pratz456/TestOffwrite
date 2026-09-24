import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { accountResultSchema, isAccountActionHref } from '@/lib/tax-assistant/account-contract';
import { extractTaxPosition, taxPositionResult, transactionAccountResult } from '@/lib/tax-assistant/account-tools';
const h = vi.hoisted(() => ({ authenticate: vi.fn(), create: vi.fn(), records: vi.fn(), tax: vi.fn(), guidance: vi.fn(), save: vi.fn(), key: true }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: h.authenticate }));
vi.mock('@/lib/openai/client', () => ({ hasOpenAIAPIKey: () => h.key, getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: h.create } } }) }));
vi.mock('@/lib/tax-assistant/account-records', () => ({ readAssistantTransactions: h.records }));
vi.mock('@/lib/tax-assistant/account-history', () => ({ saveTaxPosition: h.save }));
vi.mock('@/app/api/ai/tax-assistant/route', () => ({ POST: h.guidance }));
vi.mock('@/app/api/tax/compute-1040/route', () => ({ GET: h.tax }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { resetRateLimitStore } from './fixtures/rate-limit-store';
import { POST } from '@/app/api/ai/account-assistant/route';
const now = new Date('2026-09-23T12:00:00Z');
const row = { id: 'one', userId: 'owner', merchant_name: 'Adobe', amount: 59, date: '2026-09-10', iso_currency_code: 'USD' };
const tax = { taxYear: 2026, income: { grossReceipts: 60000, totalDeductible: 5000 }, form1040: { totalTax: 11413, balanceDue: 1000, refund: 0, calculationWarnings: [] } };
const completion = (value: unknown) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value), refusal: null } }] });
const req = (body: unknown = { message: 'What needs review?', taxYear: 2026 }) => new NextRequest('http://localhost/api/ai/account-assistant', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' } });
beforeEach(() => { vi.clearAllMocks(); resetRateLimitStore(); h.key = true; h.authenticate.mockResolvedValue({ user: { uid: 'owner' } }); h.create.mockResolvedValue(completion({ intent: 'review_transactions' })); h.records.mockResolvedValue([row]); h.tax.mockImplementation(async () => NextResponse.json(tax)); h.guidance.mockImplementation(async () => NextResponse.json({ reply: 'Reviewed legal guidance' })); h.save.mockResolvedValue(null); });

describe('account assistant read boundary', () => {
  it('authenticates before provider or record reads', async () => {
    h.authenticate.mockResolvedValue({ user: null, error: 'expired' });
    expect((await POST(req())).status).toBe(401); expect(h.create).not.toHaveBeenCalled(); expect(h.records).not.toHaveBeenCalled();
  });
  it.each([{ message: 'lookup', userId: 'victim' }, { message: 'lookup', taxYear: 2024 }, { message: 'lookup', imageDataUrl: 'https://attacker.example/photo' }])('rejects caller identity or invalid input %j', async body => {
    expect((await POST(req(body))).status).toBe(400); expect(h.create).not.toHaveBeenCalled();
  });
  it('routes with GPT, scopes reads to owner, and keeps records out of routing prompt', async () => {
    const response = await POST(req()); const result = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(h.records).toHaveBeenCalledExactlyOnceWith('owner');
    expect(h.create.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o', store: false });
    expect(JSON.stringify(h.create.mock.calls[0])).not.toContain('Adobe');
    expect(result.account.items[0].label).toBe('Adobe'); expect(accountResultSchema.safeParse(result.account).success).toBe(true);
  });
  it.each([{ intent: 'delete_all' }, { intent: 'tax_position', userId: 'victim' }, { intent: 'missing_receipts', answer: 'You qualify' }])('refuses unsafe or injected model actions %j', async choice => {
    h.create.mockResolvedValue(completion(choice)); expect((await POST(req())).status).toBe(502); expect(h.records).not.toHaveBeenCalled(); expect(h.tax).not.toHaveBeenCalled();
  });
  it('refuses incomplete model calls and hides provider payloads', async () => {
    h.create.mockResolvedValue({ choices: [] }); expect((await POST(req())).status).toBe(502);
    h.create.mockRejectedValue(new Error('private provider key and records')); const response = await POST(req());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private provider');
  });
  it('does not show an empty checklist when the record read failed', async () => {
    h.records.mockRejectedValue(new Error('private query failure')); expect((await POST(req())).status).toBe(503);
  });
  it('uses reviewed tax guidance for legal questions', async () => {
    h.create.mockResolvedValue(completion({ intent: 'tax_guidance' }));
    expect(await (await POST(req({ message: 'Are receipts required for meals?', taxYear: 2026 }))).json()).toEqual({ reply: 'Reviewed legal guidance' });
    const forwarded = h.guidance.mock.calls[0][0]; expect(forwarded.headers.get('authorization')).toBe('Bearer synthetic');
    expect((await forwarded.json()).message).toBe('Are receipts required for meals?'); expect(h.records).not.toHaveBeenCalled();
  });
  it('reuses validated federal amounts and stores only a successful owner/year baseline', async () => {
    h.create.mockResolvedValue(completion({ intent: 'tax_position' }));
    const result = await (await POST(req())).json(); expect(result.reply).toContain('$11,413.00');
    expect(h.tax.mock.calls[0][0].nextUrl.searchParams.get('year')).toBe('2026');
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', taxYear: 2026, totalTax: 11413 }));
  });
  it('keeps eligibility gates visible instead of displaying invented zeros or saving a baseline', async () => {
    h.create.mockResolvedValue(completion({ intent: 'tax_changes' }));
    h.tax.mockImplementation(async () => NextResponse.json({ error: 'Reconcile duplicated income first.', code: 'INCOME_RECONCILIATION_REQUIRED' }, { status: 422 }));
    const result = await (await POST(req())).json(); expect(result.reply).toBe('Reconcile duplicated income first.'); expect(result.account.metrics).toEqual([]); expect(h.save).not.toHaveBeenCalled();
  });
  it('does not replace 2027 unavailable guidance with 2026 amounts', async () => {
    h.create.mockResolvedValue(completion({ intent: 'tax_position' }));
    h.tax.mockImplementation(async () => NextResponse.json({ error: 'Annual 2027 figures are not published.', code: 'TAX_YEAR_UNAVAILABLE' }, { status: 400 }));
    const result = await (await POST(req({ message: 'What do I owe?', taxYear: 2027 }))).json(); expect(result.account.metrics).toEqual([]); expect(h.save).not.toHaveBeenCalled();
  });
  it('links to the Premium-gated handoff flow without exporting or sharing anything', async () => {
    h.create.mockResolvedValue(completion({ intent: 'prepare_handoff' })); const result = await (await POST(req())).json();
    expect(result.account.actions[0].href).toBe('/protected?screen=tax-filing-hub'); expect(h.records).not.toHaveBeenCalled(); expect(h.tax).not.toHaveBeenCalled();
  });
});

describe('account facts, scope and comparisons', () => {
  it('accepts server-normalized ISO dates, bounds labels and safely encodes record IDs', () => {
    const result = transactionAccountResult({ intent: 'review_transactions', uid: 'owner', taxYear: 2026, now,
      rows: [{ ...row, date: '2026-09-10T00:00:00.000Z', id: "business-owner's-entry", merchant_name: 'A'.repeat(140) }] });
    expect(result.account.metrics[0].value).toBe('1'); expect(result.account.items[0].detail).toContain('2026-09-10 · $59.00');
    expect(result.account.items[0].label).toHaveLength(100); expect(result.account.items[0].href).toContain('%27');
    expect(accountResultSchema.safeParse(result.account).success).toBe(true);
  });
  it('excludes bank-removed records and never labels an unofficial currency as USD', () => {
    const result = transactionAccountResult({ intent: 'missing_receipts', uid: 'owner', taxYear: 2026, now,
      rows: [{ ...row, bank_removed: true }, { ...row, unofficial_currency_code: 'BTC' }] });
    expect(result.account.metrics[0].value).toBe('1'); expect(result.account.items[0].detail).toContain('currency review');
    expect(result.account.items[0].detail).not.toContain('$59.00');
  });
  it('excludes foreign/conflicting ownership, other years, invalid dates, superseded and pending rows', () => {
    const result = transactionAccountResult({ intent: 'review_transactions', uid: 'owner', taxYear: 2026, now, rows: [row,
      { ...row, userId: 'other' }, { ...row, user_id: 'other' }, { ...row, date: '2027-01-01' }, { ...row, date: '2026-99-40' },
      { ...row, date: '2026-02-30' }, { ...row, superseded_by: 'replacement' }, { ...row, pending: true }] });
    expect(result.account.metrics[0].value).toBe('1'); expect(result.account.scope).toContain('up to 500');
  });
  it('lists unattached expenses, excluding known personal, refunds, transfers and attached receipts', () => {
    const result = transactionAccountResult({ intent: 'missing_receipts', uid: 'owner', taxYear: 2026, now, rows: [row,
      { ...row, receipt_url: '/api/receipts/abc' }, { ...row, is_deductible: false }, { ...row, transaction_kind: 'personal' },
      { ...row, amount: -59 }, { ...row, transaction_kind: 'transfer' }] });
    expect(result.account.metrics[0].value).toBe('1'); expect(result.account.notes[0]).toContain('does not establish');
  });
  it('never formats foreign or unknown currency as US dollars', () => {
    const result = transactionAccountResult({ intent: 'missing_receipts', uid: 'owner', taxYear: 2026, now, rows: [{ ...row, iso_currency_code: 'EUR' }] });
    expect(result.account.items[0].detail).not.toContain('$59'); expect(result.account.items[0].detail).toContain('currency review');
  });
  it('rejects partial/wrong year snapshots and compares only owner-matched saved baselines', () => {
    expect(extractTaxPosition({ ...tax, taxYear: 2025 }, 'owner', 2026, now)).toBeNull();
    expect(extractTaxPosition({ ...tax, form1040: {} }, 'owner', 2026, now)).toBeNull();
    const current = extractTaxPosition(tax, 'owner', 2026, now)!;
    const previous = { ...current, totalTax: 12000, checkedAt: '2026-09-22T00:00:00Z' };
    expect(taxPositionResult(current, previous, true).account.notes[0]).toContain('-$587.00');
    expect(taxPositionResult(current, { ...previous, userId: 'other' }, true).account.notes[0]).toContain('first comparable');
    expect(taxPositionResult(current, null, true).account.notes[0]).toContain('first comparable');
  });
  it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)', '/api/user/delete', '/protected?screen=settings&redirect=evil'])('refuses non-navigation targets %s', href => expect(isAccountActionHref(href)).toBe(false));
});
