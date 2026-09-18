import { describe, expect, it } from 'vitest';
import {
  INSTALL_MIN_VISITS, INSTALL_SNOOZE_KEY, LEGACY_DISMISS_KEY,
  isQuietInstallRoute, recordInstallVisit, shouldOfferInstall, snoozeInstallPrompt,
} from '@/lib/pwa/install-prompt-policy';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, map };
}
const now = new Date('2026-09-17T12:00:00Z');

describe('install prompt policy', () => {
  it('counts one visit per page load and tolerates corrupted counters', () => {
    const storage = memoryStorage();
    expect(recordInstallVisit(storage)).toBe(1);
    expect(recordInstallVisit(storage)).toBe(2);
    expect(recordInstallVisit(memoryStorage({ 'writeoff-pwa-visit-count': 'garbage' }))).toBe(1);
  });
  it('stays quiet during sign-in, onboarding and checkout routes', () => {
    for (const route of ['/auth/login', '/auth/sign-up-success', '/onboarding', '/protected/onboarding/plaid', '/stripe/success']) expect(isQuietInstallRoute(route)).toBe(true);
    for (const route of ['/', '/protected', '/protected/reports', '/tools/1099-tax-calculator', null]) expect(isQuietInstallRoute(route)).toBe(false);
  });
  it('offers installation only from the third visit on an ordinary screen', () => {
    const storage = memoryStorage();
    expect(shouldOfferInstall({ pathname: '/protected', storage, visitCount: INSTALL_MIN_VISITS - 1, now })).toBe(false);
    expect(shouldOfferInstall({ pathname: '/protected', storage, visitCount: INSTALL_MIN_VISITS, now })).toBe(true);
    expect(shouldOfferInstall({ pathname: '/auth/login', storage, visitCount: 10, now })).toBe(false);
  });
  it('honors "Not now" for thirty days and then offers again', () => {
    const storage = memoryStorage();
    snoozeInstallPrompt(storage, now);
    expect(storage.getItem(INSTALL_SNOOZE_KEY)).toBe('2026-10-17T12:00:00.000Z');
    expect(shouldOfferInstall({ pathname: '/protected', storage, visitCount: 5, now })).toBe(false);
    expect(shouldOfferInstall({ pathname: '/protected', storage, visitCount: 5, now: new Date('2026-10-17T11:59:59Z') })).toBe(false);
    expect(shouldOfferInstall({ pathname: '/protected', storage, visitCount: 5, now: new Date('2026-10-17T12:00:01Z') })).toBe(true);
  });
  it('keeps honoring the permanent dismissal written by earlier builds', () => {
    const storage = memoryStorage({ [LEGACY_DISMISS_KEY]: 'true' });
    expect(shouldOfferInstall({ pathname: '/protected', storage, visitCount: 50, now })).toBe(false);
  });
});
