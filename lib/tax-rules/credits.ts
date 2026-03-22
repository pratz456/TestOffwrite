/**
 * Tax Credits Engine — 2025 Tax Year
 * Sources:
 *   - IRS Rev. Proc. 2024-40 (EITC amounts and phase-out thresholds)
 *   - IRS Publication 596 (EITC rules)
 *   - IRS Publication 972 (Child Tax Credit)
 *   - One Big Beautiful Bill Act P.L. 119-21 (CTC $2,200, OBBB changes)
 *   - Tax Foundation 2025 Tax Brackets (capital gains rates)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilingStatus =
  | 'single'
  | 'married_filing_jointly'
  | 'married_filing_separately'
  | 'head_of_household';

export interface CreditInput {
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

  childTaxCredit: number;      // Child Tax Credit (up to $2,200/child)
  additionalCTC: number;       // Refundable portion (up to $1,700/child)
  ctcEligible: boolean;

  longTermCapGainsTax: number; // Tax on long-term capital gains (0/15/20%)
  shortTermCapGainsTax: number;// Taxed as ordinary income (already in bracket calc)

  totalCredits: number;        // EITC + CTC (reduces tax due)
  totalRefundableCredits: number; // Credits that can create refund even if $0 tax

  notes: string[];             // IRS guidance notes shown to user
}

// ── 2025 EITC Parameters (IRS Rev. Proc. 2024-40) ─────────────────────────────

interface EITCConfig {
  maxCredit: number;
  phaseInRate: number;
  phaseOutRate: number;
  phaseInEnd: number;        // earned income at which max credit is reached
  phaseOutStart: number;     // AGI at which phase-out begins (single/HoH)
  phaseOutStartMFJ: number;  // AGI phase-out start for MFJ
  phaseOutEnd: number;       // AGI at which credit = $0 (single/HoH)
  phaseOutEndMFJ: number;    // AGI phase-out end for MFJ
}

const EITC_2025: Record<0 | 1 | 2 | 3, EITCConfig> = {
  0: {
    maxCredit: 649,
    phaseInRate: 0.0765,
    phaseOutRate: 0.0765,
    phaseInEnd: 8490,
    phaseOutStart: 10620,
    phaseOutStartMFJ: 17730,
    phaseOutEnd: 19104,
    phaseOutEndMFJ: 26214,
  },
  1: {
    maxCredit: 4328,
    phaseInRate: 0.34,
    phaseOutRate: 0.1598,
    phaseInEnd: 11950,
    phaseOutStart: 23330,
    phaseOutStartMFJ: 30440,
    phaseOutEnd: 50434,
    phaseOutEndMFJ: 57554,
  },
  2: {
    maxCredit: 7152,
    phaseInRate: 0.40,
    phaseOutRate: 0.2106,
    phaseInEnd: 16810,
    phaseOutStart: 23330,
    phaseOutStartMFJ: 30440,
    phaseOutEnd: 57310,
    phaseOutEndMFJ: 64430,
  },
  3: {
    maxCredit: 8046,
    phaseInRate: 0.45,
    phaseOutRate: 0.2106,
    phaseInEnd: 16810,
    phaseOutStart: 23330,
    phaseOutStartMFJ: 30440,
    phaseOutEnd: 61555,
    phaseOutEndMFJ: 68675,
  },
};

const EITC_INVESTMENT_INCOME_LIMIT_2025 = 11950;

// ── 2025 Child Tax Credit (OBBB P.L. 119-21) ─────────────────────────────────

const CTC_PER_CHILD_2025 = 2200;              // $2,200 per qualifying child under 17
const CTC_REFUNDABLE_PER_CHILD_2025 = 1700;   // Additional CTC (refundable portion)
const CTC_PHASE_OUT_THRESHOLD_MFJ = 400000;   // OBBB made this permanent
const CTC_PHASE_OUT_THRESHOLD_SINGLE = 200000;
const CTC_PHASE_OUT_RATE = 50;                // $50 reduction per $1,000 over threshold
const CTC_EARNED_INCOME_MIN = 2500;           // Must have at least $2,500 earned income for ACTC

// ── 2025 Long-Term Capital Gains Rates ───────────────────────────────────────
// Source: IRS Rev. Proc. 2024-40

const LTCG_BRACKETS_SINGLE = [
  { min: 0, max: 48350, rate: 0 },
  { min: 48350, max: 533400, rate: 0.15 },
  { min: 533400, max: Infinity, rate: 0.20 },
];

const LTCG_BRACKETS_MFJ = [
  { min: 0, max: 96700, rate: 0 },
  { min: 96700, max: 600050, rate: 0.15 },
  { min: 600050, max: Infinity, rate: 0.20 },
];

const LTCG_BRACKETS_HH = [
  { min: 0, max: 64750, rate: 0 },
  { min: 64750, max: 566700, rate: 0.15 },
  { min: 566700, max: Infinity, rate: 0.20 },
];

const LTCG_BRACKETS_MFS = [
  { min: 0, max: 48350, rate: 0 },
  { min: 48350, max: 300025, rate: 0.15 },
  { min: 300025, max: Infinity, rate: 0.20 },
];

function getLTCGBrackets(filingStatus: FilingStatus) {
  switch (filingStatus) {
    case 'married_filing_jointly': return LTCG_BRACKETS_MFJ;
    case 'head_of_household': return LTCG_BRACKETS_HH;
    case 'married_filing_separately': return LTCG_BRACKETS_MFS;
    default: return LTCG_BRACKETS_SINGLE;
  }
}

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

  // Cannot file MFS (with limited exceptions we don't model)
  if (filingStatus === 'married_filing_separately') {
    return { amount: 0, eligible: false, disqualifier: 'Married Filing Separately is not eligible for EITC' };
  }

  // Must have at least $1 of earned income
  if (earnedIncome <= 0) {
    return { amount: 0, eligible: false, disqualifier: 'Must have earned income to qualify for EITC' };
  }

  // Age requirement for no-child EITC: must be 25-64
  if (numEITCChildren === 0 && taxPayerAge !== undefined) {
    if (taxPayerAge < 25 || taxPayerAge > 64) {
      return { amount: 0, eligible: false, disqualifier: 'Without qualifying children, must be age 25-64' };
    }
  }

  // Investment income limit: $11,950 for 2025
  if (investmentIncome > EITC_INVESTMENT_INCOME_LIMIT_2025) {
    return {
      amount: 0,
      eligible: false,
      disqualifier: `Investment income ($${investmentIncome.toLocaleString()}) exceeds $${EITC_INVESTMENT_INCOME_LIMIT_2025.toLocaleString()} limit`,
    };
  }

  const childKey = Math.min(numEITCChildren, 3) as 0 | 1 | 2 | 3;
  const config = EITC_2025[childKey];
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
    credit = Math.max(0, phaseInCredit - reduction);
  }

  return { amount: Math.round(credit * 100) / 100, eligible: credit > 0 };
}

// ── Child Tax Credit Calculator ───────────────────────────────────────────────

export function calculateCTC(input: CreditInput): { ctc: number; actc: number } {
  const { agi, earnedIncome, filingStatus, numDependents } = input;

  if (numDependents <= 0) return { ctc: 0, actc: 0 };

  const threshold = filingStatus === 'married_filing_jointly'
    ? CTC_PHASE_OUT_THRESHOLD_MFJ
    : CTC_PHASE_OUT_THRESHOLD_SINGLE;

  // Base credit
  let baseCTC = numDependents * CTC_PER_CHILD_2025;

  // Phase-out: $50 reduction per $1,000 (or fraction) over threshold
  if (agi > threshold) {
    const excess = agi - threshold;
    const reduction = Math.ceil(excess / 1000) * CTC_PHASE_OUT_RATE;
    baseCTC = Math.max(0, baseCTC - reduction);
  }

  // Additional Child Tax Credit (refundable portion)
  // = 15% of earned income over $2,500, up to $1,700 per child
  let actc = 0;
  if (earnedIncome >= CTC_EARNED_INCOME_MIN) {
    const refundableBase = (earnedIncome - CTC_EARNED_INCOME_MIN) * 0.15;
    const maxACTC = numDependents * CTC_REFUNDABLE_PER_CHILD_2025;
    actc = Math.min(refundableBase, maxACTC);
  }

  return { ctc: Math.round(baseCTC * 100) / 100, actc: Math.round(actc * 100) / 100 };
}

// ── Long-Term Capital Gains Tax ───────────────────────────────────────────────

export function calculateLTCGTax(longTermGains: number, taxableIncome: number, filingStatus: FilingStatus): number {
  if (longTermGains <= 0) return 0;

  const brackets = getLTCGBrackets(filingStatus);
  // LTCG rates apply to the LTCG portion of taxable income
  // Ordinary income "fills up" the brackets first
  const ordinaryIncome = taxableIncome - longTermGains;
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
 * Calculate the IRS maximum SEP-IRA contribution for a self-employed person.
 * IRS formula: 25% of net SE earnings, where net SE earnings = net profit - half SE tax
 * This equals approximately 18.587% of net Schedule C profit.
 * Annual dollar cap: $70,000 for 2025.
 * Source: IRS Publication 560, Rev. Proc. 2024-40
 */
