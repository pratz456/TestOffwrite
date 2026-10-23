/**
 * Whether this person has a home office for the hired fare label.
 *
 * home_office_sqft, the onboarding name homeOfficeSqft, and settings/homeOffice
 * officeSqFt count when greater than 0. A numeric string such as "150" counts
 * the same way. A present home_office_details object counts on its own.
 * Legacy boolean keys are accepted too. A method with no square footage and
 * no details does not count.
 *
 * With vehicle copy off, the tax wizard does not use this helper. It keeps
 * the earlier check: home_office_sqft greater than 0, or home_office_details.
 */
const LEGACY_HOME_OFFICE_FLAGS = ['home_office', 'homeOffice', 'has_home_office'] as const;

const HOME_OFFICE_KEYS = [
  'home_office_sqft', 'homeOfficeSqft', 'home_office_details', 'home_office_method',
  'home_office', 'homeOffice', 'has_home_office', 'officeSqFt',
] as const;

function positiveAmount(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!/^\+?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return false;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0;
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
