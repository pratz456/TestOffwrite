/**
 * A region zone, or UTC.
 * The canonical name must look like Area/Location. Etc/ names, fixed offsets,
 * and abbreviations such as est are not stored and are not used as the zone.
 * An abbreviation is never rewritten into a region.
 * Exact zero-offset aliases are stored as UTC. A numbered offset is not an alias.
 */

/** Names Intl resolves to UTC and that are stored as UTC. Comparison is lowercase. */
const UTC_ZONE_ALIASES = new Set([
  'utc',
  'etc/utc',
  'etc/gmt',
  'gmt',
  'etc/universal',
  'universal',
  'etc/zulu',
  'zulu',
  // Intl resolves these three to UTC. GMT-0, GMT+0, and Etc/GMT-0 stay rejected.
  'gmt0',
  'etc/gmt0',
  'etc/gmt+0',
]);

export function regionUploadTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  if (canonical === 'UTC') return UTC_ZONE_ALIASES.has(value.toLowerCase()) ? 'UTC' : undefined;
  if (!canonical.includes('/') || canonical.startsWith('Etc/')) return undefined;
  if (!value.includes('/') && value.toLowerCase() !== canonical.toLowerCase()) return undefined;
  return canonical;
}
