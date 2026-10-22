import type { SafeHarborBasis } from '@/lib/tax-provider/quarterly-planner';
import { formatPlannerDueDate, formatPlannerMoney } from '@/lib/planner/format-due-date';
import {
  PLANNER_ADD_INCOME_PAY_LESS, PLANNER_ADD_INCOME_SEE_IT, PLANNER_ALREADY_COVERED, PLANNER_ANNUAL_CURRENT,
  PLANNER_ANNUAL_PRIOR, PLANNER_BASIS_PRIOR, PLANNER_COULD_BE_SMALLER, PLANNER_DE_MINIMIS, PLANNER_E1_MESSAGE,
  PLANNER_FOOTER, PLANNER_MISSING_FACTS, PLANNER_NEXT_PAYMENT, PLANNER_NO_TWELVE_MONTH, PLANNER_NOT_SURE,
  PLANNER_PENALTY_SENTENCE, PLANNER_ZERO_TARGET_CASE1, PLANNER_ZERO_TARGET_CASE2, plannerFill,
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
}

export type PlannerCardView =
  | { kind: 'e1'; message: string; footer: string; hideNinetyPrompt: true }
  | { kind: 'case1'; explanation: string; penalty: string; footer: string; hideNinetyPrompt: true }
  | { kind: 'case2'; message: string; footer: string }
  | { kind: 'no_twelve_month'; message: string; addIncome: string; footer: string }
  | { kind: 'not_sure'; message: string; footer: string }
  | { kind: 'missing'; message: string; footer: string }
  | { kind: 'covered'; annual: string; covered: string; penalty: string; basis: string | null; couldBeSmaller: string | null; addIncome: string | null; deMinimis: string | null; footer: string }
  | { kind: 'plan'; annual: string; next: string; penalty: string; basis: string | null; couldBeSmaller: string | null; addIncome: string | null; deMinimis: string | null; footer: string };

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
  if (facts.nextAmount === 0 && facts.nextDueDate) {
    return {
      kind: 'covered', annual, covered: plannerFill(PLANNER_ALREADY_COVERED, { nextDueDate: formatPlannerDueDate(facts.nextDueDate) }),
      penalty, basis, couldBeSmaller, addIncome, deMinimis, footer,
    };
  }
  const next = facts.nextAmount != null && facts.nextDueDate
    ? plannerFill(PLANNER_NEXT_PAYMENT, { nextAmount: formatPlannerMoney(facts.nextAmount), nextDueDate: formatPlannerDueDate(facts.nextDueDate) })
    : '';
  return { kind: 'plan', annual, next, penalty, basis, couldBeSmaller, addIncome, deMinimis, footer };
}
