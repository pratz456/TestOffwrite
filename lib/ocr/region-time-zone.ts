/**
 * A region zone, or exactly UTC.
 * The canonical name must look like Area/Location. Etc/ names, fixed offsets,
 * and abbreviations such as est are not stored and are not used as the zone.
 * An abbreviation is never rewritten into a region.
 */
export function regionUploadTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  if (canonical === 'UTC') return value.toLowerCase() === 'utc' ? 'UTC' : undefined;
  if (!canonical.includes('/') || canonical.startsWith('Etc/')) return undefined;
  if (!value.includes('/') && value.toLowerCase() !== canonical.toLowerCase()) return undefined;
  return canonical;
}
