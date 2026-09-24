/**
 * Federal credits estimator — published 2024–2026 parameters
 * Sources:
 *   - IRS Rev. Proc. 2024-40 (EITC amounts and phase-out thresholds)
 *   - IRS Publication 596 (EITC rules)
 *   - IRS Schedule 8812 and instructions (Child Tax Credit)
 *   - One Big Beautiful Bill Act P.L. 119-21 (CTC $2,200, OBBB changes)
 *   - IRS Rev. Proc. 2023-34 and 2025-32 (2024 and 2026 annual amounts)
 */

import { getFederalTaxRules, LATEST_PUBLISHED_TAX_YEAR } from './federal-year-rules';
import { calculateFederalIncomeTax } from './federal-brackets';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilingStatus =
  | 'single'
  | 'married_filing_jointly'
  | 'married_filing_separately'
  | 'head_of_household';

export interface CreditInput {
  taxYear?: number;             // Omitted calls use the latest complete published parameter set
  taxLiabilityBeforeCTC?: number; // Credit Limit Worksheet A, after other nonrefundable credits; excludes regular SE tax
  earnedIncome: number;        // W-2 wages + net SE income (Schedule C profit)
  agi: number;                 // Adjusted Gross Income (Line 11)
  filingStatus: FilingStatus;
  numDependents: number;       // qualifying children under 17 for CTC
  numEITCChildren: number;     // qualifying children for EITC (under 19, or 24 if student)
  taxPayerAge?: number;        // for EITC no-child age requirement (25-64)
  investmentIncome?: number;   // interest + dividends + cap gains (EITC disqualifier)
  taxableIncome: number;       // for capital gains rate determination
  shortTermCapGains?: number;  // taxed as ordinary income
  longTermCapGains?: number;   // taxed at 0/15/20%
}

export interface CreditResult {
  eitc: number;                // Earned Income Tax Credit (refundable)
  eitcEligible: boolean;
  eitcDisqualifier?: string;   // reason if not eligible

  childTaxCredit: number;      // Allowed nonrefundable CTC, limited by available income tax
  additionalCTC: number;       // Refundable portion (up to $1,700/child)
  ctcEligible: boolean;

  longTermCapGainsTax: number; // Tax on long-term capital gains (0/15/20%)
  shortTermCapGainsTax: number;// Taxed as ordinary income (already in bracket calc)

  totalCredits: number;        // Nonrefundable CTC only; EITC belongs in refundable credits
  totalRefundableCredits: number; // Credits that can create refund even if $0 tax

  notes: string[];             // IRS guidance notes shown to user
}

// Continuing Schedule 8812 mechanics. The annual per-child limits live in the year registry.
const CTC_PHASE_OUT_THRESHOLD_MFJ = 400000;
const CTC_PHASE_OUT_THRESHOLD_SINGLE = 200000;
const CTC_PHASE_OUT_RATE = 50;
const CTC_EARNED_INCOME_MIN = 2500;

// ── EITC Calculator ───────────────────────────────────────────────────────────

export function calculateEITC(input: CreditInput): { amount: number; eligible: boolean; disqualifier?: string } {
  const {
    earnedIncome,
    agi,
    filingStatus,
    numEITCChildren,
    taxPayerAge,
    investmentIncome = 0,
  } = input;

  const year = getFederalTaxRules(input.taxYear ?? LATEST_PUBLISHED_TAX_YEAR);

  // Cannot file MFS (with limited exceptions we don't model)
  if (filingStatus === 'married_filing_separately') {
    return { amount: 0, eligible: false, disqualifier: 'MFS EITC requires separated-spouse eligibility rules that this estimator does not model' };
  }

  // Must have at least $1 of earned income
  if (earnedIncome <= 0) {
    return { amount: 0, eligible: false, disqualifier: 'Must have earned income to qualify for EITC' };
  }

  // Age requirement for no-child EITC: must be 25-64
  if (numEITCChildren === 0) {
    if (taxPayerAge === undefined) return { amount: 0, eligible: false, disqualifier: 'Age is required to estimate EITC without qualifying children' };
    if (taxPayerAge < 25 || taxPayerAge > 64) {
      return { amount: 0, eligible: false, disqualifier: 'Without qualifying children, must be age 25-64' };
    }
  }

  // Investment-income limit for the selected tax year
  if (investmentIncome > year.eitcInvestmentIncomeLimit) {
    return {
      amount: 0,
      eligible: false,
      disqualifier: `Investment income ($${investmentIncome.toLocaleString()}) exceeds $${year.eitcInvestmentIncomeLimit.toLocaleString()} limit`,
    };
  }

  const childKey = Math.min(Math.max(0, Math.floor(numEITCChildren)), 3) as 0 | 1 | 2 | 3;
  const config = year.eitc[childKey];
  const isMFJ = filingStatus === 'married_filing_jointly';

  // Phase-in: credit = earned income × phase-in rate, capped at max
  const phaseInCredit = Math.min(earnedIncome * config.phaseInRate, config.maxCredit);

  // Phase-out: use the HIGHER of earned income or AGI (IRS rule)
  const incomeForPhaseOut = Math.max(earnedIncome, agi);
  const phaseOutStart = isMFJ ? config.phaseOutStartMFJ : config.phaseOutStart;
  const phaseOutEnd = isMFJ ? config.phaseOutEndMFJ : config.phaseOutEnd;

  if (incomeForPhaseOut >= phaseOutEnd) {
    return { amount: 0, eligible: false, disqualifier: 'Income exceeds EITC limit' };
  }

  let credit = phaseInCredit;
  if (incomeForPhaseOut > phaseOutStart) {
    const reduction = (incomeForPhaseOut - phaseOutStart) * config.phaseOutRate;
    credit = Math.min(phaseInCredit, Math.max(0, config.maxCredit - reduction));
  }

  return { amount: Math.round(credit * 100) / 100, eligible: credit > 0 };
}

