import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => ({
  user: null as null | { uid: string },
  recordCorrection: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));
vi.mock('@/lib/firebase/api-auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/firebase/api-auth')>(),
  getAuthenticatedUser: async () => ({ user: mock.user, error: mock.user ? null : 'Unauthorized' }),
}));
vi.mock('@/lib/firebase/admin', async () => {
  const fake = await import('./fixtures/fake-firestore');
  return { adminDb: fake.createFakeFirestore(), adminAuth: {}, FieldValue: fake.fakeFieldValue };
});
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { recordCorrection: mock.recordCorrection } }));
vi.mock('@/lib/ai/taxpayer-context-server', () => ({ invalidateTaxpayerContextCache: mock.invalidate }));

import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import { exhaustRateLimit, failRateLimitStore, recordedRateLimitCount, resetRateLimitStore } from './fixtures/rate-limit-store';
import { POST } from '@/app/api/transactions/bulk-confirm/route';
import { RATE_LIMITS } from '@/lib/security/rate-limit';
import { BULK_CONFIRM_BATCH_SIZE, BULK_CONFIRM_MAX_TRANSACTIONS } from '@/lib/transactions/bulk-confirm';

const db = adminDb as unknown as FakeFirestore;
const uid = 'owner-uid';
const other = 'other-uid';
const now = new Date('2026-09-17T15:00:00Z');
const suggestion = { id: 's1', status: 'needs_more_info', transactionKind: 'expense', category: 'software_subscriptions', isDeductible: null,
  deductiblePercent: 100, reasoning: 'Recurring design software charge.', proposed_purpose: 'Design software for client work', questions: [], inputHash: 'h' };

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new NextRequest('https://writeoff.test/api/transactions/bulk-confirm', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  }));
}
const nested = (owner: string, id: string, data: Record<string, unknown>) =>
  db.records.set(`user_profiles/${owner}/accounts/acc/transactions/${id}`, { trans_id: id, account_id: 'acc', userId: owner, amount: 52.99, date: '2026-09-01', merchant_name: 'Adobe', category: 'SERVICE_SUBSCRIPTION', ...data });
const stored = (owner: string, id: string) => db.records.get(`user_profiles/${owner}/accounts/acc/transactions/${id}`)!;

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  db.records.clear(); resetRateLimitStore();
  mock.user = { uid };
  for (const owner of [uid, other]) db.records.set(`user_profiles/${owner}/accounts/acc`, { userId: owner });
});
afterEach(() => { vi.useRealTimers(); });

