import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

import { assistantRequestSchema } from '../lib/tax-assistant/contract';
import {
  assistantContextForModel, assistantProfileFacts, composeForYou, mentionedMerchantFacts, merchantCandidates, type AssistantContext, type AssistantTransactionRow,
} from '../lib/tax-assistant/context';
import { buildGuidanceMessages, guidanceResponse, validateAssessment } from '../lib/tax-assistant/guidance';

const uid = 'synthetic-owner';
const row = (overrides: Partial<AssistantTransactionRow> = {}): AssistantTransactionRow => ({
  merchant_name: 'Adobe Systems', amount: 54.99, date: '2026-03-14', type: 'expense', userId: uid, ...overrides,
});
const adobeRows = Array.from({ length: 12 }, (_, index) => row({ date: `2026-${String(index + 1).padStart(2, '0')}-14` }));

const profile = {
  profession: 'graphic designer', filing_status: 'married_filing_jointly', state: 'ca', business_entity_type: 'sole_proprietor',
  home_office_method: 'simplified', vehicle_deduction_method: undefined, income: 84000, ein: '12-3456789',
};

describe('merchant mentions', () => {
  it.each([
    ['Can I deduct my Adobe subscription?', ['adobe']],
    ['can i write off adobe and figma', ['adobe', 'figma']],
    ['Is my Verizon bill deductible?', ['verizon']],
    ['What about GoDaddy renewals?', ['godaddy']],
    ['Are AWS charges deductible', ['aws']],
    ["Is Best Buy's laptop charge a business expense?", ['best']],
  ])('finds merchant-shaped words in %j', (message, expected) => {
    expect(merchantCandidates(message)).toEqual(expected);
  });

  it.each([
    'Can I write off a laptop I use for work and at home?',
    'can i deduct lunch with a client',
    'What records should I keep for a business purchase?',
    'Is my home office deductible if I also rent a coworking desk?',
    'Can I deduct my cell phone bill and internet?',
  ])('finds none in a plain question so no transaction read happens: %s', (message) => {
    expect(merchantCandidates(message)).toEqual([]);
  });

  it('counts and totals only the owner\'s expense rows for the named merchant in the tax year', () => {
    const rows = [
      ...adobeRows,
      row({ merchant_name: 'Adobe Systems', amount: 1000, userId: 'someone-else' }),
      row({ merchant_name: 'Adobe Systems', amount: 54.99, date: '2025-12-14' }),
      row({ merchant_name: 'Adobe Systems', amount: -54.99 }),
      row({ merchant_name: 'Adobe Systems', amount: 54.99, type: 'income' }),
      row({ merchant_name: 'Adobe Systems', amount: 54.99, pending: true }),
      row({ merchant_name: 'Figma', amount: 15 }),
    ];
    const facts = mentionedMerchantFacts({ message: 'Can I deduct my Adobe subscription?', rows, taxYear: 2026, uid });
    expect(facts).toEqual({ merchantKey: 'adobe systems', displayName: 'Adobe Systems', taxYear: 2026, count: 12, totalCents: 65988, unreviewedCount: 12 });
  });

  it('treats server-confirmed and personal decisions as reviewed; an unconfirmed post-cutoff deduction flag still needs review', () => {
    const rows = [
      row({ is_deductible: true, review_status: 'confirmed' }),
      row({ is_deductible: false }),
      row({ is_deductible: true, date: '2026-10-01' }),
      row(),
    ];
    expect(mentionedMerchantFacts({ message: 'adobe?', rows, taxYear: 2026, uid })?.unreviewedCount).toBe(2);
  });

  it('prefers the merchant whose full name appears over a shared first word', () => {
    const rows = [row({ merchant_name: 'Uber Eats', amount: 20 }), row({ merchant_name: 'Uber Eats', amount: 20 }), row({ merchant_name: 'Uber Trip', amount: 30 })];
    expect(mentionedMerchantFacts({ message: 'Are my Uber Eats orders deductible?', rows, taxYear: 2026, uid })?.merchantKey).toBe('uber eats');
    expect(mentionedMerchantFacts({ message: 'Are my Uber rides deductible?', rows, taxYear: 2026, uid })?.merchantKey).toBe('uber eats');
  });

  it('returns nothing without a mention, a match or a same-year expense', () => {
    expect(mentionedMerchantFacts({ message: 'Can I deduct lunch?', rows: adobeRows, taxYear: 2026, uid })).toBeNull();
    expect(mentionedMerchantFacts({ message: 'Adobe?', rows: adobeRows, taxYear: 2027, uid })).toBeNull();
    expect(mentionedMerchantFacts({ message: 'Figma?', rows: adobeRows, taxYear: 2026, uid })).toBeNull();
  });
});

describe('saved profile facts', () => {
  it('normalizes the six facts and drops everything else', () => {
    expect(assistantProfileFacts(profile)).toEqual({
      profession: 'graphic designer', filingStatus: 'married filing jointly', state: 'CA', entityType: 'sole proprietor',
      homeOfficeMethod: 'simplified', vehicleMethod: null,
    });
    expect(JSON.stringify(assistantProfileFacts(profile))).not.toContain('12-3456789');
    expect(assistantProfileFacts(null)).toEqual({ profession: null, filingStatus: null, state: null, entityType: null, homeOfficeMethod: null, vehicleMethod: null });
    expect(assistantProfileFacts({ profession: ['photographer', 'writer'], filing_status: 'Head of Household', business_entity_type: 'S-Corp' })).toMatchObject({ profession: 'photographer', filingStatus: 'head of household', entityType: 'S corporation' });
  });
});