export function calculateSEPIRAMax(scheduleC_netProfit: number): number {
  if (scheduleC_netProfit <= 0) return 0;
  const seBase = scheduleC_netProfit * 0.9235;
  const seTax = seBase * 0.153;
  const halfSE = seTax / 2;
  const netSEEarnings = scheduleC_netProfit - halfSE;
  const max25Pct = netSEEarnings * 0.25;
  return Math.round(Math.min(max25Pct, 70000) * 100) / 100;
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
    notes.push(`EITC: You may qualify for $${eitcResult.amount.toLocaleString()} — attach Schedule EIC when filing`);
  }

  // CTC
  const ctcResult = calculateCTC(input);
  if (ctcResult.ctc > 0) {
    notes.push(`Child Tax Credit: $${ctcResult.ctc.toLocaleString()} (non-refundable) + $${ctcResult.actc.toLocaleString()} Additional CTC (refundable)`);
  }

  // Long-term capital gains
  const ltcgTax = calculateLTCGTax(
    input.longTermCapGains ?? 0,
    input.taxableIncome,
    input.filingStatus
  );

  if ((input.longTermCapGains ?? 0) > 0) {
    const stcgNote = (input.shortTermCapGains ?? 0) > 0
      ? ` Short-term gains ($${(input.shortTermCapGains ?? 0).toLocaleString()}) taxed as ordinary income.`
      : '';
    notes.push(`Capital Gains: Long-term gains taxed at preferential 0/15/20% rates — saves vs ordinary income rates.${stcgNote}`);
  }

  const totalCredits = ctcResult.ctc + eitcResult.amount;
  const totalRefundableCredits = eitcResult.amount + ctcResult.actc;

  return {
    eitc: eitcResult.amount,
    eitcEligible: eitcResult.eligible,
    eitcDisqualifier: eitcResult.disqualifier,
    childTaxCredit: ctcResult.ctc,
    additionalCTC: ctcResult.actc,
    ctcEligible: ctcResult.ctc > 0,
    longTermCapGainsTax: ltcgTax,
    shortTermCapGainsTax: 0, // already included in ordinary income tax
    totalCredits,
    totalRefundableCredits,
    notes,
  };
}