describe('POST /api/transactions/bulk-confirm', () => {
  it('rejects cross-site requests before authenticating', async () => {
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://attacker.example' }]) {
      const response = await post({ merchantKey: 'adobe', decision: 'business' }, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Cross-site request rejected' });
    }
    expect(recordedRateLimitCount(RATE_LIMITS.bulkConfirm.scope)).toBe(0);
  });
  it('requires an authenticated owner', async () => {
    mock.user = null;
    expect((await post({ merchantKey: 'adobe', decision: 'business' })).status).toBe(401);
  });
  it('rejects malformed bodies without touching the store', async () => {
    nested(uid, 't1', { ai_suggestion: suggestion });
    for (const body of ['not json', {}, { merchantKey: '', decision: 'business' }, { merchantKey: 'adobe', decision: 'maybe' },
      { merchantKey: 'adobe', decision: 'personal', category: 'software_subscriptions' }, { merchantKey: 'adobe', decision: 'personal', businessPurpose: 'x' },
      { merchantKey: 'adobe', decision: 'business', review_status: 'confirmed' }, { merchantKey: 'adobe', decision: 'business', businessPurpose: 'p'.repeat(501) }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
    }
    expect(stored(uid, 't1').review_status).toBeUndefined();
    expect(recordedRateLimitCount(RATE_LIMITS.bulkConfirm.scope)).toBe(0);
  });
  it('stamps only the caller\u2019s unreviewed charges from that merchant, across nested and legacy root rows', async () => {
    nested(uid, 'with-ai', { ai_suggestion: suggestion, merchant_name: 'ADOBE  ' });
    nested(uid, 'without-ai', { merchant_name: 'adobe', date: '2026-08-15' });
    nested(uid, 'other-merchant', { merchant_name: 'Figma' });
    nested(uid, 'reviewed', { review_status: 'confirmed', is_deductible: true });
    nested(uid, 'client-decided', { is_deductible: false });
    nested(uid, 'pending', { pending: true });
    nested(uid, 'removed', { bank_removed: true });
    nested(uid, 'superseded', { superseded_by: 'newer' });
    nested(uid, 'credit', { amount: -52.99 });
    nested(uid, 'disowned', { user_id: other });
    nested(other, 'foreign', { ai_suggestion: suggestion });
    db.records.set('transactions/legacy-mine', { trans_id: 'legacy-mine', user_id: uid, amount: 20, date: '2026-07-01', name: 'Adobe' });
    db.records.set('transactions/legacy-theirs', { trans_id: 'legacy-theirs', userId: other, amount: 20, date: '2026-07-01', name: 'Adobe' });
    db.records.set('transactions/legacy-unowned', { trans_id: 'legacy-unowned', amount: 20, date: '2026-07-01', name: 'Adobe' });

    const response = await post({ merchantKey: 'Adobe', decision: 'business', businessPurpose: '  Design software for   client work ' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ success: true, merchantKey: 'adobe', updated: 3, skipped: 0, truncated: false, transactionIds: ['with-ai', 'without-ai', 'legacy-mine'] });

    const expected = { is_deductible: true, expense_type: 'business', business_purpose: 'Design software for client work', user_classification_reason: 'confirmed_ai_proposal',
      review_status: 'confirmed', reviewed_at: now.toISOString(), tax_review_required: false, updated_at: now };
    expect(stored(uid, 'with-ai')).toMatchObject({ ...expected, review_source: 'ai_confirmed', category: 'SERVICE_SUBSCRIPTION' });
    expect(stored(uid, 'without-ai')).toMatchObject({ ...expected, review_source: 'user_decision' });
    expect(db.records.get('transactions/legacy-mine')).toMatchObject({ ...expected, review_source: 'user_decision' });
    for (const id of ['other-merchant', 'client-decided', 'pending', 'removed', 'superseded', 'credit', 'disowned']) expect(stored(uid, id).review_status).toBeUndefined();
    expect(stored(uid, 'reviewed')).toMatchObject({ review_status: 'confirmed', is_deductible: true });
    expect(stored(uid, 'reviewed').business_purpose).toBeUndefined();
    expect(stored(other, 'foreign').review_status).toBeUndefined();
    expect(db.records.get('transactions/legacy-theirs')!.review_status).toBeUndefined();
    expect(db.records.get('transactions/legacy-unowned')!.review_status).toBeUndefined();
    expect(recordedRateLimitCount(RATE_LIMITS.bulkConfirm.scope)).toBe(1);
  });
  it('records a not-business decision as a user correction with no deduction', async () => {
    nested(uid, 'a', { ai_suggestion: suggestion });
    nested(uid, 'b', {});
    const response = await post({ merchantKey: 'adobe', decision: 'personal' });
    expect(await response.json()).toMatchObject({ updated: 2, skipped: 0, truncated: false });
    for (const id of ['a', 'b']) {
      expect(stored(uid, id)).toMatchObject({ is_deductible: false, expense_type: 'personal', user_classification_reason: 'rejected_ai_proposal',
        review_status: 'confirmed', review_source: 'user_corrected', reviewed_at: now.toISOString(), tax_review_required: false });
      expect(stored(uid, id).business_purpose).toBeUndefined();
    }
  });
  it('skips charges a bulk deduction cannot cover and reports them', async () => {
    nested(uid, 'ok', { ai_suggestion: suggestion });
    nested(uid, 'transfer', { ai_suggestion: { ...suggestion, transactionKind: 'transfer' } });
    nested(uid, 'refund-kind', { ai_transaction_kind: 'refund' });
    nested(uid, 'income-kind', { transaction_kind: 'income' });
    nested(uid, 'method-review', { category: 'EQUIPMENT_REVIEW_REQUIRED' });
    expect(await (await post({ merchantKey: 'adobe', decision: 'business' })).json()).toMatchObject({ updated: 1, skipped: 4, transactionIds: ['ok'] });
    for (const id of ['transfer', 'refund-kind', 'income-kind', 'method-review']) expect(stored(uid, id).review_status).toBeUndefined();
    // The same charges can still be marked not business.
    expect(await (await post({ merchantKey: 'adobe', decision: 'personal' })).json()).toMatchObject({ updated: 4, skipped: 0 });
  });
  it('saves a supported category with the decision and refuses categories that need their own tax review', async () => {
    nested(uid, 'a', { category: 'GENERAL_MERCHANDISE_OTHER' });
    expect((await post({ merchantKey: 'adobe', decision: 'business', category: 'not-a-category' })).status).toBe(400);
    const refused = await post({ merchantKey: 'adobe', decision: 'business', category: 'equipment' });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'DEDUCTION_REVIEW_REQUIRED' });
    expect(stored(uid, 'a').review_status).toBeUndefined();
    expect((await post({ merchantKey: 'adobe', decision: 'business', category: 'software_subscriptions' })).status).toBe(200);
    expect(stored(uid, 'a')).toMatchObject({ category: 'SERVICE_SUBSCRIPTION', transaction_kind: 'expense', is_deductible: true, review_status: 'confirmed' });
  });
  it.each([
    ['parking_tolls', 'TRANSPORTATION_PARKING_AND_TOLLS'], ['insurance', 'SERVICE_INSURANCE'], ['legal_professional', 'SERVICE_LEGAL_AND_PROFESSIONAL'],
    ['taxes_licenses', 'GOVERNMENT_TAXES_AND_LICENSES'], ['repairs_maintenance', 'SERVICE_REPAIRS_AND_MAINTENANCE'],
  ])('2026-09-18.3: a bulk business decision may carry the %s category as a deduction', async (category, recorded) => {
    nested(uid, 'a', { category: 'GENERAL_MERCHANDISE_OTHER' });
    expect((await post({ merchantKey: 'adobe', decision: 'business', category })).status).toBe(200);
    expect(stored(uid, 'a')).toMatchObject({ category: recorded, transaction_kind: 'expense', is_deductible: true, review_status: 'confirmed' });
  });
  it('2026-09-18.3: a charge already recorded in a new category is a bulk deduction (not a method placeholder), and "other" is still refused as a deduction', async () => {
    nested(uid, 'insured', { merchant_name: 'Hiscox', category: 'SERVICE_INSURANCE', ai_suggestion: { ...suggestion, status: 'ok', category: 'insurance', isDeductible: true, deductiblePercent: 100, scheduleCLine: '15' } });
    nested(uid, 'parked', { merchant_name: 'Hiscox', category: 'TRANSPORTATION_PARKING_AND_TOLLS' });
    expect(await (await post({ merchantKey: 'hiscox', decision: 'business' })).json()).toMatchObject({ updated: 2, skipped: 0 });
    expect(stored(uid, 'insured')).toMatchObject({ category: 'SERVICE_INSURANCE', is_deductible: true, review_status: 'confirmed' });
    expect(stored(uid, 'parked')).toMatchObject({ category: 'TRANSPORTATION_PARKING_AND_TOLLS', is_deductible: true, review_status: 'confirmed' });
    nested(uid, 'b', { category: 'GENERAL_MERCHANDISE_OTHER' });
    const refused = await post({ merchantKey: 'adobe', decision: 'business', category: 'other' });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'DEDUCTION_REVIEW_REQUIRED' });
  });
  it('caps a call at 200 newest charges and reports truncation', async () => {
    expect(BULK_CONFIRM_MAX_TRANSACTIONS).toBe(200);
    expect(BULK_CONFIRM_BATCH_SIZE).toBeLessThanOrEqual(400);
    for (let index = 0; index < 205; index += 1) nested(uid, `t${String(index).padStart(3, '0')}`, { date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10) });
    const body = await (await post({ merchantKey: 'adobe', decision: 'business' })).json();
    expect(body).toMatchObject({ updated: 200, skipped: 0, truncated: true });
    expect(body.transactionIds).toHaveLength(200);
    const stamped = [...db.records].filter(([path, data]) => path.startsWith(`user_profiles/${uid}/accounts/acc/transactions/`) && data.review_status === 'confirmed');
    expect(stamped).toHaveLength(200);
    for (const oldest of ['t000', 't001', 't002', 't003', 't004']) expect(stored(uid, oldest).review_status).toBeUndefined();
    expect(await (await post({ merchantKey: 'adobe', decision: 'business' })).json()).toMatchObject({ updated: 5, truncated: false });
  });
  it('records one learning correction per call and refreshes the analysis priors', async () => {
    nested(uid, 'newest', { ai_suggestion: suggestion, date: '2026-09-10' });
    nested(uid, 'older', { date: '2026-09-02' });
    await post({ merchantKey: 'adobe', decision: 'business', businessPurpose: 'Design software' });
    expect(mock.recordCorrection).toHaveBeenCalledTimes(1);
    expect(mock.recordCorrection).toHaveBeenCalledWith(uid, 'newest', expect.objectContaining({ merchant_name: 'Adobe', amount: 52.99 }),
      expect.objectContaining({ is_deductible: null, reasoning: 'Recurring design software charge.' }), { isDeductible: true, reasoning: 'Design software' });
    expect(mock.invalidate).toHaveBeenCalledWith(uid);
    vi.clearAllMocks();
    expect(await (await post({ merchantKey: 'nobody', decision: 'business' })).json()).toMatchObject({ updated: 0, transactionIds: [] });
    expect(mock.recordCorrection).not.toHaveBeenCalled();
    expect(mock.invalidate).not.toHaveBeenCalled();
  });
  it('keeps the decision when the learning engine fails', async () => {
    mock.recordCorrection.mockRejectedValueOnce(new Error('learning unavailable'));
    nested(uid, 'a', {});
    const response = await post({ merchantKey: 'adobe', decision: 'business' });
    expect(response.status).toBe(200);
    expect(stored(uid, 'a').review_status).toBe('confirmed');
  });
  it('throttles bulk confirmation per owner and refuses when the limiter store is down', async () => {
    expect(RATE_LIMITS.bulkConfirm.limit).toBeLessThanOrEqual(20);
    expect(RATE_LIMITS.bulkConfirm.windowMs).toBe(10 * 60_000);
    expect(RATE_LIMITS.bulkConfirm.onUnavailable).toBe('deny');
    nested(uid, 'a', {});
    await exhaustRateLimit(RATE_LIMITS.bulkConfirm, uid);
    const limited = await post({ merchantKey: 'adobe', decision: 'business' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(stored(uid, 'a').review_status).toBeUndefined();
    resetRateLimitStore(); failRateLimitStore();
    const unavailable = await post({ merchantKey: 'adobe', decision: 'business' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' });
    expect(stored(uid, 'a').review_status).toBeUndefined();
  });
});
