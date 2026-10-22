import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EstimatedPaymentPlannerCard, PlannerCardResult } from '@/components/estimated-payment-planner-card';
import { buildPlannerCardView, type PlannerCardView, type PlannerResultFacts } from '@/lib/planner/card-view';
import { appliedCreditDate, defaultDesignatedTaxYear, paymentYearChoiceApplies, validatePlannerForm, type PlannerFormInput } from '@/lib/planner/form-input';
import { calendarIsoDate, formatPlannerDueDate, formatPlannerMoney } from '@/lib/planner/format-due-date';
import { allocateOldestFirst } from '@/lib/planner/past-due';
import {
  AFTER_PENALTY_END_NOTE, ALL_DUE_DATES_PASSED_SENTENCE, ANNUALIZED_PAST_DUE_NOTE, PAID_LATE_SENTENCE,
  PAST_DUE_LABEL, PAST_DUE_SENTENCE, PAYMENT_DATE_OUT_OF_RANGE_ERROR, PAYMENT_TAX_YEAR_PICKER_LABEL,
  PAYMENT_TYPE_PRIOR_YEAR_OVERPAYMENT_LABEL, PER_DUE_DATE_PENALTY_SENTENCE, PER_DUE_DATE_PENALTY_SENTENCE_PAST_DUE,
  PLANNER_ADD_INCOME_PAY_LESS, PLANNER_ALREADY_COVERED, PLANNER_APPLIED_AMOUNT_LABEL, PLANNER_APPLIED_FILED_LABEL,
  PLANNER_APPLIED_PENDING, PLANNER_COULD_BE_SMALLER, PLANNER_DE_MINIMIS, PLANNER_DISMISSED, PLANNER_E1_MESSAGE,
  PLANNER_EMPTY, PLANNER_ERROR_LOAD, PLANNER_ERROR_NEGATIVE, PLANNER_ERROR_NOT_A_NUMBER, PLANNER_ERROR_PAYMENT_DATE,
  PLANNER_ERROR_SAVE, PLANNER_FILING_STATUS_LABEL, PLANNER_MISSING_FACTS, PLANNER_NEXT_PAYMENT, PLANNER_PENALTY_SENTENCE,
  PLANNER_ZERO_TARGET_CASE1, PLANNER_ZERO_TARGET_CASE2, Q4_FILE_AND_PAY_SENTENCE, SHOW_AFTER_PENALTY_END_NOTE,
  SHOW_ANNUALIZED_PAST_DUE_NOTE, plannerFill,
} from '@/lib/planner/planner-copy';
import {
  allocateQuarterly, buildQuarterlyPlan, getInstallmentDueDates, type PriorYearFacts, type QuarterlyPlan,
  type RecordedEstimatedPayment,
} from '@/lib/tax-provider/quarterly-planner';

const YEAR = 2026;
const prior = (totalTax: number, agi: number): PriorYearFacts => ({ available: true, totalTax, agi, coveredTwelveMonths: true });
const dateError = plannerFill(PAYMENT_DATE_OUT_OF_RANGE_ERROR, { taxYear: YEAR, nextYear: YEAR + 1 });
const plainFor = (date: string) => plannerFill(PER_DUE_DATE_PENALTY_SENTENCE, { nextDueDate: date });
const conditionalFor = (date: string) => plannerFill(PER_DUE_DATE_PENALTY_SENTENCE_PAST_DUE, { nextDueDate: date });
const q4Sentence = plannerFill(Q4_FILE_AND_PAY_SENTENCE, { taxYear: YEAR, q4AltDate: 'February 1, 2027', lastDue: 'January 15' });
const allDueDates = plannerFill(ALL_DUE_DATES_PASSED_SENTENCE, { taxYear: YEAR });
const sectionTen = plannerFill(PLANNER_PENALTY_SENTENCE, { taxYear: YEAR });
const cents = (value: number) => Math.round(value * 100);

function form(overrides: Partial<PlannerFormInput> = {}): PlannerFormInput {
  return {
    taxYear: YEAR, asOf: '2026-10-22', filingStatus: 'Single', twelveMonth: 'yes', citizenOrResident: 'yes',
    line24: '8500', credits: '0', agi: '100000', withholding: '', hideWithholding: false, projectedIncome: '', payments: [],
    ...overrides,
  };
}

function pay(amount: number, paidDate: string, recordedQuarter: 1 | 2 | 3 | 4 = 1, extra: Partial<RecordedEstimatedPayment> = {}): RecordedEstimatedPayment {
  return { amount, paidDate, recordedQuarter, ...extra };
}

function planAt(asOf: string, payments: RecordedEstimatedPayment[] = [], extras: { withholding?: number; currentYearTax?: number | null; priorTax?: number } = {}): QuarterlyPlan {
  return buildQuarterlyPlan({
    taxYear: YEAR, filingStatus: 'single', currentYearTax: extras.currentYearTax === undefined ? null : extras.currentYearTax,
    withholding: extras.withholding ?? 0, priorYear: prior(extras.priorTax ?? 8500, 100000), payments, asOf,
  });
}

function partsOf(plan: QuarterlyPlan): number[] {
  return allocateQuarterly(cents(plan.requiredAnnualPayment.requiredAnnualPayment)).map(part => part / 100);
}

function decode(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
}

function markup(view: PlannerCardView): string {
  return decode(renderToStaticMarkup(createElement(PlannerCardResult, { view, onSeePlan() {}, onAddIncome() {} })));
}

