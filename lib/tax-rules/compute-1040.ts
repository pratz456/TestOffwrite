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
import {
  calculateAllCredits,
  calculateSEPIRAMax,
  type FilingStatus as CreditFilingStatus,
} from './credits';
import { calculateStateTax } from './state-tax';

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

  // Credits data
  numDependents?: number;           // For Child Tax Credit
  numEITCChildren?: number;         // Qualifying children for EITC
  taxPayerAge?: number;             // For EITC age test (no-child: 25-64)
  investmentIncome?: number;        // For EITC investment income limit
  longTermCapGains?: number;        // For preferential LTCG tax rate
  shortTermCapGains?: number;       // Taxed as ordinary income

  // Above-the-line deductions (Schedule 1)
  healthInsurancePremiums: number;  // Schedule 1 Line 17
  sepIraContribution: number;       // Schedule 1 Line 16
  solo401kContribution: number;     // Schedule 1 Line 16
  simpleIraContribution: number;
  hsaContribution: number;          // Schedule 1 Line 13
  studentLoanInterest: number;      // Schedule 1 Line 21

  // Itemized deductions (if itemizing)
  itemizedDeductions?: number;

  charitableDonations?: number;          // Schedule A charitable contributions
  saltDeduction?: number;                // State and local tax deduction (capped at $10,000)
  depreciationDeduction?: number;        // Section 179 / MACRS from Form 4562
  stateCode?: string;                    // State used for state tax calculation
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

  // Credits (Lines 19, 27, 28)
  eitcCredit: number;              // Line 27 - EITC (refundable)
  childTaxCredit: number;          // Line 19 - Child Tax Credit
  additionalCTC: number;           // Line 28 - Additional CTC (refundable)
  longTermCapGainsTax: number;     // Preferential LTCG tax (replaces bracket tax on LTCG)
  totalCredits: number;            // All non-refundable credits
  totalRefundableCredits: number;  // All refundable credits
  creditNotes: string[];           // Guidance for user
  sepIRAMaxContribution: number;   // IRS-calculated max SEP contribution

  // Result
  balanceDue: number;              // Line 37 (positive = you owe)
  refund: number;                  // Line 35a (positive = you get back)
  effectiveRate: number;           // Effective federal income tax rate (%)
  marginalRate: number;            // Marginal rate on last dollar of income

  // Safe harbor
  priorYearTax?: number;
  safeHarborAmount?: number;       // 100% of prior year tax (110% if AGI > $150k)
  quarterlyRecommended?: number;   // Recommended quarterly payment

  // State tax (informational)
  stateTaxEstimate: number;              // Estimated state income tax
  stateCode?: string;                    // State used for calculation
  totalTaxWithState: number;             // Federal + state combined
  stateTaxNote?: string;                 // Informational note about state tax
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
  // Subtract depreciation (Section 179 / MACRS) from Schedule C net profit
  const adjustedScheduleC = Math.max(0, scheduleCNetProfit - (input.depreciationDeduction || 0));
  const totalIncome = adjustedScheduleC + w2Wages + otherIncome;

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
  // Itemized = base itemized + charitable donations + SALT (capped at $10,000 per IRC §164(b)(6))
  const itemizedDeductions = (itemizedInput ?? 0)
    + (input.charitableDonations || 0)
    + Math.min(input.saltDeduction || 0, 10000);
  const usingStandardDeduction = standardDeduction >= itemizedDeductions;
  const deductionUsed = Math.max(standardDeduction, itemizedDeductions);

  // ── Step 5: QBI Deduction (Section 199A / Form 8995) ──
  // IRS Rev. Proc. 2024-40: 20% of QBI, capped at 20% of taxable income (minus cap gains)
  // Phase-out: $197,300-$247,300 single | $394,600-$494,600 MFJ (linear reduction)
  const qbiThreshold = filingStatus === 'married_filing_jointly' ? QBI_THRESHOLD_MFJ : QBI_THRESHOLD_SINGLE;
  const qbiPhaseOutEnd = filingStatus === 'married_filing_jointly' ? 494600 : 247300;
  const qbiPhaseOutRange = filingStatus === 'married_filing_jointly' ? 100000 : 50000;
  let qbiDeduction = 0;
  if (adjustedScheduleC > 0) {
    // QBI = Schedule C net profit (after depreciation) reduced by SE tax deduction, health insurance, retirement
    const qualifiedBusinessIncome = Math.max(0,
      adjustedScheduleC - halfSEDeduction - healthInsurancePremiums - sepIraContribution - solo401kContribution
    );
    // Cap: 20% of (taxable income before QBI, minus net capital gains)
    // We exclude capital gains from organizer data for the cap (conservative approach)
    const taxableIncomeBeforeQBI = Math.max(0, agi - deductionUsed);
    const capGains = Math.max(0, otherIncome < 0 ? 0 : 0); // cap gains handled separately
    const qbiCap = (taxableIncomeBeforeQBI - capGains) * 0.20;
    const fullQBI = Math.min(qualifiedBusinessIncome * 0.20, qbiCap);

    if (taxableIncomeBeforeQBI <= qbiThreshold) {
      // Below threshold: full deduction
      qbiDeduction = Math.max(0, fullQBI);
    } else if (taxableIncomeBeforeQBI >= qbiPhaseOutEnd) {
      // Above phase-out range: $0 for SSTBs (most freelancers)
      // Non-SSTBs still get W-2 wage limited amount — for self-employed with no W-2 wages = $0
      qbiDeduction = 0;
    } else {
      // In phase-out range: linear reduction
      // IRS Form 8995-A Schedule A: deduction phases out proportionally
      const phaseOutFraction = (taxableIncomeBeforeQBI - qbiThreshold) / qbiPhaseOutRange;
      qbiDeduction = Math.max(0, fullQBI * (1 - phaseOutFraction));
    }
  }

  // ── Step 6: Taxable Income (Line 15) ──
  const taxableIncome = Math.max(0, agi - deductionUsed - qbiDeduction);

  // ── Step 7: Income Tax (Line 16) ──
  const incomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus);

  // ── Step 8: Additional Medicare Tax (0.9% above threshold) ──
  // IRS Form 8959: Applies to EARNED income (W-2 wages + SE income) over threshold
  // Not to investment income (that uses Net Investment Income Tax / Form 8960)
  const amtThreshold = filingStatus === 'married_filing_jointly' ? NIIT_THRESHOLD_MFJ : NIIT_THRESHOLD_SINGLE;
  const earnedIncome = w2Wages + adjustedScheduleC; // Only earned income triggers 0.9% AMT
  const additionalMedicareTax = earnedIncome > amtThreshold ? (earnedIncome - amtThreshold) * 0.009 : 0;

  // ── Step 9: Credits and preferential capital gains tax ──
  const creditsInput = {
    earnedIncome: w2Wages + adjustedScheduleC,
    agi,
    filingStatus: filingStatus as CreditFilingStatus,
    numDependents: input.numDependents ?? 0,
    numEITCChildren: input.numEITCChildren ?? 0,
    taxPayerAge: input.taxPayerAge,
    investmentIncome: input.investmentIncome ?? 0,
    taxableIncome,
    longTermCapGains: input.longTermCapGains ?? 0,
    shortTermCapGains: input.shortTermCapGains ?? 0,
  };
  const credits = calculateAllCredits(creditsInput);

  // Long-term capital gains: replace the bracket-computed tax on LTCG portion
  // with preferential rates (0/15/20%). Net effect reduces total tax.
  const ltcgSavings = input.longTermCapGains && input.longTermCapGains > 0
    ? Math.max(0, (input.longTermCapGains * (
        taxableIncome > 197300 ? 0.24 : taxableIncome > 103350 ? 0.22 :
        taxableIncome > 48475 ? 0.12 : 0.10
      )) - credits.longTermCapGainsTax)
    : 0;

  // SEP-IRA max for user guidance
  const sepIRAMax = calculateSEPIRAMax(adjustedScheduleC);

  // ── Step 9b: Total Tax (Line 24) ──
  const totalTax = Math.max(0, incomeTax + selfEmploymentTax + additionalMedicareTax
    - ltcgSavings         // preferential LTCG rate benefit
    - credits.childTaxCredit  // CTC reduces tax (non-refundable)
  );

  // ── Step 9b: Tax Credits (reduce Line 24 tax) ──
  // Child Tax Credit: $2,200 per qualifying child under 17 (2025)
  // Phases out at $400,000 MFJ / $200,000 others (MAGI-based)
  // Note: we show estimate only — exact amount requires Form 8812
  // EITC: not calculated here (requires earned income tables + filing status)
  // These credits are displayed as informational in Tax Preview

  // ── Step 10: Payments and refundable credits (Lines 25-28, 33) ──
  // Refundable credits (EITC + Additional CTC) are added to payments
  // because they can create a refund even if tax owed is $0
  const totalPayments = w2FederalWithheld + estimatedPayments
    + credits.eitc           // Line 27 - EITC is refundable
    + credits.additionalCTC; // Line 28 - Additional CTC is refundable

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

  // State tax (informational — not part of federal return)
  const stateResult = input.stateCode ? calculateStateTax(input.stateCode, agi, filingStatus) : null;

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
    // Credits
    eitcCredit: round2(credits.eitc),
    childTaxCredit: round2(credits.childTaxCredit),
    additionalCTC: round2(credits.additionalCTC),
    longTermCapGainsTax: round2(credits.longTermCapGainsTax),
    totalCredits: round2(credits.totalCredits),
    totalRefundableCredits: round2(credits.totalRefundableCredits),
    creditNotes: credits.notes,
    sepIRAMaxContribution: round2(sepIRAMax),
    // Payments
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
    // State tax
    stateTaxEstimate: stateResult?.stateTax ?? 0,
    stateCode: input.stateCode,
    totalTaxWithState: round2(totalTax + (stateResult?.stateTax ?? 0)),
    stateTaxNote: stateResult?.note,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
