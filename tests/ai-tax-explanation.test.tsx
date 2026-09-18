import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiTaxExplanation, trustedTaxSourceUrl } from '@/components/ai-tax-explanation';
import type { AiReviewSuggestion } from '@/lib/transactions/ai-review-contract';

const suggestion: AiReviewSuggestion = {
  id: 'saved-synthetic-suggestion', status: 'needs_more_info', transactionKind: 'expense',
  category: 'vehicle_expense', isDeductible: null, deductiblePercent: null,
  reasoning: 'Vehicle costs need business-use and method information before tax treatment can be assessed.',
  questions: ['What share of the miles were business miles?'], documentationRequired: ['A contemporaneous mileage log'],
  irsReferences: [], sources: [{ id: 'vehicle', title: 'IRS Publication 463', url: 'https://www.irs.gov/publications/p463', edition: 'Current publication', reviewed_at: '2026-09-16' }],
  taxYear: 2026, policyVersion: 'synthetic-test-policy', model: 'synthetic-test-model', analyzedAt: 0, inputHash: 'synthetic-input-hash',
};
describe('source-backed AI explanation', () => {
  it('shows the actual category, year, reason, question, records and trusted source without approving a deduction', () => {
    const html = renderToStaticMarkup(<AiTaxExplanation suggestion={suggestion} />);
    for (const text of ['Vehicle', '2026', suggestion.reasoning, suggestion.questions[0], suggestion.documentationRequired[0], 'https://www.irs.gov/publications/p463', 'no deduction has been approved']) expect(html).toContain(text);
    expect(html).not.toContain('100% deductible');
  });
  it('puts the first concrete question in the compact next step without approving a deduction', () => {
    const html = renderToStaticMarkup(<AiTaxExplanation suggestion={suggestion} compact onAddContext={() => {}} />);
    expect(html).toContain(suggestion.questions[0]);
    expect(html).toContain('Deduction unresolved');
    expect(html).toContain('Add details');
    expect(html).not.toContain('100% deductible');
  });
  it('keeps unresolved treatment actionable when no specific question is saved', () => {
    const html = renderToStaticMarkup(<AiTaxExplanation suggestion={{ ...suggestion, questions: [] }} compact />);
    expect(html).toContain('Add the facts needed to review tax treatment.');
  });
  it('does not turn a missing source or untrusted model URL into authority', () => {
    const html = renderToStaticMarkup(<AiTaxExplanation suggestion={{ ...suggestion, sources: [{ ...suggestion.sources[0], url: 'https://irs.gov.attacker.example/fake' }] }} />);
    expect(html).toContain('No verified source is attached');
    expect(html).not.toContain('attacker.example');
  });
  it.each([['income', 'Business income'], ['transfer', 'Transfer / card payment'], ['personal', 'Personal purchase']] as const)('shows the known %s flow instead of the generic expense category', (kind, label) => {
    const html = renderToStaticMarkup(<AiTaxExplanation suggestion={{ ...suggestion, transactionKind: kind, category: 'other' }} />);
    expect(html).toContain(label);
    expect(html).not.toContain('Other — tax treatment');
  });
  it.each(['javascript:alert(1)', 'http://irs.gov/a', 'https://irs.gov.attacker.example/a', 'https://user:password@irs.gov/a', '/publications/p463'])('rejects unsafe/non-authoritative source URL %s', url => {
    expect(trustedTaxSourceUrl(url)).toBe(false);
  });
  it.each(['https://www.irs.gov/publications/p463', 'https://irs.gov/taxtopics/tc511', 'https://www.govinfo.gov/content/pkg/USCODE-2025-title26/pdf/USCODE-2025-title26.pdf', 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section162'])('allows a vetted official HTTPS host %s', url => {
    expect(trustedTaxSourceUrl(url)).toBe(true);
  });
});
