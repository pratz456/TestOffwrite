/**
 * Shared logic for the public (unauthenticated) planning calculators under /tools.
 * Everything here is a planning estimate: federal only, no credits, no itemized deductions.
 *
 * Sources (reviewed 2026-09-17):
 *   - Schedule SE: 92.35% net-earnings factor, 12.4% OASDI to the wage base, 2.9% Medicare,
 *     $400 filing threshold — https://www.irs.gov/instructions/i1040sse
 *   - OASDI wage base $176,100 (2025) / $184,500 (2026) — https://www.ssa.gov/oact/COLA/cbb.html
 *   - Additional Medicare Tax 0.9% above $200,000 / $250,000 MFJ / $125,000 MFS (not indexed) —
 *     https://www.irs.gov/taxtopics/tc560
 *   - Standard deductions and brackets — Rev. Proc. 2024-40 as amended by P.L. 119-21 (2025) and
 *     Rev. Proc. 2025-32 (2026), via ./federal-year-rules
 *   - QBI threshold and phase-in range — Rev. Proc. 2024-40 §2.27, Rev. Proc. 2025-32 §4.26, P.L. 119-21 §70105
 *   - Estimated tax due dates — https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes
 */
import { calcScheduleSE, type ScheduleSECalculation } from '@/lib/reports/calcSE';
import { getEstimatedTaxDeadline } from '@/lib/tax-provider/payment-deadlines';
import { calculateFederalIncomeTax } from './federal-brackets';
import { getFederalTaxRules, type FederalFilingStatus } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';

/** Years with a complete published parameter set that the public tools may present. */
export const PUBLIC_CALCULATOR_TAX_YEARS = [2025, 2026] as const;
export type PublicCalculatorTaxYear = (typeof PUBLIC_CALCULATOR_TAX_YEARS)[number];

export function isPublicCalculatorTaxYear(value: unknown): value is PublicCalculatorTaxYear {
  return (PUBLIC_CALCULATOR_TAX_YEARS as readonly unknown[]).includes(value);
}

/** Filing status labels shared by the tools; the SE tool historically accepted "married" as a joint alias. */
export const PUBLIC_FILING_STATUSES: readonly { value: FederalFilingStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married_filing_jointly', label: 'Married Filing Jointly' },
  { value: 'married_filing_separately', label: 'Married Filing Separately' },
  { value: 'head_of_household', label: 'Head of Household' },
];

/** §1401(b)(2) thresholds; statutory and not indexed. */
export function additionalMedicareThreshold(filingStatus: string): number {
  const status = normalizeFilingStatus(filingStatus === 'married' ? 'married_filing_jointly' : filingStatus);
  if (status === 'married_filing_jointly') return 250000;
  if (status === 'married_filing_separately') return 125000;
  return 200000;
}

export function socialSecurityWageBase(taxYear: PublicCalculatorTaxYear): number {
  return getFederalTaxRules(taxYear).socialSecurityWageBase;
}

export function standardDeduction(taxYear: PublicCalculatorTaxYear, filingStatus: string): number {
  return getFederalTaxRules(taxYear).standardDeductions[normalizeFilingStatus(filingStatus)];
}

export interface EstimatedTaxDueDate {
  quarter: 1 | 2 | 3 | 4;
  incomePeriod: string;
  /** ISO date (UTC) after weekend and federal-holiday shifts. */
  isoDate: string;
  label: string;
}

/** Individual estimated-tax installment dates for a tax year, shifted for weekends and DC/federal holidays. */
export function estimatedTaxDueDates(taxYear: number): EstimatedTaxDueDate[] {
  const periods = ['Jan 1 – Mar 31', 'Apr 1 – May 31', 'Jun 1 – Aug 31', 'Sep 1 – Dec 31'];
  return ([1, 2, 3, 4] as const).map(quarter => {
    const due = getEstimatedTaxDeadline(taxYear, quarter);
    return {
      quarter,
      incomePeriod: periods[quarter - 1],
      isoDate: due.toISOString().slice(0, 10),
      label: due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    };
  });
}

export interface Public1099EstimateInput {
  grossIncome: number;
  expenses: number;
  w2Wages: number;
  filingStatus: string;
  taxYear: PublicCalculatorTaxYear;
}

export interface Public1099Estimate {
  taxYear: PublicCalculatorTaxYear;
  netProfit: number;
  totalIncome: number;
  agi: number;
  standardDeduction: number;
  qbiDeduction: number;
  /** True when taxable income exceeds the §199A threshold, where the tool conservatively omits QBI. */
  qbiAboveThreshold: boolean;
  taxableIncome: number;
  incomeTax: number;
  seTax: number;
  halfSEDeduction: number;
  /** Form 8959 additional Medicare tax on SE earnings plus any on W-2 wages above the threshold. */
  additionalMedicareTax: number;
  totalTax: number;
  effectiveRate: number;
  /** One quarter of total tax before withholding; a planning figure, not a safe-harbor installment. */
  quarterOfTotalTax: number;
  seBreakdown: ScheduleSECalculation;
}

/** Simplified Form 1040 for a Schedule C filer: standard deduction, QBI below the threshold, no credits. */
export function estimate1099FederalTax(input: Public1099EstimateInput): Public1099Estimate {
  const { taxYear } = input;
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const rules = getFederalTaxRules(taxYear);
  const netProfit = Math.max(0, input.grossIncome - Math.max(0, input.expenses));
  const w2Wages = Math.max(0, input.w2Wages);

  const se = calcScheduleSE({ scheduleCNetProfit: netProfit, taxYear }, filingStatus, w2Wages, w2Wages);

  const totalIncome = netProfit + w2Wages;
  const agi = Math.max(0, totalIncome - se.halfSEDeduction);
  const deduction = rules.standardDeductions[filingStatus];
  const taxableBeforeQBI = Math.max(0, agi - deduction);

  // Below the threshold the deduction is 20% of QBI capped at 20% of taxable income (§199A(a), (b)(2)).
  // Above it, the W-2 wage / UBIA limits and SSTB rules need facts this tool does not collect, so QBI is omitted.
  const qbiAboveThreshold = taxableBeforeQBI > rules.qbiThreshold[filingStatus];
  let qbiDeduction = 0;
  if (netProfit > 0 && !qbiAboveThreshold) {
    const qualifiedBusinessIncome = Math.max(0, netProfit - se.halfSEDeduction);
    qbiDeduction = Math.min(qualifiedBusinessIncome * 0.20, taxableBeforeQBI * 0.20);
  }

  const taxableIncome = Math.max(0, taxableBeforeQBI - qbiDeduction);
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus, taxYear);
  const additionalMedicareTax = se.additionalMedicareTax
    + Math.max(0, w2Wages - additionalMedicareThreshold(filingStatus)) * 0.009;
  const totalTax = incomeTax + se.totalSETax + additionalMedicareTax;

  return {
    taxYear,
    netProfit,
    totalIncome,
    agi,
    standardDeduction: deduction,
    qbiDeduction,
    qbiAboveThreshold,
    taxableIncome,
    incomeTax,
    seTax: se.totalSETax,
    halfSEDeduction: se.halfSEDeduction,
    additionalMedicareTax,
    totalTax,
    effectiveRate: totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0,
    quarterOfTotalTax: totalTax / 4,
    seBreakdown: se,
  };
}
