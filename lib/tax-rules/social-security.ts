import { getFederalTaxRules, type FederalFilingStatus } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';

export class SocialSecurityReviewRequiredError extends Error {
  readonly code = 'SOCIAL_SECURITY_REVIEW_REQUIRED';
  constructor(detail = 'Complete the benefit, income and filing facts before calculating your federal estimate or Form 1040 export.') {
    super(`Review Social Security in Tax Organizer using SSA-1099/RRB-1099 records and IRS Publication 915. ${detail}`);
    this.name = 'SocialSecurityReviewRequiredError';
  }
}
const review = (message: string): never => { throw new SocialSecurityReviewRequiredError(message); };
const money = (value: unknown, label: string, allowNegative = false): number => {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value.trim())))
      || !Number.isFinite(Number(value)) || !Number.isSafeInteger(Math.round(Number(value) * 100))
      || (!allowNegative && Number(value) < 0)) review(`Enter a valid ${label}, including zero when applicable.`);
  return Math.round(Number(value) * 100) / 100;
};
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export interface SocialSecurityWorksheetInput {
  taxYear: number;
  filingStatus: FederalFilingStatus;
  netBenefits: number;
  /** Taxable income before Social Security and Schedule1 adjustments. */
  otherIncome: number;
  taxExemptInterest: number;
  excludedSavingsBondInterest: number;
  exclusionAddbacks: number;
  /** Pub915 line7 only: excludes student-loan interest and Schedule1-A. */
  allowedAdjustments: number;
  livedApartAllYear?: boolean;
}

/** Pub915 Worksheet1 / 2026 Pub505 Worksheet2-2 / IRC86. Scope eligibility is checked by the organizer adapter. */
export function calculateSocialSecurityWorksheet(input: SocialSecurityWorksheetInput) {
  getFederalTaxRules(input.taxYear);
  if (!input.filingStatus) review('Confirm your filing status before applying the benefit thresholds.');
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const benefits = money(input.netBenefits, 'Box5 net benefits');
  const otherIncome = money(input.otherIncome, 'other income', true);
  const taxExemptInterest = money(input.taxExemptInterest, 'tax-exempt interest');
  const savingsBondInterest = money(input.excludedSavingsBondInterest, 'excluded savings-bond interest');
  const addbacks = money(input.exclusionAddbacks, 'income exclusion addbacks');
  const adjustments = money(input.allowedAdjustments, 'permitted Schedule1 adjustments');
  if (filingStatus === 'married_filing_separately' && typeof input.livedApartAllYear !== 'boolean') review('Answer whether you lived apart from your spouse for the entire tax year.');
  const halfBenefits = benefits * .5;
  const combinedIncome = Math.max(0, halfBenefits + otherIncome + taxExemptInterest + savingsBondInterest + addbacks - adjustments);
  const mfsTogether = filingStatus === 'married_filing_separately' && !input.livedApartAllYear;
  const baseAmount = mfsTogether ? 0 : filingStatus === 'married_filing_jointly' ? 32000 : 25000;
  const tierWidth = mfsTogether ? 0 : filingStatus === 'married_filing_jointly' ? 12000 : 9000;
  const aboveBase = Math.max(0, combinedIncome - baseAmount);
  const firstTier = Math.min(halfBenefits, Math.min(aboveBase, tierWidth) * .5);
  const secondTier = Math.max(0, aboveBase - tierWidth) * .85;
  const taxableBenefits = round(Math.min(benefits * .85, firstTier + secondTier));
  return {
    method: 'pub915_worksheet1' as const, taxYear: input.taxYear, filingStatus,
    netBenefits: benefits, taxableBenefits, combinedIncome: round(combinedIncome),
    baseAmount, upperBaseAmount: baseAmount + tierWidth,
    otherIncome, taxExemptInterest, excludedSavingsBondInterest: savingsBondInterest,
    exclusionAddbacks: addbacks, allowedAdjustments: adjustments,
    livedApartAllYear: filingStatus === 'married_filing_separately' ? input.livedApartAllYear : undefined,
  };
}

