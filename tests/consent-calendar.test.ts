import { describe, expect, it } from 'vitest';
import { defaultConsentExpiry, formatConsentDate, isValidTimeZone } from '@/lib/openai/consent-contract';

const losAngeles = 'America/Los_Angeles';

function civil(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour') % 24, minute: value('minute'), second: value('second'),
  };
}

describe('defaultConsentExpiry leap day in America/Los_Angeles', () => {
  it('keeps noon Pacific on February 28 after a February 29 signing', () => {
    const signedAt = new Date('2028-02-29T20:00:00.000Z');
    const expiry = defaultConsentExpiry(signedAt, losAngeles);
    expect(expiry.toISOString()).toBe('2029-02-28T20:00:00.000Z');
    expect(civil(signedAt, losAngeles)).toEqual({ year: 2028, month: 2, day: 29, hour: 12, minute: 0, second: 0 });
    expect(civil(expiry, losAngeles)).toEqual({ year: 2029, month: 2, day: 28, hour: 12, minute: 0, second: 0 });
    expect(formatConsentDate(expiry, losAngeles)).toBe('February 28, 2029');
  });

  it('keeps a February 28 signing on February 28 one year later', () => {
    const signedAt = new Date('2028-02-28T20:00:00.000Z');
    const expiry = defaultConsentExpiry(signedAt, losAngeles);
    expect(expiry.toISOString()).toBe('2029-02-28T20:00:00.000Z');
    expect(civil(expiry, losAngeles)).toEqual({ year: 2029, month: 2, day: 28, hour: 12, minute: 0, second: 0 });
  });

  it('keeps a March 1 signing on March 1 one year later', () => {
    const signedAt = new Date('2028-03-01T20:00:00.000Z');
    const expiry = defaultConsentExpiry(signedAt, losAngeles);
    expect(expiry.toISOString()).toBe('2029-03-01T20:00:00.000Z');
    expect(civil(signedAt, losAngeles)).toEqual({ year: 2028, month: 3, day: 1, hour: 12, minute: 0, second: 0 });
    expect(civil(expiry, losAngeles)).toEqual({ year: 2029, month: 3, day: 1, hour: 12, minute: 0, second: 0 });
  });
});

describe('defaultConsentExpiry keeps the local time for existing zone cases', () => {
  it('keeps 8:30 PM in Los Angeles across the following daylight saving change', () => {
    const signedAt = new Date('2026-03-11T03:30:00.000Z');
    const expiry = defaultConsentExpiry(signedAt, losAngeles);
    expect(civil(signedAt, losAngeles)).toEqual({ year: 2026, month: 3, day: 10, hour: 20, minute: 30, second: 0 });
    expect(expiry.toISOString()).toBe('2027-03-11T04:30:00.000Z');
    expect(civil(expiry, losAngeles)).toEqual({ year: 2027, month: 3, day: 10, hour: 20, minute: 30, second: 0 });
  });

  it('keeps a Kiritimati New Year at the same local time', () => {
    const signedAt = new Date('2025-12-31T10:30:00.000Z');
    const expiry = defaultConsentExpiry(signedAt, 'Pacific/Kiritimati');
    expect(civil(signedAt, 'Pacific/Kiritimati')).toEqual({ year: 2026, month: 1, day: 1, hour: 0, minute: 30, second: 0 });
    expect(expiry.toISOString()).toBe('2026-12-31T10:30:00.000Z');
    expect(civil(expiry, 'Pacific/Kiritimati')).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 30, second: 0 });
  });

  it('keeps a Tokyo New Year at the same local time', () => {
    const signedAt = new Date('2025-12-31T15:30:00.000Z');
    const expiry = defaultConsentExpiry(signedAt, 'Asia/Tokyo');
    expect(civil(signedAt, 'Asia/Tokyo')).toEqual({ year: 2026, month: 1, day: 1, hour: 0, minute: 30, second: 0 });
    expect(expiry.toISOString()).toBe('2026-12-31T15:30:00.000Z');
    expect(civil(expiry, 'Asia/Tokyo')).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 30, second: 0 });
  });
});

describe('isValidTimeZone', () => {
  it('refuses SystemV zones and still accepts region zones', () => {
    expect(isValidTimeZone('SystemV/PST8PDT')).toBe(false);
    expect(isValidTimeZone('SystemV/PST8')).toBe(false);
    expect(isValidTimeZone('SystemV/EST5EDT')).toBe(false);
    expect(isValidTimeZone('systemv/PST8PDT')).toBe(false);
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidTimeZone('Pacific/Kiritimati')).toBe(true);
  });
});
