import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), collection: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mocks.collection } }));
vi.mock('openai', () => ({ default: function MockOpenAI() { return { chat: { completions: { create: mocks.create } } }; } }));

import { analyzeTransaction, buildAnalysisContext, type TransactionInput, type UserContext } from '@/lib/ai/analyzeTransaction';
import {
  OTHER_GENERAL_PRIOR, PROFESSION_CONTEXT_LIMIT, PROFESSION_IDS, PROFESSION_PRIORS, matchProfession, matchProfessions,
  professionContextForModel, professionHint,
} from '@/lib/ai/profession-priors';
import { EXPENSE_CATEGORIES, TRANSACTION_EVIDENCE_IDS } from '@/lib/ai/transaction-tax-policy';

const LINES_BY_CATEGORY: Record<string, string[]> = {
  advertising_marketing: ['8'], vehicle_expense: ['9'], bank_and_payment_fees: ['10'], contract_labor: ['11'], equipment: ['13'],
  other: ['15', '16b', '17', '21', '23', '27a'], software_subscriptions: ['18'], rent: ['20a', '20b'], supplies_small_tools: ['22'],
  travel: ['24a'], meals_50: ['24b'], utilities_phone_internet: ['25'], education_training: ['27a'], dues_and_memberships: ['27a'], home_office: ['30'],
};

describe('profession priors table', () => {
  it('covers 26 professions, each with rule nuances traceable to the evidence packet', () => {
    expect(PROFESSION_PRIORS.length).toBe(26);
    expect(PROFESSION_PRIORS.map(prior => prior.id)).toEqual([...PROFESSION_IDS]);
    for (const prior of PROFESSION_PRIORS) {
      expect(prior.label.length, prior.id).toBeGreaterThan(3);
      expect(prior.summary.length, prior.id).toBeGreaterThan(20);
      expect(prior.keywords.length, prior.id).toBeGreaterThanOrEqual(3);
      for (const keyword of prior.keywords) expect(keyword, prior.id).toBe(keyword.toLowerCase().trim());
      expect(prior.typical.length, prior.id).toBeGreaterThanOrEqual(prior.id === 'other_general' ? 2 : 4);
      for (const item of prior.typical) {
        expect(EXPENSE_CATEGORIES, prior.id).toContain(item.category);
        expect(item.nuance.length, `${prior.id}/${item.category}`).toBeGreaterThan(20);
        expect(item.evidence.length, `${prior.id}/${item.category}`).toBeGreaterThan(0);
        for (const id of item.evidence) expect(TRANSACTION_EVIDENCE_IDS, `${prior.id}/${item.category} cites ${id}`).toContain(id);
      }
      expect(prior.auditTraps.length, prior.id).toBe(3);
      for (const [subtype, hint] of Object.entries(prior.hints ?? {})) {
        expect(hint.question.length, `${prior.id}/${subtype}`).toBeGreaterThan(20);
        // Hint questions are displayed by the grounding layer, whose evidence list may not back a named statute.
        expect(hint.question, `${prior.id}/${subtype}`).not.toMatch(/§|\bPub(?:lication)?\.?\s+\d|\bsections?\s+\d/i);
        if (hint.category) expect(EXPENSE_CATEGORIES).toContain(hint.category);
        if (hint.scheduleCLine) expect(LINES_BY_CATEGORY[hint.category as string], `${prior.id}/${subtype}`).toContain(hint.scheduleCLine);
      }
    }
  });

  it('never states a deductibility conclusion for a transaction', () => {
    expect(JSON.stringify(PROFESSION_PRIORS)).not.toMatch(/is_deductible|isDeductible|fully deductible|100% deductible/);
  });

  it('covers every profession the profile screens offer', () => {
    const expected: Record<string, string> = {
      'Software Developer': 'web_developer', 'Freelance Writer': 'writer_editor', 'Graphic Designer': 'graphic_ux_designer', 'Consultant': 'management_consultant',
      'Marketing Specialist': 'marketing_consultant', 'Real Estate Agent': 'real_estate_agent', 'Photographer': 'photographer_videographer', 'Web Designer': 'graphic_ux_designer',
      'Content Creator': 'influencer_content_creator', 'Business Coach': 'management_consultant', 'Virtual Assistant': 'virtual_assistant',
      'Social Media Manager': 'marketing_consultant', 'Online Tutor': 'tutor_teacher', 'E-commerce Store Owner': 'ecommerce_seller',
    };
    for (const [option, id] of Object.entries(expected)) expect(matchProfession(option)?.prior.id, option).toBe(id);
    expect(matchProfession('Other')?.prior).toBe(OTHER_GENERAL_PRIOR);
    expect(matchProfessions(['Other'])).toEqual([OTHER_GENERAL_PRIOR]);
  });
});

