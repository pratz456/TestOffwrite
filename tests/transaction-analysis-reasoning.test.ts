import { describe, expect, it } from 'vitest';
import { groundTransactionAnalysis } from '@/lib/ai/transaction-tax-policy';
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

const transaction: TransactionInput = {
  tx_id: 'reasoning-example', merchant: 'Computer store', amount_usd: 1200, date_iso: '2026-09-16',
  business_purpose: 'Bought a laptop for editing client videos and graphic designs.',
};
const context: UserContext = { user_id: 'example', profession: ['Designer'], filing_state: 'CA', business_entity: 'sole_proprietor' };
const rationale = 'The laptop supports editing client videos and fits the equipment category.';
const limitation = 'The category is suggested, but this expense has additional eligibility or calculation rules. Review the supporting facts before including a deduction.';

function model(overrides: Partial<OutputType> = {}): OutputType {
  return { status: 'ok', transaction_kind: 'expense', category: 'equipment', is_deductible: true, expense_type: 'business',
    deductible_percent: 100, evidence_ids: ['assets-946'], customized_reason: rationale,
    key_analysis_factor: 'Equipment tax treatment needs review.', confidence: 0.9, ...overrides };
}
const analyze = (input = model(), tx = transaction) => groundTransactionAnalysis(input, tx, context, 'test-model');

describe('item context after a tax-policy gate', () => {
  it('keeps a specific category explanation after the authoritative limitation without approving a deduction', () => {
    const result = analyze();
    expect(result).toMatchObject({ status: 'needs_more_info', transaction_kind: 'expense', category: 'equipment',
      missing_fields: ['asset_treatment'], questions: ['What was purchased, when was it first used for business, and what business-use records and depreciation elections apply?'],
      customized_reason: `${limitation} About this purchase: ${rationale}`,
      reasoning_summary: `${limitation} About this purchase: ${rationale}`, key_analysis_factor: limitation, reason: limitation,
      tax_year: 2026, sources: [{ id: 'assets-946' }] });
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.deductible_percent).toBeUndefined();
    expect(result?.expense_type).toBeUndefined();
  });

  it.each([
    'The laptop for client videos is fully deductible.',
    'You can write the laptop for client videos off.',
    'The laptop for client videos is a guaranteed write-off.',
    'The laptop for client videos qualifies for immediate expensing.',
    'The laptop for client videos meets the requirements.',
    'The laptop for client videos is IRS-approved.',
    'The laptop for client videos will save you money.',
    'The laptop for client videos reduces income.',
    'The laptop for client videos has an eighty percent business portion.',
    'The laptop for client videos is 80% business use.',
    'The laptop for client videos is ８０％ business use.',
    'The laptop for client videos costs $1200.',
    'The laptop for client videos costs twelve hundred dollars.',
    'The laptop for client videos belongs on the 2026 return.',
    'The laptop for client videos is used exclusively for business.',
  ])('uses policy-only text for an unsafe or ambiguous earlier assertion: %s', customized_reason => {
    const result = analyze(model({ customized_reason }));
    expect(result?.customized_reason).toBe(limitation);
    expect(result?.reasoning_summary).toBe(limitation);
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.deductible_percent).toBeUndefined();
  });

  it('keeps the category sentence but discards an adjacent deduction promise', () => {
    const result = analyze(model({ customized_reason: `${rationale} You can deduct the full amount this year.` }));
    expect(result?.customized_reason).toBe(`${limitation} About this purchase: ${rationale}`);
    expect(result?.customized_reason).not.toContain('full amount');
  });

  it('can use a short item-specific key factor when the main explanation is an unsafe claim', () => {
    expect(analyze(model({ customized_reason: 'This laptop is fully deductible.', key_analysis_factor: rationale }))?.customized_reason)
      .toBe(`${limitation} About this purchase: ${rationale}`);
  });

  it.each([
    'This payment needs further review.',
    'The hotel booking covers attendance at a marketing conference.',
    'Keep the laptop invoice for editing client videos.',
    'Was the laptop for editing client videos?',
    `The laptop for editing client videos ${'has recorded business context '.repeat(15)}.`,
  ])('does not pad the explanation with generic, unrelated or excessive context: %s', customized_reason => {
    expect(analyze(model({ customized_reason }))?.customized_reason).toBe(limitation);
  });

  it('does not retain an expense rationale after the cash direction rejects that kind', () => {
    const result = analyze(model(), { ...transaction, amount_usd: -1200 });
    expect(result).toMatchObject({ status: 'needs_more_info', transaction_kind: 'unknown', missing_fields: ['transaction_kind'] });
    expect(result?.customized_reason).not.toContain(rationale);
  });

  it('does not retain model business-use claims when saved purpose is missing', () => {
    const result = analyze(model(), { ...transaction, business_purpose: undefined });
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['business_purpose'] });
    expect(result?.customized_reason).not.toContain(rationale);
  });

  it('preserves meal context without treating supplied meal facts as automatic approval', () => {
    const mealContext = 'The recorded dinner with the client fits business meals.';
    const result = analyze(model({ category: 'meals_50', evidence_ids: ['meals-274'],
      deductible_percent: 50, customized_reason: mealContext }), {
      ...transaction, merchant: 'Restaurant', amount_usd: 80,
      business_purpose: 'Dinner with client Morgan to discuss the design project. I was present, the meal was not lavish, and food was billed separately from entertainment.',
      attendees: ['Morgan', 'Me'], documentation_status: 'complete',
    });
    expect(result).toMatchObject({ status: 'needs_more_info', category: 'meals_50', missing_fields: ['meal_conditions'] });
    expect(result?.customized_reason).toMatch(/^A qualifying business meal generally has a 50% limit/);
    expect(result?.customized_reason).toContain(`About this purchase: ${mealContext}`);
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.deductible_percent).toBeUndefined();
  });

  it('keeps year limitations first and does not duplicate the item context when grounded again', () => {
    const nextYear = { ...transaction, date_iso: '2027-01-10' };
    const first = analyze(model(), nextYear)!;
    const second = analyze(first, nextYear)!;
    expect(first.status).toBe('blocked');
    expect(first.customized_reason).toMatch(/^The category is a suggestion only\./);
    expect(first.customized_reason).toContain('2027 is outside its verified scope. About this purchase:');
    expect(second.customized_reason).toBe(first.customized_reason);
    expect(second.sources).toEqual(first.sources);
    expect(second.is_deductible).toBeUndefined();
  });

  it('does not modify a supported simple-expense explanation or treatment', () => {
    const reason = 'The design-software subscription supports editing client videos.';
    const result = analyze(model({ category: 'software_subscriptions', evidence_ids: ['business-162'], customized_reason: reason }));
    expect(result).toMatchObject({ status: 'ok', is_deductible: true, deductible_percent: 100, customized_reason: reason });
  });
});
