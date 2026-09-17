/**
 * Schedule 1-A "Working Families Tax Cuts" deductions (P.L. 119-21, tax years 2025–2028)
 * and the §170(p) charitable deduction for non-itemizers (2026 onward).
 * All amounts and thresholds are statutory and not indexed.
 * Sources:
 *   - P.L. 119-21 §70201 (new §224 qualified tips), §70202 (new §225 qualified overtime),
 *     §70203 (§163(h)(4) qualified passenger vehicle loan interest), §70424 (§170(p))
 *     https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm
 *   - Schedule 1-A (Form 1040) 2025, Parts I–IV and VI https://www.irs.gov/forms-pubs/about-schedule-1-a-form-1040
 *   - IRS FS-2025-03 https://www.irs.gov/newsroom/one-big-beautiful-bill-act-tax-deductions-for-working-americans-and-seniors
 *   - IRS "Working Families Tax Cuts – Individuals and workers" https://www.irs.gov/newsroom/working-families-tax-cuts-individuals-and-workers
 *   - T.D. 10044 (Reg. §1.224-1), Notice 2025-69 (SSTB transition relief), IRS FS-2026-13 (overtime FAQs)
 *   - Treasury tipped-occupation list https://www.irs.gov/TippedOccupations
 */
import { getFederalTaxRules } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';

export const OBBBA_DEDUCTION_FIELD = 'obbbaDeductionFacts';
export interface OBBBADeductionAnswers {
  version: 1;
  taxYear: number;
  magiForeignExclusions?: string;
  hasQualifiedTips?: string;
  qualifiedTipsAmount?: string;
  tipsOccupationListed?: string;
  tipsBusinessSSTB?: string;
  workEligibleSSN?: string;
  hasW2Overtime?: string;
  qualifiedOvertimeAmount?: string;
  has1099Overtime?: string;
  hasVehicleLoanInterest?: string;
  vehicleLoanInterestAmount?: string;
  vehicleLoanAfter2024?: string;
  vehicleNewUSAssembled?: string;
  vehicleVIN?: string;
  vehiclePersonalUse?: string;
  vehicleLoanQualified?: string;
  hasNonItemizerCharity?: string;
  nonItemizerCashCharity?: string;
}
export class OBBBADeductionReviewRequiredError extends Error {
  readonly code = 'OBBBA_DEDUCTION_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`Review the Working Families Tax Cuts deductions in Tax Organizer: ${detail}`);
    this.name = 'OBBBADeductionReviewRequiredError';
  }
}
const review = (message: string): never => { throw new OBBBADeductionReviewRequiredError(message); };
const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const usd = (amount: number) => `$${amount.toLocaleString('en-US')}`;

/** §224(b)(1): $25,000 per return. */
export const QUALIFIED_TIPS_LIMIT = 25000;
/** §224(b)(2): $100 per $1,000 of MAGI over $150,000 ($300,000 joint). */
export const TIPS_OVERTIME_PHASEOUT_THRESHOLD = 150000;
export const TIPS_OVERTIME_PHASEOUT_THRESHOLD_JOINT = 300000;
export const TIPS_OVERTIME_PHASEOUT_PER_THOUSAND = 100;
/** §225(b)(1): $12,500 ($25,000 joint). */
export const QUALIFIED_OVERTIME_LIMIT = 12500;
export const QUALIFIED_OVERTIME_LIMIT_JOINT = 25000;
/** §163(h)(4)(C)/(D): $10,000 interest limit; $200 per $1,000 (or fraction) of MAGI over $100,000 ($200,000 joint). */
export const VEHICLE_LOAN_INTEREST_LIMIT = 10000;
export const VEHICLE_LOAN_PHASEOUT_THRESHOLD = 100000;
export const VEHICLE_LOAN_PHASEOUT_THRESHOLD_JOINT = 200000;
export const VEHICLE_LOAN_PHASEOUT_PER_THOUSAND = 200;
/** §170(p): $1,000 ($2,000 joint) cash gifts to §170(b)(1)(A) public charities, 2026 onward. */
export const NON_ITEMIZER_CHARITY_LIMIT = 1000;
export const NON_ITEMIZER_CHARITY_LIMIT_JOINT = 2000;
/** §224, §225 and §163(h)(4) apply to tax years beginning after 2024 and before 2029. */
export const SCHEDULE_1A_FIRST_YEAR = 2025;
export const SCHEDULE_1A_LAST_YEAR = 2028;
export const NON_ITEMIZER_CHARITY_FIRST_YEAR = 2026;

