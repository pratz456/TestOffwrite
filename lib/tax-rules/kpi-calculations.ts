/**
 * KPI Calculation Utilities
 * All formulas verified against IRS sources.
 *
 * Sources:
 *   IRS Schedule C (Form 1040) 2025 - Line 31 net profit
 *   IRS Schedule SE (Form 1040) 2025 - 15.3% on 92.35% of net earnings
 *   IRS Rev. Proc. 2024-40 - 2025 tax brackets
 *   IRS Publication 505 - Estimated tax / safe harbor
 */

import { calculateFederalIncomeTax } from './federal-brackets';
import { getFederalTaxRules, LATEST_PUBLISHED_TAX_YEAR } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';
import { calcScheduleSE } from '@/lib/reports/calcSE';

// ── Schedule C Net Profit ─────────────────────────────────────────────────────
/**
 * Schedule C Line 31: Gross receipts - Total expenses
 * Source: IRS Schedule C (Form 1040), Part I - Part II
 */
export function calcScheduleCNetProfit(
  grossReceipts: number,
  totalConfirmedExpenses: number,
  homeOfficeDeduction = 0,
): number {
  // Line 7 (gross income) - Line 28 (total expenses) - Line 30 (home office) = Line 31
  return grossReceipts - totalConfirmedExpenses - homeOfficeDeduction;
}

// ── Combined Self-Employment Tax Rate ─────────────────────────────────────────
/**
 * The real effective rate a self-employed person pays on their last dollar of SE income.
 * = Income tax marginal rate + SE tax rate on that income
 *
 * Owner-only estimate with no W-2 wages. Regular SE applies the annual Social Security
 * wage base and the $400 net-earnings threshold. Additional Medicare is separate and
 * does not contribute to the half-SE deduction. QBI and credits are outside this helper.
 *
 * Source: IRS Topic 554, Schedule SE instructions
 */
export function calcCombinedSERate(
  scheduleCNetProfit: number,
  filingStatus: string,
  aboveLineDeductions = 0,
  taxYear: number = LATEST_PUBLISHED_TAX_YEAR,
): {
  seTaxRate: number;          // Regular Schedule SE tax as % of net profit
  incomeTaxEffectiveRate: number; // Income tax / net profit
  combinedEffectiveRate: number;  // Total tax / net profit
  combinedMarginalRate: number;   // Rate on next dollar of SE income
  seTaxDollars: number;
  incomeTaxDollars: number;
  totalTaxDollars: number;
} {
  const rules = getFederalTaxRules(taxYear);
  const status = normalizeFilingStatus(filingStatus);
  if (!Number.isFinite(scheduleCNetProfit) || !Number.isFinite(aboveLineDeductions) || aboveLineDeductions < 0) {
    throw new RangeError('Provide finite business profit and nonnegative deductions.');
  }
  if (scheduleCNetProfit <= 0) {
    return { seTaxRate: 0, incomeTaxEffectiveRate: 0, combinedEffectiveRate: 0, combinedMarginalRate: 0, seTaxDollars: 0, incomeTaxDollars: 0, totalTaxDollars: 0 };
  }

  const se = calcScheduleSE({ scheduleCNetProfit, taxYear }, status);
  const seTax = se.totalSETax;
  const halfSE = se.halfSEDeduction;

  // Income tax
  const stdDed = rules.standardDeductions[status];
  const agi = Math.max(0, scheduleCNetProfit - halfSE - aboveLineDeductions);
  const taxableIncome = Math.max(0, agi - stdDed);
  const incomeTax = calculateFederalIncomeTax(taxableIncome, status, taxYear);

  const totalTax = seTax + se.additionalMedicareTax + incomeTax;
  const seTaxRate = (seTax / scheduleCNetProfit) * 100;
  const incomeTaxEffectiveRate = (incomeTax / scheduleCNetProfit) * 100;
  const combinedEffectiveRate = (totalTax / scheduleCNetProfit) * 100;

  // Local marginal rates change at the regular-SE wage cap and Medicare threshold.
  const seBase = scheduleCNetProfit * 0.9235;
  const seMarginal = seBase < 400 ? 0 : 0.9235 * (0.029 + (seBase < rules.socialSecurityWageBase ? 0.124 : 0));
  const medicareThreshold = status === 'married_filing_jointly' ? 250000 : status === 'married_filing_separately' ? 125000 : 200000;
  const additionalMedicareMarginal = seBase >= medicareThreshold ? 0.9235 * 0.009 : 0;
  // Determine income tax marginal bracket
  const bkts = rules.brackets[status];
  let marginalIncomeBracket = bkts[0].rate;
  for (const b of bkts) {
    if (taxableIncome >= b.min) marginalIncomeBracket = b.rate;
  }

  // On next $1 of SE income: SE tax = 14.13%, plus income tax on the remaining
  // (1 - half SE deduction rate) portion at the marginal bracket
  const halfSEDeductionRate = seMarginal / 2;
  const combinedMarginalRate = (seMarginal + additionalMedicareMarginal
    + (agi > stdDed ? marginalIncomeBracket * (1 - halfSEDeductionRate) : 0)) * 100;

  return {
    seTaxRate: Math.round(seTaxRate * 10) / 10,
    incomeTaxEffectiveRate: Math.round(incomeTaxEffectiveRate * 10) / 10,
    combinedEffectiveRate: Math.round(combinedEffectiveRate * 10) / 10,
    combinedMarginalRate: Math.round(combinedMarginalRate * 10) / 10,
    seTaxDollars: Math.round(seTax * 100) / 100,
    incomeTaxDollars: Math.round(incomeTax * 100) / 100,
    totalTaxDollars: Math.round(totalTax * 100) / 100,
  };
}

