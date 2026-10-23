import type { SafeHarborBasis } from '@/lib/tax-provider/quarterly-planner';
import { getIndividualReturnDueDate } from '@/lib/tax-provider/payment-deadlines';
import { formatPlannerDueDate, formatPlannerMoney, formatPlannerMonthDay } from '@/lib/planner/format-due-date';
import type { PastDueAllocation } from '@/lib/planner/past-due';
import {
  AFTER_PENALTY_END_NOTE, ALL_DUE_DATES_PASSED_SENTENCE, ANNUALIZED_PAST_DUE_NOTE, PAID_LATE_SENTENCE,
  PAST_DUE_LABEL, PAST_DUE_SENTENCE, PER_DUE_DATE_PENALTY_SENTENCE, PER_DUE_DATE_PENALTY_SENTENCE_PAST_DUE,
  PLANNER_ADD_INCOME_PAY_LESS, PLANNER_ADD_INCOME_SEE_IT, PLANNER_ALREADY_COVERED, PLANNER_ANNUAL_CURRENT,
  PLANNER_ANNUAL_PRIOR, PLANNER_APPLIED_PENDING, PLANNER_BASIS_PRIOR, PLANNER_COULD_BE_SMALLER, PLANNER_DE_MINIMIS,
  PLANNER_E1_MESSAGE, PLANNER_FOOTER, PLANNER_INSTALLMENTS_PASSED, PLANNER_MISSING_FACTS, PLANNER_NEXT_PAYMENT,
  PLANNER_NO_TWELVE_MONTH, PLANNER_NOT_SURE, PLANNER_PENALTY_SENTENCE, PLANNER_REMAINING_SHORTFALL,
  PLANNER_ZERO_TARGET_CASE1, PLANNER_ZERO_TARGET_CASE2, Q4_FILE_AND_PAY_SENTENCE, SHOW_AFTER_PENALTY_END_NOTE,
  SHOW_ANNUALIZED_PAST_DUE_NOTE, plannerFill,
} from '@/lib/planner/planner-copy';
import { decidePriorYearZeroTarget, type YesNoBlank } from '@/lib/planner/zero-target';

export interface PlannerResultFacts {
  line24: number;
  credits: number;
  twelveMonth: YesNoBlank | 'not_sure';
  citizenOrResident: YesNoBlank;
  taxYear: number;
  /** True when an income record or projected business income exists. */
  hasCurrentYearFigure: boolean;
  basis?: SafeHarborBasis | null;
  annualAmount?: number | null;
  nextAmount?: number | null;
  nextDueDate?: string | null;
  deMinimisApplies?: boolean;
  deMinimisEvaluated?: boolean;
  missingLabels?: string[];
  /** Oldest-first balances. Absent before the first due date, and on views built without a plan. */
  pastDue?: PastDueAllocation | null;
  /** Overrides SHOW_ANNUALIZED_PAST_DUE_NOTE for tests. The card leaves this unset. */
  showAnnualizedNote?: boolean;
  /** Overrides SHOW_AFTER_PENALTY_END_NOTE for tests. The card leaves this unset. */
  showAfterPenaltyEndNote?: boolean;
  /** An applied credit whose prior-year return is not filed yet. It is not in the math. */
  appliedCreditPending?: boolean;
}

export type PlannerCardView =
  | { kind: 'e1'; message: string; footer: string; hideNinetyPrompt: true }
  | { kind: 'case1'; explanation: string; penalty: string; footer: string; hideNinetyPrompt: true }
  | { kind: 'case2'; message: string; footer: string }
  | { kind: 'no_twelve_month'; message: string; addIncome: string; footer: string }
  | { kind: 'not_sure'; message: string; footer: string }
  | { kind: 'missing'; message: string; footer: string }
  | { kind: 'covered'; annual: string; covered: string; penalty: string; basis: string | null; couldBeSmaller: string | null; addIncome: string | null; deMinimis: string | null; footer: string }
  | {
    kind: 'plan';
    mode: 'standard' | 'past_due' | 'window' | 'paid_late_only' | 'after_final';
    annual: string;
    pastDueLine: string | null;
    pastDueSentence: string | null;
    next: string;
    penalty: string;
    paidLate: string | null;
    annualizedNote: string | null;
    allDueDatesPassed: string | null;
    q4FileAndPay: string | null;
    afterFinalHeading: string | null;
    afterFinalDetail: string | null;
    basis: string | null;
    couldBeSmaller: string | null;
    addIncome: string | null;
    deMinimis: string | null;
    afterPenaltyEndNote: string | null;
    appliedPending: string | null;
    footer: string;
  };

function percentLabel(basis: SafeHarborBasis): '100%' | '110%' {
  return basis === 'prior_year_110' ? '110%' : '100%';
}

function deMinimisLine(facts: PlannerResultFacts): string | null {
  if (facts.basis !== 'current_year_90' || !facts.deMinimisEvaluated || !facts.deMinimisApplies) return null;
  return plannerFill(PLANNER_DE_MINIMIS, { taxYear: facts.taxYear });
}

