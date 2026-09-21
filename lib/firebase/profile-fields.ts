/** Public account fields; billing and bank credentials are server-managed. */
export const EDITABLE_PROFILE_FIELDS = new Set([
  'email', 'name', 'profession', 'business_entity_type', 'primary_work_location',
  'work_related_travel_pattern', 'income', 'state', 'filing_status', 'year_of_birth',
  'onboardingIntroCompleted', 'onboardingPlaidGuideCompleted', 'itemization_status',
  'business_start_date', 'home_office_sqft', 'total_home_sqft', 'home_office_method',
  'vehicle_business_use_percentage', 'vehicle_deduction_method', 'naics_code',
  'business_purpose', 'ein', 'w2_income', 'w2_federal_withheld', 'health_insurance_premiums',
  'sep_ira_contribution', 'solo_401k_contribution', 'hsa_contribution', 'business_income',
  'other_income', 'tax_bracket', 'professional_licenses', 'prior_year_tax', 'mailing_address',
  'prior_year_deductions', 'audit_history', 'tax_professional', 'documentation_habits',
  'business_seasonality', 'multiple_locations', 'international_business', 'business_vehicle',
  'home_office_details', 'income_breakdown', 'businessEntityType', 'primaryWorkLocation',
  'workRelatedTravelPattern', 'annualIncomeRange',
  // Sign-up acknowledgments; the route validates the shape with parseConsentRecord
  // and firestore.rules keeps the field server-only.
  'consents',
]);

/** Server-stamped metadata returned with the profile but never accepted from a client. */
const READ_ONLY_PROFILE_FIELDS = ['created_at', 'updated_at', 'bankConnected', 'consents_recorded_at'];

export function publicProfile(data: Record<string, unknown>, uid: string) {
  return { ...Object.fromEntries(Object.entries(data).filter(([key]) =>
    EDITABLE_PROFILE_FIELDS.has(key) || READ_ONLY_PROFILE_FIELDS.includes(key))), id: uid };
}
