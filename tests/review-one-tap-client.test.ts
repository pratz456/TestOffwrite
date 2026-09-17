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
import { ExplanationCard } from '../components/ai/explanation-card';
import { reviewSourceFor, taxDecisionUpdate } from '../lib/transactions/tax-decision';
import { canOfferPurposeConfirmation, confirmPurposeUpdates, proposedBusinessPurpose, rejectProposalUpdates } from '../lib/transactions/review-proposals';

type Props = { children?: unknown; proposal?: string | null; question?: string | null; onConfirm?: (purpose: string) => unknown; onReject?: () => unknown; onClick?: () => unknown; disabled?: boolean; explanation?: unknown };
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