describe('for-you paragraph', () => {
  const context: AssistantContext = {
    profile: assistantProfileFacts(profile),
    merchant: { merchantKey: 'adobe systems', displayName: 'Adobe', taxYear: 2026, count: 12, totalCents: 65988, unreviewedCount: 12 },
  };

  it('states the owner\'s numbers, the packet placement and a review action', () => {
    const forYou = composeForYou(context, 'software-subscriptions');
    expect(forYou?.paragraph).toBe('You have 12 Adobe charges in 2026 totaling $659.88; all are unreviewed. If they are used in your graphic designer work, they belong on Schedule C line 18 (office expense) or line 27a (other expenses).');
    expect(forYou?.action).toEqual({ screen: 'transactions', merchantKey: 'adobe systems', count: 12, label: 'Review these 12 charges' });
    expect(composeForYou(context, 'owner-draws')?.paragraph).toContain('Your business is saved as a sole proprietor, which reports on Schedule C.');
  });

  it('handles partial review counts, a single charge, and personal-only packets', () => {
    const partly = composeForYou({ ...context, merchant: { ...context.merchant!, unreviewedCount: 5 } }, 'software-subscriptions');
    expect(partly?.paragraph).toContain('; 5 are unreviewed.');
    expect(partly?.action?.label).toBe('Review these 5 charges');
    const single = composeForYou({ ...context, merchant: { ...context.merchant!, count: 1, totalCents: 4200, unreviewedCount: 1, displayName: 'Planet Fitness' } }, 'gym-membership');
    expect(single?.paragraph).toContain('You have 1 Planet Fitness charge in 2026 totaling $42.00; it is unreviewed.');
    expect(single?.paragraph).toContain('treats this charge as personal unless the exception described applies');
    expect(single?.action?.label).toBe('Review this charge');
    const reviewed = composeForYou({ ...context, merchant: { ...context.merchant!, unreviewedCount: 0 } }, 'software-subscriptions');
    expect(reviewed?.paragraph).toContain('all are reviewed');
    expect(reviewed?.action).toEqual({ screen: 'transactions', merchantKey: 'adobe systems', count: 12, label: 'See these 12 charges' });
  });

  it('uses saved methods for home and vehicle topics without a merchant', () => {
    const home = composeForYou({ ...context, merchant: null }, 'home-office');
    expect(home?.paragraph).toBe('Your saved home office method is the simplified method, so the answer above applies through that method.');
    expect(home?.action).toBeNull();
    const car = composeForYou({ ...context, merchant: null }, 'car-mileage-vs-actual');
    expect(car?.paragraph).toContain('No vehicle deduction method is saved yet');
    const filing = composeForYou({ ...context, merchant: null }, 'health-insurance');
    expect(filing?.paragraph).toContain('Your saved filing status is married filing jointly');
  });

  it('returns null when nothing personal is known or the topic is unsupported', () => {
    const empty: AssistantContext = { profile: assistantProfileFacts(null), merchant: null };
    expect(composeForYou(empty, 'meals')).toBeNull();
    expect(composeForYou(context, 'not-supported')).toBeNull();
    expect(composeForYou(null, 'meals')).toBeNull();
  });

  it('never makes a forbidden claim and never invents an amount', () => {
    for (const topic of ['software-subscriptions', 'gym-membership', 'home-office', 'car-mileage-vs-actual', 'health-insurance', 'owner-draws', 'state-taxes-licenses', 'when-to-see-a-cpa']) {
      const text = composeForYou(context, topic)?.paragraph ?? '';
      expect(text).not.toMatch(/maximi[sz]e|guarantee|every deduction|audit[- ](protection|defense)|savings/i);
      const amounts = text.match(/\$[\d,.]+/g) ?? [];
      expect(amounts).toEqual(amounts.length ? ['$659.88'] : []);
    }
  });

  it('gives the model facts for routing but no dollar totals', () => {
    const forModel = assistantContextForModel(context) ?? '';
    expect(forModel).toContain('Profession: graphic designer');
    expect(forModel).toContain('The user has 12 Adobe charges in 2026');
    expect(forModel).not.toContain('659');
    expect(forModel).not.toContain('$');
    const input = assistantRequestSchema.parse({ message: 'Can I deduct my Adobe subscription?', taxYear: 2026 });
    const system = String(buildGuidanceMessages(input, context)[0].content);
    expect(system).toContain('USER CONTEXT');
    expect(system).toContain('Home office method saved: simplified');
    expect(system).not.toContain('659');
    expect(String(buildGuidanceMessages(input, null)[0].content)).not.toContain('USER CONTEXT');
  });

  it('attaches the server-composed block to the response and keeps it out of model history', () => {
    const input = assistantRequestSchema.parse({ message: 'Can I deduct my Adobe subscription?', taxYear: 2026 });
    const assessment = validateAssessment({ topic: 'software-subscriptions', missingFactIds: [], photoCategories: [] }, input);
    const response = guidanceResponse(input, assessment, context);
    expect(response.forYou?.paragraph).toContain('$659.88');
    expect(response.forYou?.action?.merchantKey).toBe('adobe systems');
    expect(response.reply).not.toContain('$659.88');
    expect(JSON.stringify(response.conversationHistory)).not.toContain('659');
    expect(guidanceResponse(input, assessment).forYou).toBeNull();
  });
});
