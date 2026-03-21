/**
 * Form 1040 Computation Engine
 * Calculates the complete federal tax return bottom line for self-employed workers.
 * Sources:
 *   - IRS Rev. Proc. 2024-40 (2025 brackets and standard deductions)
 *   - IRS Publication 505 (SE tax, quarterly estimates)
 *   - One Big Beautiful Bill Act P.L. 119-21 (updated standard deductions)
 */

import {
  FEDERAL_TAX_BRACKETS_2025,
  STANDARD_DEDUCTIONS_2025,
  calculateFederalIncomeTax,
} from './federal-brackets';

// 2025 QBI thresholds (IRS Rev. Proc. 2024-40)
const QBI_THRESHOLD_SINGLE = 197300;
const QBI_THRESHOLD_MFJ = 394600;

// 2025 Additional Medicare Tax threshold
const NIIT_THRESHOLD_SINGLE = 200000;
const NIIT_THRESHOLD_MFJ = 250000;

export interface Form1040Input {
  taxYear: number;
  filingStatus: 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';

  // Income sources
  scheduleCNetProfit: number;       // From Schedule C Line 31
  w2Wages: number;                  // Total W-2 Box 1 wages
  otherIncome?: number;             // Interest, dividends, capital gains, etc.

  // Payments already made
  w2FederalWithheld: number;        // Total W-2 Box 2 withheld
  estimatedPayments: number;        // Quarterly payments made (Form 1040-ES)

  // SE tax (from Schedule SE)
  selfEmploymentTax: number;        // Total SE tax
  halfSEDeduction: number;          // Half of SE tax (Schedule 1 Line 15)

  // Above-the-line deductions (Schedule 1)
  healthInsurancePremiums: number;  // Schedule 1 Line 17
  sepIraContribution: number;       // Schedule 1 Line 16
  solo401kContribution: number;     // Schedule 1 Line 16
  simpleIraContribution: number;
  hsaContribution: number;          // Schedule 1 Line 13
  studentLoanInterest: number;      // Schedule 1 Line 21

  // Itemized deductions (if itemizing)
  itemizedDeductions?: number;
}

export interface Form1040Result {
  // Income lines
  totalIncome: number;              // Line 9 (gross income)
  adjustments: number;             // Schedule 1 above-the-line deductions
  agi: number;                     // Line 11 (Adjusted Gross Income)

  // Deduction
  standardDeduction: number;
  itemizedDeductions: number;
  deductionUsed: number;           // Larger of standard vs itemized
  usingStandardDeduction: boolean;

  // QBI
  qbiDeduction: number;            // Line 13 (Form 8995)

  // Taxable income
  taxableIncome: number;           // Line 15

  // Tax computation
  incomeTax: number;               // Line 16 (from tax table/brackets)
  selfEmploymentTax: number;       // Schedule 2 Line 4
  additionalMedicareTax: number;   // Schedule 2 Line 11
  totalTax: number;                // Line 24

  // Payments
  w2FederalWithheld: number;       // Line 25a
  estimatedPayments: number;       // Line 26
  totalPayments: number;           // Line 33

  // Result
  balanceDue: number;              // Line 37 (positive = you owe)
  refund: number;                  // Line 35a (positive = you get back)
  effectiveRate: number;           // Effective federal income tax rate (%)
  marginalRate: number;            // Marginal rate on last dollar of income

  // Safe harbor
  priorYearTax?: number;
  safeHarborAmount?: number;       // 100% of prior year tax (110% if AGI > $150k)
  quarterlyRecommended?: number;   // Recommended quarterly payment
}