/**
 * Builds the result the card renders.
 * Rule ZT-HIDE: E1 and case 1 omit both the "could be smaller" line and the "Add this year's income" link.
 */
export function buildPlannerCardView(facts: PlannerResultFacts): PlannerCardView {
  const footer = PLANNER_FOOTER;
  const lastYear = facts.taxYear - 1;
  if (facts.twelveMonth === 'not_sure') {
    return { kind: 'not_sure', message: plannerFill(PLANNER_NOT_SURE, { lastYear }), footer };
  }
  const decision = decidePriorYearZeroTarget({ ...facts, twelveMonth: facts.twelveMonth });
  if (decision.showE1) {
    return { kind: 'e1', message: plannerFill(PLANNER_E1_MESSAGE, { taxYear: facts.taxYear }), footer, hideNinetyPrompt: true };
  }
  if (decision.showCase1) {
    return {
      kind: 'case1',
      explanation: plannerFill(PLANNER_ZERO_TARGET_CASE1, { lastYear }),
      penalty: plannerFill(PLANNER_PENALTY_SENTENCE, { taxYear: facts.taxYear }),
      footer,
      hideNinetyPrompt: true,
    };
  }
  if (decision.showCase2) {
    return { kind: 'case2', message: PLANNER_ZERO_TARGET_CASE2, footer };
  }
  if (decision.showNoTwelveMonth && !facts.hasCurrentYearFigure) {
    return {
      kind: 'no_twelve_month',
      message: plannerFill(PLANNER_NO_TWELVE_MONTH, { lastYear }),
      addIncome: PLANNER_ADD_INCOME_SEE_IT,
      footer,
    };
  }
  if (facts.missingLabels && facts.missingLabels.length > 0 && facts.annualAmount == null) {
    return { kind: 'missing', message: plannerFill(PLANNER_MISSING_FACTS, { list: facts.missingLabels.join(', ') }), footer };
  }
  if (facts.annualAmount == null || facts.basis == null) {
    return { kind: 'missing', message: plannerFill(PLANNER_MISSING_FACTS, { list: facts.missingLabels?.join(', ') || 'this year\'s income' }), footer };
  }
  const priorBasis = facts.basis === 'prior_year_100' || facts.basis === 'prior_year_110';
  const hideNinety = decision.hideNinetyPrompt || (priorBasis && facts.annualAmount === 0);
  const couldBeSmaller = priorBasis && !hideNinety ? PLANNER_COULD_BE_SMALLER : null;
  const addIncome = priorBasis && !hideNinety ? PLANNER_ADD_INCOME_PAY_LESS : null;
  const annual = plannerFill(facts.basis === 'current_year_90' ? PLANNER_ANNUAL_CURRENT : PLANNER_ANNUAL_PRIOR, {
    taxYear: facts.taxYear, annualAmount: formatPlannerMoney(facts.annualAmount),
  });
  const penalty = plannerFill(PLANNER_PENALTY_SENTENCE, { taxYear: facts.taxYear });
  const basis = priorBasis ? plannerFill(PLANNER_BASIS_PRIOR, { percent: percentLabel(facts.basis) }) : null;
  const deMinimis = deMinimisLine(facts);
  const appliedPending = facts.appliedCreditPending ? PLANNER_APPLIED_PENDING : null;
  const shared = { annual, basis, couldBeSmaller, addIncome, footer, appliedPending };
  const pastDueView = facts.pastDue && facts.pastDue.passedDueDates >= 1
    ? pastDuePlan(facts, facts.pastDue, shared)
    : null;
  if (pastDueView) return pastDueView;
  if (facts.nextAmount === 0 && facts.nextDueDate) {
    return {
      kind: 'covered', annual, covered: plannerFill(PLANNER_ALREADY_COVERED, { nextDueDate: formatPlannerDueDate(facts.nextDueDate) }),
      penalty, basis, couldBeSmaller, addIncome, deMinimis, footer,
    };
  }
  const nextDueDate = facts.nextDueDate ? formatPlannerDueDate(facts.nextDueDate) : '';
  const next = facts.nextAmount != null && facts.nextAmount > 0 && nextDueDate
    ? plannerFill(PLANNER_NEXT_PAYMENT, { nextAmount: formatPlannerMoney(facts.nextAmount), nextDueDate })
    : '';
  return {
    kind: 'plan', mode: 'standard', ...shared, pastDueLine: null, pastDueSentence: null, next,
    penalty: next ? plannerFill(PER_DUE_DATE_PENALTY_SENTENCE, { nextDueDate }) : '',
    paidLate: null, annualizedNote: null, allDueDatesPassed: null, q4FileAndPay: null,
    afterFinalHeading: null, afterFinalDetail: null, deMinimis, afterPenaltyEndNote: null,
  };
}

function individualReturnDueLabel(taxYear: number): string {
  return formatPlannerDueDate(getIndividualReturnDueDate(taxYear).toISOString().slice(0, 10));
}

function afterPenaltyNote(facts: PlannerResultFacts, pastDue: PastDueAllocation): string | null {
  if (pastDue.window !== 'w3' || pastDue.remaining <= 0) return null;
  if (!(facts.showAfterPenaltyEndNote ?? SHOW_AFTER_PENALTY_END_NOTE)) return null;
  return plannerFill(AFTER_PENALTY_END_NOTE, { taxYear: facts.taxYear, penaltyEnd: formatPlannerDueDate(pastDue.penaltyEnd) });
}

