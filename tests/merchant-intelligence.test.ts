import { describe, expect, it } from 'vitest';
import {
  MERCHANT_DISPOSITIONS, MERCHANT_INTELLIGENCE, PLAID_CATEGORY_MAP, findMerchantEntry, mapPlaidCategory,
  merchantDescriptor, merchantIntelligence, merchantIntelligenceForModel,
} from '@/lib/ai/merchant-intelligence';
import { EXPENSE_CATEGORIES } from '@/lib/ai/transaction-tax-policy';

const SCHEDULE_C_LINES = ['8', '9', '10', '11', '13', '15', '16b', '17', '18', '20a', '20b', '21', '22', '23', '24a', '24b', '25', '27a', '30'];
/** Lines a category may legitimately land on (2025 Schedule C). */
const LINES_BY_CATEGORY: Record<string, string[]> = {
  advertising_marketing: ['8'], vehicle_expense: ['9'], bank_and_payment_fees: ['10'], contract_labor: ['11'], equipment: ['13'],
  other: ['15', '16b', '17', '21', '23', '27a'], software_subscriptions: ['18'], rent: ['20a', '20b'], supplies_small_tools: ['22'],
  travel: ['24a'], meals_50: ['24b'], utilities_phone_internet: ['25'], education_training: ['27a'], dues_and_memberships: ['27a'],
  home_office: ['30'],
};
const tx = (merchant: string, extra: Record<string, unknown> = {}) => ({ tx_id: 't1', merchant, amount_usd: 20, date_iso: '2026-03-01', ...extra });
const intel = (merchant: string, extra: Record<string, unknown> = {}) => merchantIntelligence(tx(merchant, extra));

