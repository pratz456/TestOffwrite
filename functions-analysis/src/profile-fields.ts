/** Shared by the event bridge and Settings. Display, billing and sync metadata are excluded. */
export const ANALYSIS_PROFILE_FIELDS = [
  'profession', 'year_of_birth', 'income', 'state', 'filing_status', 'business_entity_type', 'business_entity',
  'primary_work_location', 'work_related_travel_pattern', 'business_structure', 'itemized', 'prior_deductions_used',
  'mixed_use_flag', 'annual_income_scale', 'itemization_status', 'business_start_date', 'home_office_sqft',
  'total_home_sqft', 'home_office_method', 'vehicle_business_use_percentage', 'vehicle_deduction_method',
  'naics_code', 'business_purpose', 'w2_income', 'business_income', 'other_income', 'tax_bracket',
  'professional_licenses', 'prior_year_deductions', 'audit_history', 'tax_professional', 'documentation_habits',
  'business_seasonality', 'multiple_locations', 'international_business', 'business_vehicle', 'home_office_details',
  'income_breakdown',
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value ?? null;
}

export function analysisProfileFieldsKey(profile: Record<string, unknown>): string {
  return JSON.stringify(ANALYSIS_PROFILE_FIELDS.map(field => canonical(profile[field])));
}

export function hasAnalysisProfileChange(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): boolean {
  return !!after && analysisProfileFieldsKey(before ?? {}) !== analysisProfileFieldsKey(after);
}
