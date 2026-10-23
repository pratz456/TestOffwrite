import { createHash } from 'node:crypto';

/**
 * Input and profile hashes from 52f5788d, before hired_fare_use and the vehicle
 * context rewrite. Tests compare the current functions with the switch off.
 */
const BASE_INPUT_FIELDS = [
  'trans_id', 'merchant_name', 'name', 'amount', 'date', 'datetime', 'category', 'bank_category', 'description', 'notes', 'note',
  'account_id', 'pending', 'business_purpose', 'attendees', 'travel_destination', 'equipment_details',
  'client_project', 'documentation_status', 'meeting_notes', 'mileage_details', 'location', 'city', 'state',
  'receipt_url', 'receipt_filename', 'ocr_data',
  'merchant_category_code', 'mcc', 'payment_channel', 'authorized_date', 'iso_currency_code',
  'unofficial_currency_code', 'personal_finance_category', 'counterparties', 'merchant_entity_id',
  'transaction_kind', 'business_use_percentage',
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value ?? null;
}

export function baselineInputHash(data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(BASE_INPUT_FIELDS.map(key => [key, data[key]]))))).digest('hex');
}

function finiteNonnegative(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const text = value.trim().replace(/^\$\s*/, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return undefined;
    value = Number(text.replace(/,/g, ''));
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}

function nonemptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function businessEntity(value: unknown): string | undefined {
  const key = nonemptyText(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    sole_proprietor: 'sole_proprietor', sole_proprietorship: 'sole_proprietor',
    'sole_proprietor_/_independent_contractor': 'sole_proprietor',
    single_member_llc: 'single_member_llc', 'single_member_llc_(disregarded_entity)': 'single_member_llc',
    multi_member_llc: 'multi_member_llc', s_corporation: 's_corporation', c_corporation: 'c_corporation',
    partnership: 'partnership', nonprofit: 'nonprofit', not_applicable: 'not_applicable',
    this_does_not_apply_to_me: 'not_applicable',
  };
  return key && Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : undefined;
}

function calculateYearsInBusiness(businessStartDate: string | undefined, transactionDate: string): number | undefined {
  if (!businessStartDate) return undefined;
  try {
    const startDate = new Date(businessStartDate);
    const asOf = new Date(transactionDate);
    const years = (asOf.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return Number.isFinite(years) && years >= 0 ? Math.floor(years) : undefined;
  } catch {
    return undefined;
  }
}

/** convertToEnhancedContext as it returned context on 52f5788d. */
export function baselineEnhancedContext(userProfile: any, transactionDate: string) {
  userProfile = userProfile && typeof userProfile === 'object' && !Array.isArray(userProfile) ? userProfile : {};
  const rawProfessions = typeof userProfile.profession === 'string' ? userProfile.profession.split(',') :
    Array.isArray(userProfile.profession) ? userProfile.profession : [];
  const professions = rawProfessions.map(nonemptyText).filter((value: string | undefined): value is string => !!value);
  const birthYear = finiteNonnegative(userProfile.year_of_birth);
  const transactionYear = new Date(transactionDate).getUTCFullYear();
  const income = finiteNonnegative(userProfile.income);
  const yearsInBusiness = calculateYearsInBusiness(userProfile.business_start_date, transactionDate);
  const travel = nonemptyText(userProfile.work_related_travel_pattern)?.toLowerCase();
  return {
    user_id: userProfile.id || '',
    birth_year: birthYear !== undefined && Number.isInteger(birthYear) && birthYear >= 1900 && birthYear <= transactionYear ? birthYear : undefined,
    profession: professions,
    annual_gross_income_usd: income,
    filing_state: nonemptyText(userProfile.state) || '',
    business_entity: businessEntity(userProfile.business_entity_type) ?? businessEntity(userProfile.business_entity),
    office_location: userProfile.primary_work_location,
    work_related_travel: travel === 'frequent' || travel === 'occasional' || travel === 'none' ? travel : undefined,
    work_related_travel_pattern: nonemptyText(userProfile.work_related_travel_pattern),
    income: userProfile.income,
    state: userProfile.state,
    filing_status: userProfile.filing_status,
    business_structure: userProfile.business_structure,
    itemized: userProfile.itemized,
    prior_deductions_used: userProfile.prior_deductions_used,
    mixed_use_flag: userProfile.mixed_use_flag,
    annual_income_scale: userProfile.annual_income_scale,
    itemization_status: userProfile.itemization_status,
    business_start_date: userProfile.business_start_date,
    years_in_business: yearsInBusiness,
    home_office_sqft: finiteNonnegative(userProfile.home_office_sqft),
    total_home_sqft: finiteNonnegative(userProfile.total_home_sqft),
    home_office_method: userProfile.home_office_method,
    vehicle_business_use_percentage: finiteNonnegative(userProfile.vehicle_business_use_percentage),
    vehicle_deduction_method: userProfile.vehicle_deduction_method,
    naics_code: userProfile.naics_code,
    business_purpose: userProfile.business_purpose,
    w2_income: finiteNonnegative(userProfile.w2_income),
    business_income: finiteNonnegative(userProfile.business_income),
    other_income: finiteNonnegative(userProfile.other_income),
    tax_bracket: userProfile.tax_bracket,
    professional_licenses: userProfile.professional_licenses || [],
    prior_year_deductions: userProfile.prior_year_deductions || [],
    audit_history: userProfile.audit_history,
    tax_professional: userProfile.tax_professional,
    documentation_habits: userProfile.documentation_habits,
    business_seasonality: userProfile.business_seasonality,
    multiple_locations: userProfile.multiple_locations,
    international_business: userProfile.international_business,
    business_vehicle: userProfile.business_vehicle,
    home_office_details: userProfile.home_office_details,
    income_breakdown: userProfile.income_breakdown,
  };
}

export function baselineProfileHash(profile: Record<string, unknown>, date: string): string {
  const context = { ...baselineEnhancedContext(profile, date), user_id: undefined };
  return createHash('sha256').update(JSON.stringify(canonical(context))).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}
