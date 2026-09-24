import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ docs: new Map<string, Record<string, any>>(), uid: 'owner', auth: true }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: mocks.auth ? { uid: mocks.uid } : null }) }));
vi.mock('@/lib/firebase/admin', () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }) });
  return { adminDb: { doc: ref, runTransaction: async (work: (tx: any) => unknown) => work({
    get: async (value: any) => ({ exists: mocks.docs.has(value.path), data: () => structuredClone(mocks.docs.get(value.path)), ref: value }),
    update: (value: any, data: any) => { mocks.docs.set(value.path, { ...mocks.docs.get(value.path), ...structuredClone(data) }); },
  }) } };
});

import { analysisProfileHash } from '@/lib/ai/profile-context';
import { analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';
import { POST } from '@/app/api/transactions/[id]/review/route';
import { hydrateReviewTransaction } from '@/lib/transactions/review';
import { canConfirmAiSuggestion } from '@/lib/transactions/ai-review-contract';
import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { aggregateScheduleC } from '@/lib/schedule-c/aggregate';
import { reconcileBusinessIncome } from '@/lib/tax-rules/business-income';
import { TRANSACTION_TAX_POLICY_VERSION } from '@/lib/ai/transaction-tax-policy';

const account = 'user_profiles/owner/accounts/bank';
const path = `${account}/transactions/tx`;
const result = { status: 'ok' as const, transaction_kind: 'expense' as const, category: 'supplies_small_tools' as const,
  is_deductible: true, expense_type: 'business' as const, deductible_percent: 100, confidence: .92,
  customized_reason: 'Supplies used only to complete the saved client project.', irs_refs: ['26 USC 162'],
  tax_year: 2026, policy_version: TRANSACTION_TAX_POLICY_VERSION, sources: [{ id: '162', title: 'Trade or business expenses', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/deducting-business-expenses', edition: 'current', reviewed_at: '2026-09-16' }] };

function record() { return mocks.docs.get(path)!; }
function change(values: Record<string, any>) { mocks.docs.set(path, { ...record(), ...values }); }
function suggest(overrides = {}) { change(analysisSuggestionUpdate({ ...result, ...overrides }, 1770000000000, record(), analysisProfileHash(mocks.docs.get('user_profiles/owner')!, record().date))); }
async function send(body: unknown, id = 'tx') {
  return POST(new NextRequest(`http://localhost/api/transactions/${id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
const confirm = () => ({ action: 'confirm', accountId: 'bank', suggestionId: record().ai_suggestion.id });
const correct = (values = {}) => ({ action: 'correct', accountId: 'bank', category: 'supplies_small_tools', transactionKind: 'expense', isDeductible: null, ...values });

beforeEach(() => {
  mocks.docs.clear(); mocks.uid = 'owner'; mocks.auth = true;
  mocks.docs.set('user_profiles/owner', { profession: 'Designer', state: 'CA', business_entity_type: 'sole_proprietor' });
  mocks.docs.set(account, { user_id: 'owner', type: 'depository' });
  mocks.docs.set(path, { userId: 'owner', account_id: 'bank', trans_id: 'tx', merchant_name: 'Office store', amount: 100,
    date: '2026-09-15', category: 'UNCLASSIFIED', iso_currency_code: 'USD', pending: false,
    is_deductible: null, notes: 'Supplies used only for Client A.', analysisLeaseToken: 'private-token' });
  suggest();
});

describe('saved AI categorization confirmation', () => {
  it('confirms an identified refund flow while leaving its original-expense reconciliation unresolved', async () => {
    change({ amount: -15 });
    suggest({ status: 'needs_more_info', transaction_kind: 'refund', category: 'other', is_deductible: undefined, expense_type: undefined, deductible_percent: undefined });
    expect(canConfirmAiSuggestion(record().ai_suggestion)).toBe(true);
    expect((await send(confirm())).status).toBe(200);
    expect(record()).toMatchObject({ transaction_kind: 'refund', is_deductible: null, tax_review_required: true, review_status: 'confirmed' });
    expect(transactionNeedsCategoryReview(record())).toBe(false);
    expect(transactionNeedsTaxReview(record())).toBe(true);
    expect(aggregateScheduleC([record() as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });
  it('requires authentication and rejects caller-controlled AI/ownership fields', async () => {
    mocks.auth = false; expect((await send(confirm())).status).toBe(401);
    mocks.auth = true;
    for (const extra of [{ userId: 'other' }, { reasoning: 'Approve everything' }, { isDeductible: true }, { category: 'INCOME' }]) {
      expect((await send({ ...confirm(), ...extra })).status).toBe(400);
    }
    expect(record().is_deductible).toBeNull();
  });

  it.each([{ userId: 'someone-else' }, { user_id: 'someone-else' }, { account_id: 'different' }])('rejects inconsistent owner/account data %j', async mutation => {
    change(mutation); expect((await send(confirm())).status).toBe(404);
  });
  it('rejects foreign paths and account owners without disclosing data', async () => {
    expect((await send({ ...confirm(), accountId: '../bank' })).status).toBe(400);
    mocks.docs.set(account, { user_id: 'other' }); expect((await send(confirm())).status).toBe(404);
  });

  it('atomically saves canonical category and explicitly confirmed deduction with provenance', async () => {
    const response = await send(confirm()); expect(response.status).toBe(200);
    const { transaction } = await response.json();
    expect(transaction).toMatchObject({ category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true,
      transaction_kind: 'expense', review_status: 'confirmed', review_source: 'ai_confirmed', tax_review_required: false });
    expect(transaction.ai_suggestion).toMatchObject({ taxYear: 2026, policyVersion: TRANSACTION_TAX_POLICY_VERSION, sources: result.sources });
    expect(transaction).not.toHaveProperty('analysisLeaseToken');
    expect(aggregateScheduleC([transaction], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(100);
  });

  it('makes repeated confirmation idempotent after the recorded category changes', async () => {
    const request = confirm(); await send(request); const first = record();
    expect((await send(request)).status).toBe(200);
    expect(record()).toEqual(first);
  });
  it('rejects stale analysis ids and edits made after analysis', async () => {
    expect((await send({ ...confirm(), suggestionId: 'stale' })).status).toBe(409);
    change({ notes: 'Actually partly personal' }); expect((await send(confirm())).status).toBe(409);
    expect(record().is_deductible).toBeNull();
  });
  it('requires reanalysis when the server tax policy changed after the suggestion', async () => {
    change({ ai_suggestion: { ...record().ai_suggestion, policyVersion: 'federal-transactions-old' } });
    const response = await send(confirm());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'AI_POLICY_CHANGED' });
    expect(record().is_deductible).toBeNull();
  });
  it.each([{ business_entity_type: 's_corporation' }, { profession: 'Employee' }, { state: 'NY' }])('rejects a tax-profile change after the suggestion %j', async changed => {
    const profilePath = 'user_profiles/owner';
    mocks.docs.set(profilePath, { ...mocks.docs.get(profilePath), ...changed });
    const response = await send(confirm());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'AI_PROFILE_CHANGED' });
    expect(record().is_deductible).toBeNull();
    // The user can still deliberately categorize it without asserting a tax deduction.
    expect((await send(correct())).status).toBe(200);
    expect(record().tax_review_required).toBe(true);
  });
  it('ignores non-tax display and subscription changes in the profile fingerprint', async () => {
    const profilePath = 'user_profiles/owner';
    mocks.docs.set(profilePath, { ...mocks.docs.get(profilePath), name: 'New name', id: 'derived-user-id', updated_at: new Date(), subscriptionStatus: 'trialing' });
    expect((await send(confirm())).status).toBe(200);
  });
  it('requires reanalysis of a legacy suggestion with no profile fingerprint', async () => {
    const { profileHash: _, ...oldSuggestion } = record().ai_suggestion;
    change({ ai_suggestion: oldSuggestion });
    expect((await send(confirm())).status).toBe(409);
  });
  it.each([{ pending: true }, { iso_currency_code: 'EUR' }, { amount: NaN }])('requires posted supported financial data %j', async mutation => {
    change(mutation); expect((await send(confirm())).status).toBe(422);
  });
  it.each(['blocked', 'unknown'])('cannot confirm unavailable or ambiguous categorization %s', async state => {
    suggest(state === 'blocked' ? { status: 'blocked' } : { transaction_kind: 'unknown' });
    expect(canConfirmAiSuggestion(record().ai_suggestion)).toBe(false);
    expect((await send(confirm())).status).toBe(422);
  });

  it('confirms a useful category while missing tax facts stay unresolved and out of totals', async () => {
    suggest({ status: 'needs_more_info', category: 'software_subscriptions', is_deductible: undefined,
      deductible_percent: undefined, questions: ['How much of this subscription supports your business?'] });
    expect((await send(confirm())).status).toBe(200);
    expect(record()).toMatchObject({ category: 'SERVICE_SUBSCRIPTION', review_status: 'confirmed', is_deductible: null, tax_review_required: true });
    expect(transactionNeedsCategoryReview(record())).toBe(false);
    expect(transactionNeedsTaxReview(record())).toBe(true);
    expect(aggregateScheduleC([record() as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });
  it('allows known categories outside the verified tax scope without any deduction claim', async () => {
    suggest({ status: 'blocked', missing_fields: ['supported_tax_year'], category: 'software_subscriptions', is_deductible: undefined });
    expect((await send(confirm())).status).toBe(200);
    expect(record()).toMatchObject({ category: 'SERVICE_SUBSCRIPTION', is_deductible: null, tax_review_required: true });
  });
  it('preserves already recorded tax decisions instead of silently overwriting them', async () => {
    change({ is_deductible: false, expense_type: 'personal' });
    expect((await send(confirm())).status).toBe(409);
    expect(record().is_deductible).toBe(false);
  });
  it('applies the meal limitation exactly once via the export category', async () => {
    suggest({ category: 'meals_50', deductible_percent: 50 });
    await send(confirm());
    expect(aggregateScheduleC([record() as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(50);
  });
  it('keeps asset and mixed-use estimates unresolved rather than exporting the gross purchase', async () => {
    for (const value of [{ category: 'equipment', deductible_percent: 100 }, { category: 'software_subscriptions', deductible_percent: 25 }]) {
      change({ category: 'UNCLASSIFIED', is_deductible: null, review_status: undefined }); suggest(value);
      expect((await send(confirm())).status).toBe(200);
      expect(record().is_deductible).toBeNull(); expect(record().tax_review_required).toBe(true);
    }
  });
});

describe('taxonomy expansion (2026-09-18.3): the five new categories confirm as deductions and reach their Schedule C line', () => {
  it.each([
    ['parking_tolls', '9', 'TRANSPORTATION_PARKING_AND_TOLLS', 'Car and truck expenses'],
    ['insurance', '15', 'SERVICE_INSURANCE', 'Insurance'],
    ['legal_professional', '17', 'SERVICE_LEGAL_AND_PROFESSIONAL', 'Legal and professional services'],
    ['repairs_maintenance', '21', 'SERVICE_REPAIRS_AND_MAINTENANCE', 'Repairs and maintenance'],
    ['taxes_licenses', '23', 'GOVERNMENT_TAXES_AND_LICENSES', 'Taxes and licenses'],
  ] as const)('a %s approval confirms as a deduction on line %s under %s', async (category, line, recorded, lineName) => {
    suggest({ category, schedule_c_line: line });
    expect(record().ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, scheduleCLine: line });
    expect(canConfirmAiSuggestion(record().ai_suggestion)).toBe(true);
    const response = await send(confirm()); expect(response.status).toBe(200);
    expect(record()).toMatchObject({ category: recorded, is_deductible: true, expense_type: 'business', transaction_kind: 'expense', review_status: 'confirmed', review_source: 'ai_confirmed', tax_review_required: false });
    expect(transactionNeedsTaxReview(record())).toBe(false);
    const totals = aggregateScheduleC([record() as any], '2026', undefined, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(100);
    expect(totals.lineItems[line]).toMatchObject({ lineCode: line, lineName, deductible: 100, transactionCount: 1 });
  });
  it('a partial-share legal_professional approval (tax preparation) confirms the category but not the deduction', async () => {
    change({ business_use_percentage: 60 });
    suggest({ category: 'legal_professional', deductible_percent: 60, schedule_c_line: '17' });
    expect((await send(confirm())).status).toBe(200);
    expect(record()).toMatchObject({ category: 'SERVICE_LEGAL_AND_PROFESSIONAL', is_deductible: null, tax_review_required: true });
    expect(aggregateScheduleC([record() as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });
  it('a manual correction may claim a deduction under the new categories but still not under "other"', async () => {
    expect((await send(correct({ category: 'taxes_licenses', isDeductible: true }))).status).toBe(200);
    expect(record()).toMatchObject({ category: 'GOVERNMENT_TAXES_AND_LICENSES', is_deductible: true, review_source: 'user_corrected', tax_review_required: false });
    change({ is_deductible: null, category: 'UNCLASSIFIED', review_status: undefined });
    expect((await send(correct({ category: 'other', isDeductible: true }))).status).toBe(422);
    expect((await send(correct({ category: 'other' }))).status).toBe(200);
    expect(record()).toMatchObject({ category: 'OTHER_REVIEW_REQUIRED', is_deductible: null, tax_review_required: true });
  });
});

describe('explicit category correction and cash direction', () => {
  it('permits category correction without asserting a tax deduction', async () => {
    expect((await send(correct({ category: 'equipment' }))).status).toBe(200);
    expect(record()).toMatchObject({ category: 'EQUIPMENT_REVIEW_REQUIRED', is_deductible: null, review_source: 'user_corrected', tax_review_required: true });
  });
  it('rejects unsupported deduction methods and inconsistent kinds', async () => {
    expect((await send(correct({ category: 'equipment', isDeductible: true }))).status).toBe(422);
    expect((await send(correct({ transactionKind: 'income', isDeductible: false }))).status).toBe(422);
    expect((await send(correct({ transactionKind: 'transfer', isDeductible: true }))).status).toBe(422);
  });
  it('only puts a negative entry in business income after explicit income classification', async () => {
    change({ amount: -100, category: 'BANK_CREDIT' });
    expect(hydrateReviewTransaction(record(), 'tx').type).toBeUndefined();
    expect(reconcileBusinessIncome(2026, [record()], [], []).grossReceipts).toBe(0);
    expect((await send(correct({ transactionKind: 'income', isDeductible: false }))).status).toBe(200);
    expect(reconcileBusinessIncome(2026, [record()], [], []).grossReceipts).toBe(100);
  });
  it('keeps transfers outside receipts and deductions', async () => {
    change({ amount: -100 });
    expect((await send(correct({ transactionKind: 'transfer', isDeductible: false }))).status).toBe(200);
    expect(reconcileBusinessIncome(2026, [record()], [], []).grossReceipts).toBe(0);
    expect(record()).toMatchObject({ category: 'TRANSFER', is_deductible: false, tax_review_required: false });
  });
  it('categorizes a refund without inventing income or an unverified deduction offset', async () => {
    change({ amount: -25 });
    expect((await send(correct({ transactionKind: 'refund' }))).status).toBe(200);
    expect(record()).toMatchObject({ is_deductible: null, tax_review_required: true, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' });
    expect(reconcileBusinessIncome(2026, [record()], [], []).grossReceipts).toBe(0);
    expect(aggregateScheduleC([record() as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });
  it('never considers old skipped or unconfirmed AI suggestions tax reviewed', () => {
    expect(transactionNeedsTaxReview({ is_deductible: null, user_classification_reason: 'Skipped by user' })).toBe(true);
    expect(transactionNeedsCategoryReview(record())).toBe(true);
    expect(transactionNeedsTaxReview(record())).toBe(true);
  });
});

describe('proposed purpose and Schedule C line pass through persistence', () => {
  const proposal = { status: 'needs_more_info' as const, is_deductible: undefined, expense_type: undefined, deductible_percent: undefined,
    category: 'software_subscriptions' as const, missing_fields: ['business_purpose'], questions: ['Is this Figma charge your design software subscription used for client work? Confirm or edit the purpose.'],
    proposed_purpose: 'Design software subscription used for client work', schedule_c_line: '18' };
  it('saves the proposed purpose and line on an unresolved business_purpose suggestion without approving it', () => {
    suggest(proposal);
    expect(record().ai_suggestion).toMatchObject({ status: 'needs_more_info', isDeductible: null, deductiblePercent: null,
      proposedPurpose: 'Design software subscription used for client work', scheduleCLine: '18' });
    expect(record()).toMatchObject({ ai_proposed_purpose: 'Design software subscription used for client work', ai_schedule_c_line: '18',
      ai: { proposed_purpose: 'Design software subscription used for client work', schedule_c_line: '18', missing_fields: ['business_purpose'] } });
    expect(hydrateReviewTransaction(record(), 'tx').ai_suggestion).toMatchObject({ proposedPurpose: 'Design software subscription used for client work' });
    // Confirming a needs_more_info suggestion still records no deduction.
    expect(canConfirmAiSuggestion(record().ai_suggestion)).toBe(true);
  });
  it('writes no undefined values and drops a proposed purpose that is not attached to the business_purpose question', () => {
    const hasUndefined = (value: unknown): boolean => value === undefined || (!!value && typeof value === 'object' && Object.values(value as object).some(hasUndefined));
    expect(hasUndefined(analysisSuggestionUpdate({ ...result, schedule_c_line: '22' }, 1770000000000, record()))).toBe(false);
    expect(hasUndefined(analysisSuggestionUpdate({ ...result, ...proposal }, 1770000000000, record()))).toBe(false);
    suggest({ schedule_c_line: '22' });
    expect(record().ai_suggestion).toMatchObject({ status: 'ok', scheduleCLine: '22' });
    expect('proposedPurpose' in record().ai_suggestion).toBe(false);
    expect(record()).toMatchObject({ ai_proposed_purpose: null, ai_schedule_c_line: '22', ai: { proposed_purpose: null, schedule_c_line: '22' } });
    // A proposed purpose on a completed result (which grounding never produces) is not persisted.
    suggest({ proposed_purpose: 'Leaked proposal' });
    expect('proposedPurpose' in record().ai_suggestion).toBe(false);
    expect(record().ai_proposed_purpose).toBeNull();
    // Nor is a line for a non-expense kind.
    suggest({ ...proposal, transaction_kind: 'personal', category: 'other', missing_fields: ['transaction_kind'], schedule_c_line: '18' });
    expect(record().ai_suggestion.scheduleCLine).toBeUndefined();
    expect(record().ai_suggestion.proposedPurpose).toBeUndefined();
  });
});
