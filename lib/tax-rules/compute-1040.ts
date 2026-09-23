/**
 * Form 1040 Computation Engine
 * Federal planning estimate for modeled inputs, not a complete return specification.
 * Sources:
 *   - IRS Rev. Proc. 2024-40 (2025 brackets and standard deductions)
 *   - IRS Publication 505 (SE tax, quarterly estimates)
 *   - One Big Beautiful Bill Act P.L. 119-21 (updated standard deductions; Schedule 1-A deductions in obbba-deductions.ts)
 *   - Schedule C loss treatment (§465/§469/§183/§461(l)) in business-losses.ts
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
import { estimateStateTax, type StateTaxEstimate } from './state';

import { getFederalTaxRules, calculateSALTLimit } from './federal-year-rules';
import { calculateStandardDeduction, calculateEnhancedSeniorDeduction } from './personal-deductions';
import { assertEITCDependencyScope, readNoChildEITCAge } from './credit-scope';
import { calculateAllowedBusinessLoss, type BusinessLossResult } from './business-losses';
import { calculateOBBBADeductions, type OBBBADeductionResult } from './obbba-deductions';
import { QBIReviewRequiredError } from './qbi';
import { assertWageOwnershipScope, TaxCalculationScopeReviewRequiredError } from './calculation-scope';

export interface Form1040Input {
  taxYear: number;
  filingStatus: 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';
  /** Saved taxpayer declarations; annual routes always supply this, even when empty. */
  personalDeductionOrganizer?: Record<string, unknown>;

  // Income sources
  scheduleCNetProfit: number;       // From Schedule C Line 31
  w2Wages: number;                  // Total W-2 Box 1 wages
  w2SocialSecurityWages?: number;   // Boxes 3 + 7; also requires spouse ownership even when Box 1 is zero
  w2MedicareWages?: number;         // Total W-2 Box 5; omitted legacy inputs use Box 1 as an approximation
  otherIncome?: number;             // Interest, dividends, capital gains, etc.

  // Payments already made
  w2FederalWithheld: number;        // Total W-2 Box 2 withheld
  socialSecurityFederalWithheld?: number; // SSA-1099 Box6 / RRB-1099 Box10 (Line25b)
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
  depreciationDeduction?: number;        // Section 179 / MACRS from Form 4562 (Schedule C line 13)
  deMinimisExpense?: number;             // Reg. §1.263(a)-1(f) safe-harbor items expensed on Schedule C, not depreciated
  homeOfficeDeduction?: number;          // Schedule C line 30 (simplified method, Rev. Proc. 2013-13)
  stateCode?: string;                    // Saved state (code or name) for the informational state planning estimate
  taxableSocialSecurityBenefits?: number; // Form 1040 line 6b, already inside otherIncome; excluded by every encoded state
}

export interface Form1040Result {
  taxYear: number;
  calculationWarnings: string[];         // Unmodeled situations / missing facts that limit this estimate
  // Income lines
  totalIncome: number;              // Line 9 (gross income)
  /** Schedule C amount in total income after depreciation and any allowed loss (negative in a loss year). */
  scheduleCAllowed: number;
  businessLoss?: BusinessLossResult;
  adjustments: number;             // Schedule 1 above-the-line deductions
  /** Amounts actually used after modeled limits, for a breakdown that reconciles to adjustments. */
  appliedAdjustments: {
    halfSEDeduction: number;
    healthInsuranceDeduction: number;
    retirementContributions: number;
    hsaDeduction: number;
    studentLoanInterestDeduction: number;
  };
  agi: number;                     // Line 11 (Adjusted Gross Income)

