import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

import { analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';
import { findMerchantEntry, merchantIntelligence } from '@/lib/ai/merchant-intelligence';
import { professionContextForModel } from '@/lib/ai/profession-priors';
import { groundTransactionAnalysis } from '@/lib/ai/transaction-tax-policy';
import { HIRED_FARE_PURPOSE, SEPARATE_VEHICLE_COST_SHARE } from '@/lib/ai/vehicle-separate-costs';
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

/**
 * Expected results captured from codex/cursor-latest-preview-20260924 at 52f5788d.
 * With the vehicle copy switch off, these cases must keep that output.
 */
const BASE_AUTO_LOAN_QUESTION = 'Car loan principal is not an expense. Under actual expenses the business share of the interest and depreciation may count; under standard mileage neither does. Which method do you use, and what share of miles are business?';
const COPY_AUTO_LOAN_QUESTION = 'Car loan principal is not an expense. The business share of the interest can count with either method. Depreciation follows the method you chose. Which method do you use, and what share of the interest was for business miles?';
const RIDE_QUESTION = 'Where did this ride go? Rides between business locations or to a client are deductible; commuting from home to a regular workplace and personal rides are not.';
const CITATION_QUESTION = 'What did you buy or pay for, and how was it used in your business?';
const CITATION_REASON = 'The category is a suggestion; the tax basis the analysis relied on did not match this kind of expense, so confirm the purpose before including a deduction.';
const NOT_AN_EXPENSE_REASON = 'Payments of this kind (taxes, loan principal, investments, fines or donations) are not Schedule C expenses even when paid from the business account. Confirm what this payment was before it is treated as an expense.';
const VEHICLE_REASON = 'The category is suggested, but this expense has additional eligibility or calculation rules. Review the supporting facts before including a deduction.';
const BASE_RIDESHARE_PROMPT = 'Rideshare / delivery driver. Typical: vehicle_expense: Standard mileage covers fuel, repairs, insurance, depreciation and car washes; only tolls and parking are added. App-on and en-route miles need a contemporaneous log; personal and commuting miles are out; supplies_small_tools: Phone mounts, chargers, insulated bags and passenger amenities are supplies (line 22); utilities_phone_internet: Phone and internet count only at the documented business-use %; the first residential line is personal; bank_and_payment_fees: Report platform payouts at the gross 1099-K amount; deduct platform and processing fees separately (line 10). Traps: Fuel, repairs or insurance claimed on top of the standard mileage rate. Personal or commuting miles counted as app-on miles without a log. Priors never establish that a purchase was for business.';

const tx: TransactionInput = {
  tx_id: 'synthetic', merchant: 'Synthetic shop', amount_usd: 45, date_iso: '2026-09-16',
  business_purpose: 'Printer supplies used exclusively for the client design project.',
};
const ctx: UserContext = { user_id: 'synthetic', profession: ['Designer'], filing_state: 'CA', business_entity: 'sole_proprietor' };

function output(patch: Partial<OutputType> = {}): OutputType {
  return {
    status: 'ok', transaction_kind: 'expense', category: 'supplies_small_tools', is_deductible: true, expense_type: 'business',
    evidence_ids: ['business-162'], confidence: 0.9, audit_risk: 'low',
    customized_reason: 'Printer supplies used for the client project. Keep the itemized invoice.',
    key_analysis_factor: 'Recorded supplies for the client design project.', ...patch,
  };
}

function analyze(patch: Partial<OutputType> = {}, transaction: Partial<TransactionInput> = {}, context: UserContext = ctx) {
  return groundTransactionAnalysis(output(patch), { ...tx, ...transaction }, context, 'synthetic-model');
}

function saved(result: OutputType, record: Record<string, unknown>) {
  return analysisSuggestionUpdate(result, 1, { amount: 90, date: '2026-09-16', ...record });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('vehicle copy switch off matches the base review', () => {
  it('keeps the base auto loan sentence in the merchant table and shows it only while the switch is off', () => {
    expect(findMerchantEntry('Toyota Financial')?.question).toBe(BASE_AUTO_LOAN_QUESTION);
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const off = merchantIntelligence({ merchant: 'Toyota Financial', amount_usd: 180, business_purpose: 'Monthly payment on the auto loan from the business account.' });
    expect(off.question).toBe(BASE_AUTO_LOAN_QUESTION);
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const on = merchantIntelligence({ merchant: 'Toyota Financial', amount_usd: 180, business_purpose: 'Monthly payment on the auto loan from the business account.' });
    expect(on.question).toBe(COPY_AUTO_LOAN_QUESTION);
  });

  it('asks the base car loan question with the switch off, and the business-use share only with it on', () => {
    const input = { category: 'vehicle_expense' as const, evidence_ids: ['travel-463'], schedule_c_line: '9' };
    const charge = { merchant: 'Toyota Financial', amount_usd: 180, business_purpose: 'Interest on the car loan for business miles this year.' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const off = analyze(input, charge);
    expect(off).toMatchObject({
      status: 'needs_more_info', category: 'vehicle_expense', missing_fields: ['transaction_kind'], questions: [BASE_AUTO_LOAN_QUESTION],
    });
    expect(off?.is_deductible).toBeUndefined();
    expect(off?.deductible_percent).toBeUndefined();
    expect(off?.schedule_c_line).toBeUndefined();
    expect(off?.reason).toBe(NOT_AN_EXPENSE_REASON);
    const offSaved = saved(off!, { amount: 180, merchant_name: 'Toyota Financial', business_purpose: charge.business_purpose });
    expect(offSaved.deductionStatus).toBe('Needs more information');
    expect(offSaved.ai_questions).toEqual([BASE_AUTO_LOAN_QUESTION]);
    expect(offSaved.ai_schedule_c_line).toBeNull();
    expect(offSaved.ai_deductible_percent).toBeNull();

    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const asked = analyze(input, charge);
    expect(asked).toMatchObject({ status: 'needs_more_info', category: 'vehicle_expense', missing_fields: ['business_use_percentage'], questions: [SEPARATE_VEHICLE_COST_SHARE.question] });
    expect(asked?.questions?.[0]).not.toBe(BASE_AUTO_LOAN_QUESTION);
    expect(asked?.is_deductible).toBeUndefined();
    const shared = analyze(input, charge, { ...ctx, vehicle_business_use_percentage: 40 });
    expect(shared).toMatchObject({ status: 'ok', is_deductible: true, category: 'vehicle_expense', deductible_percent: 40, schedule_c_line: '9' });
    const sharedSaved = saved(shared!, { amount: 180, merchant_name: 'Toyota Financial', business_purpose: charge.business_purpose, business_use_percentage: 40 });
    expect(sharedSaved.deductionStatus).toBe('Likely Deductible');
    expect(sharedSaved.ai_suggestion).toMatchObject({ status: 'ok', deductiblePercent: 40, category: 'vehicle_expense' });
  });

  it('returns needs more information for vehicle property tax with the switch off, and line 23 only at the recorded share with it on', () => {
    const input = { category: 'vehicle_expense' as const, evidence_ids: ['taxes-licenses-sch-c'], schedule_c_line: '9' };
    const charge = { merchant: 'County Treasurer', amount_usd: 90, business_purpose: 'Personal property tax on the car for the business share.' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const off = analyze(input, charge);
    expect(off).toMatchObject({
      status: 'needs_more_info', category: 'vehicle_expense', schedule_c_line: '9', missing_fields: ['business_purpose'],
      questions: [CITATION_QUESTION],
    });
    expect(off?.is_deductible).toBeUndefined();
    expect(off?.deductible_percent).toBeUndefined();
    expect(off?.reason).toBe(CITATION_REASON);
    expect(off?.category).not.toBe('taxes_licenses');
    const offSaved = saved(off!, { merchant_name: 'County Treasurer', business_purpose: charge.business_purpose });
    expect(offSaved.deductionStatus).toBe('Needs more information');
    expect(offSaved.deductionStatus).not.toBe('Likely Deductible');
    expect(offSaved.ai_category).toBe('vehicle_expense');
    expect(offSaved.ai_schedule_c_line).toBe('9');
    expect(offSaved.ai_deductible_percent).toBeNull();
    expect(offSaved.ai_questions).toEqual([CITATION_QUESTION]);

    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const asked = analyze(input, charge);
    expect(asked).toMatchObject({
      status: 'needs_more_info', category: 'taxes_licenses', missing_fields: ['business_use_percentage'], questions: [SEPARATE_VEHICLE_COST_SHARE.question],
    });
    expect(asked?.questions?.join(' ') ?? '').not.toContain('home office');
    const askedSaved = saved(asked!, { merchant_name: 'County Treasurer', business_purpose: charge.business_purpose });
    expect(askedSaved.deductionStatus).toBe('Needs more information');
    expect(askedSaved.deductionStatus).not.toBe('Likely Deductible');
    const shared = analyze(input, charge, { ...ctx, vehicle_business_use_percentage: 40 });
    expect(shared).toMatchObject({ status: 'ok', is_deductible: true, category: 'taxes_licenses', deductible_percent: 40, schedule_c_line: '23' });
    const sharedSaved = saved(shared!, { merchant_name: 'County Treasurer', business_purpose: charge.business_purpose, business_use_percentage: 40 });
    expect(sharedSaved.deductionStatus).toBe('Likely Deductible');
    expect(sharedSaved.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 40, category: 'taxes_licenses', scheduleCLine: '23' });
  });

  it('keeps the rideshare question and vehicle category with the switch off, and files a business fare as travel with it on', () => {
    const input = { category: 'vehicle_expense' as const, evidence_ids: ['travel-463'] };
    const charge = { merchant: 'Uber', amount_usd: 28, business_purpose: 'Ride to the client meeting downtown.' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const off = analyze(input, charge);
    expect(off).toMatchObject({
      status: 'needs_more_info', category: 'vehicle_expense', schedule_c_line: '9', missing_fields: ['vehicle_method'], questions: [RIDE_QUESTION],
    });
    expect(off?.is_deductible).toBeUndefined();
    expect(off?.deductible_percent).toBeUndefined();
    expect(off?.reason).toBe(VEHICLE_REASON);
    const offSaved = saved(off!, { amount: 28, merchant_name: 'Uber', business_purpose: charge.business_purpose });
    expect(offSaved.deductionStatus).toBe('Needs more information');
    expect(offSaved.ai_questions).toEqual([RIDE_QUESTION]);
    expect(offSaved.ai_category).toBe('vehicle_expense');
    expect(offSaved.ai_schedule_c_line).toBe('9');

    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const on = analyze(input, charge, { ...ctx, vehicle_deduction_method: 'standard_mileage', vehicle_business_use_percentage: 40 });
    expect(on).toMatchObject({ status: 'ok', is_deductible: true, category: 'travel', deductible_percent: 100, schedule_c_line: '24a' });
    const onSaved = saved(on!, { amount: 28, merchant_name: 'Uber', business_purpose: charge.business_purpose });
    expect(onSaved.deductionStatus).toBe('Likely Deductible');
    expect(onSaved.ai_suggestion).toMatchObject({ status: 'ok', category: 'travel', deductiblePercent: 100, scheduleCLine: '24a' });
    const unstated = analyze(input, { merchant: 'Lyft', amount_usd: 18, business_purpose: 'Ride across town tonight.' });
    expect(unstated).toMatchObject({ status: 'needs_more_info', category: 'travel', missing_fields: ['business_purpose'], questions: [HIRED_FARE_PURPOSE.question] });
  });

  it('leaves Uber Eats on the vehicle review with the switch off, and moves it to meals with it on', () => {
    const input = { category: 'vehicle_expense' as const, evidence_ids: ['meals-274'] };
    const charge = { merchant: 'Uber Eats', amount_usd: 24, business_purpose: 'Dinner delivered while finishing the client proposal tonight.' };
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const off = analyze(input, charge);
    expect(off).toMatchObject({
      status: 'needs_more_info', category: 'vehicle_expense', schedule_c_line: '9', missing_fields: ['business_purpose'], questions: [CITATION_QUESTION],
    });
    expect(off?.category).not.toBe('meals_50');
    expect(off?.reason).toBe(CITATION_REASON);
    expect(off?.is_deductible).toBeUndefined();
    const offSaved = saved(off!, { amount: 24, merchant_name: 'UBER EATS', business_purpose: charge.business_purpose });
    expect(offSaved.deductionStatus).toBe('Needs more information');
    expect(offSaved.ai_category).toBe('vehicle_expense');
    expect(offSaved.ai_category).not.toBe('meals_50');

    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const on = analyze(input, charge);
    expect(on?.category).toBe('meals_50');
    expect(on?.schedule_c_line).toBe('24b');
    expect(on?.missing_fields ?? []).not.toContain('vehicle_method');
    const onSaved = saved(on!, { amount: 24, merchant_name: 'UBER EATS', business_purpose: charge.business_purpose });
    expect(onSaved.ai_category).toBe('meals_50');
    expect(onSaved.ai_schedule_c_line).toBe('24b');
  });

  it('keeps the base rideshare mileage sentence in the profession prompt while the switch is off', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    expect(professionContextForModel({ profession: ['Uber driver'] })).toBe(BASE_RIDESHARE_PROMPT);
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const on = professionContextForModel({ profession: ['Uber driver'] });
    expect(on).toContain('Parking, tolls, and the business share of car loan interest and personal property tax on the car are added on their own.');
    expect(on).not.toContain('only tolls and parking are added');
  });
});