// ── Child Tax Credit Calculator ───────────────────────────────────────────────

export function calculateCTC(input: CreditInput): { ctc: number; actc: number } {
  const { agi, earnedIncome, filingStatus, numDependents } = input;
  const year = getFederalTaxRules(input.taxYear ?? LATEST_PUBLISHED_TAX_YEAR);

  if (numDependents <= 0) return { ctc: 0, actc: 0 };

  const threshold = filingStatus === 'married_filing_jointly'
    ? CTC_PHASE_OUT_THRESHOLD_MFJ
    : CTC_PHASE_OUT_THRESHOLD_SINGLE;

  // Base credit
  let baseCTC = Math.floor(numDependents) * year.childTaxCreditPerChild;

  // Phase-out: $50 reduction per $1,000 (or fraction) over threshold
  if (agi > threshold) {
    const excess = agi - threshold;
    const reduction = Math.ceil(excess / 1000) * CTC_PHASE_OUT_RATE;
    baseCTC = Math.max(0, baseCTC - reduction);
  }

  // Schedule 8812 lines 12–17: use the credit against income tax first. Only
  // the unused credit can qualify for ACTC; CTC must not offset Schedule 2 SE tax.
  // A direct legacy call may omit the worksheet liability; ordinary bracket tax
  // is then only an estimate. compute1040 supplies its tax after LTCG treatment.
  const availableTax = Math.max(0, input.taxLiabilityBeforeCTC
    ?? calculateFederalIncomeTax(input.taxableIncome, filingStatus, year.taxYear));
  const ctc = Math.min(baseCTC, availableTax);
  const unusedCredit = Math.max(0, baseCTC - ctc);
  const refundableBase = Math.max(0, earnedIncome - CTC_EARNED_INCOME_MIN) * 0.15;
  const maxACTC = Math.floor(numDependents) * year.refundableChildTaxCreditPerChild;
  const actc = Math.min(unusedCredit, refundableBase, maxACTC);

  // Ordinary earned-income method only. The alternate Social Security method for
  // three or more children / Puerto Rico needs additional inputs and is not modeled.
  return { ctc: Math.round(ctc * 100) / 100, actc: Math.round(actc * 100) / 100 };
}

// ── Long-Term Capital Gains Tax ───────────────────────────────────────────────

export function calculateLTCGTax(
  longTermGains: number,
  taxableIncome: number,
  filingStatus: FilingStatus,
  taxYear: number = LATEST_PUBLISHED_TAX_YEAR,
): number {
  const [zeroRateEnd, fifteenRateEnd] = getFederalTaxRules(taxYear).capitalGainsThresholds[filingStatus];
  if (longTermGains <= 0 || taxableIncome <= 0) return 0;
  const brackets = [
    { min: 0, max: zeroRateEnd, rate: 0 },
    { min: zeroRateEnd, max: fifteenRateEnd, rate: 0.15 },
    { min: fifteenRateEnd, max: Infinity, rate: 0.20 },
  ];
  // LTCG rates apply to the LTCG portion of taxable income
  // Ordinary income "fills up" the brackets first
  const ordinaryIncome = Math.max(0, taxableIncome - longTermGains);
  let ltcgTax = 0;

  for (const bracket of brackets) {
    const bracketStart = Math.max(bracket.min, ordinaryIncome);
    const bracketEnd = bracket.max;
    if (bracketStart >= bracketEnd) continue;

    const gainableInBracket = Math.min(taxableIncome, bracketEnd) - bracketStart;
    if (gainableInBracket <= 0) continue;

    // Only tax the portion that overlaps with LTCG
    const ltcgInBracket = Math.min(gainableInBracket, longTermGains);
    ltcgTax += ltcgInBracket * bracket.rate;
  }

  return Math.round(Math.max(0, ltcgTax) * 100) / 100;
}