  // Deduction
  standardDeduction: number;
  itemizedDeductions: number;
  deductionUsed: number;           // Larger of standard vs itemized
  usingStandardDeduction: boolean;
  enhancedSeniorDeduction: number;
  qualifiedTipsDeduction: number;          // Schedule 1-A Part II
  qualifiedOvertimeDeduction: number;      // Schedule 1-A Part III
  vehicleLoanInterestDeduction: number;    // Schedule 1-A Part IV
  nonItemizerCharitableDeduction: number;  // §170(p), 2026 onward
  /** Form 1040 line 13b: Schedule 1-A Part VI total, including the enhanced senior deduction. */
  scheduleOneADeductions: number;
  obbbaDeductions?: OBBBADeductionResult;
  personalDeductions?: {
    standard: ReturnType<typeof calculateStandardDeduction>;
    senior: ReturnType<typeof calculateEnhancedSeniorDeduction>;
  };

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
  socialSecurityFederalWithheld: number; // Line25b from SSA/RRB forms
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
  effectiveRate: number;           // Total federal tax (income + SE + Additional Medicare) as % of total income
  marginalRate: number;            // Marginal rate on last dollar of income

  // Safe harbor
  priorYearTax?: number;
  safeHarborAmount?: number;       // 100% of prior year tax (110% if AGI > $150k)
  quarterlyRecommended?: number;   // Recommended quarterly payment

  // State tax (informational)
  stateCode?: string;                    // Resolved state code used for the state planning estimate
  /**
   * Informational state planning estimate ({ supported: true, estimate, components, warnings, sources }
   * or { supported: false, reason }). Never added to totalTax. Null when no state is saved.
   */
  stateTax: StateTaxEstimate | null;
}

/**
 * §162(l)(2)(A) / Form 7206 line 13: the self-employed health insurance deduction
 * cannot exceed the business's net profit (after depreciation) less the deductible
 * half of SE tax and self-employed retirement contributions. Shared with the
 * Pub 915 Social Security worksheet so both use the same allowed amount.
 */
export function limitSelfEmployedHealthInsurance(premiums: number, businessNetProfit: number, halfSEDeduction: number, retirementContributions: number): number {
  const limit = Math.max(0, businessNetProfit - Math.max(0, halfSEDeduction) - Math.max(0, retirementContributions));
  return Math.min(Math.max(0, premiums), limit);
}

/**
 * §223(b): the HSA deduction cannot exceed the annual limit for the account holder's
 * HDHP coverage plus a $1,000 catch-up per spouse age 55+. Coverage type, eligibility
 * months and age are not collected, so the deduction is capped at the highest ceiling
 * (family coverage with catch-up; two catch-ups only on a joint return) and the
 * caller is told when a smaller limit may apply.
 */
export function limitHSADeduction(taxYear: number, filingStatus: Form1040Input['filingStatus'], contribution: number): { deduction: number; ceiling: number; selfOnlyCeiling: number } {
  const limit = getFederalTaxRules(taxYear).hsaContributionLimit;
  const catchUps = filingStatus === 'married_filing_jointly' ? 2 : 1;
  const ceiling = limit.family + limit.catchUp * catchUps;
  const selfOnlyCeiling = limit.selfOnly + limit.catchUp;
  return { deduction: Math.min(Math.max(0, contribution), ceiling), ceiling, selfOnlyCeiling };
}

/** §221(b)(1) per-return limit on deductible student loan interest. */
export const STUDENT_LOAN_INTEREST_LIMIT = 2500;
/** §221(b)(2)(B): the phaseout runs over $15,000 of modified AGI ($30,000 on a joint return); not indexed. */
export const STUDENT_LOAN_PHASEOUT_WIDTH = 15000;
export const STUDENT_LOAN_PHASEOUT_WIDTH_JOINT = 30000;

/**
 * Student Loan Interest Deduction Worksheet (Schedule 1, line 21): interest up to $2,500 (line 1)
 * is reduced by the fraction of the phaseout range used by modified AGI (line 4: total income
 * less the other Schedule 1 adjustments), rounded to three decimals and capped at 1.000 (line 7).
 * §221(e)(2) denies the deduction to married taxpayers filing separately.
 */
