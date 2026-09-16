import { describe, expect, it } from 'vitest';
import { groundTransactionAnalysis, transactionTaxPolicyPrompt, transactionTaxYear, TRANSACTION_TAX_POLICY_VERSION } from '@/lib/ai/transaction-tax-policy';
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

const tx: TransactionInput = { tx_id: 'synthetic', merchant: 'Synthetic shop', amount_usd: 45, date_iso: '2026-09-16', business_purpose: 'Printer supplies used exclusively for the client design project.' };
const ctx: UserContext = { user_id: 'synthetic', profession: ['Designer'], filing_state: 'CA', business_entity: 'sole_proprietor' };
function output(patch: Partial<OutputType> = {}): OutputType {
  return { status: 'ok', transaction_kind: 'expense', category: 'supplies_small_tools', is_deductible: true, expense_type: 'business',
    evidence_ids: ['business-162'], confidence: 0.9, audit_risk: 'low', customized_reason: 'Printer supplies used for the client project. Keep the itemized invoice.',
    key_analysis_factor: 'Recorded supplies for the client design project.', ...patch };
}
function analyze(patch: Partial<OutputType> = {}, transaction: Partial<TransactionInput> = {}, context: UserContext = ctx) {
  return groundTransactionAnalysis(output(patch), { ...tx, ...transaction }, context, 'synthetic-model');
}