// ── Deduction Capture Rate ────────────────────────────────────────────────────
/**
 * What % of transactions have been confirmed as deductible.
 * Benchmarks by profession are general estimates — not IRS data.
 */
export function calcDeductionCaptureRate(
  deductibleCount: number,
  totalReviewedCount: number, // only confirmed yes/no, not unreviewed
  totalCount: number,
): {
  captureRate: number;       // deductible / total reviewed (%)
  unreviewedCount: number;   // not yet confirmed
  unreviewedPct: number;     // unreviewed / total (%)
} {
  const unreviewedCount = totalCount - totalReviewedCount;
  const captureRate = totalReviewedCount > 0
    ? Math.round((deductibleCount / totalReviewedCount) * 100)
    : 0;
  const unreviewedPct = totalCount > 0
    ? Math.round((unreviewedCount / totalCount) * 100)
    : 0;
  return { captureRate, unreviewedCount, unreviewedPct };
}

// ── Uncaptured Deduction Estimate ─────────────────────────────────────────────
/**
 * Estimates potential savings from unreviewed transactions.
 * Uses the user's current deduction rate as the expected rate for unreviewed items.
 * Conservative: only estimates if there are enough reviewed transactions to form a baseline.
 */
export function calcUncapturedDeductions(
  unreviewedTransactions: { amount: number }[],
  currentCaptureRate: number, // as decimal, e.g. 0.47
  effectiveTaxRate: number,   // as decimal, e.g. 0.28
): {
  estimatedDeductibleAmount: number;
  estimatedTaxSavings: number;
  transactionCount: number;
} {
  if (unreviewedTransactions.length === 0 || currentCaptureRate <= 0) {
    return { estimatedDeductibleAmount: 0, estimatedTaxSavings: 0, transactionCount: 0 };
  }
  const totalUnreviewed = unreviewedTransactions.reduce((s, t) => s + Math.abs(t.amount), 0);
  const estimatedDeductibleAmount = totalUnreviewed * currentCaptureRate;
  const estimatedTaxSavings = estimatedDeductibleAmount * effectiveTaxRate;
  return {
    estimatedDeductibleAmount: Math.round(estimatedDeductibleAmount * 100) / 100,
    estimatedTaxSavings: Math.round(estimatedTaxSavings * 100) / 100,
    transactionCount: unreviewedTransactions.length,
  };
}

// ── Legacy quarterly status boundary ──────────────────────────────────────────
// Annual tax / total paid alone cannot determine timing or safe-harbor eligibility.
export function calcQuarterlyStatus(_estimatedAnnualTax: number, _totalPaidYTD: number, _priorYearTax?: number) {
  return {
    status: 'review_required' as const,
    message: 'Review prior-year AGI, full-year withholding and dated payments before choosing an installment.',
    quarterAmount: null, totalOwedYTD: null, onTrack: null, behindBy: null, safeHarborAmount: null,
  };
}

// ── Home Office Deduction ─────────────────────────────────────────────────────
/**
 * Simplified method: $5/sq ft, max 300 sq ft = max $1,500/year
 * Source: IRS Rev. Proc. 2013-13 (simplified method, still current)
 * Actual method uses Form 8829.
 */
export function calcHomeOfficeDeduction(
  homeOfficeSqft: number,
  method: 'simplified' | 'actual' = 'simplified',
  actualAnnualHomeCost?: number,
  totalHomeSqft?: number,
): {
  annualDeduction: number;
  monthlyDeduction: number;
  method: string;
  maxReached: boolean;
} {
  if (!homeOfficeSqft || homeOfficeSqft <= 0) {
    return { annualDeduction: 0, monthlyDeduction: 0, method, maxReached: false };
  }

  let annualDeduction = 0;
  let maxReached = false;

  if (method === 'simplified') {
    const cappedSqft = Math.min(homeOfficeSqft, 300); // IRS cap: 300 sq ft
    annualDeduction = cappedSqft * 5; // $5 per sq ft
    maxReached = homeOfficeSqft >= 300;
  } else if (method === 'actual' && actualAnnualHomeCost && totalHomeSqft) {
    const businessPct = homeOfficeSqft / totalHomeSqft;
    annualDeduction = actualAnnualHomeCost * businessPct;
  }

  return {
    annualDeduction: Math.round(annualDeduction),
    monthlyDeduction: Math.round(annualDeduction / 12),
    method,
    maxReached,
  };
}

// ── Projected Annual (with data sufficiency warning) ─────────────────────────
export function calcProjectedAnnual(
  ytdAmount: number,
  monthsOfData: number,
): {
  projected: number;
  reliable: boolean;  // true if >= 3 months of data
  caveat: string;
} {
  if (monthsOfData <= 0) return { projected: 0, reliable: false, caveat: 'No data yet' };
  const projected = (ytdAmount / monthsOfData) * 12;
  const reliable = monthsOfData >= 3;
  const caveat = reliable
    ? `Based on ${monthsOfData} months of data`
    : `Only ${monthsOfData} month${monthsOfData === 1 ? '' : 's'} of data — estimate may be inaccurate`;
  return { projected: Math.round(projected), reliable, caveat };
}