export function readSocialSecurityFacts(org: Record<string, unknown>) {
  const flag = typeof org.hasSocialSecurity === 'string' ? org.hasSocialSecurity.trim().toLowerCase() : org.hasSocialSecurity;
  const present = (value: unknown) => value !== undefined && value !== null && value !== '';
  const legacy = present(org.amountSocialSecurity) ? money(org.amountSocialSecurity, 'legacy Box3 benefits') : 0;
  if (flag !== 'yes') {
    if ((flag !== undefined && flag !== null && flag !== '' && flag !== 'no') || legacy !== 0
        || (present(org.socialSecurityNetBenefits) && money(org.socialSecurityNetBenefits, 'Box5 net benefits') !== 0)
        || (present(org.socialSecurityFederalWithheld) && money(org.socialSecurityFederalWithheld, 'benefit withholding') !== 0)) review('Reconcile the benefits answer with the saved benefit amounts; do not remove records to bypass review.');
    return null;
  }
  if (org.socialSecurityResident !== 'yes') review('Confirm full-year U.S. citizen/resident treatment and SSA-1099/RRB-1099 benefits. Nonresident, treaty and foreign-benefit cases need separate review.');
  if (org.socialSecurityLumpSum !== 'no') review('Prior-year lump-sum benefits need the Pub915 election comparison (Worksheets2–4); this estimate does not choose that election.');
  if (org.socialSecuritySpecialIRA !== 'no') review('Traditional IRA contributions with workplace or self-employed plan coverage require Pub590-A AppendixB before calculating taxable benefits.');
  if (org.socialSecurityForeignExclusion !== 'no') review('Foreign or territory income exclusions need coordinated return calculations beyond this supported benefit worksheet.');
  if (org.socialSecurityIncomeComplete !== 'yes' || org.socialSecurityAdjustmentsComplete !== 'yes') review('Confirm all income and the supported Schedule1 adjustments are entered for the return, including both spouses on a joint return.');
  return {
    netBenefits: money(org.socialSecurityNetBenefits, 'Box5 net benefits (negative net repayments need separate review)'),
    taxExemptInterest: money(org.socialSecurityTaxExemptInterest, 'tax-exempt interest'),
    excludedSavingsBondInterest: money(org.socialSecurityExcludedSavingsBondInterest, 'excluded savings-bond interest'),
    exclusionAddbacks: money(org.socialSecurityAdoptionExclusion, 'excluded adoption benefits'),
    federalWithheld: money(org.socialSecurityFederalWithheld, 'SSA/RRB federal withholding'),
  };
}

/** Retained for legacy callers: only complete supported facts pass. */
export function assertSocialSecurityBenefitsSupported(org: Record<string, unknown>): void {
  readSocialSecurityFacts(org);
}

/** Organizer payments are not automatically deductible amounts. Reconcile them
 * with the deduction records used by the annual estimate instead of dropping them. */
export function assertSocialSecurityAdjustmentRecords(org: Record<string, unknown>, deductions: {
  healthInsurancePremiums: number; sepIraContribution: number; solo401kContribution: number;
  simpleIraContribution: number; hsaContribution: number; studentLoanInterest: number;
}) {
  const retirement = org.retirementType === 'sep_ira' ? deductions.sepIraContribution
    : org.retirementType === 'solo_401k' ? deductions.solo401kContribution
      : org.retirementType === 'simple_ira' ? deductions.simpleIraContribution : undefined;
  const fields = [
    ['paidHealthInsurance', 'healthInsurancePremium', 'self-employed health insurance', deductions.healthInsurancePremiums],
    ['madeRetirementContrib', 'retirementAmount', 'retirement deduction', retirement],
    ['paidHSA', 'hsaAmount', 'HSA deduction', deductions.hsaContribution],
    ['paidStudentLoanInterest', 'studentLoanInterest', 'student-loan interest deduction', deductions.studentLoanInterest],
  ] as const;
  for (const [flag, field, label, savedDeduction] of fields) {
    const raw = org[field];
    if (org[flag] !== 'yes' && (raw === undefined || raw === null || raw === '')) continue;
    const organizerAmount = money(raw, label);
    if ((org[flag] === 'no' && organizerAmount !== 0) || (org[flag] === 'yes' && savedDeduction === undefined)
      || Math.abs(organizerAmount - (savedDeduction ?? 0)) > .005) {
      review(`Reconcile the ${label} recorded in Tax Organizer with Tax Deductions. Confirm the allowed deduction there; raw payments or contributions are not automatically deductible.`);
    }
  }
}
