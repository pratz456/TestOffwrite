import { describe, expect, it } from 'vitest';
import { buildTaxpayerContext, detectRecurrence, merchantKey, summarizeConfirmedMerchants, taxpayerContextForModel } from '@/lib/ai/taxpayer-context';
import { groundTransactionAnalysis } from '@/lib/ai/transaction-tax-policy';
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

const profile: UserContext = {
  user_id: 'owner', profession: ['Photographer'], filing_state: 'TX', business_entity: 'sole_proprietor',
  office_location: 'Home Office', home_office_sqft: 150, vehicle_business_use_percentage: 60, w2_income: 20000, business_income: 80000,
};

describe('confirmed merchant priors', () => {
  it('normalizes merchant text and reduces only confirmed rows into one-sided decisions', () => {
    expect(merchantKey('STARBUCKS #1234')).toBe('starbucks');
    expect(merchantKey('Adobe*Creative Cloud 8005551234')).toBe('adobe creative cloud');
    const priors = summarizeConfirmedMerchants([
      { merchant_name: 'Adobe*Creative Cloud', category: 'software_subscriptions', is_deductible: true, review_status: 'confirmed', date: '2026-06-01', business_purpose: 'Editing client photo deliveries' },
      { merchant_name: 'ADOBE CREATIVE CLOUD', category: 'software_subscriptions', is_deductible: true, review_status: 'confirmed', date: '2026-07-01' },
      { merchant_name: 'Adobe Creative Cloud', category: 'software_subscriptions', is_deductible: true, review_status: 'pending', date: '2026-08-01' },
      { merchant_name: 'Whole Foods', category: 'other', is_deductible: false, expense_type: 'personal', review_status: 'confirmed', date: '2026-07-03' },
      { merchant_name: 'Whole Foods', category: 'meals_50', is_deductible: true, review_status: 'confirmed', date: '2026-07-20' },
    ]);
    expect(priors).toHaveLength(2);
    const adobe = priors.find(prior => prior.merchantKey === 'adobe creative cloud')!;
    expect(adobe).toMatchObject({ decision: 'business', confirmations: 2, category: 'software_subscriptions', dates: ['2026-06-01', '2026-07-01'] });
    // The newest confirmation had no purpose text, so the last recorded wording is kept.
    expect(adobe.lastBusinessPurpose).toBe('Editing client photo deliveries');
    expect(priors.find(prior => prior.merchantKey === 'whole foods')).toMatchObject({ decision: 'unresolved', businessCount: 1, personalCount: 1 });
  });

  it('detects monthly recurrence from posting dates and stays quiet with sparse history', () => {
    expect(detectRecurrence(['2026-05-01', '2026-06-01', '2026-07-02'], '2026-08-01')).toEqual({ isRecurring: true, cadence: 'monthly', occurrences: 4 });
    expect(detectRecurrence(['2026-05-01', '2026-05-08', '2026-05-15'])).toMatchObject({ isRecurring: true, cadence: 'weekly' });
    expect(detectRecurrence(['2026-05-01', '2026-07-19', '2026-08-02'])).toMatchObject({ isRecurring: false, cadence: null });
    expect(detectRecurrence(['2026-05-01'])).toEqual({ isRecurring: false, cadence: null, occurrences: 1 });
  });

  it('keeps merchant priors inside the transaction tax year', () => {
    const records = [
      { merchant_name: 'Adobe', category: 'software_subscriptions', is_deductible: false, review_status: 'confirmed', date: '2025-12-15' },
      { merchant_name: 'Adobe', category: 'software_subscriptions', is_deductible: true, review_status: 'confirmed', date: '2026-01-15' },
    ];
    expect(summarizeConfirmedMerchants(records, 40, 2025)[0]).toMatchObject({ decision: 'personal', confirmations: 1 });
    expect(summarizeConfirmedMerchants(records, 40, 2026)[0]).toMatchObject({ decision: 'business', confirmations: 1 });
  });

  it('builds hints and open questions without asserting eligibility', () => {
    const context = buildTaxpayerContext({
      profile, homeOffice: { officeSqFt: 160, totalHomeSqFt: 1600 }, merchant: 'Adobe Creative Cloud', transactionDate: '2026-08-01',
      confirmed: summarizeConfirmedMerchants([
        { merchant_name: 'Adobe Creative Cloud', category: 'software_subscriptions', is_deductible: true, review_status: 'confirmed', date: '2026-06-01' },
        { merchant_name: 'Adobe Creative Cloud', category: 'software_subscriptions', is_deductible: true, review_status: 'confirmed', date: '2026-07-01' },
      ]),
    });
    expect(context.identity).toMatchObject({
      professions: ['Photographer'],
      entity: 'sole_proprietor',
      hasW2Income: true,
      hasBusinessIncome: true,
      professionalLicenseCount: 0,
    });
    expect(context.methods.homeOffice).toEqual({ method: null, officeSqFt: 160, totalHomeSqFt: 1600, exclusiveUseConfirmed: false });
    expect(context.methods.vehicle).toEqual({ method: null, businessUsePercent: 60 });
    expect(context.gaps).toEqual(['home_office_method', 'home_office_exclusive_use', 'vehicle_deduction_method', 'work_related_travel']);
    expect(context.priors.recurrence).toMatchObject({ isRecurring: true, cadence: 'monthly' });
    const forModel = taxpayerContextForModel(context);
    expect(JSON.stringify(forModel)).not.toMatch(/deductible["']?\s*:\s*true/);
    expect(forModel.prior_merchant_decisions?.note).toContain('do not establish deductibility');
  });
});

describe('prior-decision gate in the tax policy', () => {
  const transaction: TransactionInput = { tx_id: 'tx', merchant: 'Whole Foods', amount_usd: 84, date_iso: '2026-08-01', business_purpose: 'Snacks for a client shoot day at the studio' };
  const model: OutputType = { status: 'ok', transaction_kind: 'expense', category: 'supplies_small_tools', is_deductible: true, expense_type: 'business',
    deductible_percent: 100, evidence_ids: ['business-162'], customized_reason: 'Supplies for a client shoot.', key_analysis_factor: 'Supplies', confidence: 0.8 };
  const priorPersonal = buildTaxpayerContext({ profile, merchant: 'Whole Foods', confirmed: summarizeConfirmedMerchants([
    { merchant_name: 'Whole Foods', is_deductible: false, expense_type: 'personal', review_status: 'confirmed', date: '2026-05-01' },
    { merchant_name: 'Whole Foods', is_deductible: false, expense_type: 'personal', review_status: 'confirmed', date: '2026-06-01' },
  ]) });

  it('asks before reversing repeated personal decisions instead of approving a deduction', () => {
    const result = groundTransactionAnalysis(model, transaction, { ...profile, taxpayer_context: priorPersonal }, 'test-model');
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['prior_decision_conflict'], category: 'supplies_small_tools' });
    expect(result?.is_deductible).toBeUndefined();
  });

  it('never approves a deduction because of a prior business decision', () => {
    const priorBusiness = buildTaxpayerContext({ profile, merchant: 'Whole Foods', confirmed: summarizeConfirmedMerchants([
      { merchant_name: 'Whole Foods', is_deductible: true, review_status: 'confirmed', date: '2026-05-01' },
      { merchant_name: 'Whole Foods', is_deductible: true, review_status: 'confirmed', date: '2026-06-01' },
    ]) });
    const bare = { ...transaction, business_purpose: undefined };
    const result = groundTransactionAnalysis(model, bare, { ...profile, taxpayer_context: priorBusiness }, 'test-model');
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['business_purpose'] });
    const withPurpose = groundTransactionAnalysis(model, transaction, { ...profile, taxpayer_context: priorBusiness }, 'test-model');
    expect(withPurpose).toMatchObject({ status: 'needs_more_info', missing_fields: ['food_expense_treatment'] });
    expect(withPurpose?.is_deductible).toBeUndefined();
  });
});
