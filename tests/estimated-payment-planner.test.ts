import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EstimatedPaymentPlannerCard, PlannerCardResult } from '@/components/estimated-payment-planner-card';
import { buildPlannerCardView } from '@/lib/planner/card-view';
import { organizerPayload, validatePlannerForm, type PlannerFormInput } from '@/lib/planner/form-input';
import { formatPlannerDueDate } from '@/lib/planner/format-due-date';
import {
  PLANNER_ADD_INCOME_PAY_LESS, PLANNER_ADD_INCOME_SEE_IT, PLANNER_COULD_BE_SMALLER, PLANNER_DE_MINIMIS,
  PLANNER_E1_MESSAGE, PLANNER_ERROR_NEGATIVE, PLANNER_ERROR_NOT_A_NUMBER, PLANNER_ERROR_SAVE,
  PLANNER_NO_TWELVE_MONTH, PLANNER_PENALTY_SENTENCE, PLANNER_WITHHOLDING_LABEL, PLANNER_ZERO_TARGET_CASE1,
  PLANNER_ZERO_TARGET_CASE2, plannerFill,
} from '@/lib/planner/planner-copy';
import { estimatedPaymentPlannerEnabled, plannerCardShouldRender } from '@/lib/planner/planner-flag';
import { projectCurrentYearTax } from '@/lib/planner/projected-tax';
import { submitPlannerCard, type PlannerSubmitGuard, type PlannerTransport } from '@/lib/planner/submit-plan';
import { decidePriorYearZeroTarget, flooredPriorYearTax } from '@/lib/planner/zero-target';
import { calcScheduleSE, getTaxRatesAndLimits } from '@/lib/reports/calcSE';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { calculateFederalIncomeTax } from '@/lib/tax-rules/federal-brackets';
import {
  allocateQuarterly, allocateWithholding, assignInstallmentPeriod, buildQuarterlyPlan, calculateRequiredAnnualPayment,
  cumulativeDueDateTargets, getNextDueDate, resolveQuarterlyPlannerFacts, type PriorYearFacts,
} from '@/lib/tax-provider/quarterly-planner';

const YEAR = 2026;
const prior = (totalTax: number, agi: number): PriorYearFacts => ({ available: true, totalTax, agi, coveredTwelveMonths: true });
const noPrior: PriorYearFacts = { available: false, reason: 'short_year_or_no_return' };
const payment = (currentYearTax: number | null, filingStatus: string, priorYear: PriorYearFacts, withholding = 0) =>
  calculateRequiredAnnualPayment({ taxYear: YEAR, filingStatus, currentYearTax, withholding, priorYear });

function form(overrides: Partial<PlannerFormInput> = {}): PlannerFormInput {
  return {
    taxYear: YEAR, asOf: '2026-10-22', filingStatus: 'Single', twelveMonth: 'yes', citizenOrResident: 'yes',
    line24: '8500', credits: '0', agi: '100000', withholding: '', hideWithholding: false, projectedIncome: '', payments: [],
    ...overrides,
  };
}

function markup(view: ReturnType<typeof buildPlannerCardView>): string {
  return renderToStaticMarkup(createElement(PlannerCardResult, { view, onSeePlan() {}, onAddIncome() {} }));
}

const guard = (): PlannerSubmitGuard => ({ current: false, postedPaymentIds: new Set() });

