import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/lib/firebase/transactions';
import type { AiReviewSuggestion } from '@/lib/transactions/ai-review-contract';

// Static markup only: there is no DOM test environment. Handlers are exercised in review-one-tap-client.test.ts.
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));

import { PurposeConfirmChip } from '@/components/review/purpose-confirm-chip';
import { BulkConfirmOffer, bulkOutcomeMessage } from '@/components/review/bulk-confirm-offer';
import { MerchantGroupList } from '@/components/review/merchant-groups';
import { QuestionChips } from '@/components/review/question-chips';
import { ExplanationCard } from '@/components/ai/explanation-card';
import { groupUnreviewedByMerchant, TAX_SETTINGS_HREF, type BulkConfirmRequest, type OpenQuestion } from '@/lib/transactions/review-proposals';

/** Claims policy: none of the review copy may promise outcomes or describe filing. */
const FORBIDDEN_CLAIMS = /maximi[sz]e|guarantee|file your taxes|fully deductible/i;
const rendered: string[] = [];
function html(element: React.ReactElement): string {
  const markup = renderToStaticMarkup(element);
  rendered.push(markup);
  return markup;
}
const decode = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\u2019').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (markup: string, pattern: RegExp) => (markup.match(pattern) ?? []).length;

const suggestion: AiReviewSuggestion & { proposed_purpose?: string } = { id: 's1', inputHash: 'h', status: 'needs_more_info', category: 'software_subscriptions', transactionKind: 'expense', isDeductible: null, deductiblePercent: null,
  reasoning: 'Recurring design software charge.', questions: ['What is this software used for?'], documentationRequired: [], irsReferences: [], sources: [], taxYear: 2026, policyVersion: 'p', model: 'm', analyzedAt: 1,
  proposed_purpose: 'Design software for client work' };
const charge = (id: string, merchant: string, changes: Partial<Transaction> = {}): Transaction => ({ id, trans_id: id, account_id: 'acc', merchant_name: merchant, amount: 52.99, category: 'SERVICE_SUBSCRIPTION', date: '2026-09-01', is_deductible: null, ...changes });
const offer: BulkConfirmRequest = { merchantKey: 'adobe', merchant: 'Adobe', count: 3, decision: 'business', businessPurpose: 'Design software for client work', category: 'software_subscriptions' };
const noop = () => {};

describe('Confirm purpose chip', () => {
  it('shows the proposed purpose as a one-tap answer to the first question, with edit and not-business paths and nothing pre-selected', () => {
    const markup = html(<PurposeConfirmChip proposal="Design software for client work" question="What is this software used for?" onConfirm={noop} onReject={noop} />);
    expect(markup).toContain('What is this software used for?');
    expect(markup).toContain('aria-label="Confirm purpose: Design software for client work"');
    expect(markup).toContain('Something else');
    expect(markup).toContain('Not business');
    expect(markup).toContain('Nothing is saved until you tap.');
    expect(markup).not.toMatch(/checked|aria-pressed="true"|aria-checked="true"/);
    expect(count(markup, /<button/g)).toBe(3);
    expect(count(markup, /min-h-11/g)).toBe(3);
  });
  it('asks for a purpose in a text field when the analysis proposed none, and labels a group confirmation by charge count', () => {
    const markup = html(<PurposeConfirmChip proposal={null} onConfirm={noop} onReject={noop} />);
    expect(markup).toContain('<textarea');
    expect(markup).toContain('placeholder="Why was this needed for your business?"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Proposed business purpose');
    const group = html(<PurposeConfirmChip id="merchant-group-2" proposal="Design software" confirmLabel="Confirm 3 charges" note="Confirming saves this purpose and records a deduction for each of the 3 charges. Nothing is saved until you tap." onConfirm={noop} onReject={noop} />);
    expect(group).toContain('id="merchant-group-2-heading"');
    expect(group).toContain('aria-label="Confirm 3 charges: Design software"');
    expect(group).toContain('records a deduction for each of the 3 charges');
    expect(group).not.toContain('id="purpose-proposal-heading"');
  });
});

