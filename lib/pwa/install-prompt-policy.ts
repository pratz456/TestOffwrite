/**
 * When to offer the "Add to Home Screen" banner. Browsers re-fire
 * `beforeinstallprompt` on every page load until the user acts, so the banner
 * must earn its place: never during sign-in or onboarding, only after a few
 * separate visits, and a "Not now" is honored for a while rather than forever.
 */
export const INSTALL_VISIT_KEY = 'writeoff-pwa-visit-count';
export const INSTALL_SNOOZE_KEY = 'writeoff-pwa-install-snoozed-until';
/** Older builds stored a permanent dismissal under this key; it is still honored. */
export const LEGACY_DISMISS_KEY = 'writeoff-pwa-install-dismissed';
export const INSTALL_MIN_VISITS = 3;
export const INSTALL_SNOOZE_DAYS = 30;

export interface InstallPromptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const QUIET_ROUTES = [
  /^\/$/,
  /^\/welcome(?:\/|$)/,
  /^\/tools(?:\/|$)/,
  /^\/auth(?:\/|$)/,
  /^\/onboarding(?:\/|$)/,
  /^\/stripe(?:\/|$)/,
  /^\/protected\/onboarding(?:\/|$)/,
];

export function isQuietInstallRoute(pathname: string | null | undefined): boolean {
  return !!pathname && QUIET_ROUTES.some(route => route.test(pathname));
}

/** Count one visit per page load; returns the updated count. */
export function recordInstallVisit(storage: InstallPromptStorage): number {
  const previous = Number.parseInt(storage.getItem(INSTALL_VISIT_KEY) ?? '0', 10);
  const count = (Number.isFinite(previous) && previous >= 0 ? previous : 0) + 1;
  storage.setItem(INSTALL_VISIT_KEY, String(count));
  return count;
}

export function snoozeInstallPrompt(storage: InstallPromptStorage, now = new Date(), days = INSTALL_SNOOZE_DAYS): void {
  storage.setItem(INSTALL_SNOOZE_KEY, new Date(now.getTime() + days * 86_400_000).toISOString());
}

export function shouldOfferInstall(input: {
  pathname: string | null | undefined;
  storage: InstallPromptStorage;
  visitCount: number;
  now?: Date;
}): boolean {
  if (isQuietInstallRoute(input.pathname)) return false;
  if (input.storage.getItem(LEGACY_DISMISS_KEY) === 'true') return false;
  const snoozedUntil = Date.parse(input.storage.getItem(INSTALL_SNOOZE_KEY) ?? '');
  if (Number.isFinite(snoozedUntil) && snoozedUntil > (input.now ?? new Date()).getTime()) return false;
  return input.visitCount >= INSTALL_MIN_VISITS;
}