export function limitStudentLoanInterest(taxYear: number, filingStatus: Form1040Input['filingStatus'], interestPaid: number, modifiedAGI: number): { deduction: number; limited: number; phaseoutFraction: number; phaseoutStart: number; phaseoutEnd: number } {
  const start = getFederalTaxRules(taxYear).studentLoanInterestPhaseoutStart;
  const joint = filingStatus === 'married_filing_jointly';
  const phaseoutStart = joint ? start.joint : start.single;
  const width = joint ? STUDENT_LOAN_PHASEOUT_WIDTH_JOINT : STUDENT_LOAN_PHASEOUT_WIDTH;
  const limited = Math.min(Math.max(0, interestPaid), STUDENT_LOAN_INTEREST_LIMIT);
  if (filingStatus === 'married_filing_separately') return { deduction: 0, limited, phaseoutFraction: 1, phaseoutStart, phaseoutEnd: phaseoutStart + width };
  const excess = Math.max(0, modifiedAGI - phaseoutStart);
  const phaseoutFraction = Math.min(1, Math.round(excess / width * 1000) / 1000);
  const reduction = Math.round(limited * phaseoutFraction * 100) / 100;
  return { deduction: Math.max(0, Math.round((limited - reduction) * 100) / 100), limited, phaseoutFraction, phaseoutStart, phaseoutEnd: phaseoutStart + width };
}

/**
 * Itemized charitable contributions: the §170(b)(1) ceiling is 60% of AGI (cash to
 * public charities; lower 50%/30% limits apply to other gifts) and, for tax years after
 * 2025, §170(b)(1)(I) first reduces contributions by 0.5% of AGI. Amounts disallowed
 * carry forward five years and are not tracked here.
 */
export function limitItemizedCharitable(taxYear: number, agi: number, donations: number): { deduction: number; floor: number; ceiling: number } {
  const gifts = Math.max(0, donations);
  const floor = taxYear >= 2026 ? Math.round(agi * 0.005 * 100) / 100 : 0;
  const ceiling = Math.round(agi * 0.60 * 100) / 100;
  return { deduction: Math.min(Math.max(0, gifts - floor), ceiling), floor, ceiling };
}

