import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExplanationCard } from '@/components/ai/explanation-card';
import { ESTIMATE_LABEL, normalizeExplanation, type TransactionExplanation } from '@/lib/ai/explanation';

const explanation: TransactionExplanation = {
  headline: 'Likely deductible: Software and subscriptions — Adobe, $54.99',
  why: '26 USC 162 allows a cost that is ordinary and necessary for your existing trade or business.',
  yourFacts: ['Purpose you saved: Creative Cloud for client design work', 'Filing status used for the estimate: single'],
  scheduleCLine: 'Schedule C line 18 (Office expense)',
  estimatedTaxEffect: { low: 14, high: 20, label: ESTIMATE_LABEL, basis: '$54.99 deductible from this $54.99 charge. Federal income tax plus self-employment tax; state tax is not included and this is not a refund amount.' },
  strengthen: ['Subscription invoice', 'Note of the business work this tool is used for'],
  nextQuestion: null,
};

describe('ExplanationCard', () => {
  it('renders the server-composed headline, facts, placement, estimate label and records', () => {
    const html = renderToStaticMarkup(<ExplanationCard explanation={explanation} />);
    for (const text of [explanation.headline, explanation.why, 'Creative Cloud for client design work', 'Schedule C line 18 (Office expense)', '$14–$20',
      'estimated federal tax effect; state not included', 'not a refund amount', 'Subscription invoice']) expect(html).toContain(text);
    expect(html).not.toContain('Next question');
    expect(html).not.toMatch(/maximi[sz]e|guarantee/i);
  });

  it('shows the next question with an answer action and no estimate when the deduction is unresolved', () => {
    const unresolved = normalizeExplanation({ ...explanation, headline: 'Confirm: Design software for client projects — Adobe, $54.99',
      estimatedTaxEffect: null, yourFacts: [], nextQuestion: 'Is this the design software you use for client work?' })!;
    const html = renderToStaticMarkup(<ExplanationCard explanation={unresolved} onAnswer={() => {}} />);
    expect(html).toContain('Confirm: Design software for client projects');
    expect(html).toContain('Is this the design software you use for client work?');
    expect(html).toContain('Answer');
    expect(html).toContain('Only the bank record was used.');
    expect(html).not.toContain('estimated federal tax effect');
  });

  it('renders nothing for a missing or malformed stored payload', () => {
    expect(renderToStaticMarkup(<ExplanationCard explanation={null} />)).toBe('');
    expect(renderToStaticMarkup(<ExplanationCard explanation={normalizeExplanation({ headline: 'only' })} />)).toBe('');
  });
});
