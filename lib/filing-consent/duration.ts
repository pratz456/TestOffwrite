/**
 * Consent duration in UTC. Calendar arithmetic uses UTC fields so the stored
 * instant does not change when the process timezone changes.
 *
 * A missing duration at save time becomes one year (Rev. Proc. 2013-14
 * section 5.04(1)(b)). expiresAt is that instant. A missing expiresAt on a
 * stored record is a missing field, never an open ended consent.
 */

export type DurationUnit = 'years' | 'days';

export interface DurationStated {
  unit: DurationUnit;
  count: number;
}

export const DEFAULT_CONSENT_DURATION: DurationStated = { unit: 'years', count: 1 };

export function isDurationStated(value: unknown): value is DurationStated {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const unit = (value as { unit?: unknown }).unit;
  const count = (value as { count?: unknown }).count;
  if (unit !== 'years' && unit !== 'days') return false;
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 100;
}

/** UTC instant of signedAt plus the stated duration, or null when the inputs are unusable. */
export function expiresAtFor(signedAtIso: string, duration: DurationStated): string | null {
  if (!isDurationStated(duration)) return null;
  const signed = new Date(signedAtIso);
  if (Number.isNaN(signed.getTime())) return null;
  const year = signed.getUTCFullYear();
  const month = signed.getUTCMonth();
  const day = signed.getUTCDate();
  const hours = signed.getUTCHours();
  const minutes = signed.getUTCMinutes();
  const seconds = signed.getUTCSeconds();
  const millis = signed.getUTCMilliseconds();
  if (duration.unit === 'years') {
    const targetYear = year + duration.count;
    const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, lastDay);
    return new Date(Date.UTC(targetYear, month, clampedDay, hours, minutes, seconds, millis)).toISOString();
  }
  return new Date(Date.UTC(year, month, day + duration.count, hours, minutes, seconds, millis)).toISOString();
}

/** True only after the expiresAt instant. The expiresAt instant itself is still inside the consent. */
export function isPastExpiry(expiresAtIso: string, now: Date): boolean {
  const expires = new Date(expiresAtIso);
  if (Number.isNaN(expires.getTime()) || Number.isNaN(now.getTime())) return true;
  return now.getTime() > expires.getTime();
}