describe('safe-harbor boundaries', () => {
  it('P1/P2 uses 100% at AGI 150,000 and 110% at 150,001 for single', () => {
    expect(payment(20000, 'single', prior(10000, 150000)).basis).toBe('prior_year_100');
    expect(payment(20000, 'single', prior(10000, 150001))).toMatchObject({ basis: 'prior_year_110', requiredAnnualPayment: 11000 });
  });
  it('P3/P4 judges the $75,000 threshold by this year\'s filing status', () => {
    expect(payment(20000, 'married_filing_separately', prior(10000, 75000)).basis).toBe('prior_year_100');
    expect(payment(20000, 'married_filing_separately', prior(10000, 75001)).basis).toBe('prior_year_110');
    expect(payment(20000, 'single', prior(10000, 75001)).basis).toBe('prior_year_100');
  });
  it('keeps MFJ at AGI 75,001 on the 100% rate', () => {
    expect(payment(20000, 'married_filing_jointly', prior(10000, 75001)).basis).toBe('prior_year_100');
  });
  it('applies the $1,000 test on the 90% path at $999 and not at $1,000', () => {
    const under = payment(999, 'single', noPrior, 0);
    const at = payment(1000, 'single', noPrior, 0);
    expect(under.deMinimis).toMatchObject({ applies: true, evaluated: true, taxLessWithholding: 999 });
    expect(under.estimatedPaymentsRequired).toBe(0);
    expect(at.deMinimis.applies).toBe(false);
    expect(at.estimatedPaymentsRequired).toBe(900);
  });
  it('N6 uses the prior-year basis when the two targets are equal and 90% only when it is smaller', () => {
    const tie = payment(10000, 'single', prior(9000, 100000));
    expect(tie.ninetyPercentOfCurrentYear).toBe(9000);
    expect(tie.requiredAnnualPayment).toBe(9000);
    expect(tie.basis).toBe('prior_year_100');
    const lower = payment(9999, 'single', prior(9000, 100000));
    expect(lower.basis).toBe('current_year_90');
    expect(lower.requiredAnnualPayment).toBe(lower.ninetyPercentOfCurrentYear);
  });
  it('N7 uses 90% when the prior-year path does not apply', () => {
    const result = payment(10000, 'single', noPrior);
    expect(result.basis).toBe('current_year_90');
    expect(result.requiredAnnualPayment).toBe(result.ninetyPercentOfCurrentYear);
  });
  it('does not evaluate the $1,000 exception from prior-year facts alone', () => {
    const result = payment(null, 'single', prior(8500, 100000));
    expect(result).toMatchObject({
      basis: 'prior_year_100', currentYearCompared: false, ninetyPercentOfCurrentYear: null,
      deMinimis: { applies: false, evaluated: false, taxLessWithholding: null }, requiredAnnualPayment: 8500,
    });
    const plan = buildQuarterlyPlan({ taxYear: YEAR, filingStatus: 'single', currentYearTax: null, withholding: 0, priorYear: prior(0, 40000), payments: [], asOf: '2026-10-22' });
    expect(plan.assumptions.join(' ')).toContain('Prior-year total tax is $0');
    expect(plan.assumptions.join(' ')).toContain('was not evaluated');
  });
});

