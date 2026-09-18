import { calc4562, type Asset, type DepreciationElections, type Form4562Calculation } from '@/lib/reports/calc4562';
import { resolveHomeOfficeDeduction, type HomeOfficeResolution, type HomeOfficeSettings } from '@/lib/reports/calc8829';

/** Review codes the shared Schedule C ordering can raise; routes answer them with HTTP 422. */
export const SCHEDULE_C_REVIEW_CODES = ['DEPRECIATION_REVIEW_REQUIRED', 'HOME_OFFICE_REVIEW_REQUIRED'] as const;

/**
 * Duck-typed so routes keep working when a test mocks calc4562/calc8829 (instanceof against
 * a mocked class would throw) and so both errors share one 422 handler.
 */
export function scheduleCReviewCode(error: unknown): (typeof SCHEDULE_C_REVIEW_CODES)[number] | null {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null;
  return SCHEDULE_C_REVIEW_CODES.includes(code as (typeof SCHEDULE_C_REVIEW_CODES)[number]) ? code as (typeof SCHEDULE_C_REVIEW_CODES)[number] : null;
}

export interface ScheduleCProfitInput {
  taxYear: number;
  grossReceipts: number;
  /** Confirmed deductible transaction expenses (aggregateScheduleC totalDeductible). */
  confirmedExpenses: number;
  /** W-2 Box 1 wages; Publication 946 ch. 2 counts employee pay in the §179(b)(3) business-income limit. */
  w2Wages: number;
  assets: readonly Asset[];
  depreciationElections?: DepreciationElections | null;
  homeOffice?: HomeOfficeSettings | null;
  /** Legacy profile.home_office_method, consulted only to detect a claimed-but-unsaved deduction. */
  legacyHomeOfficeMethod?: unknown;
}

export interface ScheduleCProfit {
  /** Gross receipts minus confirmed transaction expenses; the pre-existing `scheduleCNetProfit` figure. */
  profitBeforeAssets: number;
  section179BusinessIncome: number;
  assetCalculation: Form4562Calculation | null;
  /** Reg. §1.263(a)-1(f) items: ordinary expenses on Schedule C, not Form 4562 depreciation. */
  deMinimisExpense: number;
  /** Form 4562 line 22 equivalent (§179 allowed plus regular MACRS). */
  depreciationDeduction: number;
  /** Schedule C line 29 tentative profit: the simplified-method gross income limit. */
  tentativeProfit: number;
  homeOffice: HomeOfficeResolution;
  homeOfficeDeduction: number;
  /** Schedule C line 31 equivalent: the amount Schedule SE, QBI and Form 1040 use. */
  netProfit: number;
  warnings: string[];
}

/**
 * One Schedule C ordering shared by the annual snapshot, the SE loader and the exports:
 * confirmed expenses → de minimis expenses and Form 4562 depreciation (line 13) → line 29
 * tentative profit → home office (line 30) → line 31 net profit.
 * The §179(b)(3) limit uses business income before §179 and before line 30; Form 4562 line 11
 * technically references Schedule C line 31 computed without §179 while the Simplified Method
 * Worksheet line 1 starts from line 29 after §179, which makes the two limits circular. This
 * planning estimate applies §179 first; whenever the §179 income limit binds, line 29 is already
 * at or below zero, so the home office amount is $0 and the ordering cannot overstate either.
 */
export function computeScheduleCProfit(input: ScheduleCProfitInput): ScheduleCProfit {
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const profitBeforeAssets = cents(input.grossReceipts - input.confirmedExpenses);
  const section179BusinessIncome = cents(profitBeforeAssets + input.w2Wages);
  const assetCalculation = input.assets.length
    ? calc4562([...input.assets], section179BusinessIncome, input.taxYear, input.depreciationElections ?? null)
    : null;
  const deMinimisExpense = assetCalculation?.totalDeMinimisExpense ?? 0;
  const depreciationDeduction = assetCalculation?.totalDepreciation ?? 0;
  const tentativeProfit = cents(profitBeforeAssets - deMinimisExpense - depreciationDeduction);
  const homeOffice = resolveHomeOfficeDeduction(input.homeOffice, { taxYear: input.taxYear, grossIncomeLimit: tentativeProfit, legacyMethod: input.legacyHomeOfficeMethod });
  const warnings = [...(assetCalculation?.notes ?? []), ...homeOffice.warnings];
  return {
    profitBeforeAssets, section179BusinessIncome, assetCalculation, deMinimisExpense, depreciationDeduction, tentativeProfit,
    homeOffice, homeOfficeDeduction: homeOffice.deduction, netProfit: cents(tentativeProfit - homeOffice.deduction), warnings,
  };
}
