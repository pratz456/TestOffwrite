export const APP_NAVIGATION_EVENT = 'writeoff:request-navigation';

/** Editors can delay app navigation until the user resolves an unsaved draft. */
export function requestAppNavigation(href: string): boolean {
  if (typeof window === 'undefined') return true;
  return window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { cancelable: true, detail: { href } }));
}