describe('projected current-year tax', () => {
  const limits = getTaxRatesAndLimits(YEAR);
  const rules = getFederalTaxRules(YEAR);

  it('N1 matches Schedule SE below the wage base', () => {
    const earned = 100000;
    const result = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: earned });
    expect(result.seBase).toBeCloseTo(earned * limits.seAdjustmentFactor, 2);
    expect(result.ssPart).toBeCloseTo(earned * limits.seAdjustmentFactor * limits.socialSecurityRate, 2);
    expect(result.seTax).toBeCloseTo(earned * limits.seAdjustmentFactor * (limits.socialSecurityRate + limits.medicareRate), 2);
    expect(result.seBase * 1).toBeLessThan(rules.socialSecurityWageBase);
  });

  it('N2 caps the Social Security part at the wage base', () => {
    const earned = 250000;
    const result = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: earned });
    const seBase = earned * limits.seAdjustmentFactor;
    expect(seBase).toBeGreaterThan(rules.socialSecurityWageBase);
    expect(result.ssPart).toBeCloseTo(rules.socialSecurityWageBase * limits.socialSecurityRate, 2);
    expect(result.medicarePart).toBeCloseTo(seBase * limits.medicareRate, 2);
  });

  it('N3 reduces the Social Security base by W-2 wages and drops it to zero once wages use the base', () => {
    const earned = 250000;
    const partial = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: earned, w2SocialSecurityWages: 50000 });
    const seBase = earned * limits.seAdjustmentFactor;
    expect(partial.ssPart).toBeCloseTo(Math.min(seBase, rules.socialSecurityWageBase - 50000) * limits.socialSecurityRate, 2);
    const full = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: earned, w2SocialSecurityWages: rules.socialSecurityWageBase });
    expect(full.ssPart).toBe(0);
    expect(full.medicarePart).toBeCloseTo(partial.medicarePart, 2);
  });

  it('N4 reads the standard deduction, QBI limit, and brackets from the year table', () => {
    const earned = 80000;
    const otherIncome = 1000;
    const result = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: earned, otherIncome });
    const schedule = calcScheduleSE({ scheduleCNetProfit: earned, taxYear: YEAR }, 'single');
    expect(result.standardDeduction).toBe(rules.standardDeductions.single);
    expect(result.seTax).toBe(schedule.totalSETax);
    const taxableBeforeQbi = Math.max(0, otherIncome + earned - schedule.halfSEDeduction - rules.standardDeductions.single);
    expect(result.qbiDeduction).toBeGreaterThan(0);
    expect(result.taxable).toBeCloseTo(Math.max(0, otherIncome + earned - schedule.halfSEDeduction - rules.standardDeductions.single - result.qbiDeduction), 2);
    expect(taxableBeforeQbi).toBeLessThanOrEqual(rules.qbiThreshold.single);
    expect(result.incomeTax).toBeCloseTo(calculateFederalIncomeTax(result.taxable, 'single', YEAR), 2);
  });

  it('N5 subtracts refundable credits before Additional Medicare is added', () => {
    const result = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: 100000, refundableCredits: 500 });
    expect(result.additionalMedicareTax).toBe(0);
    expect(result.projectedTax).toBeCloseTo(result.incomeTax + result.seTax - 500, 2);
  });

  it('N12 adds Additional Medicare above the single threshold and leaves it at zero below', () => {
    const wages = 50000;
    const aboveEarnings = 200000;
    const seBase = aboveEarnings * limits.seAdjustmentFactor;
    expect(seBase).toBeGreaterThan(limits.additionalMedicareThresholdSingle - wages);
    const above = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: aboveEarnings, w2MedicareWages: wages });
    const expected = (seBase - Math.max(0, limits.additionalMedicareThresholdSingle - wages)) * limits.additionalMedicareRate;
    expect(above.additionalMedicareTax).toBeCloseTo(expected, 2);
    expect(above.totalSETax).toBe(above.seTax);
    expect(Math.round((above.projectedTax - above.section103Figure) * 100)).toBe(Math.round(above.additionalMedicareTax * 100));
    const belowEarnings = 100000;
    expect(belowEarnings * limits.seAdjustmentFactor).toBeLessThanOrEqual(limits.additionalMedicareThresholdSingle - wages);
    const below = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: belowEarnings, w2MedicareWages: wages });
    expect(below.additionalMedicareTax).toBe(0);
    expect(below.projectedTax).toBeCloseTo(below.section103Figure, 2);
  });

  it('N13 floors projected tax and the 90% figure at zero when credits exceed tax', () => {
    const result = projectCurrentYearTax({ taxYear: YEAR, filingStatus: 'single', netSelfEmploymentEarnings: 100000, refundableCredits: 100000 });
    expect(result.section103Figure).toBeLessThan(0);
    expect(result.projectedTax).toBe(0);
    expect(result.ninety).toBe(0);
  });
});

