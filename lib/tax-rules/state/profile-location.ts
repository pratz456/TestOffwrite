/**
 * Reads the saved state and optional city from a profile record. The mailing address
 * takes precedence over the onboarding `state` field, matching the previous route logic.
 * Values are returned as saved (a code or a full state name); the registry resolves them.
 */
export function readProfileLocation(profile: Record<string, unknown> | null | undefined): { state: string; city: string } {
  const mailing = profile && typeof profile.mailing_address === 'object' && profile.mailing_address !== null
    ? (profile.mailing_address as Record<string, unknown>)
    : undefined;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return {
    state: text(mailing?.state) || text(profile?.state),
    city: text(mailing?.city),
  };
}
