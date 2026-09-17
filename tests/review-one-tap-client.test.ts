import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import type { Transaction } from '../lib/firebase/transactions';
import type { AiReviewSuggestion } from '../lib/transactions/ai-review-contract';

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, request: vi.fn(), updated: vi.fn(), open: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial; return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === 'function' ? value(harness.slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useEffect() {},
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('@/lib/hooks/use-ai-availability', () => ({ useAiAvailability: () => ({ status: 'configured', refresh: harness.refresh, message: '' }) }));
vi.mock('sonner', () => ({ toast: { success: harness.toast } }));
import { ReviewTransactionsScreen } from '../components/review-transactions-screen';
import { PurposeConfirmChip } from '../components/review/purpose-confirm-chip';
import { BulkConfirmOffer, requestBulkConfirm, type BulkConfirmOutcome } from '../components/review/bulk-confirm-offer';
import { ExplanationCard } from '../components/ai/explanation-card';
import { MerchantGroupList, type GroupDecisionResult } from '../components/review/merchant-groups';
import { QuestionChips } from '../components/review/question-chips';
import { reviewSourceFor, taxDecisionUpdate } from '../lib/transactions/tax-decision';
import { bulkOfferFor, canOfferPurposeConfirmation, confirmPurposeUpdates, groupDecision, groupUnreviewedByMerchant, proposedBusinessPurpose, rejectProposalUpdates,
  type BulkConfirmRequest, type MerchantGroup, type OpenQuestion } from '../lib/transactions/review-proposals';

type Props = { children?: unknown; proposal?: string | null; question?: string | null | OpenQuestion; onConfirm?: (purpose: string) => unknown; onReject?: () => unknown; onClick?: () => unknown; disabled?: boolean; explanation?: unknown;
  offer?: BulkConfirmRequest; onApplied?: (outcome: BulkConfirmOutcome | GroupDecisionResult, offer: BulkConfirmRequest | MerchantGroup) => unknown; onDismiss?: () => unknown;
  groups?: MerchantGroup[]; results?: GroupDecisionResult[]; onSave?: (updates: Record<string, unknown>, message: string) => unknown; 'aria-pressed'?: boolean };
type Element = ReactElement<Props>;
function walk(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(walk); return isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : []; }
function text(node: unknown): string { if (Array.isArray(node)) return node.map(text).join(''); if (isValidElement<Props>(node)) return text(node.props.children); return typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function action(page: unknown, label: string) { return walk(page).find(node => node.props.onClick && text(node).trim() === label)!; }
const chip = (page: unknown) => walk(page).find(node => node.type === PurposeConfirmChip);

const suggestion: AiReviewSuggestion & { proposed_purpose?: string } = { id: 'suggestion-1', inputHash: 'saved-input', status: 'needs_more_info', category: 'supplies_small_tools', transactionKind: 'expense', isDeductible: null, deductiblePercent: null,
  reasoning: 'Office supplies are usually ordinary for a design business; the purpose is not recorded.', questions: ['What did you use these supplies for?'], documentationRequired: ['Itemized receipt'], irsReferences: ['IRC 162'],
  sources: [], taxYear: 2026, policyVersion: 'synthetic-policy', model: 'synthetic-model', analyzedAt: 1, proposed_purpose: 'Printer paper and ink for client proposals' };
const base = (changes: Partial<Transaction> = {}): Transaction => ({ id: 'tx-1', trans_id: 'tx-1', account_id: 'account-1', merchant_name: 'Synthetic Office Mart', amount: 42.5, category: 'GENERAL_MERCHANDISE', date: '2026-09-16',
  is_deductible: null, analysisStatus: 'completed', ai_suggestion: suggestion, ai_missing_fields: ['business_purpose'], ...changes });
let records: Transaction[];
function page(userId = 'owner') { harness.cursor = 0; return ReviewTransactionsScreen({ user: { id: userId }, onBack() {}, transactions: records, onTransactionUpdate: harness.updated, onTransactionClick: harness.open }); }
const serverPut = (record: Transaction, changes: Record<string, unknown>) => Response.json({ success: true, transaction: { ...record, ...changes, review_status: 'confirmed', reviewed_at: '2026-09-17T12:00:00.000Z' } });
beforeEach(() => { harness.slots = []; harness.cursor = 0; records = [base()]; vi.clearAllMocks(); });

describe('one-tap purpose confirmation on the review screen', () => {
  it('shows the proposed purpose as the answer to the first question, without pre-checking any decision', () => {
    const view = page();
    const element = chip(view)!;
    expect(element.props.proposal).toBe('Printer paper and ink for client proposals');
    expect(element.props.question).toBe('What did you use these supplies for?');
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.updated).not.toHaveBeenCalled();
    expect(text(view)).toContain('the purpose is saved when you confirm it above');
  });

  it('records purpose, deduction and the AI-confirmed reason through the existing update route', async () => {
    harness.request.mockResolvedValue(serverPut(records[0], { business_purpose: 'Printer paper and ink for client proposals', is_deductible: true, review_source: 'ai_confirmed' }));
    await chip(page())!.props.onConfirm!('Printer paper and ink for client proposals');
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('/api/transactions/tx-1', expect.objectContaining({ method: 'PUT',
      body: JSON.stringify({ business_purpose: 'Printer paper and ink for client proposals', is_deductible: true, expense_type: 'business', user_classification_reason: 'confirmed_ai_proposal' }) }));
    expect(harness.updated).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1', is_deductible: true, review_status: 'confirmed', review_source: 'ai_confirmed' }));
    expect(harness.toast).toHaveBeenCalledWith('Business purpose confirmed and deduction recorded');
    expect(text(page())).toContain('Categories reviewed');
  });

  it('keeps an edited purpose tied to the AI proposal and records "Not business" as a correction', async () => {
    harness.request.mockResolvedValue(serverPut(records[0], { is_deductible: true }));
    await chip(page())!.props.onConfirm!('Paper for the Q3 client pitch');
    expect(JSON.parse(harness.request.mock.calls[0][1].body)).toMatchObject({ business_purpose: 'Paper for the Q3 client pitch', user_classification_reason: 'confirmed_ai_proposal' });
    harness.slots = []; records = [base()]; harness.request.mockReset();
    harness.request.mockResolvedValue(serverPut(records[0], { is_deductible: false, review_source: 'user_corrected' }));
    await chip(page())!.props.onReject!();
    expect(JSON.parse(harness.request.mock.calls[0][1].body)).toEqual({ is_deductible: false, expense_type: 'personal', user_classification_reason: 'rejected_ai_proposal' });
    expect(harness.toast).toHaveBeenCalledWith('Marked not business; no deduction recorded');
  });

  it('leaves the card in place with the server message when the save fails', async () => {
    harness.request.mockResolvedValue(Response.json({ error: 'Tax method still needs review.' }, { status: 500 }));
    await chip(page())!.props.onConfirm!('Printer paper and ink for client proposals');
    expect(text(page())).toContain('Tax method still needs review.');
    expect(text(page())).toContain('Synthetic Office Mart');
    expect(harness.updated).not.toHaveBeenCalled(); expect(harness.toast).not.toHaveBeenCalled();
  });

  it('falls back to the tailored reason when the suggestion predates proposed_purpose', () => {
    const { proposed_purpose: _omitted, ...older } = suggestion;
    records = [base({ ai_suggestion: older, ai_customized_reason: 'Supplies bought for the saved client project.' })];
    expect(chip(page())!.props.proposal).toBe('Supplies bought for the saved client project.');
    records = [base({ ai_suggestion: older })];
    expect(chip(page())).toBeUndefined();
  });

  it.each([
    ['a saved business purpose', { business_purpose: 'Already recorded' }],
    ['a bank-pending charge', { pending: true }],
    ['a credit', { amount: -42.5 }],
    ['a personal decision', { is_deductible: false }],
    ['a tax-method category', { ai_suggestion: { ...suggestion, category: 'equipment' as const } }],
    ['a non-expense flow', { ai_suggestion: { ...suggestion, transactionKind: 'refund' as const } }],
  ])('does not offer the chip for %s', (_label, changes) => {
    records = [base(changes as Partial<Transaction>)];
    expect(canOfferPurposeConfirmation(records[0])).toBe(false);
    expect(chip(page())).toBeUndefined();
  });

  it('renders the saved plain-language explanation instead of the raw reasoning when one exists', () => {
    records = [base({ ai_explanation: { headline: 'Likely an ordinary supplies expense', why: 'Consumable supplies for client work are ordinary for a design business.', yourFacts: ['Design business', 'Office supplies merchant'], scheduleCLine: 'Line 22 Supplies', estimatedTaxEffect: null, strengthen: ['Keep the itemized receipt'], nextQuestion: 'What were the supplies for?' } })];
    const view = page();
    const card = walk(view).find(node => node.type === ExplanationCard)!;
    expect(card).toBeDefined();
    expect(text(view)).not.toContain(suggestion.reasoning);
  });
});

describe('apply to similar charges after a single decision', () => {
  const offerOn = (view: unknown) => walk(view).find(node => node.type === BulkConfirmOffer);
  const similar = (id: string, changes: Partial<Transaction> = {}) => base({ id, trans_id: id, merchant_name: 'SYNTHETIC OFFICE MART', ai_suggestion: null, ai_missing_fields: [], ...changes });
  const purpose = 'Printer paper and ink for client proposals';

  it('offers the merchant\u2019s other unreviewed charges once, with the confirmed purpose, and none for a lone charge', async () => {
    records = [base(), similar('tx-2'), similar('tx-3'), similar('tx-4', { is_deductible: false }), similar('tx-5', { pending: true }), base({ id: 'tx-6', trans_id: 'tx-6', merchant_name: 'Other Shop' })];
    harness.request.mockResolvedValue(serverPut(records[0], { business_purpose: purpose, is_deductible: true, review_source: 'ai_confirmed' }));
    expect(offerOn(page())).toBeUndefined();
    await chip(page())!.props.onConfirm!(purpose);
    const offer = offerOn(page())!;
    expect(offer.props.offer).toEqual({ merchantKey: 'synthetic office mart', merchant: 'Synthetic Office Mart', count: 2, decision: 'business', businessPurpose: purpose, category: null });
    expect(harness.request).toHaveBeenCalledTimes(1);
    offer.props.onDismiss!();
    expect(offerOn(page())).toBeUndefined();

    harness.slots = []; harness.request.mockReset(); harness.updated.mockReset();
    records = [base(), similar('tx-2'), base({ id: 'tx-6', trans_id: 'tx-6', merchant_name: 'Other Shop' })];
    harness.request.mockResolvedValue(serverPut(records[0], { business_purpose: purpose, is_deductible: true }));
    await chip(page())!.props.onConfirm!(purpose);
    expect(offerOn(page())).toBeUndefined();
  });

  it('marks exactly the server-stamped rows reviewed locally and reports the server count', async () => {
    records = [base(), similar('tx-2'), similar('tx-3'), similar('tx-4', { ai_suggestion: { ...suggestion, transactionKind: 'transfer' } })];
    harness.request.mockResolvedValue(serverPut(records[0], { business_purpose: purpose, is_deductible: true }));
    await chip(page())!.props.onConfirm!(purpose);
    const offer = offerOn(page())!;
    expect(offer.props.offer!.count).toBe(3);
    harness.updated.mockReset();
    offer.props.onApplied!({ updated: 2, skipped: 1, truncated: false, transactionIds: ['tx-2', 'tx-3'] }, offer.props.offer!);
    expect(harness.updated).toHaveBeenCalledTimes(2);
    expect(harness.updated).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-2', is_deductible: true, expense_type: 'business', business_purpose: purpose,
      user_classification_reason: 'confirmed_ai_proposal', review_status: 'confirmed', review_source: 'user_decision', tax_review_required: false }));
    expect(harness.toast).toHaveBeenLastCalledWith('Recorded 2 charges from Synthetic Office Mart as business deductions; 1 still needs your individual review.');
    const view = page();
    expect(text(view)).toContain('3 confirmed this session');
    expect(text(view)).toContain('1 needs review');
  });

  it('offers a not-business bulk decision after rejecting the proposal', async () => {
    records = [base(), similar('tx-2'), similar('tx-3')];
    harness.request.mockResolvedValue(serverPut(records[0], { is_deductible: false, review_source: 'user_corrected' }));
    await chip(page())!.props.onReject!();
    const offer = offerOn(page())!.props.offer!;
    expect(offer).toMatchObject({ decision: 'personal', count: 2, businessPurpose: null, category: null });
  });

  it('sends only the fields the route accepts and surfaces its result or refusal', async () => {
    const offer: BulkConfirmRequest = { merchantKey: 'synthetic office mart', merchant: 'Synthetic Office Mart', count: 2, decision: 'business', businessPurpose: purpose, category: 'supplies_small_tools' };
    harness.request.mockResolvedValueOnce(Response.json({ success: true, merchantKey: 'synthetic office mart', updated: 2, skipped: 0, truncated: true, transactionIds: ['tx-2', 'tx-3', 7] }));
    expect(await requestBulkConfirm(offer)).toEqual({ ok: true, outcome: { updated: 2, skipped: 0, truncated: true, transactionIds: ['tx-2', 'tx-3'] } });
    expect(harness.request).toHaveBeenCalledWith('/api/transactions/bulk-confirm', expect.objectContaining({ method: 'POST',
      body: JSON.stringify({ merchantKey: 'synthetic office mart', decision: 'business', businessPurpose: purpose, category: 'supplies_small_tools' }) }));
    harness.request.mockResolvedValueOnce(Response.json({ success: true, updated: 0, skipped: 0, truncated: false, transactionIds: [] }));
    expect(JSON.parse((await requestBulkConfirm({ ...offer, decision: 'personal' }).then(() => harness.request.mock.calls.at(-1)![1].body)))).toEqual({ merchantKey: 'synthetic office mart', decision: 'personal' });
    harness.request.mockResolvedValueOnce(Response.json({ code: 'RATE_LIMITED', error: 'Too many requests.' }, { status: 429 }));
    expect(await requestBulkConfirm(offer)).toEqual({ ok: false, message: 'Too many bulk updates in a short time. Try again in a few minutes.' });
    harness.request.mockRejectedValueOnce(new Error('offline'));
    expect((await requestBulkConfirm(offer)).ok).toBe(false);
  });

  it('carries a reviewed category into the offer only after category review', () => {
    const others = [similar('tx-2'), similar('tx-3')];
    const confirmedCategory = base({ is_deductible: true, transaction_kind: 'expense', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', business_purpose: purpose });
    expect(bulkOfferFor(confirmedCategory, [confirmedCategory, ...others])).toMatchObject({ decision: 'business', category: 'supplies_small_tools', businessPurpose: purpose });
    expect(bulkOfferFor(base({ is_deductible: true, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }), others)).toMatchObject({ category: null });
    expect(bulkOfferFor(base({ is_deductible: true, transaction_kind: 'expense', category: 'EQUIPMENT_REVIEW_REQUIRED' }), others)).toMatchObject({ category: null });
    expect(bulkOfferFor(base({ is_deductible: null }), others)).toBeNull();
    expect(bulkOfferFor(base({ is_deductible: false, transaction_kind: 'refund', amount: 42.5 }), others)).toBeNull();
    expect(bulkOfferFor(base({ is_deductible: true, amount: -42.5 }), others)).toBeNull();
  });
});

