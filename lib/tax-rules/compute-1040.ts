/**
 * Form 1040 Computation Engine
 * Federal planning estimate for modeled inputs, not a complete return specification.
 * Sources:
 *   - IRS Rev. Proc. 2024-40 (2025 brackets and standard deductions)
 *   - IRS Publication 505 (SE tax, quarterly estimates)
 *   - One Big Beautiful Bill Act P.L. 119-21 (updated standard deductions)
 */

import {
  calculateFederalIncomeTax,
} from './federal-brackets';
import {
  calculateAllCredits,
  calculateLTCGTax,
  calculateSEPIRAMax,
  type FilingStatus as CreditFilingStatus,
} from './credits';
import { calculateStateTax } from './state-tax';

import { getFederalTaxRules, calculateSALTLimit } from './federal-year-rules';

export interface Form1040Input {
  taxYear: number;
  filingStatus: 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';

  // Income sources
  scheduleCNetProfit: number;       // From Schedule C Line 31
  w2Wages: number;                  // Total W-2 Box 1 wages
  w2MedicareWages?: number;         // Total W-2 Box 5; omitted legacy inputs use Box 1 as an approximation
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
  saltDeduction?: number;                // Eligible personal state/local taxes paid; annual cap applied here
  saltModifiedAGI?: number;              // Includes applicable foreign/territory income exclusions; defaults to AGI
  depreciationDeduction?: number;        // Section 179 / MACRS from Form 4562
  stateCode?: string;                    // State used for state tax calculation
}

export interface Form1040Result {
  taxYear: number;
  calculationWarnings: string[];         // Unmodeled situations / missing facts that limit this estimate
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

  const yearRules = getFederalTaxRules(taxYear);
  const calculationWarnings: string[] = [
    'Planning estimate: base standard deduction only; age/blindness, dependent status, spouse itemization, and all return adjustments are not fully modeled.',
  ];

  // ── Step 1: Total Income (Form 1040 Line 9) ──
  // Subtract depreciation (Section 179 / MACRS) from Schedule C net profit
  const adjustedScheduleC = Math.max(0, scheduleCNetProfit - (input.depreciationDeduction || 0));
  if (scheduleCNetProfit - (input.depreciationDeduction || 0) < 0) {
    calculationWarnings.push('Business losses are not applied by this estimate and require separate review.');
  }
  if ((input.numDependents ?? 0) > 0) {
    calculationWarnings.push('Dependent counts do not establish child-credit eligibility. Confirm each child meets the applicable age, relationship, residency, support and Social Security number requirements.');
  }
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
  const standardDeduction = yearRules.standardDeductions[filingStatus];
  // itemizedInput excludes the separately supplied charitable donations and personal SALT.
  const saltLimit = calculateSALTLimit(taxYear, filingStatus, input.saltModifiedAGI ?? agi);
  const itemizedDeductions = (itemizedInput ?? 0)
    + (input.charitableDonations || 0)
    + Math.min(Math.max(0, input.saltDeduction ?? 0), saltLimit);
  const usingStandardDeduction = standardDeduction >= itemizedDeductions;
  const deductionUsed = Math.max(standardDeduction, itemizedDeductions);