describe('due-date targets', () => {
  it('pins the next due date for October 22, 2026 and the day after the final date', () => {
    expect(getNextDueDate(YEAR, '2026-10-22')?.dueDate).toBe('2027-01-15');
    expect(formatPlannerDueDate('2027-01-15')).toBe('January 15, 2027');
    expect(getNextDueDate(YEAR, '2027-01-16')).toBeNull();
  });
  it('puts a payment dated 2026-10-01 in Q4 and gives leftover cents to the earliest quarters', () => {
    expect(assignInstallmentPeriod('2026-10-01', YEAR)).toEqual({ quarter: 4, afterFinalDueDate: false });
    expect(allocateQuarterly(1001)).toEqual([251, 250, 250, 250]);
  });
  it('N8 credits withholding evenly and N9 rolls a missed quarter forward', () => {
    const even = cumulativeDueDateTargets({ taxYear: YEAR, requiredAnnualPayment: 10000, annualWithholding: 4000, payments: [] });
    expect(even.map(item => item.withholdingCredited)).toEqual([1000, 2000, 3000, 4000]);
    expect(even.map(item => item.target)).toEqual([1500, 3000, 4500, 6000]);
    expect(allocateWithholding({ kind: 'even', total: 4000 }, YEAR).map(item => item.amount)).toEqual([1000, 1000, 1000, 1000]);
    const rolled = cumulativeDueDateTargets({
      taxYear: YEAR, requiredAnnualPayment: 10000, annualWithholding: 0,
      payments: [{ date: '2026-04-15', amount: 2500 }],
    });
    expect(rolled[2].target).toBe(5000);
    expect(rolled[2].target).not.toBe(3750);
  });
  it('N10 is already covered when payments reach the cumulative target', () => {
    const ahead = cumulativeDueDateTargets({
      taxYear: YEAR, requiredAnnualPayment: 10000, annualWithholding: 0,
      payments: [{ date: '2026-04-01', amount: 10000 }],
    });
    expect(ahead.every(item => item.target === 0)).toBe(true);
  });
});

