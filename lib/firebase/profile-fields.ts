/** Public account fields; billing and bank credentials are server-managed. */
export const EDITABLE_PROFILE_FIELDS = new Set([
  'email', 'name', 'profession', 'business_entity_type', 'primary_work_location',
  'work_related_travel_pattern', 'income', 'state', 'filing_status', 'year_of_birth',
  'onboardingIntroCompleted', 'onboardingPlaidGuideCompleted', 'itemization_status',
  'business_start_date', 'home_office_sqft', 'total_home_sqft', 'home_office_method',
  'vehicle_business_use_percentage', 'vehicle_deduction_method', 'naics_code',
  'business_purpose', 'ein', 'w2_income', 'w2_federal_withheld', 'health_insurance_premiums',
  'sep_ira_contribution', 'solo_401k_contribution', 'hsa_contribution', 'simple_ira_contribution', 'business_income',
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

function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every(part => part.length > 0 && /^[A-Za-z0-9+/=]+$/.test(part));
}

/** Last four digits only. Ciphertext is left for the server to unwrap before this runs. */
export function maskedEinValue(ein: unknown, einLast4: unknown): string | undefined {
  if (typeof einLast4 === 'string' && /^\d{4}$/.test(einLast4)) return `**-***${einLast4}`;
  if (typeof ein !== 'string' || !ein.trim() || looksEncrypted(ein)) return undefined;
  const digits = ein.replace(/\D/g, '');
  return digits.length >= 4 ? `**-***${digits.slice(-4)}` : undefined;
}

export function publicProfile(data: Record<string, unknown>, uid: string) {
  const visible = Object.fromEntries(Object.entries(data).filter(([key]) =>
    key !== 'ein' && (EDITABLE_PROFILE_FIELDS.has(key) || READ_ONLY_PROFILE_FIELDS.includes(key))));
  const ein = maskedEinValue(data.ein, data.ein_last4);
  return { ...visible, ...(ein ? { ein } : {}), id: uid };
}