describe('curated transaction tax grounding', () => {
  it('derives federal year, source URLs, policy version and model provenance on the server', () => {
    expect(analyze({ irs_refs: ['Fake source https://evil.invalid'] })).toMatchObject({
      status: 'ok', category: 'supplies_small_tools', deductible_percent: 100, tax_year: 2026,
      jurisdiction: 'US-federal', policy_version: TRANSACTION_TAX_POLICY_VERSION,
      sources: [{ id: 'business-162', title: '26 USC 162 — Trade or business expenses', url: expect.stringContaining('https://uscode.house.gov/'), reviewed_at: '2026-09-16' }],
      irs_refs: ['26 USC 162 — Trade or business expenses'],
      provenance: { provider: 'openai', model: 'synthetic-model', kind: 'model_with_curated_tax_policy' },
    });
  });
  it.each([[], ['invented-179'], ['business-162', 'business-162'], ['__proto__'], ['https://evil.invalid']].map(ids => [ids]))('rejects invalid evidence IDs %j', evidence_ids => {
    expect(analyze({ evidence_ids })).toBeNull();
  });
  it('rejects known but inapplicable evidence for a meal', () => {
    expect(analyze({ category: 'meals_50' })).toBeNull();
  });
  it.each(['assets-946', 'capital-263'])('accepts %s evidence for a vehicle purchase while withholding its deduction', evidence => {
    const result = analyze({ category: 'vehicle_expense', status: 'needs_more_info', evidence_ids: [evidence],
      is_deductible: undefined, expense_type: undefined, questions: ['What business-use percentage and depreciation method apply?'] },
      { amount_usd: 48000, business_purpose: 'Bought a 7000 pound SUV. I want to write it off.' });
    expect(result).toMatchObject({ transaction_kind: 'expense', category: 'vehicle_expense', status: 'needs_more_info' });
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.sources?.[0].id).toBe(evidence);
  });
  it('still rejects depreciation-only evidence for a vehicle operating cost', () => {
    expect(analyze({ category: 'vehicle_expense', evidence_ids: ['assets-946'] },
      { business_purpose: 'Gasoline for driving between client appointments.' })).toBeNull();
  });
  it('accepts a personal-rule citation when known personal categorization has unresolved tax fields', () => {
    const result = analyze({ transaction_kind: 'personal', category: 'other', status: 'needs_more_info', evidence_ids: ['personal-262'],
      is_deductible: undefined, expense_type: undefined, questions: ['Was any part business use?'] },
      { business_purpose: 'Streaming movies for personal relaxation.' });
    expect(result).toMatchObject({ transaction_kind: 'personal', category: 'other', status: 'needs_more_info' });
    expect(result?.sources?.[0].id).toBe('personal-262');
  });
  it('accepts a records citation for an unidentified incoming payment without classifying it as income', () => {
    expect(analyze({ transaction_kind: 'unknown', category: 'other', status: 'needs_more_info', evidence_ids: ['records-334'],
      is_deductible: undefined, expense_type: undefined, questions: ['What was the source of this deposit?'] },
      { amount_usd: -75, business_purpose: undefined })).toMatchObject({ transaction_kind: 'unknown', status: 'needs_more_info' });
  });
  it('rejects arbitrary source links in a model explanation', () => {
    expect(analyze({ customized_reason: 'See https://evil.invalid for the IRS rule.' })).toBeNull();
  });
  it.each(['Deduct under Section 999.', 'Deduct under IRS Pub 535.', 'Deduct under Section 179.'])('rejects unsupported prose citations (%s)', customized_reason => {
    expect(analyze({ customized_reason })).toBeNull();
  });
  it('does not display an unconditional deduction claim in an unresolved result', () => {
    const result = analyze({ status: 'needs_more_info', customized_reason: 'These supplies are fully deductible.', questions: ['What was the purpose?'] });
    expect(result?.customized_reason).toContain('eligibility remains unresolved');
    expect(result?.is_deductible).toBeUndefined();
  });
  it.each([
    { expense_type: 'personal' as const, evidence_ids: ['personal-262'] },
    { transaction_kind: 'income' as const, evidence_ids: ['records-334'] },
    { transaction_kind: 'transfer' as const, evidence_ids: ['records-334'] },
  ])('rejects contradictory completed tax fields %j', patch => {
    expect(analyze(patch)).toBeNull();
  });
  it.each(['2027-03-01', '2024-03-01', 'bad-date', '2026-02-31'])('withholds unsupported-year tax conclusions while retaining categorization (%s)', date_iso => {
    const result = analyze({}, { date_iso });
    expect(result).toMatchObject({ status: 'blocked', category: 'supplies_small_tools', transaction_kind: 'expense' });
    expect(result?.is_deductible).toBeUndefined(); expect(result?.deductible_percent).toBeUndefined();
    expect(result?.questions?.[0]).toContain('transaction date');
  });
  it.each(['s_corporation', 'partnership', 'not_applicable'] as const)('does not apply Schedule C eligibility to %s', business_entity => {
    expect(analyze({}, {}, { ...ctx, business_entity })).toMatchObject({ status: 'blocked', category: 'supplies_small_tools', missing_fields: ['entity_tax_treatment'] });
  });
  it('asks for entity facts rather than inventing sole proprietorship', () => {
    expect(analyze({}, {}, { ...ctx, business_entity: undefined })).toMatchObject({ status: 'needs_more_info', missing_fields: ['business_entity'] });
  });
  it('does not treat a business account or known merchant as a business purpose', () => {
    expect(analyze({}, { merchant: 'AWS', business_purpose: undefined, account_usage_type: 'business' })).toMatchObject({
      status: 'needs_more_info', category: 'supplies_small_tools', transaction_kind: 'expense', missing_fields: ['business_purpose'],
    });
  });
  it.each([
    ['equipment', 'assets-946', 'asset_treatment'], ['vehicle_expense', 'travel-463', 'vehicle_method'],
    ['travel', 'travel-463', 'travel_eligibility'], ['home_office', 'home-587', 'home_office_eligibility'],
    ['meals_50', 'meals-274', 'meal_conditions'],
  ] as const)('separates %s categorization from complex tax approval', (category, evidence, field) => {
    const result = analyze({ category, evidence_ids: [evidence], deductible_percent: 100 });
    expect(result).toMatchObject({ status: 'needs_more_info', category, transaction_kind: 'expense', missing_fields: [field] });
    expect(result?.questions?.[0].length).toBeGreaterThan(25);
    expect(result?.customized_reason).not.toContain('fully deductible');
    expect(result?.is_deductible).toBeUndefined(); expect(result?.deductible_percent).toBeUndefined();
  });
  it('never guesses a phone allocation', () => {
    const result = analyze({ category: 'utilities_phone_internet', deductible_percent: 80 });
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['business_use_percentage'] });
    expect(result?.deductible_percent).toBeUndefined();
  });
  it('retains only the explicitly documented mixed-use allocation', () => {
    expect(analyze({ category: 'utilities_phone_internet', deductible_percent: 70 }, { business_use_percentage: 70 }))
      .toMatchObject({ status: 'ok', deductible_percent: 70 });
    expect(analyze({ category: 'utilities_phone_internet', deductible_percent: 70 }, { business_use_percentage: 60 })).toBeNull();
    expect(analyze({}, { business_use_percentage: 0 })).toBeNull();
  });
  it('asks before calling a negative amount income even if the model says needs_more_info', () => {
    const result = analyze({ status: 'needs_more_info', transaction_kind: 'income', category: 'other', evidence_ids: ['records-334'], is_deductible: undefined, expense_type: undefined },
      { amount_usd: -45, business_purpose: undefined });
    expect(result).toMatchObject({ transaction_kind: 'unknown', status: 'needs_more_info', missing_fields: ['transaction_kind'] });
  });
  it('supports explicitly recorded customer income without turning it into an expense', () => {
    expect(analyze({ transaction_kind: 'income', category: 'other', evidence_ids: ['records-334'], is_deductible: false },
      { amount_usd: -45, category: 'INCOME', business_purpose: 'Customer invoice payment' }))
      .toMatchObject({ transaction_kind: 'income', status: 'ok', is_deductible: false, deductible_percent: 0 });
  });
  it('retains refund categorization but requires the original purchase and tax year before an offset', () => {
    const result = analyze({ transaction_kind: 'refund', evidence_ids: ['records-334'], is_deductible: false },
      { amount_usd: -45, business_purpose: 'Returned printer supplies refund' });
    expect(result).toMatchObject({ transaction_kind: 'refund', category: 'supplies_small_tools', status: 'needs_more_info', missing_fields: ['original_expense'] });
    expect(result?.questions?.[0]).toContain('tax year');
    expect(result?.is_deductible).toBeUndefined();
  });
  it('does not manufacture a refund category from an unexplained deposit', () => {
    expect(analyze({ transaction_kind: 'refund', evidence_ids: ['records-334'], is_deductible: false },
      { amount_usd: -45, business_purpose: undefined }))
      .toMatchObject({ transaction_kind: 'unknown', status: 'needs_more_info' });
  });
  it('does not infer own-account transfer from PayPal', () => {
    expect(analyze({ transaction_kind: 'transfer', category: 'other', evidence_ids: ['records-334'], is_deductible: false },
      { merchant: 'PayPal', business_purpose: undefined }))
      .toMatchObject({ transaction_kind: 'unknown', status: 'needs_more_info' });
  });
  it('allows explicitly recorded own-account transfer categorization without a deduction', () => {
    expect(analyze({ transaction_kind: 'transfer', category: 'other', evidence_ids: ['records-334'], is_deductible: false },
      { business_purpose: 'Internal transfer between my accounts' }))
      .toMatchObject({ transaction_kind: 'transfer', status: 'ok', deductible_percent: 0 });
  });
  it('requires a concrete question when only a missing field is returned', () => {
    expect(analyze({ status: 'needs_more_info', missing_fields: ['purpose'], questions: undefined })?.questions)
      .toEqual(['What was purchased or received, and what was its business or personal purpose?']);
  });
  it('includes year/edition/scope constraints and critical limitations in the trusted prompt', () => {
    const prompt = transactionTaxPolicyPrompt(tx);
    for (const phrase of ['2026', 'US federal only', '2025 publication', '2027 treatment', '50% limit, not automatic eligibility',
      'A vehicle over 6,000 pounds is not automatically fully deductible', 'prior-year deduction recoveries',
      'standard mileage already includes', 'time of day do not establish', 'Return irs_refs=null']) expect(prompt).toContain(phrase);
    expect(prompt).not.toContain('Pub 535');
    expect(transactionTaxYear({ ...tx, date_iso: '2026-02-31' })).toBeNull();
  });
  it('supplies actionable documentation when the model omits it', () => {
    expect(analyze()?.documentation_required).toEqual(['Itemized invoice or receipt', 'Recorded business purpose and any personal-use allocation']);
  });
});