describe('merchant-grouped triage', () => {
  const at = (id: string, merchant: string, changes: Partial<Transaction> = {}) => base({ id, trans_id: id, merchant_name: merchant, ai_suggestion: null, ai_missing_fields: [], ...changes });
  const grouped = (view: unknown) => walk(view).find(node => node.type === MerchantGroupList);
  const toggle = (view: unknown) => walk(view).find(node => node.props.onClick && text(node) === 'By merchant')!;

  it('keeps the single-card flow as the default and switches to groups sorted by count', () => {
    records = [at('a1', 'Adobe'), at('f1', 'Figma'), at('a2', 'ADOBE', { ai_suggestion: { ...suggestion, category: 'software_subscriptions' } }), at('f2', 'Figma'), at('f3', 'figma', { amount: 10 }),
      at('r1', 'Refund Co', { amount: -20 }), at('p1', 'Pending Co', { pending: true }), at('d1', 'Decided Co', { is_deductible: true })];
    let view = page();
    expect(grouped(view)).toBeUndefined();
    expect(text(view)).toContain('Adobe');
    toggle(view).props.onClick!();
    view = page();
    const list = grouped(view)!;
    expect(list.props.groups!.map(group => [group.merchant, group.count, Number(group.total.toFixed(2))])).toEqual([['Figma', 3, 95], ['Adobe', 2, 85]]);
    expect(list.props.groups![1]).toMatchObject({ merchantKey: 'adobe', proposedPurpose: 'Printer paper and ink for client proposals', category: 'software_subscriptions', categoryLabel: 'Software and subscriptions' });
    expect(text(view)).toContain('5 charges from 2 merchants');
    expect(walk(view).find(node => node.props['aria-pressed'] === true && text(node) === 'By merchant')).toBeDefined();
  });

  it('applies a group decision locally from the server\u2019s ids and shows the count until dismissed', () => {
    records = [at('a1', 'Adobe'), at('a2', 'Adobe', { ai_suggestion: { ...suggestion, transactionKind: 'transfer' } }), at('f1', 'Figma')];
    toggle(page()).props.onClick!();
    const list = grouped(page())!;
    const group = list.props.groups![0];
    expect(group).toMatchObject({ merchant: 'Adobe', count: 2, needsIndividualReview: 1 });
    const request = groupDecision(group, 'business', 'Design software for client work');
    // The only categorized suggestion read its charge as a transfer, so no category travels with the group decision.
    expect(request).toEqual({ merchantKey: 'adobe', merchant: 'Adobe', count: 2, decision: 'business', businessPurpose: 'Design software for client work', category: null });
    list.props.onApplied!({ request, outcome: { updated: 1, skipped: 1, truncated: false, transactionIds: ['a1'] } }, group);
    expect(harness.updated).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'a1', is_deductible: true, business_purpose: 'Design software for client work', review_status: 'confirmed', review_source: 'user_decision' }));
    const after = grouped(page())!;
    expect(after.props.results).toHaveLength(1);
    expect(after.props.groups!.map(entry => [entry.merchant, entry.count])).toEqual([['Adobe', 1], ['Figma', 1]]);
    expect(text(page())).toContain('1 confirmed this session');
    (after.props as unknown as { onDismissResult: (key: string) => void }).onDismissResult('adobe');
    expect(grouped(page())!.props.results).toEqual([]);
  });

  it('never carries a disagreeing or tax-method category into a group decision', () => {
    const disagreeing = groupUnreviewedByMerchant([at('a1', 'Adobe', { ai_suggestion: { ...suggestion, category: 'software_subscriptions' } }), at('a2', 'Adobe', { ai_suggestion: { ...suggestion, category: 'supplies_small_tools' } })]);
    expect(disagreeing[0]).toMatchObject({ category: null, categoryLabel: null });
    const equipment = groupUnreviewedByMerchant([at('e1', 'Best Buy', { ai_suggestion: { ...suggestion, category: 'equipment' } })]);
    expect(equipment[0]).toMatchObject({ category: 'equipment', needsIndividualReview: 0 });
    expect(groupDecision(equipment[0], 'business', 'Laptop').category).toBeNull();
    expect(groupDecision(equipment[0], 'personal', 'ignored')).toMatchObject({ decision: 'personal', businessPurpose: null, category: null });
  });
});