describe('zero-tax exception and ZT-HIDE', () => {
  const hidden = (html: string) => {
    expect(html).not.toContain(PLANNER_COULD_BE_SMALLER);
    expect(html).not.toContain('could be smaller');
    expect(html).not.toContain(PLANNER_ADD_INCOME_PAY_LESS);
    expect(html).not.toContain('Add this year\'s income to see the 90% option');
  };

  it('E1c and Z1 show the exception for exact zero and never a dollar amount', () => {
    const view = buildPlannerCardView({ line24: 0, credits: 0, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false });
    const html = markup(view);
    expect(view.kind).toBe('e1');
    expect(html).toContain(plannerFill(PLANNER_E1_MESSAGE, { taxYear: YEAR }));
    expect(html).not.toContain('$0');
    hidden(html);
    const exact = buildPlannerCardView({ line24: 400, credits: 400, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: true });
    expect(exact.kind).toBe('e1');
    expect(markup(exact)).not.toContain('$0');
    hidden(markup(exact));
  });

  it('E1d shows the residency question and no $0 when the answer is blank', () => {
    const view = buildPlannerCardView({ line24: 0, credits: 0, twelveMonth: 'yes', citizenOrResident: '', taxYear: YEAR, hasCurrentYearFigure: false });
    const html = markup(view);
    expect(view.kind).toBe('case2');
    expect(html).toContain(PLANNER_ZERO_TARGET_CASE2);
    expect(html).not.toContain(plannerFill(PLANNER_E1_MESSAGE, { taxYear: YEAR }));
    expect(html).not.toContain('$0');
  });

  it('E1e does not show the exception when the return did not cover 12 months', () => {
    const decision = decidePriorYearZeroTarget({ line24: 0, credits: 0, twelveMonth: 'no', citizenOrResident: 'yes' });
    expect(decision.showE1).toBe(false);
    const view = buildPlannerCardView({ line24: 0, credits: 0, twelveMonth: 'no', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: true, basis: 'current_year_90', annualAmount: 900, nextAmount: 900, nextDueDate: '2027-01-15' });
    expect(view.kind).not.toBe('e1');
  });

  it('E1f qualifies when credits exceed line 24 and hides both 90% prompts', () => {
    const line24 = 100;
    const credits = 250;
    expect(credits).toBeGreaterThan(line24);
    const view = buildPlannerCardView({ line24, credits, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: true, basis: 'prior_year_100', annualAmount: 0, nextAmount: 0, nextDueDate: '2027-01-15' });
    const html = markup(view);
    expect(view.kind).toBe('e1');
    expect(html).toContain(plannerFill(PLANNER_E1_MESSAGE, { taxYear: YEAR }));
    expect(html).not.toContain('$0');
    expect(html).not.toMatch(/\$\d/);
    hidden(html);
  });

  it('E1g explains a $0 prior-year target when residency is no and hides both 90% prompts', () => {
    const view = buildPlannerCardView({ line24: 100, credits: 250, twelveMonth: 'yes', citizenOrResident: 'no', taxYear: YEAR, hasCurrentYearFigure: true, basis: 'prior_year_100', annualAmount: 0, nextAmount: 0, nextDueDate: '2027-01-15' });
    const html = markup(view);
    expect(view.kind).toBe('case1');
    expect(html).not.toContain(plannerFill(PLANNER_E1_MESSAGE, { taxYear: YEAR }));
    expect(html).toContain(plannerFill(PLANNER_ZERO_TARGET_CASE1, { lastYear: YEAR - 1 }));
    expect(html).toContain(plannerFill(PLANNER_PENALTY_SENTENCE, { taxYear: YEAR }));
    hidden(html);
  });

  it('E1h uses the no-12-month state and does not explain a zero target', () => {
    const view = buildPlannerCardView({ line24: 100, credits: 250, twelveMonth: 'no', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false });
    const html = markup(view);
    expect(view.kind).toBe('no_twelve_month');
    expect(html).toContain(plannerFill(PLANNER_NO_TWELVE_MONTH, { lastYear: YEAR - 1 }));
    expect(html).toContain(PLANNER_ADD_INCOME_SEE_IT);
    expect(html).not.toContain(plannerFill(PLANNER_E1_MESSAGE, { taxYear: YEAR }));
    expect(html).not.toContain(plannerFill(PLANNER_ZERO_TARGET_CASE1, { lastYear: YEAR - 1 }));
    expect(html).not.toContain(PLANNER_ZERO_TARGET_CASE2);
  });

  it('Z2 qualifies below zero and Z3 falls back to 100% or 110% with prior tax of $1', () => {
    const below = decidePriorYearZeroTarget({ line24: 500, credits: 501, twelveMonth: 'yes', citizenOrResident: 'yes' });
    expect(below.priorNet).toBe(-1);
    expect(below.showE1).toBe(true);
    expect(flooredPriorYearTax(500, 501)).toBe(0);
    const almost = decidePriorYearZeroTarget({ line24: 500, credits: 499, twelveMonth: 'yes', citizenOrResident: 'yes' });
    expect(almost.priorNet).toBe(1);
    expect(almost.showE1).toBe(false);
    expect(flooredPriorYearTax(500, 499)).toBe(1);
    expect(payment(20000, 'single', prior(1, 100000)).requiredAnnualPayment).toBe(1);
    expect(payment(20000, 'single', prior(1, 150001)).requiredAnnualPayment).toBe(1.1);
    const view = buildPlannerCardView({
      line24: 500, credits: 499, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false,
      basis: 'prior_year_100', annualAmount: 1, nextAmount: 1, nextDueDate: '2027-01-15',
    });
    expect(view.kind).toBe('plan');
    expect(markup(view)).toContain(PLANNER_COULD_BE_SMALLER);
    expect(markup(view)).toContain(PLANNER_ADD_INCOME_PAY_LESS);
  });
});