describe('Apply to similar charges offer', () => {
  it('names the count and merchant, explains what a business decision saves, and waits for a tap', () => {
    const markup = html(<BulkConfirmOffer offer={offer} onApplied={noop} onDismiss={noop} />);
    expect(decode(markup)).toContain('Apply to 3 similar charges from Adobe?');
    expect(markup).toContain('aria-label="Apply to 3 similar charges from Adobe"');
    expect(markup).toContain('Apply to 3');
    expect(markup).toContain('Not now');
    expect(markup).toContain('records each as a business deduction');
    expect(markup).toContain('left for your review');
    expect(count(markup, /<button/g)).toBe(2);
    expect(count(markup, /min-h-11/g)).toBe(2);
  });
  it('describes a not-business decision without a deduction and reports server counts honestly', () => {
    const markup = html(<BulkConfirmOffer offer={{ ...offer, decision: 'personal', businessPurpose: null, category: null, count: 1 }} onApplied={noop} onDismiss={noop} />);
    expect(decode(markup)).toContain('Apply to 1 similar charge from Adobe?');
    expect(markup).toContain('No deductions are recorded.');
    expect(bulkOutcomeMessage(offer, { updated: 3, skipped: 0, truncated: false, transactionIds: [] })).toBe('Recorded 3 charges from Adobe as business deductions.');
    expect(bulkOutcomeMessage(offer, { updated: 1, skipped: 2, truncated: true, transactionIds: [] })).toBe('Recorded 1 charge from Adobe as business deductions; 2 still need your individual review. More charges remain; apply again to continue.');
    expect(bulkOutcomeMessage({ ...offer, decision: 'personal' }, { updated: 2, skipped: 0, truncated: false, transactionIds: [] })).toBe('Marked 2 charges from Adobe as not business.');
    expect(bulkOutcomeMessage(offer, { updated: 0, skipped: 1, truncated: false, transactionIds: [] })).toBe('No other charges from Adobe were changed; 1 still needs your individual review.');
    rendered.push(bulkOutcomeMessage(offer, { updated: 1, skipped: 2, truncated: true, transactionIds: [] }));
  });
});

describe('By merchant view', () => {
  it('lists merchants by count with totals, the proposed purpose, the agreed category and group actions', () => {
    const groups = groupUnreviewedByMerchant([
      charge('f1', 'Figma', { amount: 15 }), charge('a1', 'Adobe'), charge('f2', 'Figma', { amount: 15 }), charge('a2', 'ADOBE', { ai_suggestion: suggestion }),
      charge('f3', 'figma', { amount: 15, ai_suggestion: { ...suggestion, transactionKind: 'transfer', proposed_purpose: undefined } }),
      charge('done', 'Adobe', { is_deductible: true, review_status: 'confirmed' }), charge('credit', 'Adobe', { amount: -52.99 }),
    ]);
    const markup = html(<MerchantGroupList groups={groups} results={[]} onApplied={noop} onDismissResult={noop} onOpen={noop} />);
    const plain = decode(markup);
    expect(plain.indexOf('Figma')).toBeLessThan(plain.indexOf('Adobe'));
    expect(plain).toContain('3 charges · No category suggested yet');
    expect(plain).toContain('$45.00');
    expect(plain).toContain('2 charges · Software and subscriptions');
    expect(plain).toContain('$105.98');
    expect(markup).toContain('aria-label="Confirm 2 charges: Design software for client work"');
    expect(markup).toContain('id="merchant-group-0-heading"');
    expect(markup).toContain('id="merchant-group-1-heading"');
    expect(plain).toContain('1 of these looks like a transfer, refund or a category with its own tax method');
    expect(count(markup, /Not business/g)).toBe(2);
    expect(plain).toContain('Sep 1, 2026');
    expect(markup).not.toMatch(/checked|aria-pressed="true"/);
  });
  it('shows applied decisions with the server count, and an empty state without inventing work', () => {
    const results = [{ request: offer, outcome: { updated: 2, skipped: 1, truncated: false, transactionIds: ['a1', 'a2'] } }];
    const markup = html(<MerchantGroupList groups={[]} results={results} onApplied={noop} onDismissResult={noop} />);
    expect(markup).toContain('role="status"');
    expect(decode(markup)).toContain('Recorded 2 charges from Adobe as business deductions; 1 still needs your individual review.');
    expect(markup).toContain('aria-label="Dismiss"');
    expect(markup).toContain('No unreviewed charges are waiting.');
  });
});

