import { describe, expect, it } from 'vitest';
import { CATEGORY_EVIDENCE, CATEGORY_SCHEDULE_C_LINE, EXPENSE_CATEGORIES, groundTransactionAnalysis, isStatedSentence, proposedPurposeQuestion,
  transactionTaxPolicyPrompt, transactionTaxYear, TRANSACTION_EVIDENCE_IDS, TRANSACTION_TAX_EVIDENCE, TRANSACTION_TAX_POLICY_VERSION, uncitedReferences,
  userPurposeText } from '@/lib/ai/transaction-tax-policy';
import { merchantIntelligence } from '@/lib/ai/merchant-intelligence';
import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { REVIEW_CATEGORIES } from '@/lib/transactions/ai-review-contract';
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
      jurisdiction: 'US-federal', policy_version: 'federal-transactions-2026-09-17.2',
      sources: [
        { id: 'business-162', title: '26 USC 162 — Trade or business expenses', url: expect.stringContaining('https://uscode.house.gov/'), reviewed_at: '2026-09-16' },
        // The category-specific rule is attached by the server so the user sees the applicable test.
        { id: 'supplies-263a', title: expect.stringContaining('§1.263(a)-1(f)'), url: expect.stringContaining('https://www.ecfr.gov/'), reviewed_at: '2026-09-17' },
      ],
      irs_refs: ['26 USC 162 — Trade or business expenses', 'Treas. Reg. §1.263(a)-1(f) — Supplies and the de minimis safe harbor'],
      provenance: { provider: 'openai', model: 'synthetic-model', kind: 'model_with_curated_tax_policy' },
    });
    expect(TRANSACTION_TAX_POLICY_VERSION).toBe('federal-transactions-2026-09-17.2');
  });
  it('ships a reviewed packet of primary sources with a category-specific rule for every expense category', () => {
    expect(TRANSACTION_TAX_EVIDENCE.length).toBeGreaterThanOrEqual(22);
    expect(new Set(TRANSACTION_EVIDENCE_IDS).size).toBe(TRANSACTION_TAX_EVIDENCE.length);
    for (const item of TRANSACTION_TAX_EVIDENCE) {
      expect(item.url, item.id).toMatch(/^https:\/\/(?:uscode\.house\.gov|www\.ecfr\.gov|www\.irs\.gov)\//);
      expect(item.reviewed_at, item.id).toMatch(/^2026-09-1[67]$/);
      expect(item.rule.split(/(?<=[.!?])\s+/).length, item.id).toBeGreaterThanOrEqual(2);
      expect(item.rule, item.id).not.toMatch(/https?:\/\//);
    }
    expect(TRANSACTION_TAX_EVIDENCE.filter(item => item.reviewed_at === '2026-09-17').length).toBeGreaterThanOrEqual(14);
    for (const category of EXPENSE_CATEGORIES) {
      expect(CATEGORY_EVIDENCE[category].length, category).toBeGreaterThan(0);
      for (const id of CATEGORY_EVIDENCE[category]) expect(TRANSACTION_EVIDENCE_IDS, `${category} -> ${id}`).toContain(id);
      if (category !== 'other') expect(CATEGORY_EVIDENCE[category][0], category).not.toBe('business-162');
    }
    // No hard-coded mileage rate: the model is pointed at the dated table instead.
    const mileage = TRANSACTION_TAX_EVIDENCE.find(item => item.id === 'mileage-rates')!;
    expect(mileage.rule).not.toMatch(/\d+(?:\.\d+)?\s*cents|\$0\.\d+/);
    expect(mileage.edition).toContain('dated rate periods on file');
    expect(mileage.title).toContain('lib/tax-rules/mileage-rates.ts');
    expect(TRANSACTION_TAX_EVIDENCE.find(item => item.id === 'information-returns-6041')!.rule).toContain('$2,000');
  });
  it.each([
    ['Ordinary supplies under Section 162 and the safe harbor in Reg. §1.263(a)-1(f)(1)(ii)(D).', ['business-162', 'supplies-263a'], []],
    ['Education must maintain or improve skills under Treas. Reg. §1.162-5(a).', ['education-reg-1.162-5'], []],
    ['Education must maintain or improve skills under Treas. Reg. §1.162-5(a).', ['business-162'], ['§1.162-5']],
    ['Club dues are disallowed by §274(a)(3) even though § 162 would otherwise apply.', ['dues-274a3', 'business-162'], []],
    ['Club dues are disallowed by §274(a)(3).', ['business-162'], ['§274(a)(3)']],
    ['See Pub 334 and Publication 463 plus Pub. 535.', ['software-334', 'mileage-rates'], ['Pub 535']],
    ['Section 199A gives a 20% deduction; see §280F too.', ['business-162'], ['§199A', '§280F']],
    ['Start-up costs follow §195 and the 1099-NEC duty follows §6041.', ['startup-195', 'information-returns-6041'], []],
  ] as const)('resolves prose citations against the packet: %s', (text, ids, expected) => {
    expect(uncitedReferences(text, ids)).toEqual(expected);
  });
  it.each([
    ['software_subscriptions', 'software-334'], ['advertising_marketing', 'advertising-334'], ['contract_labor', 'contract-labor-334'],
    ['education_training', 'education-reg-1.162-5'], ['dues_and_memberships', 'dues-274a3'], ['bank_and_payment_fees', 'bank-fees-334'],
    ['rent', 'rent-334'], ['utilities_phone_internet', 'phone-internet-262'],
  ] as const)('attaches the %s rule when the model cited only the general business rule', (category, specific) => {
    const result = analyze({ category, evidence_ids: ['business-162'] }, category === 'utilities_phone_internet' ? { business_use_percentage: 50 } : {});
    expect(result?.evidence_ids).toEqual(['business-162', specific]);
    expect(result?.sources?.map(source => source.id)).toEqual(['business-162', specific]);
  });
  it('accepts the category-specific rule on its own and rejects a rule from an unrelated category', () => {
    expect(analyze({ category: 'software_subscriptions', evidence_ids: ['software-334'] })).toMatchObject({ status: 'ok', evidence_ids: ['software-334'] });
    expect(analyze({ category: 'software_subscriptions', evidence_ids: ['mileage-rates'] })).toBeNull();
    expect(analyze({ category: 'contract_labor', evidence_ids: ['information-returns-6041'] })).toMatchObject({ status: 'ok', evidence_ids: ['information-returns-6041', 'contract-labor-334'] });
    expect(analyze({ category: 'vehicle_expense', evidence_ids: ['mileage-rates'] })).toMatchObject({ status: 'needs_more_info', missing_fields: ['vehicle_method'], evidence_ids: ['mileage-rates', 'travel-463'] });
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

describe('merchant- and profession-aware grounding (2026-09-17.2)', () => {
  const trainer: UserContext = { ...ctx, profession: ['Personal trainer'] };
  const software = (patch: Partial<OutputType> = {}) => ({ category: 'software_subscriptions' as const, evidence_ids: ['software-334'],
    customized_reason: 'Design software commonly used by designers. Keep the invoice.', key_analysis_factor: 'Design software.', ...patch });

  it('a bank descriptor copied into the note is not a saved purpose; a typed sentence is', () => {
    expect(userPurposeText({ ...tx, business_purpose: undefined, merchant: 'Figma', description: 'FIGMA MONTHLY', note: 'FIGMA MONTHLY' })).toBe('');
    expect(userPurposeText({ ...tx, business_purpose: undefined, merchant: 'Figma', note: 'Design tool for client work' })).toBe('Design tool for client work');
    expect(isStatedSentence('Client snacks')).toBe(false);
    expect(isStatedSentence('Snacks for the client shoot day')).toBe(true);
    expect(proposedPurposeQuestion(merchantIntelligence({ ...tx, merchant: 'OpenAI ChatGPT' }))).toBe('Is this OpenAI / ChatGPT charge your AI assistant subscription used for business work? Confirm or edit the purpose.');
  });
  it('a business_likely merchant with no purpose gets a proposed purpose, never an approval', () => {
    const result = analyze(software(), { merchant: 'Figma', business_purpose: undefined });
    expect(result).toMatchObject({
      status: 'needs_more_info', missing_fields: ['business_purpose'], proposed_purpose: 'Design software subscription used for client work', schedule_c_line: '18',
      questions: ['Is this Figma charge your design software subscription used for client work? Confirm or edit the purpose.'], evidence_ids: ['software-334'],
    });
    expect(result?.is_deductible).toBeUndefined(); expect(result?.deductible_percent).toBeUndefined();
    // No proposal for a medium-confidence (Plaid-only) or needs_purpose merchant.
    expect(analyze(software(), { merchant: 'Unknown Vendor', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', business_purpose: undefined })?.proposed_purpose).toBeUndefined();
    expect(analyze(software(), { merchant: 'LinkedIn', business_purpose: undefined })).toMatchObject({ missing_fields: ['business_purpose'], questions: [expect.stringContaining('job-search')] });
  });
  it('caller- or model-supplied proposed_purpose and schedule_c_line are dropped and recomputed', () => {
    const forged = { proposed_purpose: 'Whatever the model says', schedule_c_line: '99' } as Partial<OutputType>;
    const approved = analyze({ ...software(), ...forged }, { merchant: 'Figma' });
    expect(approved).toMatchObject({ status: 'ok', is_deductible: true, schedule_c_line: '18' });
    expect(approved?.proposed_purpose).toBeUndefined();
    const personal = analyze({ ...forged, transaction_kind: 'personal', is_deductible: false, expense_type: 'personal', evidence_ids: ['personal-262'] }, { merchant: 'Netflix' });
    expect(personal?.status).toBe('ok'); expect(personal?.proposed_purpose).toBeUndefined(); expect(personal?.schedule_c_line).toBeUndefined();
  });
  it('personal_likely and transfer merchants need a stated sentence; the merchant question and rule are attached', () => {
    const label = analyze({}, { merchant: 'Whole Foods', business_purpose: undefined, note: 'Client snacks' });
    expect(label).toMatchObject({ status: 'needs_more_info', missing_fields: ['business_purpose'], evidence_ids: ['business-162', 'personal-262', 'supplies-263a'], questions: [expect.stringContaining('Groceries are personal')] });
    expect(analyze({}, { merchant: 'Whole Foods', business_purpose: 'Snacks and drinks for the client shoot day' })).toMatchObject({ status: 'ok', deductible_percent: 100 });
    const venmo = analyze({ category: 'contract_labor', evidence_ids: ['contract-labor-334'] }, { merchant: 'Venmo', business_purpose: undefined, note: 'Alex logo' });
    expect(venmo).toMatchObject({ status: 'needs_more_info', missing_fields: ['transaction_kind'], evidence_ids: ['records-334', 'contract-labor-334'] });
    expect(venmo?.schedule_c_line).toBeUndefined();
  });
  it.each([
    ['IRS USATAXPYMT', 'other', 'taxes-licenses-sch-c', 'transaction_kind', 'taxes-licenses-sch-c'],
    ['Nelnet', 'education_training', 'education-reg-1.162-5', 'transaction_kind', 'records-334'],
    ['Kaiser Permanente', 'other', 'insurance-334', 'deduction_placement', 'personal-262'],
    ['Lively HSA', 'other', 'business-162', 'deduction_placement', 'records-334'],
  ] as const)('%s: not_an_expense / schedule_1 merchants route to %s even with a saved purpose', (merchant, category, evidence, field, added) => {
    const result = analyze({ category, evidence_ids: [evidence] }, { merchant, business_purpose: 'Paid from the business account for the business this month' });
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: [field], evidence_ids: expect.arrayContaining([evidence, added]) });
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.evidence_ids?.length).toBeLessThanOrEqual(3);
  });
  it('the same gym is a rent question for a trainer and a club-dues question for a designer; both still ask', () => {
    const forTrainer = analyze({ category: 'rent', evidence_ids: ['rent-334'] }, { merchant: 'Planet Fitness', business_purpose: 'Monthly floor fee to train my clients' }, trainer);
    expect(forTrainer).toMatchObject({ status: 'needs_more_info', missing_fields: ['club_dues_exception'], evidence_ids: ['dues-274a3', 'personal-262', 'rent-334'], questions: [expect.stringContaining('floor fee')] });
    expect(forTrainer?.customized_reason).toContain('business rent rather than dues');
    const forDesigner = analyze({ category: 'dues_and_memberships', evidence_ids: ['dues-274a3'] }, { merchant: 'Planet Fitness', business_purpose: 'Monthly gym membership to stay fit for work' });
    expect(forDesigner).toMatchObject({ status: 'needs_more_info', missing_fields: ['club_dues_exception'], evidence_ids: ['dues-274a3', 'personal-262'], questions: [expect.stringContaining('membership for your own use')] });
  });
  it('the word "gym" in a note does not re-route a confidently identified clothing purchase away from the clothing test', () => {
    const shoes = analyze({}, { merchant: 'Nike', business_purpose: 'Training shoes I wear when coaching clients at the gym' }, trainer);
    expect(shoes).toMatchObject({ status: 'needs_more_info', missing_fields: ['personal_use_exception'], questions: [expect.stringContaining('Workout clothing')] });
    // An unknown merchant with the same words still reaches the club-dues gate.
    expect(analyze({ category: 'dues_and_memberships', evidence_ids: ['dues-274a3'] }, { merchant: 'Riverside Athletic', business_purpose: 'Monthly gym membership for my health' })?.missing_fields).toEqual(['club_dues_exception']);
  });
  it('profession hints replace the generic gate question without changing the gate', () => {
    const camera = { category: 'equipment' as const, evidence_ids: ['assets-946'] };
    expect(analyze(camera, { merchant: 'B&H Photo', amount_usd: 2899, business_purpose: 'Camera body for paid wedding shoots' }, { ...ctx, profession: ['Photographer'] }))
      .toMatchObject({ missing_fields: ['asset_treatment'], questions: [expect.stringContaining('paid shoots')], schedule_c_line: '13' });
    expect(analyze(camera, { merchant: 'B&H Photo', amount_usd: 2899, business_purpose: 'Camera for recording consulting workshop videos' }, { ...ctx, profession: ['Management consultant'] }))
      .toMatchObject({ missing_fields: ['asset_treatment'], questions: [expect.stringContaining('consulting work')] });
    expect(analyze({ category: 'vehicle_expense', evidence_ids: ['mileage-rates'] }, { merchant: 'Chevron', business_purpose: 'Gas for a full day of Uber driving' }, { ...ctx, profession: ['Rideshare driver'] }))
      .toMatchObject({ missing_fields: ['vehicle_method'], questions: [expect.stringContaining('standard mileage rate')], evidence_ids: ['mileage-rates', 'travel-463'] });
  });
  it('mixed_use merchants ask for the documented split in the merchant\'s words and accept a recorded one', () => {
    const turbo = { category: 'other' as const, evidence_ids: ['professional-fees-334'] };
    expect(analyze(turbo, { merchant: 'TurboTax', business_purpose: 'Tax software used to file my return with the business schedule' }))
      .toMatchObject({ status: 'needs_more_info', missing_fields: ['business_use_percentage'], questions: [expect.stringContaining('business schedules')], schedule_c_line: '17' });
    expect(analyze({ ...turbo, deductible_percent: 60 }, { merchant: 'TurboTax', business_use_percentage: 60, business_purpose: 'Tax software used to file my return with the business schedule' }))
      .toMatchObject({ status: 'ok', is_deductible: true, deductible_percent: 60, schedule_c_line: '17' });
  });
  it('gate-cited rules survive the three-source cap even when the model already selected three ids', () => {
    const result = analyze({ category: 'dues_and_memberships', evidence_ids: ['dues-274a3', 'business-162', 'personal-262'] },
      { merchant: 'Planet Fitness', business_purpose: 'Monthly floor fee to train my clients' }, trainer);
    expect(result?.evidence_ids).toEqual(['dues-274a3', 'personal-262', 'rent-334']);
    expect(uncitedReferences([result?.customized_reason, ...(result?.questions ?? [])].join(' '), result?.evidence_ids ?? [])).toEqual([]);
  });
  it('the Schedule C line table agrees with the app\'s Schedule C aggregation map', () => {
    for (const review of REVIEW_CATEGORIES) {
      const mapped = CATEGORY_MAP[review.recordedCategory]?.line;
      if (mapped) expect(CATEGORY_SCHEDULE_C_LINE[review.value], review.value).toBe(mapped);
    }
    expect(CATEGORY_SCHEDULE_C_LINE.other).toBeNull();
  });
});