describe('planner card behavior', () => {
  it('keeps the feature off unless the flag is the exact string true', () => {
    for (const value of [undefined, '', 'TRUE', '1', 'false']) expect(estimatedPaymentPlannerEnabled(value)).toBe(false);
    expect(estimatedPaymentPlannerEnabled('true')).toBe(true);
    expect(plannerCardShouldRender('true', {})).toBe(true);
    expect(plannerCardShouldRender('true', { firstRunPlannerCard: 'dismissed' })).toBe(false);
    expect(plannerCardShouldRender('true', { firstRunPlannerCard: 'completed' })).toBe(false);
    expect(plannerCardShouldRender(undefined, {})).toBe(false);
  });

  it('renders nothing when the flag is off or the card was already saved', () => {
    const off = renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, {
      profile: {}, onNavigate() {}, taxYear: YEAR, asOf: '2026-10-22',
    }));
    expect(off).toBe('');
    const seen = renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, {
      profile: { firstRunPlannerCard: 'completed' }, onNavigate() {}, taxYear: YEAR, asOf: '2026-10-22',
    }));
    expect(seen).toBe('');
  });

  it('A2 hides the withholding field when a W-2 record exists', () => {
    const previous = process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
    process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = 'true';
    try {
      const html = renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, {
        profile: { filing_status: 'Single' }, onNavigate() {}, taxYear: YEAR, asOf: '2026-10-22',
        initialPhase: 'form', initialW2: { count: 1, withheld: 1200 },
      }));
      expect(html).toContain('Withholding from your W-2 records');
      expect(html).not.toContain(PLANNER_WITHHOLDING_LABEL);
      expect(html).toContain('From your profile');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
      else process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = previous;
    }
  });

  it('A1 saves blank withholding as 0 and keeps a negative AGI', () => {
    const parsed = validatePlannerForm(form({ withholding: '', agi: '-1500' }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.parsed?.withholding).toBe(0);
    expect(parsed.parsed?.agi).toBe(-1500);
    expect(parsed.parsed?.priorYearTax).toBe(8500);
  });

  it('rejects an empty form, abc, and a negative tax without sending a request', async () => {
    const calls: string[] = [];
    const transport: PlannerTransport = {
      async postJson(url) { calls.push(url); return { ok: true, status: 200, body: {} }; },
      async getJson(url) { calls.push(url); return { ok: true, status: 200, body: {} }; },
    };
    expect((await submitPlannerCard(form({ line24: '', credits: '', agi: '' }), transport, guard())).status).toBe('invalid');
    const abc = validatePlannerForm(form({ line24: 'abc' }));
    expect(abc.errors[0]?.message).toBe(PLANNER_ERROR_NOT_A_NUMBER);
    expect((await submitPlannerCard(form({ line24: 'abc' }), transport, guard())).status).toBe('invalid');
    const negative = validatePlannerForm(form({ line24: '-5' }));
    expect(negative.errors.map(error => error.message)).toContain(PLANNER_ERROR_NEGATIVE);
    expect(calls).toEqual([]);
  });

  it('keeps entries when the save fails and does not post a payment twice', async () => {
    const transport: PlannerTransport = {
      async postJson() { return { ok: false, status: 503, body: {} }; },
      async getJson() { return { ok: true, status: 200, body: {} }; },
    };
    const failed = await submitPlannerCard(form(), transport, guard());
    expect(failed).toMatchObject({ status: 'save_failed', message: PLANNER_ERROR_SAVE });
    let posts = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow: PlannerTransport = {
      async postJson(url) {
        posts += url === '/api/tax/quarterly-payments' ? 1 : 0;
        await gate;
        return { ok: true, status: 200, body: {} };
      },
      async getJson() {
        return { ok: true, status: 200, body: { planner: { status: 'ready', requiredAnnualPayment: { basis: 'prior_year_100', requiredAnnualPayment: 8500, deMinimis: { applies: false, evaluated: false } }, nextDue: { amountToPay: 8500, dueDate: '2027-01-15' } } } };
      },
    };
    const shared = guard();
    const input = form({ payments: [{ clientId: 'pay-1', date: '2026-04-10', amount: '200' }] });
    const first = submitPlannerCard(input, slow, shared);
    const second = await submitPlannerCard(input, slow, shared);
    expect(second.status).toBe('duplicate');
    release();
    expect((await first).status).toBe('ready');
    expect(posts).toBe(1);
  });

  it('E2 shows the drafted $1,000 sentence only on the 90% basis', () => {
    const shown = buildPlannerCardView({
      line24: 20000, credits: 0, twelveMonth: 'no', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: true,
      basis: 'current_year_90', annualAmount: 0, nextAmount: 0, nextDueDate: '2027-01-15', deMinimisApplies: true, deMinimisEvaluated: true,
    });
    expect(shown.kind === 'covered' || shown.kind === 'plan').toBe(true);
    if (shown.kind === 'covered' || shown.kind === 'plan') expect(shown.deMinimis).toBe(plannerFill(PLANNER_DE_MINIMIS, { taxYear: YEAR }));
    const hiddenMessage = buildPlannerCardView({
      line24: 8500, credits: 0, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false,
      basis: 'prior_year_100', annualAmount: 8500, nextAmount: 8500, nextDueDate: '2027-01-15', deMinimisApplies: false, deMinimisEvaluated: false,
    });
    expect(hiddenMessage.kind === 'plan' && hiddenMessage.deMinimis).toBeNull();
  });

  it('writes the raw line 24, the floored prior tax, and no unused payment totals', () => {
    const parsed = validatePlannerForm(form({ line24: '100', credits: '250', agi: '40000' })).parsed;
    expect(parsed).not.toBeNull();
    const answers = organizerPayload(form({ line24: '100', credits: '250', citizenOrResident: '' }), parsed!);
    expect(answers).toMatchObject({ priorYearLine24Tax: '100', priorYearRefundableCredits: '250', priorYearTax: '0', priorYearAGI: '40000', priorReturnCoveredTwelveMonths: 'yes' });
    expect(answers).not.toHaveProperty('priorYearFullYearCitizenOrResident');
    expect(answers).not.toHaveProperty('madeQuarterlyPayments');
    expect(answers).not.toHaveProperty('quarterlyTotal');
  });

  it('projects income into a ready 90% plan and keeps a no-return year in review without it', () => {
    const annual = { filingStatus: 'single', totalTax: 0, refundableCredits: 0, totalFederalWithheld: 0, totalIncome: 0 };
    const missing = resolveQuarterlyPlannerFacts({ taxYear: YEAR, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'no' }, deductions: {} });
    expect(missing.status).toBe('review_required');
    if (missing.status !== 'review_required') throw new Error('expected review');
    expect(missing.missingFacts.map(fact => fact.key)).toEqual(['current_year_estimate']);
    const ready = resolveQuarterlyPlannerFacts({ taxYear: YEAR, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'no', projectedNetBusinessIncome: '100000' }, deductions: {} });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('expected ready');
    expect(ready.facts.currentYearTax).toBeGreaterThan(0);
    const plan = buildQuarterlyPlan({ ...ready.facts, payments: [], asOf: '2026-10-22' });
    expect(plan.requiredAnnualPayment.basis).toBe('current_year_90');
  });

  it('does not mention analytics events or a measurement id', () => {
    const files = [
      ...readdirSync(new URL('../lib/planner', import.meta.url)).map(name => `../lib/planner/${name}`),
      '../components/estimated-payment-planner-card.tsx',
      '../lib/tax-rules/estimated-tax-safe-harbor.ts',
    ];
    const source = files.map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
    expect(source).not.toMatch(/gtag|planner_card_|G-LE26KP7E9N/);
    expect(readFileSync(new URL('../lib/planner/planner-copy.ts', import.meta.url), 'utf8')).not.toMatch(/[—–]/);
    expect(PLANNER_PENALTY_SENTENCE).toBe('Paying at least these amounts by each due date generally avoids the federal underpayment penalty for {taxYear}, based on what you entered. It isn\'t your final tax for the year, and state estimated taxes are separate.');
  });
});