function card(plan: QuarterlyPlan, options: Partial<Pick<PlannerResultFacts, 'basis' | 'deMinimisApplies' | 'deMinimisEvaluated' | 'showAnnualizedNote' | 'showAfterPenaltyEndNote' | 'appliedCreditPending'>> = {}): PlannerCardView {
  const pastDue = plan.pastDue;
  const basis = options.basis ?? plan.requiredAnnualPayment.basis;
  return buildPlannerCardView({
    line24: 8500, credits: 0, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR,
    hasCurrentYearFigure: basis === 'current_year_90', basis,
    annualAmount: plan.requiredAnnualPayment.requiredAnnualPayment,
    nextAmount: pastDue ? pastDue.nextOnly : plan.nextDue?.amountToPay ?? null,
    nextDueDate: pastDue?.nextDueDate ?? plan.nextDue?.dueDate ?? null,
    pastDue, deMinimisApplies: options.deMinimisApplies ?? plan.requiredAnnualPayment.deMinimis.applies,
    deMinimisEvaluated: options.deMinimisEvaluated ?? plan.requiredAnnualPayment.deMinimis.evaluated,
    showAnnualizedNote: options.showAnnualizedNote, showAfterPenaltyEndNote: options.showAfterPenaltyEndNote,
    appliedCreditPending: options.appliedCreditPending,
  });
}

function asPlan(view: PlannerCardView) {
  if (view.kind !== 'plan') throw new Error(`expected a plan, got ${view.kind}`);
  return view;
}

function renderForm(props: { asOf: string; initialPayments: PlannerFormInput['payments'] }): string {
  const previous = process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
  process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = 'true';
  try {
    return decode(renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, {
      profile: {}, onNavigate() {}, taxYear: YEAR, asOf: props.asOf, initialPhase: 'form', initialPayments: props.initialPayments,
    })));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
    else process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = previous;
  }
}

function expectNoPastDueCopy(html: string) {
  expect(html).not.toContain(PAST_DUE_LABEL);
  expect(html).not.toContain(PAST_DUE_SENTENCE);
  expect(html).not.toContain(PAID_LATE_SENTENCE);
  expect(html).not.toContain(ANNUALIZED_PAST_DUE_NOTE);
  expect(html).not.toContain('Paying the rest now');
  expect(html).not.toContain(q4Sentence);
  expect(html).not.toContain('§6654(h)');
}

