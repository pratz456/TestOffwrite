/**
 * Organizer answers read by buildFederalTaxSnapshot. The dashboard refresh key
 * and the tax-input organizer read use this same list.
 */
export const ORGANIZER_TAX_INPUT_FIELDS = [
  'adjustmentEligibilityFacts',
  'amount1099DIV',
  'amount1099INT',
  'amountCapGains',
  'amountIRADistributions',
  'amountLongTermCapGains',
  'amountOtherIncome',
  'amountRentalIncome',
  'amountShortTermCapGains',
  'amountSocialSecurity',
  'businessLossFacts',
  'dateOfBirth',
  'dependents',
  'filingStatus',
  'hasCapGains',
  'hasSocialSecurity',
  'healthInsurancePremium',
  'hsaAmount',
  'madeRetirementContrib',
  'obbbaDeductionFacts',
  'paidHSA',
  'paidHealthInsurance',
  'paidStudentLoanInterest',
  'personalDeductionFacts',
  'retirementAmount',
  'retirementType',
  'socialSecurityAdjustmentsComplete',
  'socialSecurityAdoptionExclusion',
  'socialSecurityExcludedSavingsBondInterest',
  'socialSecurityFederalWithheld',
  'socialSecurityForeignExclusion',
  'socialSecurityIncomeComplete',
  'socialSecurityLivedApartAllYear',
  'socialSecurityLumpSum',
  'socialSecurityNetBenefits',
  'socialSecurityResident',
  'socialSecurityRetirementReviewed',
  'socialSecuritySpecialIRA',
  'socialSecurityTaxExemptInterest',
  'spouseDoB',
  'studentLoanInterest',
] as const;

export type OrganizerTaxInputField = (typeof ORGANIZER_TAX_INPUT_FIELDS)[number];

export type OrganizerTaxInputValues = { [K in OrganizerTaxInputField]: string | number | null };

export function readOrganizerTaxInput(organizer: Record<string, unknown>, field: OrganizerTaxInputField): unknown {
  return organizer[field];
}

function taxInputValue(value: unknown): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** One value per snapshot field. Missing answers are null. */
export function organizerTaxInputValues(data?: Record<string, unknown> | null): OrganizerTaxInputValues {
  const values = {} as OrganizerTaxInputValues;
  for (const field of ORGANIZER_TAX_INPUT_FIELDS) values[field] = taxInputValue(data?.[field]);
  return values;
}
