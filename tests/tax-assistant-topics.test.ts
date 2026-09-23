import { describe, expect, it } from 'vitest';
import { assistantRequestSchema, GUIDANCE_TOPICS, modelSelectionSchema } from '../lib/tax-assistant/contract';
import { buildGuidanceMessages, guidanceResponse, topicAnswer, topicSourceIds, validateAssessment } from '../lib/tax-assistant/guidance';
import { GUIDANCE_SOURCES, guidanceSource, SELECTABLE_TOPICS, type SelectableTopic } from '../lib/tax-assistant/knowledge';

/** docs/PRODUCT_ROADMAP_2026-09-17.md §4: claims the product may not make until validated. */
const FORBIDDEN_CLAIMS = /finds? every deduction|every deduction|maximi[sz]e|guarantee|file your taxes|e-file|audit[- ](protection|defense|proof)|accurate for all states|2027 estimate|IRS[- ]approved|risk[- ]free|(?<!not automatically )(?:is|are) (?:fully|100%) deductible/i;
const PRIMARY_SOURCE = /^https:\/\/(www\.irs\.gov|uscode\.house\.gov|www\.ecfr\.gov)\//;
const PLACEMENT = /Schedule (C|1|1-A|A|SE)\b|Form 1040|Not deductible|Not a deduction/;
const TAX_YEARS = [2026, 2027] as const;
const ORIGINAL_TOPICS = new Set(['business-expenses', 'vehicles-records', 'depreciation', 'home-office', 'meals', 'tips-overtime', 'vehicle-loan-interest', 'senior-deduction', 'information-returns', 'charitable-non-itemizer']);

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const packet = (topic: SelectableTopic) => {
  const source = guidanceSource(topic);
  if (!source) throw new Error(`missing packet ${topic}`);
  return source;
};
const answerFor = (topic: SelectableTopic, taxYear: number) => {
  const { answer } = packet(topic);
  return typeof answer === 'function' ? answer(taxYear) : answer ?? '';
};