describe('matchProfession', () => {
  it.each([
    ['Freelance graphic designer', 'graphic_ux_designer'], ['fitness coach', 'personal_trainer'], ['business coach', 'management_consultant'],
    ['Corporate trainer', 'tutor_teacher'], ['truck driver', 'trucker_owner_operator'], ['Uber driver', 'rideshare_delivery_driver'],
    ['Marketing Consultant', 'marketing_consultant'], ['IT consultant', 'web_developer'], ['audio engineer', 'musician_performer'],
    ['Travel Nurse (1099)', 'nurse_contractor'], ['LCSW', 'therapist_private_practice'], ['Massage Therapist', 'massage_therapist'],
    ['plumber', 'handyman_contractor'], ['Etsy seller', 'ecommerce_seller'], ['YouTuber', 'influencer_content_creator'],
    ['Notary public', 'notary_signing_agent'], ['Landscaping', 'landscaper'], ['house cleaner', 'cleaner'], ['Insurance Agent', 'insurance_agent'],
    ['Bookkeeper', 'bookkeeper'], ['Hair Stylist', 'hair_stylist_barber'], ['Personal Trainer', 'personal_trainer'], ['Yoga teacher', 'personal_trainer'],
    ['Music teacher', 'tutor_teacher'], ['video editor', 'photographer_videographer'], ['financial analyst', 'bookkeeper'], ['freelancer', 'other_general'],
    ['DoorDash', 'rideshare_delivery_driver'], ['Owner-Operator', 'trucker_owner_operator'], ['Designer', 'graphic_ux_designer'],
  ])('%s → %s', (text, id) => {
    expect(matchProfession(text)?.prior.id).toBe(id);
  });

  it('returns null for empty or unknown text and lets the caller fall back to the general prior', () => {
    expect(matchProfession('')).toBeNull();
    expect(matchProfession(undefined)).toBeNull();
    expect(matchProfession('Dog walker')).toBeNull();
    expect(matchProfessions(['Dog walker'])).toEqual([OTHER_GENERAL_PRIOR]);
    expect(matchProfessions([])).toEqual([]);
    expect(matchProfessions(undefined)).toEqual([]);
  });

  it('handles the saved comma-joined string and de-duplicates', () => {
    expect(matchProfessions('Software Developer, Photographer').map(prior => prior.id)).toEqual(['web_developer', 'photographer_videographer']);
    expect(matchProfessions(['Designer', 'Graphic Designer', 'Dog walker']).map(prior => prior.id)).toEqual(['graphic_ux_designer']);
  });
});

describe('professionHint', () => {
  it('reads a merchant signal through the profession: a gym is rent for a trainer and nothing special for a designer', () => {
    const trainer = matchProfessions(['Personal Trainer']);
    const designer = matchProfessions(['Graphic Designer']);
    expect(professionHint(trainer, 'gym')).toMatchObject({ category: 'rent', scheduleCLine: '20b' });
    expect(professionHint(trainer, 'gym')?.question).toMatch(/floor fee or space rent/i);
    expect(professionHint(designer, 'gym')).toBeNull();
    expect(professionHint(designer, 'electronics')?.category).toBe('equipment');
    expect(professionHint([...designer, ...trainer], 'gym')?.category).toBe('rent');
    expect(professionHint(trainer, null)).toBeNull();
    expect(professionHint([], 'gym')).toBeNull();
  });
});

describe('professionContextForModel', () => {
  it.each(PROFESSION_PRIORS.map(prior => [prior.id, prior.keywords[0]] as const))('%s fits the 900-character budget', (id, keyword) => {
    const context = professionContextForModel({ profession: [keyword] });
    expect(context).not.toBeNull();
    expect(context!.length).toBeLessThanOrEqual(PROFESSION_CONTEXT_LIMIT);
    expect(context).toContain(PROFESSION_PRIORS.find(prior => prior.id === id)!.label);
    expect(context).toMatch(/never establish/);
  });

  it('describes up to two professions within the budget and returns null without a profession', () => {
    const two = professionContextForModel({ profession: ['Photographer', 'Real Estate Agent'] })!;
    expect(two.length).toBeLessThanOrEqual(PROFESSION_CONTEXT_LIMIT);
    expect(two).toContain('Photographer / videographer');
    expect(two).toContain('Real estate agent');
    expect(professionContextForModel({ profession: [] })).toBeNull();
    expect(professionContextForModel(undefined)).toBeNull();
    expect(professionContextForModel({ profession: ['Other'] })).toContain('No profession-specific priors');
    expect(professionContextForModel({ profession: ['Trainer'] }, 300)!.length).toBeLessThanOrEqual(300);
  });

  it('carries the profession-specific nuance the model needs', () => {
    expect(professionContextForModel({ profession: ['Rideshare driver'] })).toMatch(/Standard mileage covers fuel/);
    expect(professionContextForModel({ profession: ['Trucker'] })).toMatch(/80%/);
    expect(professionContextForModel({ profession: ['Influencer'] })).toMatch(/everyday wear/);
  });
});