export function compute1040(input: Form1040Input, priorYearTax?: number): Form1040Result {
  const {
    taxYear,
    filingStatus,
    scheduleCNetProfit,
    w2Wages,
    otherIncome = 0,
    w2FederalWithheld,
    estimatedPayments,
    selfEmploymentTax,
    halfSEDeduction,
    healthInsurancePremiums,
    sepIraContribution,
    solo401kContribution,
    simpleIraContribution,
    hsaContribution,
    studentLoanInterest,
    itemizedDeductions: itemizedInput,
  } = input;

  // ── Step 1: Total Income (Form 1040 Line 9) ──
  const totalIncome = scheduleCNetProfit + w2Wages + otherIncome;

  // ── Step 2: Above-the-line adjustments (Schedule 1) ──
  const adjustments = Math.max(0,
    halfSEDeduction +
    healthInsurancePremiums +
    sepIraContribution +
    solo401kContribution +
    simpleIraContribution +
    hsaContribution +
    studentLoanInterest
  );

  // ── Step 3: AGI (Line 11) ──
  const agi = Math.max(0, totalIncome - adjustments);

  // ── Step 4: Standard vs Itemized ──
  const standardDeduction = STANDARD_DEDUCTIONS_2025[filingStatus] ?? 15750;
  const itemizedDeductions = itemizedInput ?? 0;
  const usingStandardDeduction = standardDeduction >= itemizedDeductions;
  const deductionUsed = Math.max(standardDeduction, itemizedDeductions);

  // ── Step 5: QBI Deduction (Section 199A) ──
  const qbiThreshold = filingStatus === 'married_filing_jointly' ? QBI_THRESHOLD_MFJ : QBI_THRESHOLD_SINGLE;
  let qbiDeduction = 0;
  if (scheduleCNetProfit > 0 && agi <= qbiThreshold) {
    qbiDeduction = Math.min(scheduleCNetProfit * 0.20, (agi - deductionUsed) * 0.20);
    qbiDeduction = Math.max(0, qbiDeduction);
  }

  // ── Step 6: Taxable Income (Line 15) ──
  const taxableIncome = Math.max(0, agi - deductionUsed - qbiDeduction);

  // ── Step 7: Income Tax (Line 16) ──
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus);

  // ── Step 8: Additional Medicare Tax (0.9% above threshold) ──
  const amtThreshold = filingStatus === 'married_filing_jointly' ? NIIT_THRESHOLD_MFJ : NIIT_THRESHOLD_SINGLE;
  const additionalMedicareTax = agi > amtThreshold ? (agi - amtThreshold) * 0.009 : 0;

  // ── Step 9: Total Tax (Line 24) ──
  const totalTax = Math.max(0, incomeTax + selfEmploymentTax + additionalMedicareTax);

  // ── Step 10: Payments (Lines 25-26) ──
  const totalPayments = w2FederalWithheld + estimatedPayments;

  // ── Step 11: Balance Due / Refund ──
  const net = totalPayments - totalTax;
  const balanceDue = net < 0 ? Math.abs(net) : 0;
  const refund = net > 0 ? net : 0;

  // ── Effective and marginal rates ──
  const effectiveRate = totalIncome > 0 ? (incomeTax / totalIncome) * 100 : 0;
  const brackets = FEDERAL_TAX_BRACKETS_2025[filingStatus] ?? FEDERAL_TAX_BRACKETS_2025.single;
  let marginalRate = brackets[0].rate * 100;
  for (const bracket of brackets) {
    if (taxableIncome >= bracket.min) marginalRate = bracket.rate * 100;
  }

  // ── Safe harbor ──
  let safeHarborAmount: number | undefined;
  let quarterlyRecommended: number | undefined;
  if (priorYearTax !== undefined && priorYearTax > 0) {
    const multiplier = agi > 150000 ? 1.10 : 1.00;
    safeHarborAmount = priorYearTax * multiplier;
    const remaining = Math.max(0, safeHarborAmount - totalPayments);
    quarterlyRecommended = remaining / 4;
  }

  return {
    totalIncome: round2(totalIncome),
    adjustments: round2(adjustments),
    agi: round2(agi),
    standardDeduction,
    itemizedDeductions,
    deductionUsed,
    usingStandardDeduction,
    qbiDeduction: round2(qbiDeduction),
    taxableIncome: round2(taxableIncome),
    incomeTax: round2(incomeTax),
    selfEmploymentTax: round2(selfEmploymentTax),
    additionalMedicareTax: round2(additionalMedicareTax),
    totalTax: round2(totalTax),
    w2FederalWithheld: round2(w2FederalWithheld),
    estimatedPayments: round2(estimatedPayments),
    totalPayments: round2(totalPayments),
    balanceDue: round2(balanceDue),
    refund: round2(refund),
    effectiveRate: round2(effectiveRate),
    marginalRate: round2(marginalRate),
    priorYearTax,
    safeHarborAmount: safeHarborAmount !== undefined ? round2(safeHarborAmount) : undefined,
    quarterlyRecommended: quarterlyRecommended !== undefined ? round2(quarterlyRecommended) : undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
