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

export type OrganizerTaxInputScalar = string | number | boolean | null;

export type OrganizerTaxInputValues = { [K in OrganizerTaxInputField]: OrganizerTaxInputScalar };

/** Tax-input read: objects and arrays stay objects. Dependents carry no identifier values. */
export type OrganizerTaxInputResponse = {
  [K in OrganizerTaxInputField]: OrganizerTaxInputScalar | Record<string, unknown> | unknown[];
};

export type DependentIdentifierKind = 'ssn' | 'itin' | 'none';

const DEPENDENT_SSN_FIELD = /^(?:dependent\d*)?ssn$/i;
const DEPENDENT_ITIN_FIELD = /^(?:dependent\d*)?itin$/i;
const IDENTIFIER_KEY = /ssn|itin/i;
const EXPLICIT_KIND_FIELDS = ['identifierKind', 'identifierType', 'idType', 'identificationType', 'type'] as const;

export function readOrganizerTaxInput(organizer: Record<string, unknown>, field: OrganizerTaxInputField): unknown {
  return organizer[field];
}

function filled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return value !== null && value !== undefined;
}

function explicitKind(record: Record<string, unknown>): DependentIdentifierKind | null {
  for (const field of EXPLICIT_KIND_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    const kind = value.trim().toLowerCase();
    if (kind === 'ssn' || kind === 'itin' || kind === 'none') return kind;
  }
  return null;
}

/** SSN and ITIN are different Child Tax Credit facts. A filled SSN field wins over an ITIN field. */
function dependentIdentifierKind(record: Record<string, unknown>): DependentIdentifierKind {
  const stated = explicitKind(record);
  if (stated) return stated;
  let itin = false;
  for (const [key, value] of Object.entries(record)) {
    if (!filled(value)) continue;
    if (DEPENDENT_SSN_FIELD.test(key)) return 'ssn';
    if (DEPENDENT_ITIN_FIELD.test(key)) itin = true;
  }
  return itin ? 'itin' : 'none';
}

function withoutIdentifierKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdentifierKeys);
  if (!value || typeof value !== 'object') return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTIFIER_KEY.test(key)) continue;
    copy[key] = withoutIdentifierKeys(entry);
  }
  return copy;
}

function presentDependentRecord(record: Record<string, unknown>): Record<string, unknown> {
  const copy = withoutIdentifierKeys(record) as Record<string, unknown>;
  copy.identifierKind = dependentIdentifierKind(record);
  return copy;
}

function presentDependents(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => item && typeof item === 'object' && !Array.isArray(item)
      ? presentDependentRecord(item as Record<string, unknown>)
      : presentDependents(item));
  }
  if (value && typeof value === 'object') return presentDependentRecord(value as Record<string, unknown>);
  return value;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function cloneJson(value: unknown): Record<string, unknown> | unknown[] {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown> | unknown[];
}

function scalarTaxInputValue(value: unknown): OrganizerTaxInputScalar | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (Array.isArray(value) || typeof value === 'object') return undefined;
  return null;
}

function dependentSource(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return trimmed || null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* A count or other plain answer stays text. */ }
  return trimmed;
}

function dependentResponseValue(value: unknown): OrganizerTaxInputResponse['dependents'] {
  const source = dependentSource(value);
  const scalar = scalarTaxInputValue(source);
  if (scalar !== undefined) return scalar;
  return presentDependents(source) as Record<string, unknown> | unknown[];
}

function taxInputValue(value: unknown): OrganizerTaxInputScalar {
  const scalar = scalarTaxInputValue(value);
  if (scalar !== undefined) return scalar;
  return canonicalJson(cloneJson(value));
}

/** One stable value per snapshot field. Objects sort their keys. Missing answers are null. */
export function organizerTaxInputValues(data?: Record<string, unknown> | null): OrganizerTaxInputValues {
  const values = {} as OrganizerTaxInputValues;
  for (const field of ORGANIZER_TAX_INPUT_FIELDS) {
    values[field] = field === 'dependents' ? dependentKeyValue(data?.[field]) : taxInputValue(data?.[field]);
  }
  return values;
}

function dependentKeyValue(value: unknown): OrganizerTaxInputScalar {
  const presented = dependentResponseValue(value);
  if (presented === null || typeof presented === 'string' || typeof presented === 'number' || typeof presented === 'boolean') return presented;
  return canonicalJson(presented);
}

/** Whole objects for the tax-input read. Dependent identifier values are left out. */
export function organizerTaxInputResponse(data?: Record<string, unknown> | null): OrganizerTaxInputResponse {
  const values = {} as OrganizerTaxInputResponse;
  for (const field of ORGANIZER_TAX_INPUT_FIELDS) {
    if (field === 'dependents') {
      values.dependents = dependentResponseValue(data?.[field]);
      continue;
    }
    const scalar = scalarTaxInputValue(data?.[field]);
    values[field] = scalar !== undefined ? scalar : cloneJson(data?.[field]);
  }
  return values;
}