describe('One question at a time', () => {
  const ask = (kind: OpenQuestion['kind'], field: string | null, question: string): OpenQuestion => ({ kind, field, question });
  it('offers business-use percentages that save a fact and keep the deduction decision separate', () => {
    const markup = html(<QuestionChips question={ask('business_use_percentage', 'business_use_percentage', 'How much of this laptop is for business?')} transaction={{}} onSave={noop} />);
    expect(markup).toContain('How much of this laptop is for business?');
    for (const percentage of [100, 75, 50, 25]) expect(markup).toContain(`${percentage}% business`);
    expect(count(markup, /<button/g)).toBe(4);
    expect(count(markup, /min-h-11/g)).toBe(4);
    expect(markup).toContain('The deduction is recorded only when you confirm it.');
    expect(markup).not.toContain('aria-pressed');
  });
  it('opens attendees for a client meal, links entity and tax-year gates to Settings, and sends other gaps to details', () => {
    const meal = html(<QuestionChips question={ask('meal_conditions', 'attendees', 'Who joined this meal?')} transaction={{}} onSave={noop} onOpenDetails={noop} />);
    expect(meal).toContain('Client meal (add attendees)');
    expect(meal).toContain('Something else');
    expect(meal).toContain('The 50% meal limit applies when a deduction is confirmed.');
    expect(meal).not.toContain('<textarea');
    const settings = html(<QuestionChips question={ask('settings_gate', 'entity_tax_treatment', 'How is your business taxed?')} transaction={{}} onSave={noop} />);
    expect(settings).toContain(`href="${TAX_SETTINGS_HREF}"`);
    expect(settings).toContain('Update tax settings');
    expect(settings).toContain('run analysis again');
    const other = html(<QuestionChips question={ask('other', 'receipt', 'Do you have the receipt?')} transaction={{}} onSave={noop} onOpenDetails={noop} />);
    expect(other).toContain('Add details');
    const purpose = html(<QuestionChips question={ask('business_purpose', 'business_purpose', 'What is this for?')} transaction={{}} proposal="Design software" onSave={noop} />);
    expect(purpose).toContain('Use: Design software');
    expect(purpose).toContain('<textarea');
    expect(purpose).toContain('Saves the purpose only.');
  });
});

describe('Explanation card', () => {
  it('renders the server-composed explanation and nothing for a null payload', () => {
    const markup = html(<ExplanationCard explanation={{ headline: 'Likely an ordinary software expense', why: 'Design software is ordinary for a design business.', yourFacts: ['Design business', 'Purpose: client design work'],
      scheduleCLine: 'Line 18 Office expense', estimatedTaxEffect: null, strengthen: ['Keep the subscription invoice'], nextQuestion: 'Which clients is it used for?' }} />);
    expect(markup).toContain('aria-label="Why this transaction was analyzed this way"');
    expect(markup).toContain('Likely an ordinary software expense');
    expect(markup).toContain('Where it goes:');
    expect(markup).toContain('Line 18 Office expense');
    expect(markup).toContain('Keep the subscription invoice');
    expect(markup).toContain('Which clients is it used for?');
    expect(count(markup, /<li>/g)).toBe(3);
    expect(markup).not.toMatch(/maximi[sz]e|guarantee|file your taxes|fully deductible/i);
    expect(decode(html(<ExplanationCard explanation={null} />)).trim()).toBe('');
  });
});

describe('claims policy', () => {
  it('keeps every rendered review string free of outcome promises and filing claims', () => {
    expect(rendered.length).toBeGreaterThan(10);
    for (const markup of rendered) expect(decode(markup)).not.toMatch(FORBIDDEN_CLAIMS);
  });
});