describe('one question at a time with suggested answers', () => {
  const chips = (view: unknown) => walk(view).find(node => node.type === QuestionChips);
  const withQuestion = (field: string, question: string, changes: Partial<Transaction> = {}) => base({
    ai_suggestion: { ...suggestion, proposed_purpose: undefined, category: 'equipment', questions: [question, 'Second question stays hidden'] }, ai_missing_fields: [field], ...changes });

  it('asks only the first question and saves the business-use percentage as a fact, not a decision', async () => {
    records = [withQuestion('business_use_percentage', 'How much of this laptop is for business?', { equipment_details: { make: 'Framework' } })];
    let view = page();
    expect(chip(view)).toBeUndefined();
    const element = chips(view)!;
    expect(element.props.question).toMatchObject({ kind: 'business_use_percentage', field: 'business_use_percentage', question: 'How much of this laptop is for business?' });
    expect(text(view)).not.toContain('Second question stays hidden');
    harness.request.mockResolvedValue(Response.json({ success: true, transaction: { ...records[0], equipment_details: { make: 'Framework', business_use_percentage: 75 } } }));
    await element.props.onSave!({ equipment_details: { make: 'Framework', business_use_percentage: 75 } }, 'Business use saved: 75%');
    expect(JSON.parse(harness.request.mock.calls[0][1].body)).toEqual({ equipment_details: { make: 'Framework', business_use_percentage: 75 } });
    expect(harness.toast).toHaveBeenCalledWith('Business use saved: 75%. Run analysis again for an updated suggestion.');
    view = page();
    expect(text(view)).toContain('Synthetic Office Mart');
    expect(text(view)).not.toContain('confirmed this session');
    expect(chips(view)).toBeUndefined();
  });

  it('routes meal, settings and unknown questions to their answer surfaces', () => {
    records = [withQuestion('attendees', 'Who joined this meal?')];
    expect(chips(page())!.props.question).toMatchObject({ kind: 'meal_conditions' });
    records = [withQuestion('attendees', 'Who joined this meal?', { attendees: ['Jordan Lee'] })];
    expect(chips(page())).toBeUndefined();
    records = [withQuestion('entity_tax_treatment', 'How is your business taxed?')];
    expect(chips(page())!.props.question).toMatchObject({ kind: 'settings_gate' });
    records = [withQuestion('receipt', 'Do you have the receipt?')];
    expect(chips(page())!.props.question).toMatchObject({ kind: 'other', field: 'receipt' });
    records = [withQuestion('business_purpose', 'What is this for?')];
    expect(chip(page())).toBeUndefined();
    expect(chips(page())!.props.question).toMatchObject({ kind: 'business_purpose' });
  });
});

