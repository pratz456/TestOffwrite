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
  /** W-2 Box 1 wages included in the AGI sum. Not the Social Security wage base. */
  w2Wages: number;
  otherIncome: number;
  /**
   * The taxpayer's own W-2 Box 3 Social Security wages. This is the only amount
   * applied to the Social Security wage base. Omit it and the wage base is
   * unreduced; Box 1 is not a substitute, and a spouse's wages are not included.
   */
  w2SocialSecurityWages?: number;
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
 * Box 1 wages stay in the AGI sum. The Social Security wage-base cap uses
 * `w2SocialSecurityWages` (the taxpayer's own Box 3) and nothing else.
 */
export function federalAgiForStateEstimate(input: StatePlanningFederalAgiInput): number {
  const profit = finite(input.scheduleCNetProfit);
  const w2Wages = finite(input.w2Wages);
  const otherIncome = finite(input.otherIncome);
  const ownSocialSecurityWages = Math.max(0, finite(input.w2SocialSecurityWages ?? 0));
  const gross = profit + w2Wages + otherIncome;
  if (profit <= 0 || !stateUsesFederalAgiIncomeBase(input.stateCode, input.taxYear)) return round2(gross);
  const halfSEDeduction = calcScheduleSE(
    { scheduleCNetProfit: profit, taxYear: input.taxYear },
    'single',
    ownSocialSecurityWages,
  ).halfSEDeduction;
  return round2(gross - halfSEDeduction);
}