export function compute1040(input: Form1040Input, priorYearTax?: number): Form1040Result {
  const {
    taxYear,
    filingStatus,
    scheduleCNetProfit,
    w2Wages,
    otherIncome = 0,
    w2FederalWithheld,
    socialSecurityFederalWithheld = 0,
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
  const calculationWarnings: string[] = input.personalDeductionOrganizer === undefined
    ? ['Planning estimate: base standard deduction only. Complete Personal Deductions in Tax Organizer before relying on age, blindness, dependency or senior deductions.']
    : ['Planning estimate based on saved eligibility declarations and modeled income. Other deductions, credits and special return rules may require review.'];

  // ── Step 1: Total Income (Form 1040 Line 9) ──
  // Schedule C line 31: subtract de minimis expenses, Form 4562 depreciation (line 13) and the
  // home office deduction (line 30) before SE tax, QBI and Schedule 1 income. A loss offsets
  // other income only with the organizer's at-risk, participation and profit-motive facts
  // (§465, §469, §183) and is capped by §461(l); it is never clamped silently.
  const scheduleCLine31 = scheduleCNetProfit - (input.deMinimisExpense || 0) - (input.depreciationDeduction || 0) - (input.homeOfficeDeduction || 0);
  assertWageOwnershipScope(filingStatus, scheduleCLine31, w2Wages, {
    socialSecurityWages: input.w2SocialSecurityWages, medicareWages: input.w2MedicareWages,
  });
  const scheduleCAfterDepreciation = scheduleCLine31;
  const businessLoss = scheduleCLine31 < 0
    ? calculateAllowedBusinessLoss({ taxYear, filingStatus, netLoss: -scheduleCLine31, organizer: input.personalDeductionOrganizer })
    : undefined;
  const adjustedScheduleC = businessLoss ? -businessLoss.allowedLoss : scheduleCLine31;
  if (businessLoss) calculationWarnings.push(...businessLoss.warnings);
  if ((input.numDependents ?? 0) > 0) {
    calculationWarnings.push('Dependent counts do not establish child-credit eligibility. Confirm each child meets the applicable age, relationship, residency, support and Social Security number requirements.');
  }
  const totalIncome = adjustedScheduleC + w2Wages + otherIncome;

  // ── Step 2: Above-the-line adjustments (Schedule 1) ──
  // §162(l)(2)(A): the self-employed health insurance deduction cannot exceed the
  // business's earned income after the deductible half of SE tax and retirement
  // contributions (Form 7206 limit). Employer-plan eligibility months are not modeled.
  const retirementContributions = Math.max(0, sepIraContribution) + Math.max(0, solo401kContribution) + Math.max(0, simpleIraContribution);
  const healthInsuranceDeduction = limitSelfEmployedHealthInsurance(healthInsurancePremiums, adjustedScheduleC, halfSEDeduction, retirementContributions);
  if (healthInsurancePremiums > healthInsuranceDeduction) {
    calculationWarnings.push('The self-employed health insurance deduction is limited to business earned income after the SE-tax and retirement deductions; the excess is not applied here and may only be usable as an itemized medical expense.');
  }
  // §223(b): HSA deduction capped at the highest possible annual limit (Form 8889 line 13).
  const hsa = limitHSADeduction(taxYear, filingStatus, hsaContribution);
  if (hsaContribution > hsa.deduction) {
    calculationWarnings.push(`The HSA deduction is limited to $${hsa.ceiling.toLocaleString('en-US')} for ${taxYear} (family coverage plus the age-55 catch-up${filingStatus === 'married_filing_jointly' ? ' for each spouse' : ''}); the excess is not deductible and may be subject to the 6% excess-contribution tax (Form 5329).`);
  } else if (hsa.deduction > hsa.selfOnlyCeiling) {
    calculationWarnings.push(`An HSA deduction above $${hsa.selfOnlyCeiling.toLocaleString('en-US')} requires family HDHP coverage for the full year; confirm coverage type and eligibility months on Form 8889 before relying on it.`);
  }
  // §221(b)(1) caps student loan interest at $2,500; §221(e)(2) denies it to married filing separately;
  // §221(b)(2) phases it out over modified AGI (worksheet line 4: total income less the other adjustments).
  const otherAdjustments = halfSEDeduction + healthInsuranceDeduction + retirementContributions + hsa.deduction;
  const studentLoan = limitStudentLoanInterest(taxYear, filingStatus, studentLoanInterest, totalIncome - otherAdjustments);
  const studentLoanInterestDeduction = studentLoan.deduction;
  if (studentLoanInterest > STUDENT_LOAN_INTEREST_LIMIT) calculationWarnings.push('Student loan interest is limited to $2,500 per return.');
  if (studentLoanInterest > 0 && filingStatus === 'married_filing_separately') {
    calculationWarnings.push('Student loan interest is not deductible when married filing separately.');
  } else if (studentLoanInterest > 0 && studentLoan.phaseoutFraction >= 1) {
    calculationWarnings.push(`Student loan interest is fully phased out: modified AGI is at or above $${studentLoan.phaseoutEnd.toLocaleString('en-US')} for ${taxYear} (Schedule 1 line 21 worksheet).`);
  } else if (studentLoanInterest > 0) {
    if (studentLoan.phaseoutFraction > 0) {
      calculationWarnings.push(`Student loan interest is reduced to $${studentLoanInterestDeduction.toLocaleString('en-US')} because modified AGI exceeds $${studentLoan.phaseoutStart.toLocaleString('en-US')} (Schedule 1 line 21 worksheet, ${(studentLoan.phaseoutFraction * 100).toFixed(1)}% of the phaseout range used).`);
    }
    calculationWarnings.push('Student loan interest requires a qualified education loan for you, your spouse or a dependent, and cannot be claimed if you can be claimed as a dependent; confirm eligibility before relying on this deduction.');
  }
  const adjustments = Math.max(0, otherAdjustments + studentLoanInterestDeduction);

  // ── Step 3: AGI (Line 11) ──
  const agiBeforeFloor = totalIncome - adjustments;
  const agi = Math.max(0, agiBeforeFloor);
  if (agiBeforeFloor < 0) {
    calculationWarnings.push(`Total income after adjustments is negative ($${round2(agiBeforeFloor).toLocaleString('en-US')}). A net operating loss may carry forward under section 172 (Publication 536); this estimate shows $0 adjusted gross income and does not compute the NOL.`);
  }

  // ── Step 4: Standard vs Itemized ──
  const personalDeductions = input.personalDeductionOrganizer === undefined ? undefined : {
    standard: calculateStandardDeduction({ taxYear, filingStatus, organizer: input.personalDeductionOrganizer }),
    senior: calculateEnhancedSeniorDeduction({ taxYear, filingStatus, agi, organizer: input.personalDeductionOrganizer }),
  };
  const standardDeduction = personalDeductions?.standard.standardDeduction ?? yearRules.standardDeductions[filingStatus];
  const enhancedSeniorDeduction = personalDeductions?.senior.deduction ?? 0;
  // itemizedInput excludes the separately supplied charitable donations and personal SALT.
  const saltLimit = calculateSALTLimit(taxYear, filingStatus, input.saltModifiedAGI ?? agi);
  const charitable = limitItemizedCharitable(taxYear, agi, input.charitableDonations || 0);
  if ((input.charitableDonations || 0) > charitable.deduction) {
    calculationWarnings.push(taxYear >= 2026
      ? `Itemized charitable contributions are reduced by 0.5% of AGI ($${charitable.floor.toLocaleString('en-US')}) for ${taxYear} and cannot exceed 60% of AGI; disallowed amounts carry forward up to five years (Pub 526).`
      : 'Itemized charitable contributions cannot exceed 60% of AGI (lower 50%/30% limits apply to non-cash gifts); the excess carries forward up to five years (Pub 526).');
  } else if (charitable.deduction > 0.30 * agi) {
    calculationWarnings.push('Charitable contributions above 30% of AGI are deductible in full only for cash gifts to public charities; non-cash and capital-gain property gifts have lower limits (Pub 526).');
  }
  const itemizedDeductions = (itemizedInput ?? 0)
    + charitable.deduction
    + Math.min(Math.max(0, input.saltDeduction ?? 0), saltLimit);
  const usingStandardDeduction = personalDeductions?.standard.standardDeductionAllowed !== false && standardDeduction >= itemizedDeductions;
  const deductionUsed = Math.max(standardDeduction, itemizedDeductions);
  if (personalDeductions?.standard.reason) calculationWarnings.push(personalDeductions.standard.reason);
  const topBracketStart = yearRules.brackets[filingStatus][yearRules.brackets[filingStatus].length - 1].min;

  // ── Step 4b: Schedule 1-A Parts II–IV and §170(p) (below AGI, before the Form 8995 cap) ──
  const obbbaDeductions = input.personalDeductionOrganizer === undefined ? undefined : calculateOBBBADeductions({
    taxYear, filingStatus, agi, scheduleCNetProfit: adjustedScheduleC, usingStandardDeduction, organizer: input.personalDeductionOrganizer,
  });
  if (obbbaDeductions) calculationWarnings.push(...obbbaDeductions.warnings);
  const qualifiedTipsDeduction = obbbaDeductions?.qualifiedTips.deduction ?? 0;
  const qualifiedOvertimeDeduction = obbbaDeductions?.qualifiedOvertime.deduction ?? 0;
  const vehicleLoanInterestDeduction = obbbaDeductions?.vehicleLoanInterest.deduction ?? 0;
  const nonItemizerCharitableDeduction = obbbaDeductions?.nonItemizerCharitable.deduction ?? 0;
  // Form 1040 line 13b is the Schedule 1-A Part VI total (lines 13, 21, 30 and 37).
  const scheduleOneADeductions = enhancedSeniorDeduction + qualifiedTipsDeduction + qualifiedOvertimeDeduction + vehicleLoanInterestDeduction;
  const belowAGIDeductions = deductionUsed + scheduleOneADeductions + nonItemizerCharitableDeduction;

  // ── Step 5: QBI Deduction (Section 199A / Form 8995) ──
  // Annual threshold is separate from the ordinary income-tax brackets.
  const qbiThreshold = yearRules.qbiThreshold[filingStatus];
  let qbiDeduction = 0;
  if (adjustedScheduleC < 0) {
    // §199A(c)(2): a qualified business loss carries forward and reduces the next year's QBI (Form 8995 line 16).
    calculationWarnings.push(`Qualified business income is negative, so no QBI deduction applies this year. The $${round2(-adjustedScheduleC).toLocaleString('en-US')} allowed loss carries forward as a qualified business (loss) that reduces next year's QBI (Form 8995 line 16; section 199A(c)(2)).`);
  } else if (adjustedScheduleC > 0) {
    // QBI = Schedule C net profit (after depreciation) reduced by SE tax deduction, health insurance, retirement.
    // §199A(c)(4)(D): qualified tips deducted under §224 are excluded from QBI.
    const qualifiedBusinessIncome = Math.max(0,
      adjustedScheduleC - halfSEDeduction - healthInsuranceDeduction - retirementContributions - qualifiedTipsDeduction
    );
    // Cap: 20% of (taxable income before QBI, minus net capital gains)
    // The caller must separately identify net long-term capital gains.
    // Form8995 line11 includes the Schedule1-A and §170(p) deductions before its cap.
    const taxableIncomeBeforeQBI = Math.max(0, agi - belowAGIDeductions);
    const capGains = Math.max(0, input.longTermCapGains ?? 0);
    const qbiCap = Math.max(0, taxableIncomeBeforeQBI - capGains) * 0.20;
    const fullQBI = Math.min(qualifiedBusinessIncome * 0.20, qbiCap);
    if (qualifiedBusinessIncome > 0 && taxableIncomeBeforeQBI > qbiThreshold) {
      throw new QBIReviewRequiredError(taxYear, qbiThreshold);
    }
    if (taxYear >= 2026 && qualifiedBusinessIncome >= 1000 && fullQBI < 400) {
      throw new TaxCalculationScopeReviewRequiredError('The 2026 $400 minimum QBI deduction may change this result, but eligibility requires at least $1,000 of aggregate QBI from materially participating active businesses');
    }

    qbiDeduction = Math.max(0, fullQBI);
  }

  // ── Step 6: Taxable Income (Line 15) ──
  const taxableIncome = Math.max(0, agi - belowAGIDeductions - qbiDeduction);
  // §68 applies after other itemized limits and is ignored when determining QBI.
  // Gate only when its statutory comparison would produce a positive reduction.
  if (taxYear >= 2026 && !usingStandardDeduction && itemizedDeductions > 0
    && taxableIncome + itemizedDeductions > topBracketStart) {
    throw new TaxCalculationScopeReviewRequiredError(`The ${taxYear} section 68 reduction changes itemized deductions above the $${topBracketStart.toLocaleString('en-US')} top-bracket threshold`);
  }

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
    taxPayerAge: input.personalDeductionOrganizer !== undefined && (input.numEITCChildren ?? 0) === 0 && filingStatus !== 'married_filing_separately'
      ? readNoChildEITCAge(input.personalDeductionOrganizer, taxYear, filingStatus)
      : input.taxPayerAge,
    investmentIncome: input.investmentIncome ?? 0,
    taxableIncome,
    longTermCapGains: input.longTermCapGains ?? 0,
    shortTermCapGains: input.shortTermCapGains ?? 0,
  };
  const credits = calculateAllCredits(creditsInput);
  // The annual snapshot always supplies organizer facts and requires an
  // eligibility review. Legacy pure callers retain their stated assumptions.
  if (input.personalDeductionOrganizer !== undefined) {
    assertEITCDependencyScope(credits.eitc, personalDeductions?.standard.dependentLimitationApplied ?? false);
  }

  // Owner-only SEP guidance uses the caller's actual regular-SE deduction.
  const sepIRAMax = calculateSEPIRAMax(adjustedScheduleC, taxYear, halfSEDeduction);

  // CTC reduces available income tax; regular SE / Additional Medicare tax remain.
  const totalTax = round2(Math.max(0, round2(incomeTax) - credits.childTaxCredit)
    + round2(selfEmploymentTax) + round2(additionalMedicareTax));

  // ── Step 10: Payments and refundable credits (Lines 25-28, 33) ──
  // Refundable credits (EITC + Additional CTC) are added to payments
  // because they can create a refund even if tax owed is $0
  const totalPayments = w2FederalWithheld + socialSecurityFederalWithheld + estimatedPayments
    + credits.eitc           // Line 27 - EITC is refundable
    + credits.additionalCTC; // Line 28 - Additional CTC is refundable

  // ── Step 11: Balance Due / Refund ──
  const net = totalPayments - totalTax;
  const balanceDue = net < 0 ? Math.abs(net) : 0;
  const refund = net > 0 ? net : 0;

  // ── Effective and marginal rates ──
  // Freelancers pay SE tax as well; the effective rate reflects total federal tax on total income.
  const effectiveRate = totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0;
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

  // State tax (informational — not part of the federal return and never added to totalTax).
  // Supported state-years come from the department-of-revenue registry with their own warnings;
  // unsupported state-years keep the federal-level warning that no validated state estimate exists.
  const stateTax = input.stateCode?.trim()
    ? estimateStateTax({
      stateCode: input.stateCode, taxYear, filingStatus, federalAGI: agi,
      scheduleCNetProfit: scheduleCLine31, w2Wages, otherIncome,
      hsaContribution, taxableSocialSecurityBenefits: input.taxableSocialSecurityBenefits, dependents: input.numDependents ?? 0,
    })
    : null;
  if (stateTax && !stateTax.supported) {
    calculationWarnings.push(`The ${stateTax.stateName} state estimate has not been validated for tax year ${taxYear} and is not shown: ${stateTax.reason}`);
  }

  return {
    taxYear,
    calculationWarnings,
    totalIncome: round2(totalIncome),
    scheduleCAllowed: round2(adjustedScheduleC),
    businessLoss,
    adjustments: round2(adjustments),
    appliedAdjustments: {
      halfSEDeduction: round2(halfSEDeduction),
      healthInsuranceDeduction: round2(healthInsuranceDeduction),
      retirementContributions: round2(retirementContributions),
      hsaDeduction: round2(hsa.deduction),
      studentLoanInterestDeduction: round2(studentLoanInterestDeduction),
    },
    agi: round2(agi),
    standardDeduction,
    itemizedDeductions,
    deductionUsed,
    usingStandardDeduction,
    enhancedSeniorDeduction: round2(enhancedSeniorDeduction),
    qualifiedTipsDeduction: round2(qualifiedTipsDeduction),
    qualifiedOvertimeDeduction: round2(qualifiedOvertimeDeduction),
    vehicleLoanInterestDeduction: round2(vehicleLoanInterestDeduction),
    nonItemizerCharitableDeduction: round2(nonItemizerCharitableDeduction),
    scheduleOneADeductions: round2(scheduleOneADeductions),
    obbbaDeductions,
    personalDeductions,
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
    socialSecurityFederalWithheld: round2(socialSecurityFederalWithheld),
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
    stateCode: stateTax?.stateCode || undefined,
    stateTax,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
