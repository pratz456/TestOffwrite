import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { composeExplanation, ESTIMATE_LABEL, formatEstimatedTaxEffect, normalizeExplanation, type ExplainableResult } from '@/lib/ai/explanation';
import { analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';
import { reviewHydrationFields } from '@/lib/transactions/ai-review-contract';

/** docs/PRODUCT_ROADMAP_2026-09-17.md §4: claims the product may not make until validated. */
const FORBIDDEN_CLAIMS = /finds? every deduction|every deduction|maximi[sz]e|guarantee|file your taxes|e-file|audit[- ](protection|defense|proof)|accurate for all states|2027 estimate|IRS[- ]approved|risk[- ]free|tax savings|write[- ]off|100% deductible|fully deductible/i;

const source = (id: string, title: string) => ({ id, title, url: 'https://www.irs.gov/publications/p334', edition: 'current', reviewed_at: '2026-09-16' });
const profile = { income: 85000, filing_status: 'single', profession: ['Graphic designer'] };
const base = { tax_year: 2026, policy_version: 'test-policy', confidence: 0.9 };

/** Eight corpus-shaped results: the analysis gates already ran, so shapes mirror what the persistence layer sees. */
const corpus = {
  okSoftware: { ...base, status: 'ok', transaction_kind: 'expense', category: 'software_subscriptions', is_deductible: true, expense_type: 'business', deductible_percent: 100,
    customized_reason: 'Design software used for the saved client work.', key_analysis_factor: 'Ordinary design tool.', documentation_required: ['Subscription invoice'],
    sources: [source('business-162', '26 USC 162 — Trade or business expenses')] },
  okMeal: { ...base, status: 'ok', transaction_kind: 'expense', category: 'meals_50', is_deductible: true, expense_type: 'business', deductible_percent: 50,
    customized_reason: 'Client lunch with the saved attendees.', key_analysis_factor: 'Business meal with a client.', documentation_required: ['Receipt', 'Attendee names'],
    sources: [source('meals-274', '26 USC 274 — Meal conditions and entertainment limits'), source('business-162', '26 USC 162 — Trade or business expenses')] },
  needsPurpose: { ...base, status: 'needs_more_info', transaction_kind: 'expense', category: 'software_subscriptions', missing_fields: ['business_purpose'],
    questions: ['Is this the design software you use for client work?'], proposed_purpose: 'Design software for client projects', documentation_required: ['Subscription invoice'],
    sources: [source('business-162', '26 USC 162 — Trade or business expenses')] },
  needsVehicle: { ...base, status: 'needs_more_info', transaction_kind: 'expense', category: 'vehicle_expense', missing_fields: ['vehicle_method'],
    questions: ['Was this commuting or business driving, and which vehicle method do you use?'], sources: [source('travel-463', 'IRS Publication 463 — Travel, gift and car expenses')] },
  blockedYear: { ...base, tax_year: 2027, status: 'blocked', transaction_kind: 'expense', category: 'supplies_small_tools', missing_fields: ['supported_tax_year'],
    questions: ['Confirm the transaction date and review this tax year with your tax professional.'], reason: 'Outside the verified scope.',
    sources: [source('business-162', '26 USC 162 — Trade or business expenses')] },
  refund: { ...base, status: 'needs_more_info', transaction_kind: 'refund', category: 'other', missing_fields: ['original_expense'],
    questions: ['Which original purchase does this refund match, and in which tax year was that purchase deducted?'],
    documentation_required: ['Refund record and matching original invoice'], sources: [source('records-334', 'IRS Publication 334 — Small-business income and expenses')] },
  income: { ...base, status: 'ok', transaction_kind: 'income', category: 'other', is_deductible: false, deductible_percent: 0,
    customized_reason: 'Recorded client invoice payment.', key_analysis_factor: 'Customer payment.', sources: [source('records-334', 'IRS Publication 334 — Small-business income and expenses')] },
  personal: { ...base, status: 'ok', transaction_kind: 'personal', category: 'other', is_deductible: false, expense_type: 'personal', deductible_percent: 0,
    customized_reason: 'Groceries recorded as family use.', key_analysis_factor: 'Personal purchase.', sources: [source('personal-262', '26 USC 262 — Personal, living and family expenses')] },
} satisfies Record<string, ExplainableResult>;

const transactions = {
  okSoftware: { merchant_name: 'Adobe', amount: 54.99, date: '2026-03-02', business_purpose: 'Creative Cloud for client design work' },
  okMeal: { merchant_name: 'Cafe Roma', amount: 86.4, date: '2026-04-11', business_purpose: 'Lunch to scope the spring campaign', attendees: ['Dana Lee (client)', 'me'] },
  needsPurpose: { merchant_name: 'Adobe', amount: 54.99, date: '2026-03-02' },
  needsVehicle: { merchant_name: 'Shell', amount: 61.2, date: '2026-05-20', mileage_details: { miles: 42, start_location: 'Studio', end_location: 'Client site' } },
  blockedYear: { merchant_name: 'Staples', amount: 40, date: '2027-01-08' },
  refund: { merchant_name: 'Amazon', amount: -35.5, date: '2026-06-01' },
  income: { merchant_name: 'ACME Corp', amount: -1200, date: '2026-02-14', notes: 'Client invoice 1042 paid' },
  personal: { merchant_name: 'Trader Joes', amount: 92.13, date: '2026-07-04', business_purpose: 'Family groceries' },
};
type Key = keyof typeof corpus;
const explain = (key: Key, overrides: Partial<ExplainableResult> = {}, saved = profile, taxYear = corpus[key].tax_year) =>
  composeExplanation({ result: { ...corpus[key], ...overrides }, transaction: { iso_currency_code: 'USD', ...transactions[key] }, profile: saved, taxYear });
const everyString = (value: unknown): string => JSON.stringify(value);

describe('composeExplanation over corpus-style results', () => {
  it('explains the applicable expense rule without unrelated refund and income paragraphs', () => {
    const explanation = explain('okSoftware', { category: 'supplies_small_tools', sources: [
      source('business-162', 'Business expenses'), source('records-334', 'Records'), source('supplies-263a', 'Supplies'),
    ] });
    expect(explanation.why).toContain('documented business use');
    expect(explanation.why).not.toMatch(/refund|customer receipts|prior-year recovery/i);
    expect(explanation.why.length).toBeLessThan(250);
  });
  it.each(Object.keys(corpus) as Key[])('%s: returns the full shape with no forbidden claims and no model-authored amounts', (key) => {
    const explanation = explain(key);
    expect(Object.keys(explanation).sort()).toEqual(['estimatedTaxEffect', 'headline', 'nextQuestion', 'scheduleCLine', 'strengthen', 'why', 'yourFacts'].sort());
    expect(explanation.headline.length).toBeGreaterThan(10);
    expect(explanation.why.length).toBeGreaterThan(40);
    expect(everyString(explanation)).not.toMatch(FORBIDDEN_CLAIMS);
    expect(everyString(explanation)).not.toMatch(/undefined|\[object|https?:/);
    expect(explanation.nextQuestion).toBe(corpus[key].questions?.[0] ?? null);
    const deductible = corpus[key].status === 'ok' && corpus[key].is_deductible === true;
    expect(explanation.estimatedTaxEffect === null).toBe(!deductible);
  });

  it('ok deduction: estimate range in whole dollars with the exact label, Schedule C line from the category map, rule from the source id', () => {
    const explanation = explain('okSoftware');
    expect(explanation.headline).toBe('Likely deductible: Software and subscriptions — Adobe, $54.99');
    expect(explanation.why).toContain('26 USC 162 allows a cost that is ordinary and necessary');
    expect(explanation.scheduleCLine).toBe('Schedule C line 18 (Office expense)');
    expect(explanation.yourFacts).toEqual(['Purpose you saved: Creative Cloud for client design work', 'Filing status used for the estimate: single']);
    const effect = explanation.estimatedTaxEffect!;
    expect(effect.label).toBe('estimated federal tax effect; state not included');
    expect(effect.label).toBe(ESTIMATE_LABEL);
    expect(Number.isInteger(effect.low) && Number.isInteger(effect.high)).toBe(true);
    // SE tax alone is about 14.1% of the deduction; the top federal bracket plus SE tax caps the range.
    expect(effect.low).toBeGreaterThanOrEqual(Math.floor(54.99 * 0.1413));
    expect(effect.low).toBeLessThanOrEqual(effect.high);
    expect(effect.high).toBeLessThanOrEqual(Math.ceil(54.99 * (0.1413 + 0.37)));
    expect(effect.basis).toContain('$54.99 deductible from $54.99');
    expect(effect.basis).toContain('single status and 2026');
    expect(effect.basis).toMatch(/not a refund/i);
    expect(explanation.strengthen).toEqual(['Subscription invoice', 'Note of the business work this tool is used for']);
    expect(formatEstimatedTaxEffect(effect)).toMatch(/^\$\d+–\$\d+$|^about \$\d+$/);
  });

  it('ok meal: applies the 50% share to the estimate and lists the attendees actually saved', () => {
    const explanation = explain('okMeal');
    expect(explanation.headline).toBe('Likely deductible: Business meals (50% limit) — Cafe Roma, $86.40');
    expect(explanation.why).toMatch(/^26 USC 274 limits a qualifying business meal to 50%/);
    expect(explanation.scheduleCLine).toBe('Schedule C line 24b (Meals)');
    expect(explanation.yourFacts).toContain('Attendees: Dana Lee (client), me');
    expect(explanation.estimatedTaxEffect!.basis).toContain('$43.20 deductible at 50% from $86.40');
    expect(explanation.estimatedTaxEffect!.high).toBeLessThanOrEqual(Math.ceil(43.2 * (0.1413 + 0.37)));
    expect(explanation.strengthen).toEqual(['Receipt', 'Attendee names', 'Receipt showing the restaurant, date and amount',
      'Names and business relationship of everyone present', 'Business purpose of the meal, written at the time']);
  });

  it('needs_more_info with a proposed purpose: headline asks to confirm it and the effect is withheld', () => {
    const explanation = explain('needsPurpose');
    expect(explanation.headline).toBe('Confirm: Design software for client projects — Adobe, $54.99');
    expect(explanation.estimatedTaxEffect).toBeNull();
    expect(explanation.scheduleCLine).toBe('Schedule C line 18 (Office expense)');
    expect(explanation.nextQuestion).toBe('Is this the design software you use for client work?');
    expect(explanation.yourFacts).toEqual([]);
  });

  it('needs_more_info without a proposed purpose: names the missing fact and the category records', () => {
    const explanation = explain('needsVehicle');
    expect(explanation.headline).toBe('Needs one fact: the business miles driven and your vehicle deduction method — Shell, $61.20');
    expect(explanation.yourFacts).toEqual(['Mileage: 42 miles (Studio to Client site)']);
    expect(explanation.scheduleCLine).toBeNull();
    expect(explanation.strengthen[0]).toBe('Mileage log with date, miles, destination and purpose for each trip');
    expect(explanation.why).toMatch(/^IRS Publication 463/);
  });

  it('blocked: states the scope limit and never estimates, even if a deductible flag survived', () => {
    const explanation = explain('blockedYear');
    expect(explanation.headline).toBe('Outside the reviewed tax years: category only — Staples, $40.00');
    expect(explanation.estimatedTaxEffect).toBeNull();
    expect(explain('blockedYear', { is_deductible: true }).estimatedTaxEffect).toBeNull();
    expect(explain('blockedYear', { missing_fields: ['entity_tax_treatment'] }).headline).toMatch(/^Entity return: category only/);
  });

  it('refund: no Schedule C line, refund records, and the matching question leads', () => {
    const explanation = explain('refund');
    expect(explanation.headline).toBe('Needs one fact: which original purchase this refund matches — Amazon, $35.50');
    expect(explanation.scheduleCLine).toBeNull();
    expect(explanation.strengthen).toEqual(['Refund record and matching original invoice', 'Refund record and the original invoice', 'Tax year and treatment of the original purchase']);
    expect(explanation.why).toContain('a refund needs the original purchase and tax year checked');
  });

  it('income and personal flows: state the flow, keep the effect and Schedule C line empty, and ask for nothing personal', () => {
    const income = explain('income');
    expect(income.headline).toBe('Business income: reported as receipts, not an expense — ACME Corp, $1,200.00');
    expect(income.estimatedTaxEffect).toBeNull();
    expect(income.scheduleCLine).toBeNull();
    expect(income.strengthen).toEqual(['Invoice or payment record that matches this deposit']);
    const personal = explain('personal');
    expect(personal.headline).toBe('Personal purchase: not a business deduction — Trader Joes, $92.13');
    expect(personal.strengthen).toEqual([]);
    expect(personal.yourFacts).toEqual(['Purpose you saved: Family groceries']);
    expect(personal.why).toMatch(/^26 USC 262 disallows personal, living and family costs/);
  });
});

describe('estimated tax effect boundaries', () => {
  it.each(['w2_income', 'w2_social_security_wages', 'w2_medicare_wages'])('withholds estimates for malformed recorded %s rather than substituting zero or another box', field => {
    for (const invalid of [-1, NaN, Infinity, '100000', false]) {
      expect(explain('okSoftware', {}, { ...profile, [field]: invalid }).estimatedTaxEffect).toBeNull();
    }
  });

  it('preserves explicit zero W-2 SS and Medicare boxes', () => {
    const wages = { income: 100000, w2_income: 200000, filing_status: 'single' };
    const defaultBoxes = explain('okSoftware', {}, wages).estimatedTaxEffect!;
    const zeroBoxes = composeExplanation({ result: corpus.okSoftware,
      transaction: { ...transactions.okSoftware, iso_currency_code: 'USD' },
      profile: { ...wages, w2_social_security_wages: 0, w2_medicare_wages: 0 }, taxYear: 2026 }).estimatedTaxEffect!;
    expect(zeroBoxes.high).toBeGreaterThan(defaultBoxes.high);
  });

  it.each(['ok', 'blocked'] as const)('never labels a raw EUR charge as dollars in a %s explanation', status => {
    const explanation = composeExplanation({ result: { ...corpus.okSoftware, status },
      transaction: { merchant_name: 'Adobe', amount: 54.99, iso_currency_code: 'EUR' }, profile, taxYear: 2026 });
    expect(explanation.headline).toContain('EUR');
    expect(explanation.headline).not.toContain('$');
    expect(explanation.estimatedTaxEffect).toBeNull();
  });

  it.each([{}, { iso_currency_code: 'USD', unofficial_currency_code: 'USDC' }])('withholds raw dollar amounts and tax effects without unambiguous currency: %j', currency => {
    const explanation = composeExplanation({ result: corpus.okSoftware,
      transaction: { merchant_name: 'Adobe', amount: 54.99, ...currency }, profile, taxYear: 2026 });
    expect(explanation.headline).toMatch(/ — Adobe$/);
    expect(explanation.headline).not.toContain('$');
    expect(explanation.estimatedTaxEffect).toBeNull();
  });

  it('accepts explicit USD input separately from a raw foreign amount', () => {
    const explanation = composeExplanation({ result: corpus.okSoftware,
      transaction: { merchant_name: 'Adobe', amount_usd: 54.99, amount: 50, iso_currency_code: 'EUR' }, profile, taxYear: 2026 });
    expect(explanation.headline).toContain('$54.99');
    expect(explanation.estimatedTaxEffect?.basis).toContain('$54.99 deductible');
  });

  it('is absent unless status is ok and the deduction is supported', () => {
    expect(explain('okSoftware', { status: 'needs_more_info' }).estimatedTaxEffect).toBeNull();
    expect(explain('okSoftware', { is_deductible: false }).estimatedTaxEffect).toBeNull();
    expect(explain('okSoftware', { is_deductible: undefined }).estimatedTaxEffect).toBeNull();
    expect(composeExplanation({ result: corpus.okSoftware, transaction: { merchant_name: 'Adobe', amount: 0 }, profile, taxYear: 2026 }).estimatedTaxEffect).toBeNull();
    expect(composeExplanation({ result: corpus.okSoftware, transaction: { merchant_name: 'Adobe', amount: -54.99 }, profile, taxYear: 2026 }).estimatedTaxEffect).toBeNull();
  });

  it('never produces a 2027 estimate or an estimate for an unsupported filing status', () => {
    expect(explain('okSoftware', {}, profile, 2027).estimatedTaxEffect).toBeNull();
    expect(explain('okSoftware', {}, profile, null).estimatedTaxEffect).toBeNull();
    expect(explain('okSoftware', {}, { ...profile, filing_status: 'qualifying_widow' }).estimatedTaxEffect).toBeNull();
    expect(explain('okSoftware', {}, { ...profile, filing_status: 42 as unknown as string }).estimatedTaxEffect).toBeNull();
  });

  it('with no saved income, withholds the estimate instead of inventing a 25% rate', () => {
    expect(explain('okSoftware', {}, { filing_status: 'single' }).estimatedTaxEffect).toBeNull();
  });

  it('does not add Social Security tax when W-2 wages already exhaust the wage base', () => {
    const effect = explain('okSoftware', {}, { income: 20000, w2_income: 200000, filing_status: 'single' }).estimatedTaxEffect!;
    // 2026 single taxable income exceeds $201,775: 32% marginal income tax.
    // $54.99 reduces net SE earnings by $50.78: $1.47 Medicare + $0.46 additional
    // Medicare + $17.36 income tax after the half-SE adjustment = about $19.
    expect(effect.low).toBe(19);
    expect(effect.high).toBe(19);
  });

  it('withholds an effect that requires loss or joint wage-ownership facts', () => {
    expect(explain('okSoftware', {}, { income: 20, filing_status: 'single' }).estimatedTaxEffect).toBeNull();
    expect(explain('okSoftware', {}, { income: 20000, w2_income: 100000, filing_status: 'married_filing_jointly' }).estimatedTaxEffect).toBeNull();
  });

  it('lets saved W-2 wages raise the bracket used for the top of the range', () => {
    const seOnly = explain('okSoftware', {}, { income: 20000, filing_status: 'single' }).estimatedTaxEffect!;
    const withWages = explain('okSoftware', {}, { income: 20000, w2_income: 120000, filing_status: 'single' }).estimatedTaxEffect!;
    expect(withWages.high).toBeGreaterThan(seOnly.high);
    expect(withWages.high).toBeGreaterThanOrEqual(Math.floor(54.99 * (0.1413 + 0.24)));
  });

  it('above the Social Security wage base only the Medicare part of SE tax is added', () => {
    const high = explain('okSoftware', {}, { income: 400000, filing_status: 'married_filing_jointly' }).estimatedTaxEffect!;
    const mid = explain('okSoftware', {}, { income: 85000, filing_status: 'married_filing_jointly' }).estimatedTaxEffect!;
    expect(high.high).toBeLessThanOrEqual(Math.ceil(54.99 * (0.9235 * 0.029 + 0.37)));
    expect(high.basis).toContain('married filing jointly status and 2026');
    expect(mid.low).toBeGreaterThanOrEqual(Math.floor(54.99 * 0.9235 * 0.153));
  });

  it('formats a range, a point and a sub-dollar effect', () => {
    expect(formatEstimatedTaxEffect({ low: 14, high: 32, label: ESTIMATE_LABEL, basis: '' })).toBe('$14–$32');
    expect(formatEstimatedTaxEffect({ low: 25, high: 25, label: ESTIMATE_LABEL, basis: '' })).toBe('about $25');
    expect(formatEstimatedTaxEffect({ low: 0, high: 0, label: ESTIMATE_LABEL, basis: '' })).toBe('under $1');
  });
});

describe('Schedule C placement and stored payloads', () => {
  it('prefers the policy-supplied schedule_c_line in any of its shapes', () => {
    expect(explain('okSoftware', { schedule_c_line: '27a' }).scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    expect(explain('okSoftware', { schedule_c_line: 'Schedule C line 18 (Office expense)' }).scheduleCLine).toBe('Schedule C line 18 (Office expense)');
    expect(explain('okSoftware', { schedule_c_line: 'line 25' }).scheduleCLine).toBe('Schedule C line 25');
    expect(explain('okSoftware', { schedule_c_line: 'Not deductible' }).scheduleCLine).toBe('Not deductible');
    expect(explain('okSoftware', { schedule_c_line: '   ' }).scheduleCLine).toBe('Schedule C line 18 (Office expense)');
  });

  it('normalizes a stored payload and rejects malformed or tampered records', () => {
    const explanation = explain('okSoftware');
    expect(normalizeExplanation(JSON.parse(JSON.stringify(explanation)))).toEqual(explanation);
    expect(normalizeExplanation(null)).toBeNull();
    expect(normalizeExplanation({ headline: 'x' })).toBeNull();
    expect(normalizeExplanation({ ...explanation, estimatedTaxEffect: { low: 5, high: 9, label: 'guaranteed savings', basis: '' } })!.estimatedTaxEffect).toBeNull();
    expect(normalizeExplanation({ ...explanation, strengthen: 'not a list', yourFacts: [1, 'kept'] })).toMatchObject({ strengthen: [], yourFacts: ['kept'] });
  });

  it('persists ai_explanation composed from the gated suggestion, not the raw model output', () => {
    const saved = { userId: 'owner', trans_id: 'tx', merchant_name: 'B&H Photo', amount: 1899, date: '2026-03-02', iso_currency_code: 'USD',
      business_purpose: 'Camera body for client shoots', equipment_details: { make: 'Sony', model: 'A7 IV', business_use_percentage: 80 } };
    const raw = { ...corpus.okSoftware, category: 'equipment' as const, customized_reason: 'Camera used for client work.' };
    const update = analysisSuggestionUpdate(raw, 1770000000000, saved, 'profile-hash', profile);
    expect(update.ai_suggestion.status).toBe('needs_more_info');
    expect(update.ai_explanation.estimatedTaxEffect).toBeNull();
    expect(update.ai_explanation.headline).not.toMatch(/^Likely deductible/);
    expect(update.ai_explanation.headline).toContain('B&H Photo, $1,899.00');
    expect(update.ai_explanation.yourFacts).toEqual(['Purpose you saved: Camera body for client shoots', 'Business use: 80%', 'Equipment: Sony A7 IV']);
    expect(update.ai_explanation.nextQuestion).toBe(update.ai_suggestion.questions[0]);
    expect(JSON.stringify(update.ai_explanation)).not.toContain('undefined');
    expect(everyString(update.ai_explanation)).not.toMatch(FORBIDDEN_CLAIMS);

    const ok = analysisSuggestionUpdate(corpus.okSoftware, 1770000000000, { ...saved, merchant_name: 'Adobe', amount: 54.99, equipment_details: undefined }, 'profile-hash', profile);
    expect(ok.ai_suggestion.status).toBe('ok');
    expect(ok.ai_explanation.estimatedTaxEffect?.label).toBe(ESTIMATE_LABEL);
    expect(ok.ai_explanation.headline).toMatch(/^Likely deductible: Software and subscriptions — Adobe, \$54\.99$/);
    expect(reviewHydrationFields({ ai_explanation: ok.ai_explanation }).ai_explanation).toEqual(ok.ai_explanation);
    expect(reviewHydrationFields({}).ai_explanation).toBeNull();
  });

  it('keeps ai_explanation out of every client update allow-list in firestore.rules', () => {
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const allowLists = [...rules.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map(match => match[1]);
    expect(allowLists.length).toBeGreaterThanOrEqual(2);
    for (const list of allowLists) {
      expect(list).not.toMatch(/ai_explanation|ai_suggestion|ai_status|review_status/);
    }
    expect(rules).toMatch(/allow create, delete: if false/);
  });
});
