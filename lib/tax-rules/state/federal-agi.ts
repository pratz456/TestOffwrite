import { calcScheduleSE } from '@/lib/reports/calcSE';
import { getStateYearRules, isSupportedStateYear } from './registry';

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (value: number) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * True when this state-year starts from federal AGI, so the Schedule 1 line 15
 * deduction belongs in the planning AGI. Flat-rate states declare that with
 * `incomeBase: 'federal_agi'` (Georgia, Illinois, North Carolina). California
 * and New York also start from federal AGI but do not carry that field.
 * Pennsylvania (`pa_income_classes`), Ohio, and no-income-tax states do not.
 */
export function stateUsesFederalAgiIncomeBase(stateCode: string, taxYear: number): boolean {
  const rules = getStateYearRules(stateCode, taxYear);
  if (!isSupportedStateYear(rules)) return false;
  if (rules.kind === 'flat') return rules.incomeBase === 'federal_agi';
  return rules.kind === 'california' || rules.kind === 'new_york';
}

export interface StatePlanningFederalAgiInput {
  stateCode: string;
  taxYear: number;
  scheduleCNetProfit: number;
  w2Wages: number;
  otherIncome: number;
}

/**
 * Planning federal AGI for the state calculator: Schedule C profit + W-2 wages
 * + other income, minus one-half of regular self-employment tax when the state
 * taxes federal AGI.
 *
 * The deduction is Schedule SE line 13 / Schedule 1 line 15 (IRC §164(f)),
 * taken from `calcScheduleSE().halfSEDeduction` — the same helper
 * `buildFederalTaxSnapshot` calls. Net earnings under $400 produce no
 * self-employment tax in that helper, so the deduction is zero. Zero or
 * negative Schedule C profit also produces no deduction.
 *
 * `w2Wages` is the screen's Box 1 amount, passed through as W-2 Social
 * Security wages for the wage-base cap. The screen does not collect Box 3.
 */
export function federalAgiForStateEstimate(input: StatePlanningFederalAgiInput): number {
  const profit = finite(input.scheduleCNetProfit);
  const w2Wages = finite(input.w2Wages);
  const otherIncome = finite(input.otherIncome);
  const gross = profit + w2Wages + otherIncome;
  if (profit <= 0 || !stateUsesFederalAgiIncomeBase(input.stateCode, input.taxYear)) return round2(gross);
  const halfSEDeduction = calcScheduleSE(
    { scheduleCNetProfit: profit, taxYear: input.taxYear },
    'single',
    Math.max(0, w2Wages),
  ).halfSEDeduction;
  return round2(gross - halfSEDeduction);
}