  // ── Step 5: QBI Deduction (Section 199A / Form 8995) ──
  // Annual threshold is separate from the ordinary income-tax brackets.
  const qbiThreshold = yearRules.qbiThreshold[filingStatus];
  const qbiPhaseOutRange = yearRules.qbiPhaseInWidth * (filingStatus === 'married_filing_jointly' ? 2 : 1);
  const qbiPhaseOutEnd = qbiThreshold + qbiPhaseOutRange;
  let qbiDeduction = 0;
  if (adjustedScheduleC > 0) {
    // QBI = Schedule C net profit (after depreciation) reduced by SE tax deduction, health insurance, retirement
    const qualifiedBusinessIncome = Math.max(0,
      adjustedScheduleC - halfSEDeduction - healthInsurancePremiums - sepIraContribution - solo401kContribution - simpleIraContribution
    );
    // Cap: 20% of (taxable income before QBI, minus net capital gains)
    // The caller must separately identify net long-term capital gains.
    const taxableIncomeBeforeQBI = Math.max(0, agi - deductionUsed);
    const capGains = Math.max(0, input.longTermCapGains ?? 0);
    const qbiCap = Math.max(0, taxableIncomeBeforeQBI - capGains) * 0.20;
    const fullQBI = Math.min(qualifiedBusinessIncome * 0.20, qbiCap);
    if (taxableIncomeBeforeQBI > qbiThreshold) {
      calculationWarnings.push('QBI above the annual threshold requires business type, business W-2 wages and qualified-property data. The simplified phaseout is not a validated Form 8995-A result.');
    }
    if (taxYear >= 2026 && qualifiedBusinessIncome >= 1000 && fullQBI < 400) {
      calculationWarnings.push('The new active-business minimum QBI deduction requires material-participation facts and is not included.');
    }

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
  // Ordinary long-term gains stack above ordinary taxable income; do not estimate
  // their benefit using one marginal rate. Special 25%/28% gains are not modeled.
  const taxableLongTermGains = Math.min(taxableIncome, Math.max(0, input.longTermCapGains ?? 0));
  const ordinaryIncomeTax = calculateFederalIncomeTax(taxableIncome, filingStatus, taxYear);
  const preferentialTax = calculateFederalIncomeTax(taxableIncome - taxableLongTermGains, filingStatus, taxYear)
    + calculateLTCGTax(taxableLongTermGains, taxableIncome, filingStatus, taxYear);
  const incomeTax = Math.min(ordinaryIncomeTax, preferentialTax);

  // ── Step 8: Additional Medicare Tax (Form 8959) ──
  const amtThreshold = filingStatus === 'married_filing_jointly' ? 250000
    : filingStatus === 'married_filing_separately' ? 125000 : 200000;
  const medicareWages = Math.max(0, input.w2MedicareWages ?? w2Wages);
  const netSE = adjustedScheduleC * 0.9235;
  const medicareSEIncome = netSE >= 400 ? netSE : 0;
  const additionalMedicareTax = Math.max(0, medicareWages - amtThreshold) * 0.009
    + Math.max(0, medicareSEIncome - Math.max(0, amtThreshold - medicareWages)) * 0.009;
  if (input.w2MedicareWages === undefined && w2Wages > 0) {
    calculationWarnings.push('Additional Medicare Tax uses W-2 Box 1 as an approximation because Box 5 Medicare wages were not provided.');
  }

  // ── Step 9: Credits and preferential capital gains tax ──
  const creditsInput = {
    taxYear,
    taxLiabilityBeforeCTC: incomeTax,
    earnedIncome: Math.max(0, w2Wages + adjustedScheduleC - halfSEDeduction),
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

  // Owner-only SEP guidance uses the caller's actual regular-SE deduction.
  const sepIRAMax = calculateSEPIRAMax(adjustedScheduleC, taxYear, halfSEDeduction);

  // CTC reduces available income tax; regular SE / Additional Medicare tax remain.
  const totalTax = round2(Math.max(0, round2(incomeTax) - credits.childTaxCredit)
    + round2(selfEmploymentTax) + round2(additionalMedicareTax));

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
  const brackets = yearRules.brackets[filingStatus];
  let marginalRate = brackets[0].rate * 100;
  for (const bracket of brackets) {
    if (taxableIncome >= bracket.min) marginalRate = bracket.rate * 100;
  }

  // Prior-year tax alone does not establish safe-harbor eligibility, the AGI
  // multiplier or payment timing. Leave recommendations absent until reviewed.
  const safeHarborAmount = undefined;
  const quarterlyRecommended = undefined;
  if (priorYearTax !== undefined) {
    calculationWarnings.push('Quarterly payments require prior-year AGI and return eligibility, a full-year tax/withholding forecast and dated payments. No safe-harbor or quarterly recommendation has been calculated from prior-year tax alone.');
  }

  // State tax (informational — not part of federal return)
  const stateResult = input.stateCode ? calculateStateTax(input.stateCode, agi, filingStatus) : null;
  if (stateResult?.isSupported && stateResult.stateTax > 0) {
    calculationWarnings.push('The state estimate uses a separate simplified calculation that has not been validated for the selected tax year.');
  }

  return {
    taxYear,
    calculationWarnings,
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