describe('server stamps for one-tap decisions', () => {
  const record = { category: 'GENERAL_MERCHANDISE', ai_suggestion: { id: 'suggestion-1' } };
  const at = new Date('2026-09-17T12:00:00.000Z');
  it('records an AI-confirmed deduction and a user-corrected rejection with the shared review fields', () => {
    expect(taxDecisionUpdate(record, confirmPurposeUpdates('Paper for proposals', 'Paper for proposals'), at)).toEqual({ tax_review_required: false, review_status: 'confirmed', review_source: 'ai_confirmed', reviewed_at: at.toISOString() });
    expect(taxDecisionUpdate(record, rejectProposalUpdates(), at)).toEqual({ tax_review_required: false, review_status: 'confirmed', review_source: 'user_corrected', reviewed_at: at.toISOString() });
  });
  it('never labels a decision AI-confirmed without a saved suggestion or with a mismatched reason', () => {
    expect(reviewSourceFor({}, { is_deductible: true, user_classification_reason: 'confirmed_ai_proposal' })).toBe('user_decision');
    expect(reviewSourceFor(record, { is_deductible: false, user_classification_reason: 'confirmed_ai_proposal' })).toBe('user_decision');
    expect(reviewSourceFor(record, { is_deductible: true, user_classification_reason: 'rejected_ai_proposal' })).toBe('user_decision');
    expect(reviewSourceFor(record, { is_deductible: true, user_classification_reason: 'Business deduction included by user after reviewing eligibility' })).toBe('user_decision');
    expect(confirmPurposeUpdates('Typed by the user', null).user_classification_reason).not.toBe('confirmed_ai_proposal');
  });
  it('still refuses a deduction that needs a separate tax-method review', () => {
    expect(() => taxDecisionUpdate({ ...record, category: 'EQUIPMENT_REVIEW_REQUIRED' }, confirmPurposeUpdates('Laptop', 'Laptop'), at)).toThrow('requires tax-method');
    expect(proposedBusinessPurpose({ ai_suggestion: null })).toBeNull();
  });
});
