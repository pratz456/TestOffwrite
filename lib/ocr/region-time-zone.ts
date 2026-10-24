/**
 * A region zone, or UTC.
 * The canonical name must look like Area/Location. Etc/ names, fixed offsets,
 * and abbreviations such as est are not stored and are not used as the zone.
 * An abbreviation is never rewritten into a region.
 * The saved region name is whatever this Node zone table returns. Asia/Kolkata
 * may be saved as Asia/Calcutta, and Asia/Kathmandu as Asia/Katmandu. A saved
 * zone string is only passed back to Intl. It is never compared as text.
 * UTC is stored only for the names in UTC_ZONE_ALIASES, compared in lowercase:
 * utc, etc/utc, etc/gmt, gmt, etc/universal, universal, etc/zulu, zulu, gmt0,
 * etc/gmt0, etc/gmt+0, gmt+0, gmt-0, etc/gmt-0, uct, etc/uct, greenwich, and
 * etc/greenwich. Z, numeric offsets, GMT+5, Etc/GMT with an hour other than 0,
 * EST, PST, EST5EDT, and CST6CDT stay unset.
 */

/** Names stored as UTC. Comparison is lowercase. Intl resolves each of these to UTC. */
export const UTC_ZONE_ALIASES = new Set([
  'utc',
  'etc/utc',
  'etc/gmt',
  'gmt',
  'etc/universal',
  'universal',
  'etc/zulu',
  'zulu',
  'gmt0',
  'etc/gmt0',
  'etc/gmt+0',
  'gmt+0',
  'gmt-0',
  'etc/gmt-0',
  'uct',
  'etc/uct',
  'greenwich',
  'etc/greenwich',
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