// ── SEP-IRA Limit Calculator ─────────────────────────────────────────────────

/**
 * Owner-only sole-proprietor SEP with a 25% plan rate: reduced rate = .25/1.25 = .20.
 * IRS Publication 560, chapter 5. This is not the remaining combined-plan limit.
 * Supply the actual deductible half of regular SE tax when wages/other SE income exist.
 * Legacy one-argument calls use the latest published year and assume no Social Security wages/other businesses.
 */
export function calculateSEPIRAMax(
  scheduleC_netProfit: number,
  taxYear: number = LATEST_PUBLISHED_TAX_YEAR,
  halfSEDeduction?: number,
): number {
  const year = getFederalTaxRules(taxYear);
  if (scheduleC_netProfit <= 0) return 0;
  const seBase = scheduleC_netProfit * 0.9235;
  const regularSETax = seBase < 400 ? 0
    : Math.min(seBase, year.socialSecurityWageBase) * 0.124 + seBase * 0.029;
  const halfSE = halfSEDeduction ?? regularSETax / 2;
  const netSEEarnings = Math.max(0, scheduleC_netProfit - Math.max(0, halfSE));
  return Math.round(Math.min(netSEEarnings * 0.20, year.sepContributionLimit) * 100) / 100;
}

// ── Main Credit Calculator ────────────────────────────────────────────────────

export function calculateAllCredits(input: CreditInput): CreditResult {
  const notes: string[] = [];

  // EITC
  const eitcResult = calculateEITC(input);
  if (!eitcResult.eligible && eitcResult.disqualifier) {
    if (input.earnedIncome < 70000) notes.push(`EITC: ${eitcResult.disqualifier}`);
  }
  if (eitcResult.eligible && eitcResult.amount > 0) {
    const scheduleNote = input.numEITCChildren > 0 ? ' Qualifying-child claims require Schedule EIC.' : '';
    notes.push(`EITC estimate (eligibility and IRS table must be confirmed): $${eitcResult.amount.toLocaleString()}.${scheduleNote}`);
  }

  if (input.numDependents >= 3) {
    notes.push('ACTC uses the earned-income method only. Three or more qualifying children may require the alternate Schedule 8812 calculation.');
  }

  // CTC
  const ctcResult = calculateCTC(input);
  if (ctcResult.ctc > 0 || ctcResult.actc > 0) {
    notes.push(`Child Tax Credit: $${ctcResult.ctc.toLocaleString()} (non-refundable) + $${ctcResult.actc.toLocaleString()} Additional CTC (refundable)`);
  }

  // Long-term capital gains
  const ltcgTax = calculateLTCGTax(
    input.longTermCapGains ?? 0,
    input.taxableIncome,
    input.filingStatus,
    input.taxYear ?? LATEST_PUBLISHED_TAX_YEAR
  );

  if ((input.longTermCapGains ?? 0) > 0) {
    const stcgNote = (input.shortTermCapGains ?? 0) > 0
      ? ` Short-term gains ($${(input.shortTermCapGains ?? 0).toLocaleString()}) taxed as ordinary income.`
      : '';
    notes.push(`Capital Gains: Long-term gains taxed at preferential 0/15/20% rates — saves vs ordinary income rates.${stcgNote}`);
  }

  const totalCredits = ctcResult.ctc;
  const totalRefundableCredits = eitcResult.amount + ctcResult.actc;

  return {
    eitc: eitcResult.amount,
    eitcEligible: eitcResult.eligible,
    eitcDisqualifier: eitcResult.disqualifier,
    childTaxCredit: ctcResult.ctc,
    additionalCTC: ctcResult.actc,
    ctcEligible: ctcResult.ctc > 0 || ctcResult.actc > 0,
    longTermCapGainsTax: ltcgTax,
    shortTermCapGainsTax: 0, // already included in ordinary income tax
    totalCredits,
    totalRefundableCredits,
    notes,
  };
}
