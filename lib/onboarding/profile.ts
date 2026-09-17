import type { UserProfile } from '@/lib/firebase/profiles';

export interface ProfileSetupData {
  email: string;
  name: string;
  yearOfBirth?: string;
  profession: string[];
  customProfession?: string;
  businessEntityType: string;
  primaryWorkLocation: string;
  workRelatedTravelPattern: string;
  income: string;
  state: string;
  filingStatus: string;
  businessStartDate?: string;
  homeOfficeSqft?: number;
  totalHomeSqft?: number;
  vehicleBusinessUsePercentage?: number;
  businessPurpose?: string;
  ein?: string;
  w2Income?: number;
  businessIncome?: number;
}

export function missingProfileFields(data: ProfileSetupData): string[] {
  const missing: string[] = [];
  for (const [field, label] of [
    ['email', 'email address'], ['name', 'full name'], ['state', 'state'],
    ['filingStatus', 'filing status'], ['businessEntityType', 'business entity type'],
    ['primaryWorkLocation', 'work location'], ['income', 'income range'],
  ] as const) {
    if (!data[field].trim()) missing.push(label);
  }
  if (!data.profession.length) missing.push('at least one profession');
  if (data.profession.includes('Other') && !data.customProfession?.trim()) missing.push('your profession');
  return missing;
}

export function profileDetailsError(data: ProfileSetupData, skipBusiness: boolean, currentYear = new Date().getFullYear()): string | null {
  if (data.yearOfBirth && (!/^\d{4}$/.test(data.yearOfBirth) || Number(data.yearOfBirth) < 1900 || Number(data.yearOfBirth) > currentYear)) {
    return 'Enter a valid four-digit year of birth.';
  }
  for (const [amount, label] of [[data.w2Income, 'W-2 income'], [data.businessIncome, 'self-employment income']] as const) {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) return `Enter ${label} as a number of zero or more.`;
  }
  if (skipBusiness) return null;
  for (const [area, label] of [[data.homeOfficeSqft, 'office area'], [data.totalHomeSqft, 'total home area']] as const) {
    if (area !== undefined && (!Number.isFinite(area) || area < 0)) return `Enter ${label} as a number of zero or more.`;
  }
  if (data.homeOfficeSqft !== undefined && data.totalHomeSqft !== undefined && data.homeOfficeSqft > data.totalHomeSqft) {
    return 'Office area cannot be larger than the total home area.';
  }
  const use = data.vehicleBusinessUsePercentage;
  if (use !== undefined && (!Number.isFinite(use) || use < 0 || use > 100)) return 'Vehicle business use must be between 0% and 100%.';
  if (data.ein?.trim() && !/^\d{2}-?\d{7}$/.test(data.ein.trim())) return 'Enter a nine-digit EIN, or leave it blank.';
  return null;
}

export function profileWriteData(data: ProfileSetupData, skipBusiness: boolean): Partial<UserProfile> {
  return {
    email: data.email.trim(), name: data.name.trim(),
    year_of_birth: data.yearOfBirth || undefined,
    profession: data.profession.filter(p => p !== 'Other').concat(data.profession.includes('Other') ? [data.customProfession!.trim()] : []).join(', '),
    business_entity_type: data.businessEntityType,
    primary_work_location: data.primaryWorkLocation,
    work_related_travel_pattern: data.workRelatedTravelPattern || undefined,
    income: data.income, state: data.state, filing_status: data.filingStatus,
    w2_income: data.w2Income, business_income: data.businessIncome,
    ...(!skipBusiness ? {
      business_start_date: data.businessStartDate || undefined,
      home_office_sqft: data.homeOfficeSqft, total_home_sqft: data.totalHomeSqft,
      vehicle_business_use_percentage: data.vehicleBusinessUsePercentage,
      business_purpose: data.businessPurpose?.trim() || undefined,
      ein: data.ein?.trim() || undefined,
    } : {}),
  };
}

/** Completion callbacks use a screen key; only the standalone page builds a URL. */
export const PROFILE_COMPLETE_SCREEN = 'dashboard';
export const PROFILE_COMPLETE_URL = '/protected?screen=dashboard';

/** Answers only the setup form records; a document holding just the consent record has none. */
const SETUP_ANSWER_FIELDS = ['name', 'profession', 'state', 'filing_status', 'income'] as const;

function hasSetupAnswers(profile: Record<string, unknown>): boolean {
  return SETUP_ANSWER_FIELDS.some(field => {
    const value = profile[field];
    return typeof value === 'string' ? value.trim() !== '' : value != null;
  });
}

export function profileLookupState(profile: unknown, error: unknown): 'existing' | 'missing' | 'error' {
  if (error) {
    const code = typeof error === 'object' && 'code' in error ? error.code : undefined;
    return code === 'PROFILE_NOT_FOUND' || code === 'PGRST116' ? 'missing' : 'error';
  }
  if (!profile) return 'missing';
  // Consents are recorded before the setup answers, so a consent-only document
  // still needs onboarding. Profiles without a consent record are untouched.
  const record = profile as Record<string, unknown>;
  if (typeof profile === 'object' && record.consents && !hasSetupAnswers(record)) return 'missing';
  return 'existing';
}
