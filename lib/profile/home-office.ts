/**
 * Whether this person has a home office.
 *
 * The tax form wizard uses square footage or a saved details record
 * (components/tax-form-wizard-screen.tsx). The same test is used here.
 * home_office_sqft and the onboarding name homeOfficeSqft count when greater
 * than 0. settings/homeOffice stores that square footage as officeSqFt.
 * A present home_office_details object counts on its own.
 * Legacy boolean keys are accepted too. A method with no square footage and
 * no details does not count.
 */
const LEGACY_HOME_OFFICE_FLAGS = ['home_office', 'homeOffice', 'has_home_office'] as const;

const HOME_OFFICE_KEYS = [
  'home_office_sqft', 'homeOfficeSqft', 'home_office_details', 'home_office_method',
  'home_office', 'homeOffice', 'has_home_office', 'officeSqFt',
] as const;

function positiveAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function profileHasHomeOffice(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  const record = profile as Record<string, unknown>;
  if (LEGACY_HOME_OFFICE_FLAGS.some(key => record[key] === true)) return true;
  const settings = record.homeOffice;
  const settingsSqft = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).officeSqFt : undefined;
  if (positiveAmount(record.home_office_sqft) || positiveAmount(record.homeOfficeSqft) || positiveAmount(record.officeSqFt) || positiveAmount(settingsSqft)) return true;
  return Boolean(record.home_office_details);
}

/** Copy home office facts that a normalized profile dropped, including settings/homeOffice. */
export function withHomeOfficeSources(profile: unknown, ...extras: unknown[]): Record<string, unknown> | null {
  if ((!profile || typeof profile !== 'object' || Array.isArray(profile)) && extras.every(extra => !extra || typeof extra !== 'object' || Array.isArray(extra))) return null;
  const merged: Record<string, unknown> = profile && typeof profile === 'object' && !Array.isArray(profile)
    ? { ...(profile as Record<string, unknown>) } : {};
  for (const extra of extras) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) continue;
    const record = extra as Record<string, unknown>;
    for (const key of HOME_OFFICE_KEYS) {
      if (merged[key] == null && record[key] != null) merged[key] = record[key];
    }
  }
  return merged;
}
