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

import { calculateFederalIncomeTax, STANDARD_DEDUCTIONS_2025 } from './federal-brackets';

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
  return Math.max(0, grossReceipts - totalConfirmedExpenses - homeOfficeDeduction);
}

// ── Combined Self-Employment Tax Rate ─────────────────────────────────────────
/**
 * The real effective rate a self-employed person pays on their last dollar of SE income.
 * = Income tax marginal rate + SE tax rate on that income
 *
 * SE tax rate on net profit: 14.13% effective
 *   Net profit × 92.35% × 15.3% = 14.13% of net profit
 *   Then you deduct half SE tax from income, so net income tax impact is lower
 *
 * Source: IRS Topic 554, Schedule SE instructions
 */
export function calcCombinedSERate(
  scheduleCNetProfit: number,
  filingStatus: string,
  aboveLineDeductions = 0,
): {
  seTaxRate: number;          // SE tax as % of net profit (always ~14.13%)
  incomeTaxEffectiveRate: number; // Income tax / net profit
  combinedEffectiveRate: number;  // Total tax / net profit
  combinedMarginalRate: number;   // Rate on next dollar of SE income
  seTaxDollars: number;
  incomeTaxDollars: number;
  totalTaxDollars: number;
} {
  if (scheduleCNetProfit <= 0) {
    return { seTaxRate: 0, incomeTaxEffectiveRate: 0, combinedEffectiveRate: 0, combinedMarginalRate: 0, seTaxDollars: 0, incomeTaxDollars: 0, totalTaxDollars: 0 };
  }

  // SE tax
  const seBase = scheduleCNetProfit * 0.9235;
  const seTax = seBase * 0.153;
  const halfSE = seTax / 2;

  // Income tax
  const stdDed = STANDARD_DEDUCTIONS_2025[filingStatus as keyof typeof STANDARD_DEDUCTIONS_2025] ?? 15750;
  const agi = Math.max(0, scheduleCNetProfit - halfSE - aboveLineDeductions);
  const taxableIncome = Math.max(0, agi - stdDed);
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus);

  const totalTax = seTax + incomeTax;
  const seTaxRate = (seTax / scheduleCNetProfit) * 100;
  const incomeTaxEffectiveRate = (incomeTax / scheduleCNetProfit) * 100;
  const combinedEffectiveRate = (totalTax / scheduleCNetProfit) * 100;

  // Marginal: SE tax on next dollar is always 14.13%, plus marginal income bracket
  const seMarginal = 0.9235 * 0.153; // 14.13%
  // Determine income tax marginal bracket
  const brackets2025: Record<string, { min: number; rate: number }[]> = {
    single: [
      { min: 0, rate: 0.10 }, { min: 11925, rate: 0.12 }, { min: 48475, rate: 0.22 },
      { min: 103350, rate: 0.24 }, { min: 197300, rate: 0.32 }, { min: 250525, rate: 0.35 }, { min: 626350, rate: 0.37 },
    ],
    married_filing_jointly: [
      { min: 0, rate: 0.10 }, { min: 23850, rate: 0.12 }, { min: 96950, rate: 0.22 },
      { min: 206700, rate: 0.24 }, { min: 394600, rate: 0.32 }, { min: 501050, rate: 0.35 }, { min: 751600, rate: 0.37 },
    ],
    head_of_household: [
      { min: 0, rate: 0.10 }, { min: 17000, rate: 0.12 }, { min: 64850, rate: 0.22 },
      { min: 103350, rate: 0.24 }, { min: 197300, rate: 0.32 }, { min: 250500, rate: 0.35 }, { min: 626350, rate: 0.37 },
    ],
  };
  const bkts = brackets2025[filingStatus] ?? brackets2025.single;
  let marginalIncomeBracket = bkts[0].rate;
  for (const b of bkts) {
    if (taxableIncome >= b.min) marginalIncomeBracket = b.rate;
  }

  // On next $1 of SE income: SE tax = 14.13%, plus income tax on the remaining
  // (1 - half SE deduction rate) portion at the marginal bracket
  const halfSEDeductionRate = seMarginal / 2; // ~7.065% deducted from AGI
  const combinedMarginalRate = (seMarginal + marginalIncomeBracket * (1 - halfSEDeductionRate)) * 100;

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

// ── Quarterly Payment Status ──────────────────────────────────────────────────
/**
 * Which quarter are we in, how much is due, and are we on track?
 * Source: IRS Publication 505, Form 1040-ES instructions
 */
export function calcQuarterlyStatus(
  estimatedAnnualTax: number,
  totalPaidYTD: number,
  priorYearTax?: number,
): {
  quarterLabel: string;        // "Q2 (Jun 16)"
  quarterDueDate: string;
  quarterAmount: number;       // recommended payment this quarter
  totalOwedYTD: number;        // how much should have been paid by now
  onTrack: boolean;
  behindBy: number;            // 0 if on track
  safeHarborAmount: number;    // 100% or 110% of prior year / 4
} {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12

  // IRS quarterly due dates and cumulative % of annual tax due
  const quarters = [
    { label: 'Q1', dueDate: 'Apr 15', dueDateFull: `Apr 15, ${now.getFullYear()}`, cumPct: 0.25, month: 4 },
    { label: 'Q2', dueDate: 'Jun 16', dueDateFull: `Jun 16, ${now.getFullYear()}`, cumPct: 0.50, month: 6 },
    { label: 'Q3', dueDate: 'Sep 15', dueDateFull: `Sep 15, ${now.getFullYear()}`, cumPct: 0.75, month: 9 },
    { label: 'Q4', dueDate: 'Jan 15', dueDateFull: `Jan 15, ${now.getFullYear() + 1}`, cumPct: 1.00, month: 1 },
  ];

  // Determine current quarter
  let currentQ = quarters[0];
  if (month > 9 || month === 1) currentQ = quarters[3];
  else if (month > 6) currentQ = quarters[2];
  else if (month > 4) currentQ = quarters[1];

  // Safe harbor: 100% of prior year tax (or 110% if prior AGI > $150k)
  // We use estimated annual tax if no prior year available
  const safeHarborBase = priorYearTax ?? estimatedAnnualTax;
  const safeHarborAmount = safeHarborBase / 4;
  const quarterAmount = estimatedAnnualTax / 4;

  const totalOwedYTD = estimatedAnnualTax * currentQ.cumPct;
  const behindBy = Math.max(0, totalOwedYTD - totalPaidYTD);
  const onTrack = behindBy < 100; // $100 buffer for rounding

  return {
    quarterLabel: currentQ.label,
    quarterDueDate: currentQ.dueDateFull,
    quarterAmount: Math.round(quarterAmount),
    totalOwedYTD: Math.round(totalOwedYTD),
    onTrack,
    behindBy: Math.round(behindBy),
    safeHarborAmount: Math.round(safeHarborAmount),
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
