import { describe, expect, it } from 'vitest';
import { mapPlaidCategory, merchantIntelligence } from '@/lib/ai/merchant-intelligence';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { calculateOBBBADeductions, type OBBBADeductionAnswers, type OBBBADeductionInput } from '@/lib/tax-rules/obbba-deductions';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedOBBBADeductionFacts, SYNTHETIC_VIN } from './fixtures/tier1-facts';

const EXPECTED_USE_NOTE = 'draft, awaiting copy approval. This interest qualifies for Schedule 1-A only if the buyer expected more than 50% personal use on the loan date. WriteOff puts the business share on Schedule C. The same dollar is never counted in both places.';
const SHARE_NOTE = 'draft, awaiting copy approval. Enter the vehicle business use percentage so this car loan interest can be placed. WriteOff puts the business share on Schedule C line 16b. The same dollar is never counted in both places.';

const vehicle = (amount: string, extra: Partial<OBBBADeductionAnswers> = {}): Partial<OBBBADeductionAnswers> => ({
  hasVehicleLoanInterest: 'yes', vehicleLoanInterestAmount: amount, vehicleLoanAfter2024: 'yes', vehicleNewUSAssembled: 'yes',
  vehiclePersonalUse: 'yes', vehicleExpectedPersonalUseOver50AtPurchase: 'yes', vehicleLoanQualified: 'yes', vehicleVIN: SYNTHETIC_VIN, ...extra,
});

const place = (facts: Partial<OBBBADeductionAnswers>, overrides: Partial<OBBBADeductionInput> = {}) => calculateOBBBADeductions({
  taxYear: 2026, filingStatus: 'single', agi: 100000, scheduleCNetProfit: 60000, usingStandardDeduction: true,
  organizer: { obbbaDeductionFacts: reviewedOBBBADeductionFacts(2026, facts) },
  ...overrides,
});