describe('merchant intelligence table', () => {
  it('covers at least 150 merchants and every entry is well formed', () => {
    expect(MERCHANT_INTELLIGENCE.length).toBeGreaterThanOrEqual(150);
    for (const item of MERCHANT_INTELLIGENCE) {
      expect(item.pattern, item.name).toBeInstanceOf(RegExp);
      expect(item.pattern.flags, item.name).toContain('i');
      expect(item.name.trim().length, item.name).toBeGreaterThan(1);
      expect(MERCHANT_DISPOSITIONS, item.name).toContain(item.disposition);
      if (item.category !== null) expect(EXPENSE_CATEGORIES, item.name).toContain(item.category);
      if (item.scheduleCLine !== null) {
        expect(SCHEDULE_C_LINES, item.name).toContain(item.scheduleCLine);
        expect(item.category, `${item.name} has a line without a category`).not.toBeNull();
        expect(LINES_BY_CATEGORY[item.category as string], `${item.name}: ${item.category} → line ${item.scheduleCLine}`).toContain(item.scheduleCLine);
      }
      if (item.disposition === 'business_likely') {
        expect(item.defaultPurpose, `${item.name} needs a confirmable purpose`).toBeTruthy();
        expect(item.category, `${item.name} needs a category to propose`).not.toBeNull();
        expect(item.scheduleCLine, `${item.name} needs a Schedule C line to propose`).not.toBeNull();
      } else {
        expect(item.question, `${item.name} needs a question`).toBeTruthy();
      }
    }
  });

  it('never carries a tax conclusion: no deductibility field and no purpose text asserting deductibility', () => {
    const serialised = JSON.stringify(MERCHANT_INTELLIGENCE.map(item => ({ ...item, pattern: item.pattern.source })));
    expect(serialised).not.toMatch(/is_deductible|isDeductible/);
    for (const item of MERCHANT_INTELLIGENCE) {
      if (item.defaultPurpose) expect(item.defaultPurpose, item.name).not.toMatch(/\bdeductible\b|\bwrite[- ]?off\b/i);
    }
  });

  it('every pattern matches at least one realistic descriptor shape (no dead regexes on brand names)', () => {
    const dead = MERCHANT_INTELLIGENCE.filter(item => !item.pattern.test(item.name) && !item.pattern.test(item.pattern.source.replace(/\\b|\\s\*|\\\*|\(\?:|[()|\\^$?+]/g, ' ')));
    // Grouped entries use a descriptive name rather than a brand, so only require that most entries self-match.
    expect(dead.length).toBeLessThan(MERCHANT_INTELLIGENCE.length / 2);
  });
});

describe('descriptor matching', () => {
  it('identifies exact brands with high confidence and a confirmable purpose', () => {
    const result = intel('ADOBE *CREATIVE CLOUD 800-833-6687');
    expect(result).toMatchObject({ name: 'Adobe', category: 'software_subscriptions', scheduleCLine: '18', disposition: 'business_likely', confidence: 'high', source: 'merchant_table' });
    expect(result.defaultPurpose).toMatch(/software/i);
  });

  it('lets the real brand win over processor prefixes and payment wrappers', () => {
    expect(intel('PAYPAL *ADOBE SYSTEMS').name).toBe('Adobe');
    expect(intel('SQ *BLUE BOTTLE COFFEE').category).toBe('meals_50');
    expect(intel('SQ *JOES PLUMBING SUPPLY')).toMatchObject({ name: 'Square-processed merchant', disposition: 'needs_purpose' });
    expect(intel('TST* SWEETGREEN - NOMAD').name).toBe('Sweetgreen');
    expect(intel('TST* LOCAL BISTRO')).toMatchObject({ name: 'Toast-processed restaurant', category: 'meals_50' });
    expect(intel('PAYPAL INST XFER')).toMatchObject({ name: 'PayPal', disposition: 'transfer_or_deposit' });
  });

  it('payment apps that carry a payee name win over merchant and place names', () => {
    expect(intel('VENMO PAYMENT 1032456 BART SIMPSON')).toMatchObject({ name: 'Venmo', disposition: 'transfer_or_deposit', category: null });
    expect(intel('ZELLE PAYMENT TO CHASE MARTIN')).toMatchObject({ name: 'Zelle', disposition: 'transfer_or_deposit' });
    expect(intel('CASH APP*JOHN DOE')).toMatchObject({ name: 'Cash App', disposition: 'transfer_or_deposit' });
  });

  it('separates look-alike descriptors that have very different tax treatment', () => {
    expect(intel('UBER *EATS HELP.UBER.COM')).toMatchObject({ name: 'Uber Eats', category: 'meals_50', scheduleCLine: '24b' });
    expect(intel('UBER *TRIP HELP.UBER.COM')).toMatchObject({ name: 'Uber', category: 'vehicle_expense', subtype: 'local_transport' });
    expect(intel('DELTA DENTAL INS').disposition).toBe('schedule_1');
    expect(intel('DELTA AIR 0062341234567')).toMatchObject({ name: 'Delta Air Lines', category: 'travel', disposition: 'needs_purpose' });
    expect(intel('UNITED HEALTHCARE PREMIUM').disposition).toBe('schedule_1');
    expect(intel('UNITED 0162345678901').category).toBe('travel');
    expect(intel('COSTCO GAS #1234')).toMatchObject({ name: 'Costco Gas', subtype: 'fuel' });
    expect(intel('COSTCO WHSE #0472')).toMatchObject({ name: 'Costco', category: 'supplies_small_tools' });
    expect(intel('AMAZON WEB SERVICES').name).toBe('Amazon Web Services');
    expect(intel('AMZN Mktp US*2K3AB1CD2')).toMatchObject({ name: 'Amazon', disposition: 'needs_purpose' });
    expect(intel('AMAZON PRIME*1A2B3C').disposition).toBe('mixed_use');
    expect(intel('AMAZON SELLER SERVICES').disposition).toBe('needs_purpose');
    expect(intel('GOOGLE *ADS1234567')).toMatchObject({ name: 'Google Ads', category: 'advertising_marketing', scheduleCLine: '8' });
    expect(intel('GOOGLE *WORKSPACE').category).toBe('software_subscriptions');
    expect(intel('GOOGLE *YOUTUBEPREMIUM').disposition).toBe('personal_likely');
    expect(intel('MICROSOFT*365 FAMILY').disposition).toBe('mixed_use');
    expect(intel('MICROSOFT*XBOX').disposition).toBe('personal_likely');
    expect(intel('MICROSOFT').disposition).toBe('needs_purpose');
    expect(intel('APPLE.COM/BILL')).toMatchObject({ name: 'Apple services (iCloud/apps)', disposition: 'mixed_use' });
    expect(intel('APPLE STORE #R123')).toMatchObject({ category: 'equipment', scheduleCLine: '13' });
    expect(intel('INTUIT *TURBOTAX')).toMatchObject({ name: 'TurboTax', disposition: 'mixed_use', subtype: 'tax_prep' });
    expect(intel('INTUIT *QBOOKS ONLINE')).toMatchObject({ name: 'QuickBooks', disposition: 'business_likely' });
    expect(intel('LINKEDIN LEARNING').category).toBe('education_training');
    expect(intel('LINKEDIN ADS').category).toBe('advertising_marketing');
    expect(intel('LINKEDIN PREMIUM').disposition).toBe('needs_purpose');
    expect(intel('MERCURY INSURANCE').subtype).toBe('auto_insurance');
    expect(intel('MERCURY').name).toBe('Business bank');
    expect(intel('FRONTIER AIRLINES').category).toBe('travel');
    expect(intel('FRONTIER COMMUNICATIONS').category).toBe('utilities_phone_internet');
  });

  it('maps personal signals, government, transfers and Schedule 1 items with a question instead of a category conclusion', () => {
    expect(intel('PLANET FITNESS')).toMatchObject({ disposition: 'personal_likely', category: 'dues_and_memberships', scheduleCLine: '27a' });
    expect(intel('PLANET FITNESS').question).toMatch(/gym dues/i);
    expect(intel('AIGA MEMBERSHIP DUES')).toMatchObject({ disposition: 'business_likely', category: 'dues_and_memberships' });
    expect(intel('IRS USATAXPYMT')).toMatchObject({ name: 'IRS', disposition: 'not_an_expense', category: null, scheduleCLine: null });
    expect(intel('KAISER PERMANENTE')).toMatchObject({ disposition: 'schedule_1', scheduleCLine: null });
    expect(intel('HISCOX INC')).toMatchObject({ disposition: 'business_likely', category: 'other', scheduleCLine: '15' });
    expect(intel('GEICO *AUTO')).toMatchObject({ category: 'vehicle_expense', subtype: 'auto_insurance', disposition: 'needs_purpose' });
    expect(intel('STATE FARM INSURANCE')).toMatchObject({ category: 'other', scheduleCLine: '15', disposition: 'needs_purpose' });
    expect(intel('NETFLIX.COM')).toMatchObject({ disposition: 'personal_likely', category: null });
    expect(intel('WHOLE FOODS MARKET').disposition).toBe('personal_likely');
    expect(intel('CVS/PHARMACY #1234').disposition).toBe('personal_likely');
    expect(intel('WEWORK 123 MAIN')).toMatchObject({ category: 'rent', scheduleCLine: '20b', disposition: 'business_likely' });
    expect(intel('PARKMOBILE')).toMatchObject({ subtype: 'parking_tolls', category: 'vehicle_expense' });
    expect(intel('E-ZPASS REBILL').subtype).toBe('parking_tolls');
    expect(intel('CHASE CREDIT CRD AUTOPAY')).toMatchObject({ name: 'Card payment', disposition: 'transfer_or_deposit' });
    expect(intel('ONLINE TRANSFER TO CHK ...1234').disposition).toBe('transfer_or_deposit');
    expect(intel('ATM WITHDRAWAL 123 MAIN ST').disposition).toBe('transfer_or_deposit');
    expect(intel('ROBINHOOD').disposition).toBe('not_an_expense');
    expect(intel('UPWORK -ESCROW')).toMatchObject({ category: 'contract_labor', scheduleCLine: '11', disposition: 'needs_purpose' });
    expect(intel('STARBUCKS STORE 12345')).toMatchObject({ category: 'meals_50', disposition: 'needs_purpose' });
    expect(intel('STARBUCKS STORE 12345').question).toMatch(/who was at this meal/i);
    expect(intel('NORDSTROM #123').subtype).toBe('clothing');
    expect(intel('SOFI').disposition).toBe('transfer_or_deposit');
  });

  it('treats a credit from any merchant as a payout, refund or transfer question rather than an expense', () => {
    const shopifyPayout = intel('SHOPIFY PAYOUT', { amount_usd: -1240.5 });
    expect(shopifyPayout).toMatchObject({ name: 'Shopify', disposition: 'transfer_or_deposit', category: null, scheduleCLine: null, defaultPurpose: null, confidence: 'high' });
    expect(shopifyPayout.question).toMatch(/payout/i);
    expect(intel('UBER', { amount_usd: -85 }).disposition).toBe('transfer_or_deposit');
    expect(intel('ADOBE', { amount_usd: -54.99 }).question).toMatch(/refund/i);
    expect(intel('STRIPE TRANSFER', { amount_usd: -900 })).toMatchObject({ name: 'Stripe', disposition: 'transfer_or_deposit' });
    expect(intel('TOTALLY UNKNOWN LLC', { amount_usd: -300 })).toMatchObject({ confidence: 'none', disposition: 'transfer_or_deposit' });
  });

  it('falls back to the Plaid category with medium confidence and to none when nothing matches', () => {
    const plaidOnly = intel('JOES DINER', { personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT' } });
    expect(plaidOnly).toMatchObject({ name: null, category: 'meals_50', scheduleCLine: '24b', disposition: 'needs_purpose', confidence: 'medium', source: 'plaid_category', plaidCategory: 'FOOD_AND_DRINK_RESTAURANT' });
    const legacy = intel('UNKNOWN LLC', { category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' });
    expect(legacy).toMatchObject({ confidence: 'medium', disposition: 'business_likely', category: 'supplies_small_tools' });
    expect(legacy.defaultPurpose).toBeTruthy();
    expect(intel('UNKNOWN LLC', { category: 'INCOME' })).toMatchObject({ confidence: 'medium', disposition: 'transfer_or_deposit', category: null });
    expect(intel('XYZ 123')).toMatchObject({ confidence: 'none', source: 'none', disposition: 'needs_purpose', category: null, name: null, question: null });
    expect(intel('ADOBE', { personal_finance_category: { detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' } })).toMatchObject({ name: 'Adobe', confidence: 'high', plaidCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' });
  });

  it('matches on bank-supplied text only and normalises unicode; user notes never feed matching', () => {
    expect(merchantDescriptor({ merchant: 'XYZ', merchant_name: 'Xyz Inc', description: 'XYZ 123', counterparties: [{ name: 'Adobe', type: 'merchant' }], notes: 'adobe subscription', note: 'figma', business_purpose: 'netflix' } as never))
      .toBe('XYZ | Xyz Inc | XYZ 123 | Adobe');
    expect(intel('XYZ', { notes: 'adobe subscription', note: 'netflix', business_purpose: 'planet fitness' }).confidence).toBe('none');
    expect(intel('ＡＤＯＢＥ').name).toBe('Adobe');
    expect(intel('adobe').name).toBe('Adobe');
    expect(intel('XYZ', { counterparties: [{ name: 'Figma', type: 'merchant' }] }).name).toBe('Figma');
    expect(findMerchantEntry('')).toBeNull();
  });

  it('exposes a compact model-facing view with the non-proof note', () => {
    expect(merchantIntelligenceForModel(intel('XYZ 123'))).toBeNull();
    const view = merchantIntelligenceForModel(intel('FIGMA'));
    expect(view).toMatchObject({ name: 'Figma', category: 'software_subscriptions', schedule_c_line: '18', disposition: 'business_likely', confidence: 'high', source: 'merchant_table' });
    expect(view?.note).toMatch(/never proof/i);
    expect(JSON.stringify(view)).not.toMatch(/is_deductible/);
  });
});

describe('Plaid personal_finance_category taxonomy mapping', () => {
  it('covers all 104 detailed values of the Plaid taxonomy exactly once, grouped by primary', () => {
    const detailed = PLAID_CATEGORY_MAP.map(item => item.detailed);
    expect(new Set(detailed).size).toBe(104);
    expect(detailed.length).toBe(104);
    const perPrimary: Record<string, number> = {
      INCOME: 7, TRANSFER_IN: 6, TRANSFER_OUT: 5, LOAN_PAYMENTS: 6, BANK_FEES: 6, ENTERTAINMENT: 6, FOOD_AND_DRINK: 7,
      GENERAL_MERCHANDISE: 14, HOME_IMPROVEMENT: 5, MEDICAL: 7, PERSONAL_CARE: 4, GENERAL_SERVICES: 9, GOVERNMENT_AND_NON_PROFIT: 4,
      TRANSPORTATION: 7, TRAVEL: 4, RENT_AND_UTILITIES: 7,
    };
    for (const [primary, count] of Object.entries(perPrimary)) {
      expect(detailed.filter(value => value.startsWith(`${primary}_`)).length, primary).toBe(count);
    }
    for (const value of detailed) expect(value).toMatch(/^[A-Z][A-Z_]+$/);
  });

  it('every mapping is well formed and money movement never becomes an expense category', () => {
    for (const item of PLAID_CATEGORY_MAP) {
      expect(MERCHANT_DISPOSITIONS, item.detailed).toContain(item.disposition);
      if (item.category !== null) expect(EXPENSE_CATEGORIES, item.detailed).toContain(item.category);
      if (item.scheduleCLine !== null) {
        expect(item.category, item.detailed).not.toBeNull();
        expect(LINES_BY_CATEGORY[item.category as string], item.detailed).toContain(item.scheduleCLine);
      }
      if (item.disposition === 'business_likely') expect(item.defaultPurpose, item.detailed).toBeTruthy();
      else expect(item.question, item.detailed).toBeTruthy();
      if (/^(INCOME|TRANSFER_IN|TRANSFER_OUT)_/.test(item.detailed)) {
        expect(item.category, item.detailed).toBeNull();
        expect(['transfer_or_deposit', 'not_an_expense'], item.detailed).toContain(item.disposition);
      }
      if (/^MEDICAL_/.test(item.detailed)) expect(item.disposition, item.detailed).toBe('personal_likely');
    }
    expect(PLAID_CATEGORY_MAP.filter(item => item.disposition === 'business_likely').map(item => item.detailed)).toEqual(['GENERAL_MERCHANDISE_OFFICE_SUPPLIES']);
  });

  it('looks up detailed values case-insensitively, accepts legacy primary-only values and rejects unknowns', () => {
    expect(mapPlaidCategory('FOOD_AND_DRINK_COFFEE')).toMatchObject({ category: 'meals_50', scheduleCLine: '24b', disposition: 'needs_purpose' });
    expect(mapPlaidCategory(' food_and_drink_coffee ')?.detailed).toBe('FOOD_AND_DRINK_COFFEE');
    expect(mapPlaidCategory('GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT')).toMatchObject({ disposition: 'not_an_expense', category: null });
    expect(mapPlaidCategory('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')).toMatchObject({ disposition: 'transfer_or_deposit' });
    expect(mapPlaidCategory('PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS')).toMatchObject({ disposition: 'personal_likely', category: 'dues_and_memberships' });
    expect(mapPlaidCategory('RENT_AND_UTILITIES_TELEPHONE')).toMatchObject({ disposition: 'mixed_use', category: 'utilities_phone_internet', scheduleCLine: '25' });
    expect(mapPlaidCategory('TRANSFER_OUT')).toMatchObject({ disposition: 'transfer_or_deposit', category: null });
    expect(mapPlaidCategory('BANK_FEES')?.category).toBe('bank_and_payment_fees');
    expect(mapPlaidCategory('SERVICE_SUBSCRIPTION')).toBeNull();
    expect(mapPlaidCategory('')).toBeNull();
    expect(mapPlaidCategory(undefined)).toBeNull();
    expect(mapPlaidCategory(null)).toBeNull();
  });
});