describe('analysis context wiring', () => {
  const transaction: TransactionInput = { tx_id: 'wire-1', merchant: 'ADOBE *CREATIVE CLOUD', amount_usd: 54.99, date_iso: '2026-03-02', notes: 'planet fitness netflix' };
  const context: UserContext = { user_id: '', profession: ['Graphic Designer'], filing_state: 'CA', business_entity: 'sole_proprietor' };
  const extras = { learningContext: null, timeToUse: null, w2Income: undefined, bizIncome: undefined };

  it('sends profession_context and tx.merchant_intelligence built from bank text only', () => {
    const built = buildAnalysisContext(transaction, context, extras);
    expect(built.profession_context).toContain('Graphic / UX designer');
    expect(built.tx.merchant_intelligence).toMatchObject({ name: 'Adobe', category: 'software_subscriptions', schedule_c_line: '18', disposition: 'business_likely', confidence: 'high' });
    expect(built.tx.merchant_intelligence?.default_purpose).toMatch(/design/i);
    expect(buildAnalysisContext({ ...transaction, merchant: 'XYZ 4471' }, context, extras).tx.merchant_intelligence).toBeNull();
    expect(buildAnalysisContext(transaction, { ...context, profession: [] }, extras).profession_context).toBeNull();
  });

  it('includes receipt presence and confidence without sending raw OCR text', () => {
    const built = buildAnalysisContext({
      ...transaction,
      receipt_context: {
        attached: true,
        ocr_confidence: 0.93,
      },
    }, context, extras);
    expect(built.tx.receipt_context).toMatchObject({
      attached: true,
      ocr_confidence: 0.93,
    });
    expect(JSON.stringify(built.tx.receipt_context)).not.toContain('ocr_text');
  });

  describe('prompt contract', () => {
    beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('OPENAI_API_KEY', 'synthetic-key'); vi.stubEnv('OPENAI_MODEL', ''); });
    afterEach(() => vi.unstubAllEnvs());

    it('instructs the model to prefer high-confidence merchant categories, quote or propose the purpose and name the Schedule C line', async () => {
      const content = {
        status: 'needs_more_info', transaction_kind: 'expense', evidence_ids: ['software-334'], is_deductible: null, expense_type: null,
        category: 'software_subscriptions', deductible_percent: null, key_analysis_factor: 'Confirm the subscription is used for client work.',
        customized_reason: 'If this Adobe subscription is used for client design work, it is an ordinary software expense (Schedule C line 18).',
        reasoning_summary: null, irs_refs: null, audit_risk: 'low', audit_risk_rationale: null, confidence: 0.8,
        missing_fields: ['business_purpose'], questions: ['Is this Adobe plan used in your business?'], documentation_required: ['Invoice'], reason: null, reason_hash: null,
      };
      mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], model: 'gpt-test' });
      const result = await analyzeTransaction(transaction, context);
      expect(result.success).toBe(true);
      const [request] = mocks.create.mock.calls[0];
      const system = request.messages[0].content as string;
      const user = request.messages[1].content as string;
      expect(system).toContain('MERCHANT INTELLIGENCE AND PROFESSION CONTEXT');
      expect(system).toMatch(/When confidence is high, use its category unless the saved purpose or notes describe a different item/);
      expect(system).toMatch(/quote the user's own saved purpose/);
      expect(system).toContain('If this Adobe subscription is used for client design work, it is an ordinary software expense (Schedule C line 18).');
      expect(system).toMatch(/Name the Schedule C line whenever a category is proposed/);
      expect(system).toMatch(/single most important missing fact/);
      expect(user).toContain('"profession_context": "Graphic / UX designer.');
      expect(user).toContain('"merchant_intelligence": {');
      expect(user).toContain('"disposition": "business_likely"');
      expect(user).not.toContain('"is_deductible"');
    });
  });
});