describe('car loan interest is deducted in one place', () => {
  it.each([
    ['no', 'no'],
    ['missing', undefined],
  ] as const)('expectation %s puts $0 on Schedule 1-A, files that amount as needs more information, and still puts the business share on line 16b', (_label, expectation) => {
    const facts = vehicle('600', expectation === undefined
      ? { vehicleExpectedPersonalUseOver50AtPurchase: undefined }
      : { vehicleExpectedPersonalUseOver50AtPurchase: expectation });
    let thrown = false;
    let result: ReturnType<typeof calculateOBBBADeductions> | undefined;
    try {
      result = place(facts, { vehicleBusinessUsePercentage: 60, businessVehicleBusinessUsePercentage: 60 });
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    expect(result).toMatchObject({
      scheduleCLine16b: 360,
      lineItems: [{ line: '16b', amount: 360 }],
      vehicleLoanInterest: { deduction: 0, amountReported: 240 },
      needsMoreInformation: [{ amount: 240, note: EXPECTED_USE_NOTE }],
      scheduleOneATotal: 0,
    });
    expect(result?.warnings).toContain(EXPECTED_USE_NOTE);
  });

  it('puts the personal share on Schedule 1-A when the loan-date expectation is yes', () => {
    const result = place(vehicle('600'), { vehicleBusinessUsePercentage: 40 });
    expect(result).toMatchObject({
      scheduleCLine16b: 240,
      lineItems: [{ line: '16b', amount: 240 }],
      needsMoreInformation: [],
      vehicleLoanInterest: { deduction: 360, amountReported: 360, limitedAmount: 360, phaseoutReduction: 0 },
    });
    expect(result.warnings.join(' ')).toContain('draft, awaiting copy approval');
    expect(result.warnings.join(' ')).not.toMatch(/can(?:not|'t) (?:also )?go on Schedule 1-A/i);
  });

  it('puts a fully business vehicle on line 16b and leaves Schedule 1-A at $0', () => {
    const result = place(vehicle('600'), { vehicleBusinessUsePercentage: 100 });
    expect(result).toMatchObject({
      scheduleCLine16b: 600,
      lineItems: [{ line: '16b', amount: 600 }],
      needsMoreInformation: [],
      vehicleLoanInterest: { deduction: 0, amountReported: 0 },
    });
  });

  it('puts a fully personal vehicle on Schedule 1-A when the expectation is yes', () => {
    const result = place(vehicle('600'), { vehicleBusinessUsePercentage: 0 });
    expect(result).toMatchObject({
      scheduleCLine16b: 0,
      lineItems: [],
      needsMoreInformation: [],
      vehicleLoanInterest: { deduction: 600, amountReported: 600 },
    });
  });

  it('holds the full interest for a missing business-use percentage and does not throw', () => {
    let thrown = false;
    let result: ReturnType<typeof calculateOBBBADeductions> | undefined;
    try {
      result = place(vehicle('600'), {
        vehicleBusinessUsePercentage: undefined,
        businessVehicleBusinessUsePercentage: undefined,
        // A charge or account percentage is not a profile field and cannot place the interest.
        ...({ businessUsePercent: 80, business_use_percentage: 80 } as Record<string, unknown>),
      });
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    expect(result).toMatchObject({
      scheduleCLine16b: 0,
      lineItems: [],
      vehicleLoanInterest: { deduction: 0, amountReported: 600 },
      needsMoreInformation: [{ amount: 600, note: SHARE_NOTE }],
    });
    expect(result?.needsMoreInformation.some(item => item.note === EXPECTED_USE_NOTE)).toBe(false);
  });

  it('holds the full interest when the two profile percentages disagree or one is invalid', () => {
    const disagree = place(vehicle('600'), { vehicleBusinessUsePercentage: 60, businessVehicleBusinessUsePercentage: 40 });
    const invalid = place(vehicle('600'), { vehicleBusinessUsePercentage: 40, businessVehicleBusinessUsePercentage: '40' });
    for (const result of [disagree, invalid]) {
      expect(result).toMatchObject({
        scheduleCLine16b: 0,
        lineItems: [],
        vehicleLoanInterest: { deduction: 0 },
        needsMoreInformation: [{ amount: 600, note: SHARE_NOTE }],
      });
    }
  });

  it('keeps a used vehicle off Schedule 1-A and still places the business share on line 16b', () => {
    const result = place(vehicle('600', { vehicleNewUSAssembled: 'no' }), { vehicleBusinessUsePercentage: 60 });
    expect(result.scheduleCLine16b).toBe(360);
    expect(result.vehicleLoanInterest).toMatchObject({ deduction: 0, amountReported: 240, reason: expect.stringContaining('new vehicles') });
    expect(result.needsMoreInformation).toEqual([]);
    expect(result.lineItems).toEqual([{ line: '16b', amount: 360 }]);
  });

  it('applies the cap and phaseout to the personal share only', () => {
    const capped = place(vehicle('15000'), { vehicleBusinessUsePercentage: 60, agi: 100000 });
    expect(capped.scheduleCLine16b).toBe(9000);
    expect(capped.vehicleLoanInterest).toMatchObject({ amountReported: 6000, limitedAmount: 6000, phaseoutReduction: 0, deduction: 6000 });
    const phased = place(vehicle('15000'), { vehicleBusinessUsePercentage: 60, agi: 101001 });
    expect(phased.scheduleCLine16b).toBe(9000);
    expect(phased.vehicleLoanInterest).toMatchObject({ amountReported: 6000, limitedAmount: 6000, phaseoutReduction: 400, deduction: 5600 });
  });

  it('rounds each share once, so $1.05 at 50% is $0.53 and $0.53', () => {
    const result = place(vehicle('1.05'), { vehicleBusinessUsePercentage: 50 });
    expect(result.scheduleCLine16b).toBe(0.53);
    expect(result.vehicleLoanInterest.amountReported).toBe(0.53);
    expect(result.vehicleLoanInterest.deduction).toBe(0.53);
    expect(result.scheduleCLine16b + result.vehicleLoanInterest.amountReported).toBe(1.06);
  });
});

describe('auto lender hints do not send interest to Schedule C line 9', () => {
  const tx = (merchant: string) => ({ tx_id: 't1', merchant, amount_usd: 400, date_iso: '2026-03-01' });

  it.each(['TOYOTA FINANCIAL', 'ALLY AUTO', 'ALLY FINANCIAL'])('%s has no line 9 hint', merchant => {
    const result = merchantIntelligence(tx(merchant));
    expect(result.scheduleCLine).toBeNull();
    expect(result.category).not.toBe('vehicle_expense');
    expect(result.question ?? '').not.toMatch(/line 9/i);
    expect(result.question ?? '').not.toMatch(/standard mileage neither/i);
    expect(result.question).toContain('either method');
    expect(result.question).toContain('WriteOff puts that business share on Schedule C');
    expect(result.question).toContain('The same dollar is never counted in both places');
    expect(result.question).toContain('draft, awaiting copy approval');
    expect(result.question ?? '').not.toMatch(/can(?:not|'t).{0,40}Schedule 1-A/i);
  });

  it('uses the same hint for a Plaid car payment and leaves other loans on the generic question', () => {
    const car = mapPlaidCategory('LOAN_PAYMENTS_CAR_PAYMENT');
    expect(car).toMatchObject({ category: null, scheduleCLine: null, disposition: 'not_an_expense' });
    expect(car?.question).toContain('either method');
    expect(car?.question).toContain('draft, awaiting copy approval');
    expect(mapPlaidCategory('LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT')?.question).toContain('Schedule C line 16b');
    expect(mapPlaidCategory('LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT')?.question).not.toContain('either method');
  });
});

describe('federal snapshot reduces Schedule C profit by the business share', () => {
  it('places $240 on line 16b before AGI and $360 on Schedule 1-A', () => {
    const snapshot = buildFederalTaxSnapshot({
      taxYear: 2026,
      profile: { filing_status: 'single', vehicle_business_use_percentage: 40 },
      organizer: reviewedPersonalDeductionOrganizer(2026, {}, {
        obbbaDeductionFacts: reviewedOBBBADeductionFacts(2026, vehicle('600')),
      }),
      transactions: [], grossReceipts: [{ amount: 100000 }], forms1099: [], w2Entries: [],
      deductions: {}, assets: [], estimatedPayments: 0,
    });
    expect(snapshot.income.scheduleCNetProfit).toBe(99760);
    expect(snapshot.income.totalDeductible).toBe(240);
    expect(snapshot.obbbaDeductions?.scheduleCLine16b).toBe(240);
    expect(snapshot.obbbaDeductions?.vehicleLoanInterest.deduction).toBe(360);
    expect(snapshot.result.vehicleLoanInterestDeduction).toBe(360);
    expect(snapshot.obbbaDeductions?.needsMoreInformation).toEqual([]);
  });
});