export function readOBBBADeductionAnswers(raw: unknown): OBBBADeductionAnswers | undefined {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return undefined;
  if (typeof raw !== 'string') return review('saved answers are invalid; save the section again.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return review('saved answers are invalid; save the section again.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    return review('saved answers need review; save the section again.');
  }
  if (!Number.isInteger((value as { taxYear?: unknown }).taxYear)) review('save the answers for the selected tax year.');
  if (Object.entries(value).some(([key, item]) => key !== 'version' && key !== 'taxYear' && typeof item !== 'string')) {
    return review('answers must be text selections or amounts.');
  }
  return value as OBBBADeductionAnswers;
}
function yesNo(value: unknown, label: string): boolean {
  if (value !== 'yes' && value !== 'no') review(`answer ${label}; an unanswered question is not “No.”`);
  return value === 'yes';
}
function money(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) review(`enter ${label}, including 0 when none.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result > 1e12) review(`enter a valid ${label}.`);
  return result;
}
/** Schedule 1-A lines 11/19 decrease to the next lower whole $1,000; line 28 increases ("or portion thereof"). */
export function phaseoutReduction(modifiedAGI: number, threshold: number, perThousand: number, rounding: 'floor' | 'ceil'): number {
  const excess = modifiedAGI - threshold;
  if (excess <= 0) return 0;
  const steps = rounding === 'floor' ? Math.floor(excess / 1000) : Math.ceil(excess / 1000);
  return steps * perThousand;
}

export interface OBBBAItemResult {
  deduction: number;
  amountReported: number;
  limitedAmount: number;
  phaseoutReduction: number;
  reason?: string;
}
export interface OBBBADeductionInput {
  taxYear: number;
  filingStatus: string;
  agi: number;
  /** Allowed Schedule C net profit after depreciation (the §224(c) business-income limit). */
  scheduleCNetProfit: number;
  usingStandardDeduction: boolean;
  organizer: Record<string, unknown>;
}
export interface OBBBADeductionResult {
  taxYear: number;
  /** All four intake questions were answered for this year. */
  reviewed: boolean;
  modifiedAGI: number | null;
  qualifiedTips: OBBBAItemResult;
  qualifiedOvertime: OBBBAItemResult;
  vehicleLoanInterest: OBBBAItemResult;
  nonItemizerCharitable: OBBBAItemResult;
  /** Schedule 1-A Parts II–IV (the enhanced senior deduction, Part V, is calculated separately). */
  scheduleOneATotal: number;
  /** Schedule 1-A Parts II–IV plus the §170(p) non-itemizer charitable deduction. */
  total: number;
  warnings: string[];
}
const none = (reason?: string): OBBBAItemResult => ({ deduction: 0, amountReported: 0, limitedAmount: 0, phaseoutReduction: 0, ...(reason ? { reason } : {}) });

/**
 * Below-the-line deductions taken after AGI whether or not itemizing (§63(b)(5)–(7)).
 * Unanswered intake produces no deduction and a warning; an explicit claim with
 * missing facts, an SSTB, a business-use vehicle or contractor overtime is review-blocked.
 */
export function calculateOBBBADeductions(input: OBBBADeductionInput): OBBBADeductionResult {
  const taxYear = getFederalTaxRules(input.taxYear).taxYear;
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const joint = filingStatus === 'married_filing_jointly';
  const separate = filingStatus === 'married_filing_separately';
  const warnings: string[] = [];
  const result: OBBBADeductionResult = {
    taxYear, reviewed: false, modifiedAGI: null, qualifiedTips: none(), qualifiedOvertime: none(), vehicleLoanInterest: none(),
    nonItemizerCharitable: none(), scheduleOneATotal: 0, total: 0, warnings,
  };
  if (taxYear < SCHEDULE_1A_FIRST_YEAR) {
    const reason = `Schedule 1-A deductions begin in ${SCHEDULE_1A_FIRST_YEAR}.`;
    return { ...result, reviewed: true, qualifiedTips: none(reason), qualifiedOvertime: none(reason), vehicleLoanInterest: none(reason), nonItemizerCharitable: none(`The non-itemizer charitable deduction begins in ${NON_ITEMIZER_CHARITY_FIRST_YEAR}.`) };
  }
  if (!Number.isFinite(input.agi) || Math.abs(input.agi) > 1e12) review('the annual adjusted gross income is invalid.');
  const charityYear = taxYear >= NON_ITEMIZER_CHARITY_FIRST_YEAR;
  const items = ['qualified tips', 'qualified overtime', 'vehicle loan interest', ...(charityYear ? ['non-itemizer charitable gifts'] : [])];
  const saved = readOBBBADeductionAnswers(input.organizer[OBBBA_DEDUCTION_FIELD]);
  const facts = saved && saved.taxYear === taxYear ? saved : undefined;
  if (!facts) {
    warnings.push(`Schedule 1-A deductions (${items.join(', ')}) were not reviewed in Tax Organizer for ${taxYear}${saved ? ' (saved answers belong to another year)' : ''}; none is applied. Blank answers are not treated as No.`);
    if (!charityYear) result.nonItemizerCharitable = none(`The non-itemizer charitable deduction begins in ${NON_ITEMIZER_CHARITY_FIRST_YEAR}.`);
    return result;
  }
  const answered = (value: unknown) => value === 'yes' || value === 'no';
  const unanswered = [
    !answered(facts.hasQualifiedTips) && 'qualified tips',
    !answered(facts.hasW2Overtime) && 'qualified overtime',
    !answered(facts.hasVehicleLoanInterest) && 'vehicle loan interest',
    charityYear && !answered(facts.hasNonItemizerCharity) && 'non-itemizer charitable gifts',
  ].filter((item): item is string => typeof item === 'string');
  result.reviewed = unanswered.length === 0;
  if (unanswered.length) warnings.push(`Schedule 1-A intake not answered for ${taxYear}: ${unanswered.join(', ')}. No deduction is applied for an unanswered item; blank is not No.`);
  const claims = [facts.hasQualifiedTips, facts.hasW2Overtime, facts.hasVehicleLoanInterest, charityYear ? facts.hasNonItemizerCharity : 'no'].some(value => value === 'yes');
  if (facts.has1099Overtime === 'yes') {
    review('overtime paid to an independent contractor is generally not qualified overtime because Fair Labor Standards Act section 7 applies to employees. The rare case of an FLSA employee treated as a contractor for tax purposes (IRS FS-2026-13 Q7) needs review.');
  }
  let modifiedAGI: number | null = null;
  if (claims) {
    // Schedule 1-A Part I: MAGI is AGI plus §911/§931/§933 exclusions, which are not modeled.
    if (yesNo(facts.magiForeignExclusions, 'whether you exclude foreign earned income or U.S. territory income')) {
      review('Schedule 1-A modified AGI adds back excluded foreign earned income (Form 2555) and territory income (Form 4563 / Puerto Rico). Those exclusions are not calculated here.');
    }
    modifiedAGI = round(input.agi);
  }
  result.modifiedAGI = modifiedAGI;
  const magi = modifiedAGI ?? 0;
  const tipsOvertimeThreshold = joint ? TIPS_OVERTIME_PHASEOUT_THRESHOLD_JOINT : TIPS_OVERTIME_PHASEOUT_THRESHOLD;

  // Part II — qualified tips received in a trade or business (line 5), limited to net profit.
  if (facts.hasQualifiedTips === 'yes') {
    const amountReported = money(facts.qualifiedTipsAmount, 'qualified tips reported on Form 1099-NEC/MISC/K or Form 4137');
    const listed = yesNo(facts.tipsOccupationListed, 'whether your occupation is on the Treasury list of tipped occupations');
    if (yesNo(facts.tipsBusinessSSTB, 'whether your business is a specified service trade or business')) {
      review('tips received in a specified service trade or business (section 199A(d)(2)) are not qualified tips. Notice 2025-69 transition relief treats listed occupations as outside an SSTB until final regulations apply; confirm the treatment with a tax professional before relying on this deduction.');
    }
    const ssn = yesNo(facts.workEligibleSSN, 'whether you have a work-eligible Social Security number');
    if (!listed) result.qualifiedTips = { ...none('Tips received outside an occupation on the Treasury tipped-occupation list are not qualified tips (section 224(d)).'), amountReported };
    else if (separate) result.qualifiedTips = { ...none('Married taxpayers must file jointly to claim the qualified tips deduction (section 224).'), amountReported };
    else if (!ssn) result.qualifiedTips = { ...none('A work-eligible Social Security number is required for the qualified tips deduction (section 224).'), amountReported };
    else if (input.scheduleCNetProfit <= 0) result.qualifiedTips = { ...none('Schedule 1-A line 5 cannot exceed the net profit from the trade or business; no business net profit is available this year.'), amountReported };
    else {
      const limitedAmount = round(Math.min(amountReported, QUALIFIED_TIPS_LIMIT, input.scheduleCNetProfit));
      const phaseout = phaseoutReduction(magi, tipsOvertimeThreshold, TIPS_OVERTIME_PHASEOUT_PER_THOUSAND, 'floor');
      result.qualifiedTips = { deduction: round(Math.max(0, limitedAmount - phaseout)), amountReported, limitedAmount, phaseoutReduction: phaseout };
      if (result.qualifiedTips.deduction > 0) {
        warnings.push(`Qualified tips deduction of ${usd(result.qualifiedTips.deduction)} applied on Schedule 1-A Part II using the Schedule C net profit recorded in WriteOff as the business-income limit. Tips must be included in your gross receipts and shown on Form 1099-NEC/MISC/K or Form 4137. Whether the SE health insurance, half-SE-tax and retirement deductions also reduce that limit was left open by T.D. 10044 and is not applied.`);
      }
    }
  }
  // Part III — qualified overtime (W-2 box 12 code TT); contractors generally have none.
  if (facts.hasW2Overtime === 'yes') {
    const amountReported = money(facts.qualifiedOvertimeAmount, 'qualified overtime compensation from Form W-2 box 12 code TT');
    const ssn = yesNo(facts.workEligibleSSN, 'whether you have a work-eligible Social Security number');
    if (separate) result.qualifiedOvertime = { ...none('Married taxpayers must file jointly to claim the qualified overtime deduction (section 225).'), amountReported };
    else if (!ssn) result.qualifiedOvertime = { ...none('A work-eligible Social Security number is required for the qualified overtime deduction (section 225).'), amountReported };
    else {
      const limitedAmount = round(Math.min(amountReported, joint ? QUALIFIED_OVERTIME_LIMIT_JOINT : QUALIFIED_OVERTIME_LIMIT));
      const phaseout = phaseoutReduction(magi, tipsOvertimeThreshold, TIPS_OVERTIME_PHASEOUT_PER_THOUSAND, 'floor');
      result.qualifiedOvertime = { deduction: round(Math.max(0, limitedAmount - phaseout)), amountReported, limitedAmount, phaseoutReduction: phaseout };
      if (result.qualifiedOvertime.deduction > 0) warnings.push(`Qualified overtime deduction of ${usd(result.qualifiedOvertime.deduction)} applied on Schedule 1-A Part III from W-2 box 12 code TT. Only the FLSA-required premium portion qualifies; state-law or contract overtime does not.`);
    }
  }
  // Part IV — qualified passenger vehicle loan interest (personal-use vehicles only).
  if (facts.hasVehicleLoanInterest === 'yes') {
    const amountReported = money(facts.vehicleLoanInterestAmount, 'passenger vehicle loan interest paid');
    const after2024 = yesNo(facts.vehicleLoanAfter2024, 'whether the loan was taken out after December 31, 2024');
    const newUS = yesNo(facts.vehicleNewUSAssembled, 'whether the vehicle is new (original use began with you) with final assembly in the United States');
    if (!yesNo(facts.vehiclePersonalUse, 'whether the vehicle is used for personal purposes rather than in your business')) {
      review('interest on a vehicle used in your business follows the Schedule C business-interest rules (sections 162 and 163) with a business-use percentage, not Schedule 1-A Part IV. Record it with your vehicle expenses for review.');
    }
    const qualifiedLoan = yesNo(facts.vehicleLoanQualified, 'whether the loan is a first-lien purchase loan from an unrelated lender for a vehicle under 14,000 pounds (not a lease)');
    const vin = typeof facts.vehicleVIN === 'string' ? facts.vehicleVIN.trim().toUpperCase() : '';
    if (!after2024) result.vehicleLoanInterest = { ...none('Only loans incurred after December 31, 2024 qualify (section 163(h)(4)).'), amountReported };
    else if (!newUS) result.vehicleLoanInterest = { ...none('Only new vehicles with final assembly in the United States qualify (section 163(h)(4)).'), amountReported };
    else if (!qualifiedLoan) result.vehicleLoanInterest = { ...none('Leases, related-party loans and loans that are not a first lien on a qualifying vehicle do not qualify (section 163(h)(4)).'), amountReported };
    else {
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) review('enter the 17-character vehicle identification number; the VIN must be reported on Schedule 1-A line 22 to claim the deduction.');
      const limitedAmount = round(Math.min(amountReported, VEHICLE_LOAN_INTEREST_LIMIT));
      const phaseout = phaseoutReduction(magi, joint ? VEHICLE_LOAN_PHASEOUT_THRESHOLD_JOINT : VEHICLE_LOAN_PHASEOUT_THRESHOLD, VEHICLE_LOAN_PHASEOUT_PER_THOUSAND, 'ceil');
      result.vehicleLoanInterest = { deduction: round(Math.max(0, limitedAmount - phaseout)), amountReported, limitedAmount, phaseoutReduction: phaseout };
      if (result.vehicleLoanInterest.deduction > 0) warnings.push(`Qualified passenger vehicle loan interest deduction of ${usd(result.vehicleLoanInterest.deduction)} applied on Schedule 1-A Part IV for VIN ${vin}. Keep the lender interest statement and the final-assembly evidence (dealer label or NHTSA VIN decoder).`);
    }
  }
  // §170(p) — cash gifts to public charities for taxpayers who do not itemize (2026 onward).
  if (!charityYear) result.nonItemizerCharitable = none(`The non-itemizer charitable deduction begins in ${NON_ITEMIZER_CHARITY_FIRST_YEAR}.`);
  else if (facts.hasNonItemizerCharity === 'yes') {
    const amountReported = money(facts.nonItemizerCashCharity, 'cash gifts to public charities');
    if (!input.usingStandardDeduction) {
      result.nonItemizerCharitable = { ...none('You itemize, so charitable gifts belong on Schedule A rather than the non-itemizer deduction (section 170(p)).'), amountReported };
      warnings.push('From 2026, itemized charitable contributions are deductible only above 0.5% of AGI (section 170(b)(1)(I)); that floor is not modeled.');
    } else {
      const limitedAmount = round(Math.min(amountReported, joint ? NON_ITEMIZER_CHARITY_LIMIT_JOINT : NON_ITEMIZER_CHARITY_LIMIT));
      result.nonItemizerCharitable = { deduction: limitedAmount, amountReported, limitedAmount, phaseoutReduction: 0 };
      if (limitedAmount > 0) warnings.push(`Non-itemizer charitable deduction of ${usd(limitedAmount)} applied (section 170(p)): cash gifts to public charities only, not donor-advised funds, supporting organizations or most private foundations. Keep bank records or written acknowledgments.`);
    }
  }
  result.scheduleOneATotal = round(result.qualifiedTips.deduction + result.qualifiedOvertime.deduction + result.vehicleLoanInterest.deduction);
  result.total = round(result.scheduleOneATotal + result.nonItemizerCharitable.deduction);
  return result;
}