function pastDuePlan(
  facts: PlannerResultFacts,
  pastDue: PastDueAllocation,
  shared: { annual: string; basis: string | null; couldBeSmaller: string | null; addIncome: string | null; footer: string; appliedPending: string | null },
): PlannerCardView | null {
  const paidLate = pastDue.installments.some(item => item.paidLate);
  const earlierStillOpen = pastDue.installments.some(item => item.n < 4 && item.balance > 0);
  const inWindow = pastDue.window === 'w1' || pastDue.window === 'w2';
  const showPayingNow = pastDue.window === 'open' ? pastDue.amount > 0 : inWindow && pastDue.remaining > 0 && earlierStillOpen;
  const showPaidLate = paidLate && !showPayingNow && pastDue.window !== 'w3' && (pastDue.window === 'open' ? pastDue.amount === 0 : pastDue.remaining === 0);
  const showNote = (facts.showAnnualizedNote ?? SHOW_ANNUALIZED_PAST_DUE_NOTE) && showPayingNow;
  const annualizedNote = showNote ? ANNUALIZED_PAST_DUE_NOTE : null;
  const blank = {
    pastDueLine: null, pastDueSentence: null, next: '', penalty: '', paidLate: null, annualizedNote: null,
    allDueDatesPassed: null, q4FileAndPay: null, afterFinalHeading: null, afterFinalDetail: null, deMinimis: null,
    afterPenaltyEndNote: null,
  };
  if (pastDue.window === 'w3') {
    return {
      kind: 'plan', mode: 'after_final', ...shared, ...blank,
      annual: '',
      afterFinalHeading: plannerFill(PLANNER_INSTALLMENTS_PASSED, { taxYear: facts.taxYear }),
      afterFinalDetail: null,
      deMinimis: null,
      afterPenaltyEndNote: afterPenaltyNote(facts, pastDue),
    };
  }
  if (inWindow && pastDue.remaining === 0 && !showPaidLate) {
    return {
      kind: 'plan', mode: 'after_final', ...shared, ...blank,
      afterFinalHeading: plannerFill(PLANNER_INSTALLMENTS_PASSED, { taxYear: facts.taxYear }),
      afterFinalDetail: plannerFill(PLANNER_REMAINING_SHORTFALL, {
        amount: formatPlannerMoney(pastDue.remaining), returnDueDate: individualReturnDueLabel(facts.taxYear),
      }),
      deMinimis: deMinimisLine(facts),
      afterPenaltyEndNote: afterPenaltyNote(facts, pastDue),
    };
  }
  if (inWindow && pastDue.remaining === 0 && showPaidLate) {
    return { kind: 'plan', mode: 'paid_late_only', ...shared, ...blank, paidLate: PAID_LATE_SENTENCE };
  }
  if (inWindow && pastDue.remaining > 0) {
    const nextDueDate = formatPlannerDueDate(pastDue.q4AltDate);
    return {
      kind: 'plan', mode: 'window', ...shared, ...blank,
      pastDueLine: `${PAST_DUE_LABEL}: ${formatPlannerMoney(pastDue.remaining)}`,
      allDueDatesPassed: plannerFill(ALL_DUE_DATES_PASSED_SENTENCE, { taxYear: facts.taxYear }),
      pastDueSentence: showPayingNow ? PAST_DUE_SENTENCE : null,
      q4FileAndPay: pastDue.window === 'w1'
        ? plannerFill(Q4_FILE_AND_PAY_SENTENCE, { taxYear: facts.taxYear, q4AltDate: nextDueDate, lastDue: formatPlannerMonthDay(pastDue.lastDue) })
        : null,
      annualizedNote,
    };
  }
  if (pastDue.window === 'open' && (pastDue.amount > 0 || showPaidLate)) {
    const nextDueDate = pastDue.nextDueDate ? formatPlannerDueDate(pastDue.nextDueDate) : '';
    const next = pastDue.nextOnly > 0 && nextDueDate
      ? plannerFill(PLANNER_NEXT_PAYMENT, { nextAmount: formatPlannerMoney(pastDue.nextOnly), nextDueDate })
      : '';
    const penalty = !next ? ''
      : pastDue.amount > 0
        ? plannerFill(PER_DUE_DATE_PENALTY_SENTENCE_PAST_DUE, { nextDueDate })
        : plannerFill(PER_DUE_DATE_PENALTY_SENTENCE, { nextDueDate });
    return {
      kind: 'plan', mode: 'past_due', ...shared, ...blank,
      pastDueLine: pastDue.amount > 0 ? `${PAST_DUE_LABEL}: ${formatPlannerMoney(pastDue.amount)}` : null,
      pastDueSentence: showPayingNow ? PAST_DUE_SENTENCE : null,
      next, penalty,
      paidLate: showPaidLate ? PAID_LATE_SENTENCE : null,
      annualizedNote,
    };
  }
  return null;
}
