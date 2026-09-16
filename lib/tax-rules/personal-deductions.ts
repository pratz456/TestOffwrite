import { getFederalTaxRules, type FederalFilingStatus } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';

/** One versioned JSON-string answer fits the existing organizer text contract. */
export const PERSONAL_DEDUCTION_FIELD = 'personalDeductionFacts';
export interface PersonalDeductionAnswers {
  version: 1;
  taxYear: number;
  ordinaryScope?: string;
  taxpayerBlind?: string;
  taxpayerDependent?: string;
  spouseBlind?: string;
  spouseDependent?: string;
  dependentEarnedIncome?: string;
  mfsSpouseItemizes?: string;
  mfsSpouseAdditionalEligible?: string;
  taxpayerSeniorSSN?: string;
  spouseSeniorSSN?: string;
  seniorHasAddbacks?: string;
  excludedPuertoRicoIncome?: string;
  form2555Line45?: string;
  form2555Line50?: string;
  form4563Line15?: string;
}
export class PersonalDeductionReviewRequiredError extends Error {
  readonly code = 'PERSONAL_DEDUCTION_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`Review Personal Deductions in Tax Organizer: ${detail}`);
    this.name = 'PersonalDeductionReviewRequiredError';
  }
}
const review = (message: string): never => { throw new PersonalDeductionReviewRequiredError(message); };
const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const extraRules = {
  2024: { dependentMinimum: 1300, earnedAddition: 450, marriedAdditional: 1550, unmarriedAdditional: 1950 },
  2025: { dependentMinimum: 1350, earnedAddition: 450, marriedAdditional: 1600, unmarriedAdditional: 2000 },
  2026: { dependentMinimum: 1350, earnedAddition: 450, marriedAdditional: 1650, unmarriedAdditional: 2050 },
} as const;

export function readPersonalDeductionAnswers(raw: unknown): PersonalDeductionAnswers {
  if (typeof raw !== 'string' || !raw.trim()) review('confirm age, blindness and dependency facts before calculating.');
  let value: unknown;
  try { value = JSON.parse(raw as string); } catch { return review('saved deduction answers are invalid; save the section again.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    return review('saved deduction answers need review; save the section again.');
  }
  if (!Number.isInteger((value as { taxYear?: unknown }).taxYear)) review('save deduction answers for the selected tax year.');
  if (Object.entries(value).some(([key, item]) => key !== 'version' && key !== 'taxYear' && typeof item !== 'string')) {
    return review('deduction answers must be text selections or amounts.');
  }
  return value as PersonalDeductionAnswers;
}
function yesNo(value: unknown, label: string): boolean {
  if (value !== 'yes' && value !== 'no') review(`answer ${label}; an unanswered question is not “No.”`);
  return value === 'yes';
}
function money(value: unknown, label: string, allowNegative = false): number {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) review(`enter ${label}, including 0 when none.`);
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e12 || (!allowNegative && result < 0)) review(`enter a valid ${label}.`);
  return result;
}
/** Calendar-only comparison: someone born January 1 turns 65 for tax purposes December 31. */
export function isAge65AtTaxYearEnd(dateOfBirth: unknown, taxYear: number, label = 'your date of birth'): boolean {
  getFederalTaxRules(taxYear);
  if (typeof dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) review(`enter ${label}.`);
  const date = dateOfBirth as string;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '1850-01-01' || date > `${taxYear}-12-31`) review(`enter a valid ${label} for ${taxYear}.`);
  return date <= `${taxYear - 64}-01-01`;
}
type Organizer = Record<string, unknown>;
interface Input { taxYear: number; filingStatus: string; organizer: Organizer }
function context(input: Input) {
  const rules = getFederalTaxRules(input.taxYear);
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const facts = readPersonalDeductionAnswers(input.organizer[PERSONAL_DEDUCTION_FIELD]);
  if (facts.taxYear !== rules.taxYear) review(`answers were saved for ${facts.taxYear}; confirm them for ${rules.taxYear}.`);
  if (!yesNo(facts.ordinaryScope, 'whether the ordinary full-year deduction rules apply')) {
    review('deceased taxpayers, short tax years, nonresident/dual-status returns, territorial standard-deduction allocations and disaster-loss increases need separate review.');
  }
  return { rules, filingStatus, facts };
}
export interface StandardDeductionResult {
  taxYear: number;
  filingStatus: FederalFilingStatus;
  standardDeduction: number;
  basicStandardDeduction: number;
  dependentLimitedBase: number;
  additionalStandardDeduction: number;
  additionalBoxCount: number;
  dependentLimitationApplied: boolean;
  standardDeductionAllowed: boolean;
  reason?: string;
}