describe('v1.8 past-due planner', () => {
  it('uses the v1.8 strings', () => {
    expect(PAYMENT_TAX_YEAR_PICKER_LABEL).toBe('Which tax year is this payment for?');
    expect(PAYMENT_TYPE_PRIOR_YEAR_OVERPAYMENT_LABEL).toBe('Applied from last year\'s return');
    expect(plannerFill(PLANNER_APPLIED_AMOUNT_LABEL, { priorYear: 2025 })).toBe('the amount on line 36 of your 2025 Form 1040');
    expect(plannerFill(PLANNER_APPLIED_FILED_LABEL, { priorYear: 2025 })).toBe('Have you filed your 2025 return?');
    expect(PLANNER_APPLIED_PENDING).toBe('Pending until you file');
    expect(dateError).toBe('Enter a date from January 1, 2026 to April 15, 2027, and not after today.');
    expect(PLANNER_ERROR_PAYMENT_DATE).toBe('Pick a date in {taxYear}, on or before today.');
    expect(q4Sentence).toBe('If you file your 2026 return and pay the full balance by February 1, 2027, there\'s no penalty for the January 15 payment.');
    expect(allDueDates).toBe('All 2026 due dates have passed. Paying the rest now limits the penalty.');
    expect(plannerFill(AFTER_PENALTY_END_NOTE, { taxYear: 2026, penaltyEnd: 'April 15, 2027' })).toBe('2026 estimated payments are over. Any 2026 tax you still owe is due with your return, and tax unpaid after April 15, 2027 adds interest and a late-payment penalty');
    expect(SHOW_ANNUALIZED_PAST_DUE_NOTE).toBe(false);
    expect(SHOW_AFTER_PENALTY_END_NOTE).toBe(false);
    expect(appliedCreditDate(YEAR)).toBe('2026-04-15');
  });

  it('PD1 splits the past-due quarters from the January payment on both bases', () => {
    for (const extras of [{}, { currentYearTax: 8000 }]) {
      const plan = planAt('2026-10-22', [], extras);
      const parts = partsOf(plan);
      const past = parts[0] + parts[1] + parts[2];
      expect(plan.requiredAnnualPayment.basis).toBe(extras.currentYearTax ? 'current_year_90' : 'prior_year_100');
      expect(cents(plan.pastDue?.amount ?? -1)).toBe(cents(past));
      expect(cents(plan.pastDue?.nextOnly ?? -1)).toBe(cents(parts[3]));
      expect(cents((plan.pastDue?.amount ?? 0) + (plan.pastDue?.nextOnly ?? 0))).toBe(cents(plan.nextDue?.amountToPay ?? -1));
      const view = asPlan(card(plan, { basis: extras.currentYearTax ? 'current_year_90' : plan.requiredAnnualPayment.basis, deMinimisApplies: true, deMinimisEvaluated: true }));
      const html = markup(view);
      const conditional = conditionalFor('January 15, 2027');
      expect(view.pastDueLine).toBe(`${PAST_DUE_LABEL}: ${formatPlannerMoney(plan.pastDue!.amount)}`);
      expect(view.pastDueLine).not.toContain('by January 15, 2027');
      expect(view.next).toContain('Next payment:');
      expect(view.next).toContain(formatPlannerMoney(parts[3]));
      expect(view.next).toContain('January 15, 2027');
      expect(view.pastDueSentence).toBe(PAST_DUE_SENTENCE);
      expect(view.penalty).toBe(conditional);
      expect(html).not.toContain(plainFor('January 15, 2027'));
      expect(html).not.toContain(sectionTen);
      expect(html).not.toContain(plannerFill(PLANNER_DE_MINIMIS, { taxYear: YEAR }));
      expect(html.indexOf(PAST_DUE_LABEL)).toBeLessThan(html.indexOf(view.next));
      expect(html.indexOf(view.next)).toBeLessThan(html.indexOf(conditional));
      expect(html.slice(html.indexOf(view.next), html.indexOf(conditional))).not.toContain(PAST_DUE_SENTENCE);
      expect(html).toContain('See full plan');
      if (!extras.currentYearTax) {
        expect(html).toContain('It is based on 100% of last year\'s tax.');
        expect(html).toContain(PLANNER_COULD_BE_SMALLER);
        expect(html).toContain(PLANNER_ADD_INCOME_PAY_LESS);
      }
    }
  });

  it('PD2 and PD2b keep a plain per-due-date sentence when nothing is past due or paid late', () => {
    const sample = planAt('2026-10-22');
    const parts = partsOf(sample);
    const onTime = planAt('2026-10-22', [
      pay(parts[0], '2026-04-15', 1), pay(parts[1], '2026-06-15', 2), pay(parts[2], '2026-09-15', 3),
    ]);
    expect(onTime.pastDue?.amount).toBe(0);
    expect(onTime.pastDue?.installments.some(item => item.paidLate)).toBe(false);
    const view = asPlan(card(onTime));
    const html = markup(view);
    expect(view.pastDueLine).toBeNull();
    expect(view.pastDueSentence).toBeNull();
    expect(view.paidLate).toBeNull();
    expect(view.annualizedNote).toBeNull();
    expect(view.afterPenaltyEndNote).toBeNull();
    expect(view.next).toContain(formatPlannerMoney(parts[3]));
    expect(view.next).toContain('January 15, 2027');
    expect(view.penalty).toBe(plainFor('January 15, 2027'));
    expect(html).not.toContain(sectionTen);
    expectNoPastDueCopy(html);
    const exact = planAt('2026-10-22', [pay(parts[0], '2026-04-15', 1)]);
    const first = exact.pastDue!.installments[0];
    expect(first.shortAtDue).toBe(0);
    expect(first.paidLate).toBe(false);
  });

  it('PD3 leaves the short quarter unpaid and PD3b clears it late', () => {
    const parts = partsOf(planAt('2026-10-22'));
    const partial = 1000;
    const pd3 = planAt('2026-10-22', [pay(parts[0], '2026-04-15', 1), pay(partial, '2026-06-15', 2)]);
    const rows = pd3.pastDue!.installments;
    expect(rows[0].balance).toBe(0);
    expect(cents(rows[1].balance)).toBe(cents(parts[1] - partial));
    expect(cents(rows[2].balance)).toBe(cents(parts[2]));
    expect(cents(pd3.pastDue!.amount)).toBe(cents(parts[1] - partial + parts[2]));
    expect(cents(pd3.pastDue!.nextOnly)).toBe(cents(parts[3]));
    const open = asPlan(card(pd3));
    expect(open.pastDueLine).toContain(PAST_DUE_LABEL);
    expect(open.pastDueSentence).toBe(PAST_DUE_SENTENCE);
    expect(open.paidLate).toBeNull();
    expect(open.penalty).toBe(conditionalFor('January 15, 2027'));
    const caughtUp = planAt('2026-10-22', [
      pay(parts[0], '2026-04-15', 1), pay(partial, '2026-06-15', 2), pay(parts[1] - partial + parts[2], '2026-10-01', 3),
    ]);
    expect(caughtUp.pastDue?.amount).toBe(0);
    expect(caughtUp.pastDue?.installments[1].paidLate).toBe(true);
    expect(caughtUp.pastDue?.installments[2].paidLate).toBe(true);
    const late = asPlan(card(caughtUp));
    const html = markup(late);
    expect(late.paidLate).toBe(PAID_LATE_SENTENCE);
    expect(html).not.toContain(PAST_DUE_LABEL);
    expect(html).not.toContain('Paying now');
    expect(html).not.toContain('paying sooner');
    expect(late.next).toContain('January 15, 2027');
    expect(late.penalty).toBe(plainFor('January 15, 2027'));
    expect(html).not.toContain(sectionTen);
  });

  it('PD4 lets ZT-HIDE win over a real past-due allocation', () => {
    for (const asOf of ['2026-10-22', '2027-01-20']) {
      const stuffed = planAt(asOf);
      expect(stuffed.pastDue && stuffed.pastDue.amount > 0).toBe(true);
      const shared = {
        taxYear: YEAR, hasCurrentYearFigure: true, basis: 'prior_year_100' as const, annualAmount: 8500,
        nextAmount: stuffed.pastDue?.nextOnly, nextDueDate: stuffed.pastDue?.nextDueDate, pastDue: stuffed.pastDue,
        showAnnualizedNote: true, showAfterPenaltyEndNote: true,
      };
      const e1 = buildPlannerCardView({ line24: 100, credits: 250, twelveMonth: 'yes', citizenOrResident: 'yes', ...shared });
      const case1 = buildPlannerCardView({ line24: 100, credits: 250, twelveMonth: 'yes', citizenOrResident: 'no', ...shared });
      expect(e1.kind).toBe('e1');
      expect(case1.kind).toBe('case1');
      for (const view of [e1, case1]) {
        const html = markup(view);
        expectNoPastDueCopy(html);
        expect(html).not.toContain(allDueDates);
        expect(html).not.toContain(ANNUALIZED_PAST_DUE_NOTE);
        expect(html).not.toContain('estimated payments are over');
        expect(html).not.toContain(PLANNER_COULD_BE_SMALLER);
        expect(html).not.toContain(PLANNER_ADD_INCOME_PAY_LESS);
      }
      expect(markup(e1)).toContain(plannerFill(PLANNER_E1_MESSAGE, { taxYear: YEAR }));
      expect(markup(case1)).toContain(plannerFill(PLANNER_ZERO_TARGET_CASE1, { lastYear: YEAR - 1 }));
      expect(markup(case1)).toContain(sectionTen);
    }
  });

  it('PD5 bans the early-filing phrase and any claim that an extension helps with paying', () => {
    const dates = ['2026-10-22', '2027-01-15', '2027-01-16', '2027-02-01', '2027-02-02', '2027-04-15', '2027-04-16'];
    const previous = process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
    process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = 'true';
    const samples: { text: string; allowQ4: boolean }[] = [];
    try {
      for (const asOf of dates) {
        const allowQ4 = asOf === '2027-01-16' || asOf === '2027-02-01';
        const formHtml = decode(renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, { profile: {}, onNavigate() {}, taxYear: YEAR, asOf, initialPhase: 'form' })));
        const collapsed = decode(renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, { profile: {}, onNavigate() {}, taxYear: YEAR, asOf, initialPhase: 'collapsed' })));
        const dismissed = decode(renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, { profile: {}, onNavigate() {}, taxYear: YEAR, asOf, initialPhase: 'dismissed' })));
        const prior = markup(card(planAt(asOf)));
        const current = markup(card(planAt(asOf, [], { currentYearTax: 8000 })));
        const paid = markup(card(planAt(asOf, partsOf(planAt(asOf)).slice(0, 3).map((amount, index) => pay(amount, ['2026-04-15', '2026-06-15', '2026-09-15'][index], (index + 1) as 1 | 2 | 3)))));
        samples.push({ text: formHtml, allowQ4: false }, { text: collapsed, allowQ4: false }, { text: dismissed, allowQ4: false });
        samples.push({ text: prior, allowQ4 }, { text: current, allowQ4 }, { text: paid, allowQ4 });
      }
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
      else process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = previous;
    }
    const extras = [
      markup(buildPlannerCardView({ line24: 0, credits: 0, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false })),
      markup(buildPlannerCardView({ line24: 100, credits: 250, twelveMonth: 'yes', citizenOrResident: 'no', taxYear: YEAR, hasCurrentYearFigure: true, basis: 'prior_year_100', annualAmount: 0, nextAmount: 0, nextDueDate: '2027-01-15' })),
      markup(buildPlannerCardView({ line24: 0, credits: 0, twelveMonth: 'yes', citizenOrResident: '', taxYear: YEAR, hasCurrentYearFigure: false })),
      markup(buildPlannerCardView({ line24: 8500, credits: 0, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false, missingLabels: ['last year\'s total tax'] })),
      PLANNER_EMPTY, PLANNER_DISMISSED, PLANNER_ERROR_NOT_A_NUMBER, PLANNER_ERROR_NEGATIVE, dateError, PLANNER_ERROR_SAVE, PLANNER_ERROR_LOAD,
      plannerFill(PLANNER_MISSING_FACTS, { list: 'last year\'s total tax' }), PLANNER_ZERO_TARGET_CASE2,
    ];
    extras.forEach(text => samples.push({ text, allowQ4: false }));
    const copy = readFileSync(new URL('../lib/planner/planner-copy.ts', import.meta.url), 'utf8');
    const filingLabel = plannerFill(PLANNER_FILING_STATUS_LABEL, { taxYear: YEAR });
    expect(copy.toLowerCase()).not.toContain('no penalty if you file early');
    expect(copy.toLowerCase()).not.toContain('an extension helps with paying');
    expect(copy).not.toContain('February 1, 2027');
    expect(copy).not.toContain('§6654(h)');
    for (const sample of samples) {
      expect(sample.text.toLowerCase()).not.toContain('no penalty if you file early');
      expect(sample.text.toLowerCase()).not.toContain('an extension helps with paying');
      const stripped = [q4Sentence, filingLabel, PLANNER_FILING_STATUS_LABEL, 'Married Filing Jointly', 'Married Filing Separately', 'planner-filing-status']
        .reduce((text, known) => text.split(known).join(''), sample.text);
      expect(stripped.toLowerCase()).not.toContain('filing');
      expect(stripped).not.toContain('§6654(h)');
      if (sample.allowQ4) expect(sample.text).toContain(q4Sentence);
      else {
        expect(sample.text).not.toContain(q4Sentence);
        expect(stripped).not.toContain('February 1, 2027');
      }
    }
    expect(samples.some(sample => sample.allowQ4 && sample.text.includes(q4Sentence))).toBe(true);
  });

  it('PD6 keeps the annualized line off unless the earlier-quarters sentence is showing', () => {
    expect(SHOW_ANNUALIZED_PAST_DUE_NOTE).toBe(false);
    const pd1 = planAt('2026-10-22');
    expect(markup(card(pd1))).not.toContain(ANNUALIZED_PAST_DUE_NOTE);
    expect(markup(card(pd1, { showAnnualizedNote: true }))).toContain(ANNUALIZED_PAST_DUE_NOTE);
    const parts = partsOf(pd1);
    const pd2 = planAt('2026-10-22', [pay(parts[0], '2026-04-15'), pay(parts[1], '2026-06-15', 2), pay(parts[2], '2026-09-15', 3)]);
    const pd3b = planAt('2026-10-22', [pay(parts[0], '2026-04-15'), pay(1000, '2026-06-15', 2), pay(parts[1] - 1000 + parts[2], '2026-10-01', 3)]);
    expect(markup(card(pd2, { showAnnualizedNote: true }))).not.toContain(ANNUALIZED_PAST_DUE_NOTE);
    expect(markup(card(pd3b, { showAnnualizedNote: true }))).not.toContain(ANNUALIZED_PAST_DUE_NOTE);
    const hidden = buildPlannerCardView({
      line24: 100, credits: 250, twelveMonth: 'yes', citizenOrResident: 'yes', taxYear: YEAR, hasCurrentYearFigure: false,
      pastDue: pd1.pastDue, showAnnualizedNote: true, annualAmount: 8500, basis: 'prior_year_100',
    });
    expect(markup(hidden)).not.toContain(ANNUALIZED_PAST_DUE_NOTE);
  });

  it('PD7 credits a Q3-labeled payment to the oldest unpaid installment', () => {
    const parts = partsOf(planAt('2026-10-22'));
    const plan = planAt('2026-10-22', [pay(parts[0], '2026-09-15', 3)]);
    const rows = plan.pastDue!.installments;
    expect(rows[0].balance).toBe(0);
    expect(rows[0].paidLate).toBe(true);
    expect(cents(rows[1].balance)).toBe(cents(parts[1]));
    expect(cents(rows[2].balance)).toBe(cents(parts[2]));
    expect(cents(plan.pastDue!.amount)).toBe(cents(parts[1] + parts[2]));
    expect(cents(plan.pastDue!.nextOnly)).toBe(cents(parts[3]));
    const view = asPlan(card(plan));
    expect(view.pastDueLine).toContain(PAST_DUE_LABEL);
    expect(view.pastDueSentence).toBe(PAST_DUE_SENTENCE);
    expect(view.paidLate).toBeNull();
  });

  it('PD8 through PD12 follow the three windows, including the optional April line', () => {
    const parts = partsOf(planAt('2026-10-22'));
    const remaining = parts.reduce((sum, part) => sum + part, 0);
    const expectOpen = (asOf: string, withQ4: boolean) => {
      const view = asPlan(card(planAt(asOf)));
      const html = markup(view);
      expect(view.mode).toBe('window');
      expect(view.pastDueLine).toBe(`${PAST_DUE_LABEL}: ${formatPlannerMoney(remaining)}`);
      expect(view.allDueDatesPassed).toBe(allDueDates);
      expect(view.pastDueSentence).toBe(PAST_DUE_SENTENCE);
      expect(view.q4FileAndPay).toBe(withQ4 ? q4Sentence : null);
      expect(view.next).toBe('');
      expect(view.penalty).toBe('');
      expect(html).not.toContain('Next payment:');
      expect(html).not.toContain(plainFor('January 15, 2027'));
      expect(html).not.toContain(conditionalFor('January 15, 2027'));
    };
    expectOpen('2027-01-16', true);
    expectOpen('2027-02-01', true);
    expectOpen('2027-02-02', false);
    expectOpen('2027-04-15', false);
    const january = asPlan(card(planAt('2027-01-15')));
    expect(january.mode).toBe('past_due');
    expect(january.next).toContain(formatPlannerMoney(parts[3]));
    expect(january.next).toContain('January 15, 2027');
    expect(january.penalty).toBe(conditionalFor('January 15, 2027'));
    expect(january.allDueDatesPassed).toBeNull();
    expect(january.q4FileAndPay).toBeNull();
    const w3 = asPlan(card(planAt('2027-04-16')));
    const w3Html = markup(w3);
    expect(w3.mode).toBe('after_final');
    expect(w3.pastDueLine).toBeNull();
    expect(w3.next).toBe('');
    expect(w3Html).not.toContain('Next payment:');
    expect(w3Html).not.toContain(PAST_DUE_LABEL);
    expect(w3Html).not.toContain('Paying the rest now');
    expect(w3Html).not.toContain('Paying now');
    expect(w3Html).not.toContain(q4Sentence);
    expect(w3.afterFinalHeading).toBe(plannerFill('All {taxYear} installment dates have passed', { taxYear: YEAR }));
    expect(w3.afterPenaltyEndNote).toBeNull();
    const optedIn = asPlan(card(planAt('2027-04-16'), { showAfterPenaltyEndNote: true }));
    expect(optedIn.afterPenaltyEndNote).toBe(plannerFill(AFTER_PENALTY_END_NOTE, { taxYear: YEAR, penaltyEnd: 'April 15, 2027' }));
    expect(asPlan(card(planAt('2027-04-15'), { showAfterPenaltyEndNote: true })).afterPenaltyEndNote).toBeNull();
    const dues = getInstallmentDueDates(2027).map(item => item.dueDate);
    expect(dues[0]).toBe('2027-04-15');
    expect(dues.some(date => date.startsWith('2026'))).toBe(false);
    const nextYear = allocateOldestFirst({ dueDates: dues, installmentCents: [250000, 250000, 250000, 250000], credits: [], asOf: '2027-04-16', rolledForwardCents: null });
    expect(nextYear.installments[0].dueDate).toBe('2027-04-15');
    expect(nextYear.remaining).toBe(10000);
  });

  it('PD13 and PD13b show the paid-late sentence alone once the shortfall is gone', () => {
    const parts = partsOf(planAt('2026-10-22'));
    const plan = planAt('2026-10-22', [
      pay(parts[0], '2026-06-01', 1), pay(parts[1], '2026-06-15', 2), pay(parts[2], '2026-09-15', 3),
    ]);
    expect(plan.pastDue?.amount).toBe(0);
    expect(plan.pastDue?.installments.map(item => item.paidLate)).toEqual([true, false, false, false]);
    const view = asPlan(card(plan));
    const html = markup(view);
    expect(view.paidLate).toBe(PAID_LATE_SENTENCE);
    expect(html.split(PAID_LATE_SENTENCE).length).toBe(2);
    expect(html).not.toContain(PAST_DUE_LABEL);
    expect(html).not.toContain('Paying now');
    expect(html).not.toContain('paying sooner');
    expect(view.penalty).toBe(plainFor('January 15, 2027'));
    const entered = validatePlannerForm(form({ asOf: '2027-01-20', payments: [{ clientId: 'q4', date: '2027-01-18', amount: String(parts[3]) }] }));
    expect(entered.errors).toEqual([]);
    const finished = planAt('2027-01-20', [
      pay(parts[0], '2026-04-15'), pay(parts[1], '2026-06-15', 2), pay(parts[2], '2026-09-15', 3), pay(parts[3], '2027-01-18', 4),
    ]);
    expect(finished.pastDue?.remaining).toBe(0);
    const alone = asPlan(card(finished));
    const aloneHtml = markup(alone);
    expect(alone.mode).toBe('paid_late_only');
    expect(alone.paidLate).toBe(PAID_LATE_SENTENCE);
    expect(alone.pastDueLine).toBeNull();
    expect(aloneHtml).not.toContain('Paying the rest now');
    expect(aloneHtml).not.toContain(q4Sentence);
    expect(aloneHtml).not.toContain(formatPlannerMoney(parts[3]));
  });

  it('PD14 uses the conditional sentence when a later payment leaves the next quarter short', () => {
    const parts = partsOf(planAt('2026-09-15'));
    const partial = 1000;
    const plan = planAt('2026-09-15', [pay(partial, '2026-04-15', 1), pay(parts[1], '2026-06-15', 2)]);
    const rows = plan.pastDue!.installments;
    expect(rows[0].balance).toBe(0);
    expect(rows[0].paidLate).toBe(true);
    expect(cents(rows[1].balance)).toBe(cents(parts[0] - partial));
    expect(rows[1].shortAtDue).toBeGreaterThan(0);
    expect(cents(plan.pastDue!.amount)).toBe(cents(parts[0] - partial));
    const view = asPlan(card(plan));
    const html = markup(view);
    const conditional = conditionalFor('September 15, 2026');
    expect(view.pastDueLine).toContain(PAST_DUE_LABEL);
    expect(view.pastDueSentence).toBe(PAST_DUE_SENTENCE);
    expect(view.next).toContain('September 15, 2026');
    expect(view.penalty).toBe(conditional);
    expect(html.indexOf(view.next)).toBeLessThan(html.indexOf(conditional));
    expect(html).not.toContain(plainFor('September 15, 2026'));
    expect(html).not.toContain(sectionTen);
  });

  it('PD15 and PD15b count a January payment only for the year the user picks', () => {
    expect(defaultDesignatedTaxYear('2026-01-10', YEAR)).toBe(2025);
    expect(defaultDesignatedTaxYear('2026-01-10', YEAR, 2026)).toBe(2026);
    expect(defaultDesignatedTaxYear('2027-01-10', YEAR)).toBe(2026);
    expect(paymentYearChoiceApplies('2026-01-16', YEAR)).toBe(false);
    const parts = partsOf(planAt('2026-10-22'));
    const none = planAt('2026-10-22');
    const priorYear = planAt('2026-10-22', [pay(parts[0], '2026-01-10', 4, { designatedTaxYear: 2025 })]);
    expect(priorYear.pastDue?.installments.map(item => cents(item.balance))).toEqual(none.pastDue?.installments.map(item => cents(item.balance)));
    const current = planAt('2026-10-22', [pay(parts[0], '2026-01-10', 4, { designatedTaxYear: 2026 })]);
    expect(current.pastDue?.installments[0].balance).toBe(0);
    expect(current.pastDue?.installments[0].shortAtDue).toBe(0);
    expect(cents(current.pastDue!.installments[1].balance)).toBe(cents(parts[1]));
    const previous = process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
    process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = 'true';
    try {
      const html = decode(renderToStaticMarkup(createElement(EstimatedPaymentPlannerCard, {
        profile: {}, onNavigate() {}, taxYear: YEAR, asOf: '2026-10-22', initialPhase: 'form',
        initialPayments: [{ clientId: 'jan', date: '2026-01-10', amount: '100' }],
      })));
      expect(html).toContain(PAYMENT_TAX_YEAR_PICKER_LABEL);
      expect(html).not.toContain('Which tax year is this for?');
      const pressed = html.indexOf('aria-pressed="true"');
      expect(html.slice(pressed, pressed + 120)).toContain('2025');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER;
      else process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER = previous;
    }
  });

  it('PD16 treats withholding as four due-date credits', () => {
    const plan = planAt('2026-10-22', [], { withholding: 8500, priorTax: 8500 });
    const rows = plan.pastDue!.installments;
    expect(plan.pastDue?.amount).toBe(0);
    expect(rows.some(item => item.paidLate)).toBe(false);
    expect(rows.slice(0, 3).every(item => item.balance === 0 && item.shortAtDue === 0)).toBe(true);
    expect(rows[3].balance).toBeGreaterThan(0);
    const html = markup(card(plan));
    expect(html).not.toContain(PAST_DUE_LABEL);
    expect(html).not.toContain(PAST_DUE_SENTENCE);
    expect(html).not.toContain(PAID_LATE_SENTENCE);
    expect(html).toContain(plannerFill(PLANNER_ALREADY_COVERED, { nextDueDate: formatPlannerDueDate(plan.nextDue!.dueDate) }));
  });

  it('PD17 locks a filed applied credit to April 15 and clears Q1', () => {
    const asOf = '2026-04-20';
    const parts = partsOf(planAt(asOf));
    const lateDate = planAt(asOf, [pay(parts[0], '2026-06-01', 3, { paymentType: 'prior_year_overpayment', priorReturnFiled: true })]);
    const row = lateDate.pastDue!.installments[0];
    expect(row.shortAtDue).toBe(0);
    expect(row.paidLate).toBe(false);
    expect(row.balance).toBe(0);
    expect(lateDate.pastDue?.amount).toBe(0);
    expect(lateDate.installments[0].paymentsMatched[0]?.effectiveDate).toBe('2026-04-15');
    const html = renderForm({
      asOf, initialPayments: [{ clientId: 'credit', date: '2026-06-01', amount: String(parts[0]), kind: 'prior_year_overpayment', priorReturnFiled: 'yes' }],
    });
    expect(html).toContain(PAYMENT_TYPE_PRIOR_YEAR_OVERPAYMENT_LABEL);
    expect(html).toContain('value="2026-04-15"');
    expect(html).toMatch(/disabled(?:=|\s|>)/);
    expect(html).not.toContain(PAYMENT_TAX_YEAR_PICKER_LABEL);
  });

  it('PD17b saves an applied credit before April 15 and leaves Q1 due at the installment minus the credit', () => {
    const asOf = '2026-03-01';
    const parts = partsOf(planAt(asOf));
    const credit = 500;
    expect(credit).toBeGreaterThan(0);
    expect(credit).toBeLessThan(parts[0]);
    const accepted = validatePlannerForm(form({
      asOf,
      payments: [{ clientId: 'credit', date: '2026-04-15', amount: String(credit), kind: 'prior_year_overpayment', priorReturnFiled: 'yes' }],
    }));
    expect(accepted.errors.map(error => error.message)).not.toContain(dateError);
    expect(accepted.errors).toEqual([]);
    const saved = accepted.parsed?.payments[0];
    expect(saved).toMatchObject({ date: '2026-04-15', amount: credit, kind: 'prior_year_overpayment' });
    const rejected = validatePlannerForm(form({
      asOf, payments: [{ clientId: 'cash', date: '2026-04-15', amount: String(credit), kind: 'estimated' }],
    }));
    expect(rejected.errors.map(error => error.message)).toContain(dateError);
    const plan = planAt(asOf, [pay(saved!.amount, saved!.date, 1, { paymentType: 'prior_year_overpayment', priorReturnFiled: true })]);
    expect(plan.pastDue).toBeNull();
    expect(plan.installments[0].paymentsMatchedTotal).toBeCloseTo(credit, 2);
    expect(plan.installments[0].paymentsMatched[0]?.effectiveDate).toBe('2026-04-15');
    expect(plan.nextDue?.dueDate).toBe('2026-04-15');
    expect(cents(plan.nextDue!.amountToPay)).toBe(cents(parts[0] - credit));
    const view = asPlan(card(plan));
    expect(view.mode).toBe('standard');
    expect(view.next).toBe(plannerFill(PLANNER_NEXT_PAYMENT, { nextAmount: formatPlannerMoney(parts[0] - credit), nextDueDate: 'April 15, 2026' }));
    expect(view.pastDueLine).toBeNull();
    expect(view.paidLate).toBeNull();
    expect(view.q4FileAndPay).toBeNull();
    expect(markup(view)).not.toContain('§6654(h)');
    const extra = 400;
    const larger = parts[0] + extra;
    const covered = planAt(asOf, [pay(larger, '2026-04-15', 1, { paymentType: 'prior_year_overpayment', priorReturnFiled: true })]);
    expect(covered.nextDue?.amountToPay).toBe(0);
    expect(cents(covered.installments[0].overpaymentCarriedOut)).toBe(cents(extra));
    expect(cents(covered.installments[1].overpaymentCarriedIn)).toBe(cents(extra));
    expect(markup(card(covered))).not.toContain(PAST_DUE_LABEL);
  });

  it('PD17c keeps an unfiled credit pending and clears Q1 once the return is filed', () => {
    const asOf = '2026-05-01';
    const parts = partsOf(planAt(asOf));
    const unfiled = validatePlannerForm(form({
      asOf,
      payments: [{ clientId: 'credit', date: '2026-04-15', amount: String(parts[0]), kind: 'prior_year_overpayment', priorReturnFiled: 'no' }],
    }));
    expect(unfiled.errors).toEqual([]);
    expect(unfiled.parsed?.payments).toEqual([]);
    expect(unfiled.parsed?.pendingApplied).toBe(true);
    const blank = validatePlannerForm(form({
      asOf,
      payments: [{ clientId: 'credit', date: '2026-04-15', amount: String(parts[0]), kind: 'prior_year_overpayment', priorReturnFiled: '' }],
    }));
    expect(blank.parsed?.payments).toEqual([]);
    expect(blank.parsed?.pendingApplied).toBe(true);
    const pendingPlan = planAt(asOf, [pay(parts[0], '2026-04-15', 1, { paymentType: 'prior_year_overpayment', priorReturnFiled: false })]);
    expect(cents(pendingPlan.pastDue!.installments[0].shortAtDue)).toBe(cents(parts[0]));
    expect(cents(pendingPlan.pastDue!.amount)).toBe(cents(parts[0]));
    const pending = asPlan(card(pendingPlan, { appliedCreditPending: true }));
    expect(pending.appliedPending).toBe(PLANNER_APPLIED_PENDING);
    expect(pending.pastDueLine).toBe(`${PAST_DUE_LABEL}: ${formatPlannerMoney(parts[0])}`);
    expect(markup(pending)).toContain(PLANNER_APPLIED_PENDING);
    const filed = validatePlannerForm(form({
      asOf,
      payments: [{ clientId: 'credit', date: '2026-04-15', amount: String(parts[0]), kind: 'prior_year_overpayment', priorReturnFiled: 'yes' }],
    }));
    expect(filed.parsed?.pendingApplied).toBe(false);
    const saved = filed.parsed!.payments[0];
    const cleared = planAt(asOf, [pay(saved.amount, saved.date, 1, { paymentType: 'prior_year_overpayment', priorReturnFiled: true })]);
    expect(cents(cleared.pastDue!.installments[0].shortAtDue)).toBe(0);
    expect(cleared.pastDue!.installments[0].paidLate).toBe(false);
    const clearedView = asPlan(card(cleared));
    expect(clearedView.pastDueLine).toBeNull();
    expect(markup(clearedView)).not.toContain(PAST_DUE_LABEL);
    expect(markup(clearedView)).not.toContain(PLANNER_APPLIED_PENDING);
  });

  it('PD17d uses the lowered notice amount for Q1 and does not keep the original', () => {
    const asOf = '2026-04-20';
    const parts = partsOf(planAt(asOf));
    const lowered = 1000;
    expect(lowered).toBeGreaterThan(0);
    expect(lowered).toBeLessThan(parts[0]);
    const first = validatePlannerForm(form({
      asOf,
      payments: [{ clientId: 'credit', date: '2026-04-15', amount: String(parts[0]), kind: 'prior_year_overpayment', priorReturnFiled: 'yes' }],
    }));
    expect(first.parsed?.payments).toHaveLength(1);
    expect(first.parsed?.payments[0].amount).toBe(parts[0]);
    const edited = validatePlannerForm(form({
      asOf,
      payments: [{ clientId: 'credit', date: '2026-06-01', amount: String(lowered), kind: 'prior_year_overpayment', priorReturnFiled: 'yes' }],
    }));
    expect(edited.parsed?.payments).toHaveLength(1);
    expect(edited.parsed?.payments[0]).toMatchObject({ amount: lowered, date: '2026-04-15' });
    expect(edited.parsed?.payments[0].amount).not.toBe(parts[0]);
    const noticed = planAt(asOf, [pay(lowered, '2026-10-01', 1, { paymentType: 'prior_year_overpayment', priorReturnFiled: true })]);
    expect(cents(noticed.installments[0].paymentsMatchedTotal)).toBe(cents(lowered));
    expect(cents(noticed.pastDue!.installments[0].shortAtDue)).toBe(cents(parts[0] - lowered));
    expect(cents(noticed.pastDue!.amount)).toBe(cents(parts[0] - lowered));
    const view = asPlan(card(noticed));
    expect(view.pastDueLine).toBe(`${PAST_DUE_LABEL}: ${formatPlannerMoney(parts[0] - lowered)}`);
    const amountLabel = plannerFill(PLANNER_APPLIED_AMOUNT_LABEL, { priorYear: 2025 });
    const html = renderForm({
      asOf, initialPayments: [{ clientId: 'credit', date: '2026-04-15', amount: String(lowered), kind: 'prior_year_overpayment', priorReturnFiled: 'yes' }],
    });
    expect(html.split(amountLabel).length).toBe(2);
    expect(html).toContain(`value="${lowered}"`);
    expect(html).not.toContain(String(parts[0]));
    expect(html.toLowerCase()).not.toContain('notice');
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.filter(input => input.includes('inputMode="decimal"'))).toHaveLength(6);
    expect(inputs.filter(input => input.includes('type="date"'))).toHaveLength(1);
  });

  it('DR1 to DR5 accept January 1 through April 15 of the next year, and never a later day', () => {
    const message = (asOf: string, date: string) => validatePlannerForm(form({ asOf, payments: [{ clientId: 'p', date, amount: '10' }] })).errors.map(error => error.message);
    expect(message('2026-10-22', '2025-12-31')).toContain(dateError);
    expect(message('2026-10-22', '2026-01-01')).toEqual([]);
    expect(paymentYearChoiceApplies('2026-01-01', YEAR)).toBe(true);
    expect(message('2027-04-16', '2027-04-15')).toEqual([]);
    expect(message('2027-04-20', '2027-04-16')).toContain(dateError);
    expect(message('2026-10-22', '2026-10-23')).toContain(dateError);
    expect(message('2026-10-22', '2026-10-22')).toEqual([]);
  });

  it('LD1 uses the local calendar date when UTC has already moved on', () => {
    const instant = new Date('2027-01-16T04:00:00.000Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2027-01-16');
    expect(calendarIsoDate(instant, 'America/Los_Angeles')).toBe('2027-01-15');
    const view = asPlan(card(planAt('2027-01-15')));
    expect(view.next).toContain('January 15, 2027');
    expect(view.allDueDatesPassed).toBeNull();
    expect(view.q4FileAndPay).toBeNull();
    expect(view.mode).not.toBe('window');
    const route = readFileSync(new URL('../app/api/tax/quarterly-reminders/route.ts', import.meta.url), 'utf8');
    expect(route).toContain('const asOf = isIsoDate(asOfParam) ? asOfParam : localIsoDate()');
    expect(route).not.toContain('new Date().toISOString().slice(0, 10)');
  });
});
