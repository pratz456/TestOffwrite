import { SNAPSHOT_DEPENDENT_FIELDS } from './credit-scope';

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

export type DependentIdentifierKind = 'ssn' | 'itin' | 'atin' | 'none' | 'unknown';

const DEPENDENT_SSN_FIELD = /^(?:dependent\d*)?ssn$/i;
const DEPENDENT_ATIN_FIELD = /^(?:dependent\d*)?atin$/i;
const DEPENDENT_ITIN_FIELD = /^(?:dependent\d*)?itin$/i;
const EXPLICIT_KIND_FIELDS = ['identifierKind', 'identifierType', 'idType', 'identificationType', 'type'] as const;
/** Credit facts kept for each dependent. Same fields the federal snapshot reads. */
export const DEPENDENT_CREDIT_FIELDS = SNAPSHOT_DEPENDENT_FIELDS;

/**
 * Dependent properties the organizer can store that are not credit facts.
 * Each value is a one-line reason the refresh key leaves that property out.
 */
export const DEPENDENT_IGNORED_FIELDS: Readonly<Record<string, string>> = {
  dependentDetails: 'free-text note, not a structured credit fact',
  dependents: 'the dependent list or count, not a fact inside one record',
  dob: 'detail label; the credit fact is dateOfBirth',
  name: 'display only',
  ssn: 'identifier field; the key keeps the kind',
};

type DependentRelationship = 'child' | 'stepchild' | 'eligible_foster_child' | 'sibling' | 'descendant_of_child_or_sibling' | 'parent' | 'other_relative' | 'not_related';

const RELATIONSHIP_BY_LABEL: Readonly<Record<string, DependentRelationship>> = {
  child: 'child',
  son: 'child',
  daughter: 'child',
  adopted: 'child',
  'adopted child': 'child',
  'adopted son': 'child',
  'adopted daughter': 'child',
  stepchild: 'stepchild',
  'step child': 'stepchild',
  stepson: 'stepchild',
  stepdaughter: 'stepchild',
  'step son': 'stepchild',
  'step daughter': 'stepchild',
  'eligible foster child': 'eligible_foster_child',
  'foster child': 'eligible_foster_child',
  'foster son': 'eligible_foster_child',
  'foster daughter': 'eligible_foster_child',
  sibling: 'sibling',
  brother: 'sibling',
  sister: 'sibling',
  'half brother': 'sibling',
  'half sister': 'sibling',
  halfbrother: 'sibling',
  halfsister: 'sibling',
  stepbrother: 'sibling',
  stepsister: 'sibling',
  'step brother': 'sibling',
  'step sister': 'sibling',
  grandchild: 'descendant_of_child_or_sibling',
  'grand child': 'descendant_of_child_or_sibling',
  grandson: 'descendant_of_child_or_sibling',
  granddaughter: 'descendant_of_child_or_sibling',
  niece: 'descendant_of_child_or_sibling',
  nephew: 'descendant_of_child_or_sibling',
  'descendant of child or sibling': 'descendant_of_child_or_sibling',
  parent: 'parent',
  mother: 'parent',
  father: 'parent',
  'other relative': 'other_relative',
  'not related': 'not_related',
  unrelated: 'not_related',
};

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(5, 7));
  const day = Number(trimmed.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return trimmed;
}

function canonicalRelationship(value: unknown): DependentRelationship | 'unknown' {
  if (typeof value !== 'string' || /\d/.test(value)) return 'unknown';
  const label = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!label || /\d/.test(label)) return 'unknown';
  return RELATIONSHIP_BY_LABEL[label] ?? 'unknown';
}

export function readOrganizerTaxInput(organizer: Record<string, unknown>, field: OrganizerTaxInputField): unknown {
  return organizer[field];
}

function filled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return value !== null && value !== undefined;
}

function statedKind(value: unknown): DependentIdentifierKind | null {
  if (typeof value !== 'string') return null;
  const kind = value.trim().toLowerCase();
  if (kind === 'ssn' || kind === 'itin' || kind === 'atin' || kind === 'none' || kind === 'unknown') return kind;
  return null;
}

function explicitKind(record: Record<string, unknown>): DependentIdentifierKind | null {
  for (const field of EXPLICIT_KIND_FIELDS) {
    const kind = statedKind(record[field]);
    if (kind) return kind;
  }
  return null;
}

/** A stored idKind wins, including unknown, then an explicit type, then the field name. Several filled fields resolve ssn, then atin, then itin. */
function dependentIdentifierKind(record: Record<string, unknown>): DependentIdentifierKind {
  const stored = statedKind(record.idKind);
  if (stored) return stored;
  const stated = explicitKind(record);
  if (stated) return stated;
  let atin = false;
  let itin = false;
  for (const [key, value] of Object.entries(record)) {
    if (!filled(value)) continue;
    if (DEPENDENT_SSN_FIELD.test(key)) return 'ssn';
    if (DEPENDENT_ATIN_FIELD.test(key)) atin = true;
    else if (DEPENDENT_ITIN_FIELD.test(key)) itin = true;
  }
  if (atin) return 'atin';
  if (itin) return 'itin';
  return 'none';
}

function presentDependentRecord(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const field of DEPENDENT_CREDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const value = record[field];
    if (field === 'relationship') {
      if (typeof value === 'string' && !value.trim()) continue;
      copy.relationship = canonicalRelationship(value);
      continue;
    }
    if (field === 'dateOfBirth') {
      copy.dateOfBirth = canonicalDate(value);
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) copy[field] = trimmed;
    } else if (typeof value === 'number' && Number.isFinite(value)) copy[field] = value;
    else if (typeof value === 'boolean') copy[field] = value;
  }
  copy.identifierKind = dependentIdentifierKind(record);
  return copy;
}

function presentDependents(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter(plainRecord).map(item => presentDependentRecord(item));
  if (plainRecord(value)) return presentDependentRecord(value);
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
  if (!trimmed) return null;
  if (/^\d{1,2}$/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* Anything other than a count or JSON is left out. */ }
  }
  return null;
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

/** Objects for the tax-input read. Dependents keep credit facts only. */
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