/** Pub501 Table8 + annual §63 inflation parameters; choose vs itemization in caller. */
export function calculateStandardDeduction(input: Input): StandardDeductionResult {
  const { rules, filingStatus, facts } = context(input);
  const basic = rules.standardDeductions[filingStatus];
  const parameters = extraRules[rules.taxYear];
  const result: StandardDeductionResult = {
    taxYear: rules.taxYear, filingStatus, basicStandardDeduction: basic, standardDeduction: 0,
    dependentLimitedBase: 0, additionalStandardDeduction: 0, additionalBoxCount: 0,
    dependentLimitationApplied: false, standardDeductionAllowed: true,
  };
  if (filingStatus === 'married_filing_separately' && yesNo(facts.mfsSpouseItemizes, 'whether your spouse itemizes')) {
    return { ...result, standardDeductionAllowed: false, reason: 'Your spouse itemizes on a separate return, so your standard deduction is zero. Review your own allowable itemized deductions.' };
  }
  const taxpayerOlder = isAge65AtTaxYearEnd(input.organizer.dateOfBirth, rules.taxYear);
  const taxpayerBlind = yesNo(facts.taxpayerBlind, 'whether you meet the IRS blindness definition');
  const taxpayerDependent = yesNo(facts.taxpayerDependent, 'whether another taxpayer can claim you');
  let dependent = taxpayerDependent;
  let boxes = Number(taxpayerOlder) + Number(taxpayerBlind);
  let includeSpouse = filingStatus === 'married_filing_jointly';
  if (filingStatus === 'married_filing_jointly') {
    // Do not short-circuit: both dependency questions must be answered.
    const spouseDependent = yesNo(facts.spouseDependent, 'whether another taxpayer can claim your spouse');
    dependent = dependent || spouseDependent;
  }
  if (filingStatus === 'married_filing_separately') {
    includeSpouse = yesNo(facts.mfsSpouseAdditionalEligible, 'whether your spouse had no gross income, is not filing a return and cannot be claimed by anyone else');
  }
  if (includeSpouse) {
    boxes += Number(isAge65AtTaxYearEnd(input.organizer.spouseDoB, rules.taxYear, 'your spouse’s date of birth'));
    boxes += Number(yesNo(facts.spouseBlind, 'whether your spouse meets the IRS blindness definition'));
  }
  const earned = dependent ? money(facts.dependentEarnedIncome, 'earned income for the dependent standard-deduction worksheet', true) : 0;
  const base = dependent ? Math.min(basic, Math.max(parameters.dependentMinimum, earned + parameters.earnedAddition)) : basic;
  const perBox = filingStatus === 'single' || filingStatus === 'head_of_household' ? parameters.unmarriedAdditional : parameters.marriedAdditional;
  const additional = boxes * perBox;
  return { ...result, standardDeduction: round(base + additional), dependentLimitedBase: round(base), additionalStandardDeduction: additional, additionalBoxCount: boxes, dependentLimitationApplied: dependent };
}

export interface EnhancedSeniorDeductionResult {
  taxYear: number;
  deduction: number;
  eligiblePeople: number;
  modifiedAGI: number | null;
  magiAddbacks: number;
  perPersonDeduction: number;
  phaseoutThreshold: number | null;
  phaseoutReductionPerPerson: number;
  reason?: string;
}
/** Schedule1A PartI/V. BELOW AGI; never subtract from Social Security combined income. */
export function calculateEnhancedSeniorDeduction(input: Input & { agi: number }): EnhancedSeniorDeductionResult {
  const year = getFederalTaxRules(input.taxYear).taxYear;
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const empty: EnhancedSeniorDeductionResult = { taxYear: year, deduction: 0, eligiblePeople: 0, modifiedAGI: null, magiAddbacks: 0, perPersonDeduction: 0, phaseoutThreshold: null, phaseoutReductionPerPerson: 0 };
  if (year === 2024) return { ...empty, reason: 'The enhanced senior deduction begins in 2025.' };
  if (filingStatus === 'married_filing_separately') return { ...empty, reason: 'Married taxpayers must file jointly to claim the enhanced senior deduction.' };
  const { facts } = context(input);
  const taxpayerOlder = isAge65AtTaxYearEnd(input.organizer.dateOfBirth, year);
  const spouseOlder = filingStatus === 'married_filing_jointly' && isAge65AtTaxYearEnd(input.organizer.spouseDoB, year, 'your spouse’s date of birth');
  const taxpayerEligible = taxpayerOlder && yesNo(facts.taxpayerSeniorSSN, 'whether your SSN is valid for employment and issued by the return due date, including extensions');
  const spouseEligible = spouseOlder && yesNo(facts.spouseSeniorSSN, 'whether your spouse’s SSN is valid for employment and issued by the return due date, including extensions');
  const eligiblePeople = Number(taxpayerEligible) + Number(spouseEligible);
  if (!eligiblePeople) return { ...empty, reason: 'No taxpayer meets both the age and valid-SSN requirements.' };
  if (!Number.isFinite(input.agi) || Math.abs(input.agi) > 1e12) review('the annual adjusted gross income is invalid.');
  const hasAddbacks = yesNo(facts.seniorHasAddbacks, 'whether foreign or territory amounts must be added back for senior MAGI');
  const magiAddbacks = hasAddbacks ? [
    money(facts.excludedPuertoRicoIncome, 'excluded Puerto Rico income'),
    money(facts.form2555Line45, 'Form 2555 line 45'),
    money(facts.form2555Line50, 'Form 2555 line 50'),
    money(facts.form4563Line15, 'Form 4563 line 15'),
  ].reduce((sum, value) => sum + value, 0) : 0;
  // A contradictory stored amount cannot disappear behind a stale No selection.
  if (!hasAddbacks && [facts.excludedPuertoRicoIncome, facts.form2555Line45, facts.form2555Line50, facts.form4563Line15].some(value => value !== undefined && value.trim() !== '' && money(value, 'stored MAGI addback') !== 0)) {
    review('foreign/territory amounts are saved while addbacks are marked No; reconcile those answers.');
  }
  const modifiedAGI = round(input.agi + magiAddbacks);
  const threshold = filingStatus === 'married_filing_jointly' ? 150000 : 75000;
  const reduction = round(Math.max(0, modifiedAGI - threshold) * .06);
  const perPerson = Math.max(0, round(6000 - reduction));
  // Schedule1A calculates the reduced amount PER eligible person before adding spouses.
  return { ...empty, deduction: round(perPerson * eligiblePeople), eligiblePeople, modifiedAGI, magiAddbacks: round(magiAddbacks), perPersonDeduction: perPerson, phaseoutThreshold: threshold, phaseoutReductionPerPerson: reduction };
}