describe('assistant topic catalogue', () => {
  it('covers the questions freelancers actually ask, as a closed enum the model selects from', () => {
    expect(SELECTABLE_TOPICS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(SELECTABLE_TOPICS).size).toBe(SELECTABLE_TOPICS.length);
    expect(GUIDANCE_TOPICS).toEqual([...SELECTABLE_TOPICS, 'not-supported']);
    for (const expected of [
      'cell-phone', 'home-internet', 'computer-equipment', 'software-subscriptions', 'office-rent', 'home-rent', 'car-mileage-vs-actual',
      'parking-tolls', 'business-travel', 'meals', 'solo-meals', 'clothing-uniforms', 'grooming', 'gym-membership', 'health-insurance',
      'marketplace-premium-credit', 'dental-vision', 'retirement-plans', 'hsa', 'education-courses', 'conferences', 'books-publications', 'advertising', 'website-domain',
      'contract-labor', 'family-employees', 'owner-draws', 'estimated-taxes', 'state-taxes-licenses', 'bank-payment-fees', 'business-interest',
      'business-insurance', 'legal-professional-fees', 'startup-costs', 'business-gifts', 'charitable-gifts', 'hobby-loss', 'side-hustle-w2',
      'information-returns', 'bartering', 'cash-income', 'business-losses', 'qbi-deduction', 'when-to-see-a-cpa',
    ]) expect(SELECTABLE_TOPICS).toContain(expected);
  });

  it('accepts every catalogue topic in the model schema and nothing else', () => {
    for (const topic of GUIDANCE_TOPICS) {
      expect(modelSelectionSchema.safeParse({ topic, missingFactIds: [], photoCategories: [] }).success).toBe(true);
    }
    for (const topic of ['personal-expenses', 'authority', 'vehicle-classification', 'crypto', '']) {
      expect(modelSelectionSchema.safeParse({ topic, missingFactIds: [], photoCategories: [] }).success).toBe(false);
    }
  });

  it.each(SELECTABLE_TOPICS)('%s: server-authored packet with answer, placement, records, follow-ups and primary sources', (topic) => {
    const source = packet(topic);
    expect(source.supportedTaxYears).toEqual([2026, 2027]);
    expect(source.answer).toBeTruthy();
    expect(source.placement).toMatch(PLACEMENT);
    expect(source.records?.length).toBeGreaterThan(0);
    expect(source.requiredFacts.length).toBeGreaterThanOrEqual(1);
    expect(source.requiredFacts.length).toBeLessThanOrEqual(ORIGINAL_TOPICS.has(topic) ? 5 : 3);
    if (!ORIGINAL_TOPICS.has(topic)) for (const fact of source.requiredFacts) expect(fact).toMatch(/\?$/);
    for (const id of source.citations ?? []) expect(guidanceSource(id), `citation ${id}`).toBeDefined();

    const urls = topicSourceIds(topic).map(id => guidanceSource(id)?.url);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls.length).toBeLessThanOrEqual(3);
    for (const url of urls) expect(url).toMatch(PRIMARY_SOURCE);

    for (const taxYear of TAX_YEARS) {
      const answer = answerFor(topic, taxYear);
      expect(words(answer), `${topic} ${taxYear} word count`).toBeLessThanOrEqual(220);
      expect(words(answer)).toBeGreaterThanOrEqual(30);
      const everything = [source.title, source.summary, answer, source.placement, ...(source.records ?? []), ...source.requiredFacts, topicAnswer(topic, taxYear)].join('\n');
      expect(everything).not.toMatch(FORBIDDEN_CLAIMS);
      expect(everything).not.toMatch(/\{|\}|undefined|\[object/);
    }
  });

  it('never states a 2026 annual amount as the 2027 figure', () => {
    const yearDependent = SELECTABLE_TOPICS.filter(topic => typeof packet(topic).answer === 'function');
    const newlyEffectiveTopics = new Set(['savers-match', 'scholarship-contribution-credit']);
    expect(yearDependent.length).toBeGreaterThanOrEqual(7);
    for (const topic of yearDependent) {
      const later = answerFor(topic, 2027);
      expect(later).not.toBe(answerFor(topic, 2026));
      if (!newlyEffectiveTopics.has(topic)) expect(later, topic).toMatch(/pending verification|not been verified as published|will be published|2027 the limits are|published employer-coverage affordability percentage/);
      expect(later, topic).not.toMatch(/for 2026\b|made in 2026 in the course/);
    }
    expect(answerFor('hsa', 2027)).toContain('$4,500');
    expect(answerFor('hsa', 2026)).toContain('$4,400');
    expect(answerFor('marketplace-premium-credit', 2027)).toContain('10.22%');
    expect(answerFor('marketplace-premium-credit', 2026)).toContain('9.96%');
    expect(answerFor('retirement-plans', 2027)).not.toContain('$72,000');
    expect(answerFor('retirement-plans', 2027)).toContain('The 2027 dollar limits have not been verified as published');
    expect(answerFor('business-losses', 2027)).not.toContain('$256,000');
    expect(answerFor('car-mileage-vs-actual', 2027)).not.toContain('72.5');
  });

  it('keeps the disallowed items honest: solo meals, grooming, gym and owner draws say no', () => {
    expect(answerFor('solo-meals', 2026)).toMatch(/not deductible/);
    expect(answerFor('grooming', 2026)).toMatch(/personal and not deductible/);
    expect(answerFor('gym-membership', 2026)).toContain('274(a)(3)');
    expect(answerFor('owner-draws', 2026)).toMatch(/not a deductible expense/);
    expect(answerFor('estimated-taxes', 2026)).toMatch(/not an expense/);
    expect(packet('clothing-uniforms').answer).toContain('not suitable for everyday wear');
    for (const topic of ['solo-meals', 'grooming', 'gym-membership', 'owner-draws', 'estimated-taxes'] as const) {
      expect(packet(topic).placement).toMatch(/^Not deductible/);
    }
  });

  it('places Schedule 1 items off Schedule C and names the form', () => {
    expect(packet('health-insurance').placement).toMatch(/Schedule 1 .*Form 7206/);
    expect(packet('retirement-plans').placement).toMatch(/^Schedule 1/);
    expect(packet('hsa').placement).toMatch(/Schedule 1 .*Form 8889/);
    expect(packet('qbi-deduction').placement).toMatch(/Form 8995/);
    expect(packet('charitable-gifts').placement).not.toMatch(/^Schedule C/);
    expect(packet('contract-labor').placement).toContain('line 11');
    expect(answerFor('contract-labor', 2026)).toContain('$2,000 or more during 2026');
    expect(answerFor('startup-costs', 2026)).toContain('$5,000');
    expect(answerFor('business-gifts', 2026)).toContain('$25 per recipient');
    expect(packet('education-courses').url).toContain('ecfr.gov/current/title-26/section-1.162-5');
  });

  it('composes the reply from the packet: answer, placement and records, then the conditional notice', () => {
    for (const taxYear of TAX_YEARS) {
      const input = assistantRequestSchema.parse({ message: 'Can I deduct my Adobe subscription?', taxYear });
      const assessment = validateAssessment({ topic: 'software-subscriptions', missingFactIds: ['software-subscriptions:1'], photoCategories: [] }, input);
      expect(assessment.status).toBe('needs_details');
      expect(assessment.answer).toContain('**Where it goes:** Schedule C line 18');
      expect(assessment.answer).toContain('**Keep:** subscription invoices');
      expect(assessment.answer).toContain('not a determination that your expense qualifies');
      expect(assessment.questions).toEqual(['Which tool is this, and what business work do you use it for?']);
      const response = guidanceResponse(input, assessment);
      expect(response.assessment.sources.map(source => source.id)).toEqual(['software-subscriptions', 'computer-equipment']);
      expect(response.assessment.deductibleAmount).toBeNull();
    }
  });

  it('rejects missing-fact ids that belong to a different topic', () => {
    const input = assistantRequestSchema.parse({ message: 'Gym?', taxYear: 2026 });
    const assessment = validateAssessment({ topic: 'gym-membership', missingFactIds: ['meals:1'], photoCategories: [] }, input);
    expect(assessment.answer).toContain('could not reliably match');
  });

  it('shows the model every selectable packet and its fact ids, but not citation-only sources', () => {
    const input = assistantRequestSchema.parse({ message: 'Can I deduct my phone?', taxYear: 2026 });
    const system = String(buildGuidanceMessages(input)[0].content);
    for (const topic of SELECTABLE_TOPICS) expect(system).toContain(`"id":"${topic}"`);
    expect(system).toContain('| not-supported>');
    expect(system).toContain('"cell-phone:1"');
    expect(system).not.toContain('"id":"personal-expenses"');
    expect(system).not.toMatch(FORBIDDEN_CLAIMS);
    const citationOnly = GUIDANCE_SOURCES.filter(source => !(SELECTABLE_TOPICS as readonly string[]).includes(source.id)).map(source => source.id);
    expect(citationOnly).toEqual(['authority', 'vehicle-classification', 'personal-expenses', 'hsa-2027-limits', 'hsa-expanded-eligibility', 'aca-2026-percentages', 'aca-2027-percentages', 'savers-match-implementation', 'scholarship-credit-conditions', 'employee-expense-exceptions', 'passive-losses-925']);
  });
});


it('business-loss advice checks material participation before claiming a wage offset', () => {
  const source = packet('business-losses');
  expect(source.requiredFacts.join(' ')).toContain('materially participate');
  expect(source.citations).toContain('passive-losses-925');
  for (const year of TAX_YEARS) {
    const answer = answerFor('business-losses', year);
    expect(answer).toContain('passive-activity rules');
    expect(answer).toContain('Form 8582');
    expect(answer).not.toContain('when three tests are passed');
  }
});


it('vehicle-interest guidance uses the final expected-personal-use test and prevents double benefits', () => {
  const source = packet('vehicle-loan-interest');
  expect(source.url).toBe('https://www.irs.gov/irb/2026-39_irb');
  expect(source.requiredFacts.join(' ')).toContain('When the debt was incurred');
  for (const year of TAX_YEARS) {
    const answer = answerFor('vehicle-loan-interest', year);
    expect(answer).toContain('more than 50% personal use');
    expect(answer).toContain('Mixed business use alone does not disqualify');
    expect(answer).toContain('Never deduct the same interest twice');
    expect(answer).toContain('gross vehicle weight rating below 14,000 pounds');
  }
});
