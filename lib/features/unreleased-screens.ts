/**
 * Server-side switch for screens that are not part of the released app.
 * Read from server components and route handlers. Off unless the value is exactly "true".
 */
type Env = Record<string, string | undefined>;

const UNRELEASED_SCREENS = new Set(['form-8879', 'tax-filing-hub', 'tax-form-wizard']);

export function unreleasedScreensEnabled(env: Env = process.env): boolean {
  // Bracket access stays a runtime read. A static property would be folded in at build time.
  return env['FEATURE_UNRELEASED_SCREENS'] === 'true';
}

export function screenQueryValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  return raw.split('?')[0];
}

export function isUnreleasedScreen(screen: string | null | undefined): boolean {
  if (!screen) return false;
  return UNRELEASED_SCREENS.has(screen.split('?')[0]);
}

export function blockUnreleasedScreen(screen: string | null | undefined, env: Env = process.env): boolean {
  return !unreleasedScreensEnabled(env) && isUnreleasedScreen(screen);
}
